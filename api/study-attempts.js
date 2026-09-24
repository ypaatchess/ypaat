const {getRedis}=require('../lib/store');
const {adminFromRequest,studentFromRequest}=require('../lib/auth');
const crypto=require('crypto');

const KEY='ypaat:study-attempts';
const STUDIES_KEY='ypaat:studies';
const STUDENTS_KEY='ypaat:students';

function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});req.on('error',reject)})}
function clean(v){return String(v??'').trim()}
async function load(redis,key){const raw=await redis.get(key);if(!raw)return [];try{const x=JSON.parse(raw);return Array.isArray(x)?x:[]}catch{return []}}

module.exports=async function(req,res){
 try{
  const redis=await getRedis();
  const admin=await adminFromRequest(req);
  const student=await studentFromRequest(req);
  const attempts=await load(redis,KEY);
  const studies=await load(redis,STUDIES_KEY);
  const students=await load(redis,STUDENTS_KEY);

  if(req.method==='GET'){
   if(!admin)return res.status(401).json({error:'Administrator login required'});
   const studyId=clean(req.query?.studyId);
   const studentId=clean(req.query?.studentId);
   const filtered=attempts.filter(a=>(!studyId||a.studyId===studyId)&&(!studentId||a.studentId===studentId));
   return res.status(200).json({attempts:filtered.sort((a,b)=>new Date(b.completedAt)-new Date(a.completedAt)),studies:studies.map(s=>({id:s.id,title:s.title})),students:students.map(s=>({id:s.id,name:s.name,email:s.email}))});
  }

  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!student)return res.status(401).json({error:'Student login required'});
  const b=await body(req);
  const studyId=clean(b.studyId),chapterId=clean(b.chapterId);
  const study=studies.find(s=>s.id===studyId);
  if(!study)return res.status(404).json({error:'Study not found'});
  if(!(study.visibility==='public'||(study.studentIds||[]).includes(student.id)))return res.status(403).json({error:'You do not have access to this study'});
  const chapter=(study.chapters||[]).find(c=>c.id===chapterId);
  if(!chapter)return res.status(404).json({error:'Chapter not found'});
  const lineLength=Math.max(0,Number(b.lineLength)||0);
  const completedMoves=Math.max(0,Math.min(lineLength,Number(b.completedMoves)||lineLength));
  const wrongMoves=Math.max(0,Number(b.wrongMoves)||0);
  const wrongEvents=Array.isArray(b.wrongEvents)?b.wrongEvents.slice(0,100).map(x=>({step:Math.max(1,Number(x.step)||1),expected:clean(x.expected),actual:clean(x.actual),at:clean(x.at)||new Date().toISOString()})):[];
  const now=new Date().toISOString();
  const attempt={id:crypto.randomUUID(),studyId,chapterId,studentId:student.id,completedMoves,lineLength,wrongMoves,wrongEvents,completed:completedMoves>=lineLength,completedAt:now};
  attempts.push(attempt);
  await redis.set(KEY,JSON.stringify(attempts));
  return res.status(201).json({attempt});
 }catch(e){console.error(e);return res.status(500).json({error:'Study attempt service error'})}
};