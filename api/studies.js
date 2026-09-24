const {getRedis}=require('../lib/store');
const {adminFromRequest,studentFromRequest}=require('../lib/auth');
const crypto=require('crypto');

const KEY='ypaat:studies';
const STUDENTS_KEY='ypaat:students';

function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});req.on('error',reject)})}
function ok(res,status,data){res.status(status).json(data)}
function clean(v){return String(v??'').trim()}
async function load(redis,key){const raw=await redis.get(key);if(!raw)return [];try{const x=JSON.parse(raw);return Array.isArray(x)?x:[]}catch{return []}}
function safeStudy(s){return {...s,studentIds:Array.isArray(s.studentIds)?s.studentIds:[],chapters:Array.isArray(s.chapters)?s.chapters:[]}}
function canStudentView(study,id){return study.visibility==='public'||(study.studentIds||[]).includes(id)}

module.exports=async function(req,res){
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
    return ok(res,200,{study:safeStudy(study),students:admin?students.map(s=>({id:s.id,name:s.name,email:s.email})):[]});
   }
   if(admin)return ok(res,200,{studies:studies.map(safeStudy),students:students.map(s=>({id:s.id,name:s.name,email:s.email}))});
   if(student)return ok(res,200,{studies:studies.filter(s=>canStudentView(s,student.id)).map(safeStudy)});
   return ok(res,401,{error:'Login required'});
  }

  if(!admin)return ok(res,401,{error:'Administrator login required'});
  const b=await body(req);

  if(req.method==='POST'){
   const title=clean(b.title),description=clean(b.description);
   const visibility=b.visibility==='public'?'public':'assigned';
   const studentIds=[...new Set((Array.isArray(b.studentIds)?b.studentIds:[]).map(clean).filter(Boolean))].filter(id=>students.some(s=>s.id===id));
   if(!title)return ok(res,400,{error:'Study title is required'});
   const now=new Date().toISOString();
   const firstChapter={id:crypto.randomUUID(),title:'Chapter 1',startFen:'start',notes:'',moves:[],shapesByPly:{},exercises:{}};
   const study={id:crypto.randomUUID(),title,description,visibility,studentIds,chapters:[firstChapter],createdAt:now,updatedAt:now};
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
     moves:Array.isArray(ch.moves)?ch.moves.map(m=>({from:clean(m.from),to:clean(m.to),promotion:clean(m.promotion)||undefined,san:clean(m.san),comment:String(m.comment??''),parentId:clean(m.parentId)||null,id:clean(m.id)||crypto.randomUUID()})):[],
     pgn:String(ch.pgn??''),
     shapesByPly:ch.shapesByPly&&typeof ch.shapesByPly==='object'?ch.shapesByPly:{}
   })):studies[i].chapters;
   const item={...studies[i],title,description,visibility,studentIds,chapters,updatedAt:new Date().toISOString()};
   studies[i]=item;await redis.set(KEY,JSON.stringify(studies));
   return ok(res,200,{study:safeStudy(item)});
  }

  if(req.method==='DELETE'){
   const next=studies.filter(s=>s.id!==b.id);
   if(next.length===studies.length)return ok(res,404,{error:'Study not found'});
   await redis.set(KEY,JSON.stringify(next));return ok(res,200,{ok:true});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error(e);return res.status(500).json({error:'Study service error'})}
};