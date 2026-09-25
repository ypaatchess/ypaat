const {getRedis}=require('../lib/store');
const {adminFromRequest,studentFromRequest}=require('../lib/auth');
const crypto=require('crypto');

const KEY='ypaat:studies';
const STUDENTS_KEY='ypaat:students';

function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});req.on('error',reject)})}
function ok(res,status,data){res.status(status).json(data)}
function clean(v){return String(v??'').trim()}
function normalizeChapterAssignments(value,studentIds,chapters){
 const out={};
 const allowed=new Set(chapters.map(ch=>ch.id));
 if(value&&typeof value==='object'){
  for(const id of studentIds){
   if(Array.isArray(value[id])){
    const ids=[...new Set(value[id].map(clean).filter(x=>allowed.has(x)))];
    if(ids.length)out[id]=ids;
   }
  }
 }
 return out;
}

async function load(redis,key){const raw=await redis.get(key);if(!raw)return [];try{const x=JSON.parse(raw);return Array.isArray(x)?x:[]}catch{return []}}
function safeStudy(s){return {...s,studentIds:Array.isArray(s.studentIds)?s.studentIds:[],chapterAssignments:s.chapterAssignments&&typeof s.chapterAssignments==='object'?s.chapterAssignments:{},chapters:Array.isArray(s.chapters)?s.chapters:[]}}
function canStudentView(study,id){return study.visibility==='public'||(study.studentIds||[]).includes(id)}
function safeStudyForStudent(s,id){
 const study=safeStudy(s);
 const assigned=study.chapterAssignments?.[id];
 if(Array.isArray(assigned)){
  const allowed=new Set(assigned);
  study.chapters=study.chapters.filter(ch=>allowed.has(ch.id));
 }
 return study;
}

