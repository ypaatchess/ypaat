const {getRedis}=require('../lib/store');
const {adminFromRequest,studentFromRequest}=require('../lib/auth');
const crypto=require('crypto');

const KEY='ypaat:homework';
const STUDENTS_KEY='ypaat:students';

function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});req.on('error',reject)})}
function ok(res,status,data){res.status(status).json(data)}
function clean(v){return String(v??'').trim()}
async function load(redis,key){const raw=await redis.get(key);if(!raw)return [];try{const x=JSON.parse(raw);return Array.isArray(x)?x:[]}catch{return []}}
function validLichessUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='lichess.org'}catch{return false}}
function publicHomework(h){return {id:h.id,topic:h.topic,date:h.date,lichessUrl:h.lichessUrl,studentIds:h.studentIds||[],createdAt:h.createdAt,updatedAt:h.updatedAt}}
module.exports=async function(req,res){
 try{
  const redis=await getRedis();
  if(req.method==='GET' && (await studentFromRequest(req))){
    const session=await studentFromRequest(req);
    const homework=await load(redis,KEY);
    return ok(res,200,{homework:homework.filter(h=>(h.studentIds||[]).includes(session.id)).map(publicHomework).sort((a,b)=>String(b.date).localeCompare(String(a.date)))});
  }
  if(!(await adminFromRequest(req))) return ok(res,401,{error:'Administrator login required'});
  const students=await load(redis,STUDENTS_KEY);
  let homework=await load(redis,KEY);
  if(req.method==='GET') return ok(res,200,{homework:homework.map(publicHomework),students:students.map(s=>({id:s.id,name:s.name,email:s.email}))});
  const b=await body(req);
  const topic=clean(b.topic),date=clean(b.date),lichessUrl=clean(b.lichessUrl);
  const studentIds=[...new Set((Array.isArray(b.studentIds)?b.studentIds:[]).map(clean).filter(Boolean))];
  if(!topic||!date||!lichessUrl||!studentIds.length)return ok(res,400,{error:'Topic, date, Lichess URL and at least one student are required'});
  if(!validLichessUrl(lichessUrl))return ok(res,400,{error:'Please enter a valid https://lichess.org URL'});
  const validIds=studentIds.filter(id=>students.some(s=>s.id===id));
  if(validIds.length!==studentIds.length)return ok(res,400,{error:'One or more selected students could not be found'});
  if(req.method==='POST'){
   const now=new Date().toISOString();const item={id:crypto.randomUUID(),topic,date,lichessUrl,studentIds:validIds,createdAt:now,updatedAt:now};
   homework.push(item);await redis.set(KEY,JSON.stringify(homework));return ok(res,201,{homework:publicHomework(item)});
  }
  if(req.method==='PUT'){
   const i=homework.findIndex(h=>h.id===b.id);if(i<0)return ok(res,404,{error:'Homework not found'});
   const existing=homework[i];const now=new Date().toISOString();const item={...existing,topic,date,lichessUrl,studentIds:validIds,updatedAt:now};
   homework[i]=item;await redis.set(KEY,JSON.stringify(homework));return ok(res,200,{homework:publicHomework(item)});
  }
  if(req.method==='DELETE'){
   const next=homework.filter(h=>h.id!==b.id);if(next.length===homework.length)return ok(res,404,{error:'Homework not found'});
   await redis.set(KEY,JSON.stringify(next));return ok(res,200,{ok:true});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error(e);return res.status(500).json({error:'Homework service error'})}
};