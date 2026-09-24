const {getRedis}=require('../lib/store');
const {adminFromRequest,studentFromRequest}=require('../lib/auth');
const crypto=require('crypto');

const KEY='ypaat:classes';
const STUDENTS_KEY='ypaat:students';
const IST_OFFSET='+05:30';

function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});req.on('error',reject)})}
function ok(res,status,data){res.status(status).json(data)}
function clean(v){return String(v??'').trim()}
async function load(redis,key){const raw=await redis.get(key);if(!raw)return [];try{const x=JSON.parse(raw);return Array.isArray(x)?x:[]}catch{return []}}
function toStoredDate(value){
  const v=clean(value);
  if(!v)return null;
  if(/[zZ]$|[+-]\d\d:\d\d$/.test(v)) return new Date(v);
  return new Date(v+IST_OFFSET);
}
function publicClass(c){return {id:c.id,className:c.className,meetingUrl:c.meetingUrl,zoomUrl:c.zoomUrl,dateTime:c.dateTime,studentIds:c.studentIds||[],createdAt:c.createdAt,updatedAt:c.updatedAt}}
function splitClasses(classes){
  const now=Date.now(), current=[], future=[], past=[];
  classes.forEach(c=>{
    const t=toStoredDate(c.dateTime)?.getTime();
    if(!Number.isFinite(t)) return;
    if(t<=now && now<t+60*60*1000) current.push(c);
    else if(t>now) future.push(c);
    else past.push(c);
  });
  const asc=(a,b)=>toStoredDate(a.dateTime)-toStoredDate(b.dateTime);
  return {current:current.sort(asc),future:future.sort(asc),past:past.sort((a,b)=>toStoredDate(b.dateTime)-toStoredDate(a.dateTime))};
}
module.exports=async function(req,res){
 try{
  const redis=await getRedis();
  const studentSession=await studentFromRequest(req);
  if(req.method==='GET' && studentSession){
    const classes=await load(redis,KEY);
    const mine=classes.filter(c=>(c.studentIds||[]).includes(studentSession.id));
    const parts=splitClasses(mine);
    return ok(res,200,{current:parts.current.map(publicClass),future:parts.future.map(publicClass),past:parts.past.map(publicClass)});
  }
  if(!(await adminFromRequest(req))) return ok(res,401,{error:'Administrator login required'});
  const students=await load(redis,STUDENTS_KEY);
  let classes=await load(redis,KEY);
  if(req.method==='GET'){
    const active=splitClasses(classes);
    return ok(res,200,{
      current:active.current.map(publicClass),
      future:active.future.map(publicClass),
      classes:classes.map(publicClass),
      students:students.map(s=>({id:s.id,name:s.name,email:s.email}))
    });
  }
  const b=await body(req);
  const className=clean(b.className),meetingUrl=clean(b.meetingUrl),zoomUrl=clean(b.zoomUrl),dateTime=clean(b.dateTime);
  const studentIds=[...new Set((Array.isArray(b.studentIds)?b.studentIds:[]).map(clean).filter(Boolean))];
  if(!className||!meetingUrl||!zoomUrl||!dateTime||!studentIds.length)return ok(res,400,{error:'Class name, meeting URL, Zoom link, date and time, and at least one student are required'});
  try{new URL(meetingUrl);new URL(zoomUrl)}catch{return ok(res,400,{error:'Please enter valid meeting and Zoom URLs'})}
  const when=toStoredDate(dateTime);
  if(!when||Number.isNaN(when.getTime()))return ok(res,400,{error:'Please enter a valid class date and time'});
  const validIds=studentIds.filter(id=>students.some(s=>s.id===id));
  if(validIds.length!==studentIds.length)return ok(res,400,{error:'One or more selected students could not be found'});
  if(req.method==='POST'){
   const now=new Date().toISOString();
   const item={id:crypto.randomUUID(),className,meetingUrl,zoomUrl,dateTime:when.toISOString(),studentIds:validIds,createdAt:now,updatedAt:now};
   classes.push(item);await redis.set(KEY,JSON.stringify(classes));return ok(res,201,{class:publicClass(item)});
  }
  if(req.method==='PUT'){
   const i=classes.findIndex(c=>c.id===b.id);if(i<0)return ok(res,404,{error:'Class not found'});
   const item={...classes[i],className,meetingUrl,zoomUrl,dateTime:when.toISOString(),studentIds:validIds,updatedAt:new Date().toISOString()};
   classes[i]=item;await redis.set(KEY,JSON.stringify(classes));return ok(res,200,{class:publicClass(item)});
  }
  if(req.method==='DELETE'){
   const next=classes.filter(c=>c.id!==b.id);if(next.length===classes.length)return ok(res,404,{error:'Class not found'});
   await redis.set(KEY,JSON.stringify(next));return ok(res,200,{ok:true});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error(e);return res.status(500).json({error:'Class schedule service error'})}
};