module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store, max-age=0');
 try{
  const redis=await getRedis();
  const admin=await adminFromRequest(req);
  const student=await studentFromRequest(req);
  let studies=await load(redis,KEY);
  const students=await load(redis,STUDENTS_KEY);

  if(req.method==='GET'){
   const id=clean(req.query?.id);
   if(id){
    const study=studies.find(x=>x.id===id);
    if(!study)return ok(res,404,{error:'Study not found'});
    if(!admin&&!student)return ok(res,401,{error:'Login required'});
    if(!admin&&!canStudentView(study,student.id))return ok(res,403,{error:'You do not have access to this study'});
    return ok(res,200,{study:admin?safeStudy(study):safeStudyForStudent(study,student.id),students:admin?students.map(s=>({id:s.id,name:s.name,email:s.email})):[]});
   }
   if(admin)return ok(res,200,{studies:studies.map(safeStudy),students:students.map(s=>({id:s.id,name:s.name,email:s.email}))});
   // The student portal list should contain only studies explicitly shared with this student.
   // Public studies remain accessible when the student has the direct study link.
   if(student)return ok(res,200,{studies:studies.filter(s=>(s.visibility!=='public'&&(s.studentIds||[]).includes(student.id))).map(safeStudy)});
   return ok(res,401,{error:'Login required'});
  }

  if(!admin)return ok(res,401,{error:'Administrator login required'});
  const b=await body(req);

  if(req.method==='POST'){
   const normalizeChapters=arr=>Array.isArray(arr)?arr.map(ch=>({
     id:clean(ch.id)||crypto.randomUUID(),
     title:clean(ch.title)||'Untitled chapter',
     startFen:clean(ch.startFen)||'start',
     notes:String(ch.notes??''),
     moves:Array.isArray(ch.moves)?ch.moves.map(m=>({
       from:clean(m.from),to:clean(m.to),promotion:clean(m.promotion)||undefined,san:clean(m.san),
       comment:String(m.comment??''),nags:Array.isArray(m.nags)?m.nags.map(clean).filter(Boolean):[],parentId:clean(m.parentId)||null,id:clean(m.id)||crypto.randomUUID()
     })):[],
     pgn:String(ch.pgn??''),
     sourceUrl:clean(ch.sourceUrl),
     sourceStudyId:clean(ch.sourceStudyId),
     sourceChapterId:clean(ch.sourceChapterId),
     parseError:clean(ch.parseError),
     shapesByPly:ch.shapesByPly&&typeof ch.shapesByPly==='object'?ch.shapesByPly:{},
     exercises:ch.exercises&&typeof ch.exercises==='object'?ch.exercises:{}
   })).filter(ch=>ch.title||ch.moves.length):[];

   if(Array.isArray(b.studies)){
     if(!b.studies.length)return ok(res,400,{error:'At least one study is required'});
     const now=new Date().toISOString();
     const created=b.studies.map(spec=>{
       const title=clean(spec.title),description=clean(spec.description??b.description);
       const visibility=(spec.visibility||b.visibility)==='public'?'public':'assigned';
       const studentIds=[...new Set((Array.isArray(spec.studentIds)?spec.studentIds:(Array.isArray(b.studentIds)?b.studentIds:[])).map(clean).filter(Boolean))].filter(id=>students.some(s=>s.id===id));
       const imported=normalizeChapters(spec.chapters);
       const firstChapter={id:crypto.randomUUID(),title:'Chapter 1',startFen:'start',notes:'',moves:[],shapesByPly:{},exercises:{}};
       const chapters=imported.length?imported:[firstChapter];
       return {id:crypto.randomUUID(),title:title||'Imported YPAAT Study',description,visibility,studentIds,chapterAssignments:normalizeChapterAssignments(spec.chapterAssignments||b.chapterAssignments,studentIds,chapters),chapters,createdAt:now,updatedAt:now};
     });
     studies.push(...created);await redis.set(KEY,JSON.stringify(studies));
     return ok(res,201,{studies:created.map(s=>({id:s.id,title:s.title,description:s.description,visibility:s.visibility,chapterCount:s.chapters.length}))});
   }

   const title=clean(b.title),description=clean(b.description);
   const visibility=b.visibility==='public'?'public':'assigned';
   const studentIds=[...new Set((Array.isArray(b.studentIds)?b.studentIds:[]).map(clean).filter(Boolean))].filter(id=>students.some(s=>s.id===id));
   if(!title)return ok(res,400,{error:'Study title is required'});
   const now=new Date().toISOString();
   const imported=normalizeChapters(b.chapters);
   const firstChapter={id:crypto.randomUUID(),title:'Chapter 1',startFen:'start',notes:'',moves:[],shapesByPly:{},exercises:{}};
   const chapters=imported.length?imported:[firstChapter];
   const study={id:crypto.randomUUID(),title,description,visibility,studentIds,chapterAssignments:normalizeChapterAssignments(b.chapterAssignments,studentIds,chapters),chapters,createdAt:now,updatedAt:now};
   studies.push(study);await redis.set(KEY,JSON.stringify(studies));
   return ok(res,201,{study:safeStudy(study)});
  }

  if(req.method==='PUT'){
   const i=studies.findIndex(s=>s.id===b.id);
   if(i<0)return ok(res,404,{error:'Study not found'});
   const title=clean(b.title),description=clean(b.description);
   if(!title)return ok(res,400,{error:'Study title is required'});
   const visibility=b.visibility==='public'?'public':'assigned';
   const studentIds=[...new Set((Array.isArray(b.studentIds)?b.studentIds:[]).map(clean).filter(Boolean))].filter(id=>students.some(s=>s.id===id));
   const chapters=Array.isArray(b.chapters)?b.chapters.map(ch=>({
     id:clean(ch.id)||crypto.randomUUID(),
     title:clean(ch.title)||'Untitled chapter',
     startFen:clean(ch.startFen)||'start',
     notes:String(ch.notes??''),
     moves:Array.isArray(ch.moves)?ch.moves.map(m=>({from:clean(m.from),to:clean(m.to),promotion:clean(m.promotion)||undefined,san:clean(m.san),comment:String(m.comment??''),nags:Array.isArray(m.nags)?m.nags.map(clean).filter(Boolean):[],parentId:clean(m.parentId)||null,id:clean(m.id)||crypto.randomUUID()})):[],
     pgn:String(ch.pgn??''),
     sourceUrl:clean(ch.sourceUrl),
     sourceStudyId:clean(ch.sourceStudyId),
     sourceChapterId:clean(ch.sourceChapterId),
     parseError:clean(ch.parseError),
     shapesByPly:ch.shapesByPly&&typeof ch.shapesByPly==='object'?ch.shapesByPly:{},
     exercises:ch.exercises&&typeof ch.exercises==='object'?ch.exercises:{}
   })):studies[i].chapters;
   const chapterAssignments=normalizeChapterAssignments(b.chapterAssignments,studentIds,chapters);
   const item={...studies[i],title,description,visibility,studentIds,chapterAssignments,chapters,updatedAt:new Date().toISOString()};
   studies[i]=item;await redis.set(KEY,JSON.stringify(studies));
   return ok(res,200,{study:safeStudy(item)});
  }

  if(req.method==='DELETE'){
   const ids=Array.isArray(b.ids)?[...new Set(b.ids.map(clean).filter(Boolean))]:(clean(b.id)?[clean(b.id)]:[]);
   if(!ids.length)return ok(res,400,{error:'Study id(s) required'});
   const idSet=new Set(ids);
   const next=studies.filter(s=>!idSet.has(s.id));
   const deleted=studies.length-next.length;
   if(!deleted)return ok(res,404,{error:'Study not found'});
   await redis.set(KEY,JSON.stringify(next));
   return ok(res,200,{ok:true,deleted});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error(e);return res.status(500).json({error:'Study service error'})}
};