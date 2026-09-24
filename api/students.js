const {getRedis}=require('../lib/store');
const {adminFromRequest}=require('../lib/auth');
const crypto=require('crypto');

const KEY='ypaat:students';
const LEVELS=['Beginner','Intermediate','Advanced'];

function body(req){
  return new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',c=>raw+=c);
    req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});
    req.on('error',reject);
  });
}
function ok(res,status,data){res.status(status).json(data)}
function hashPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.scryptSync(password,salt,64).toString('hex');
  return 'scrypt$'+salt+'$'+hash;
}
async function load(redis){
  const raw=await redis.get(KEY);
  if(!raw)return [];
  try{
    const students=JSON.parse(raw);
    return Array.isArray(students)?students:[];
  }catch{return []}
}
function clean(s){
  return String(s||'').trim();
}
function normalizeLevels(value){
  const list=Array.isArray(value)?value:[value];
  return [...new Set(list.map(clean).filter(x=>LEVELS.includes(x)))];
}
function publicStudent(s){
  const {passwordHash,...safe}=s;
  return safe;
}
module.exports=async function(req,res){
  try{
    if(!(await adminFromRequest(req))) return ok(res,401,{error:'Administrator login required'});
    const redis=await getRedis();
    let students=await load(redis);

    if(req.method==='GET'){
      return ok(res,200,{students:students.map(publicStudent),levels:LEVELS});
    }

    const b=await body(req);
    if(req.method==='POST'){
      const name=clean(b.name);
      const email=clean(b.email).toLowerCase();
      const password=String(b.password||'');
      const mobile=clean(b.mobile);
      const whatsapp=clean(b.whatsapp);
      const address=clean(b.address);
      const levels=normalizeLevels(b.levels);
      if(!name||!email||!password||!mobile||!levels.length) return ok(res,400,{error:'Name, email, password, mobile and at least one level are required'});
      if(students.some(s=>s.email===email)) return ok(res,409,{error:'A student with that email already exists'});
      const student={
        id:crypto.randomUUID(),name,email,passwordHash:hashPassword(password),
        mobile,whatsapp,address,levels,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
      };
      students.push(student);
      await redis.set(KEY,JSON.stringify(students));
      return ok(res,201,{student:publicStudent(student)});
    }

    if(req.method==='PUT'){
      const i=students.findIndex(s=>s.id===b.id);
      if(i<0)return ok(res,404,{error:'Student not found'});
      const name=clean(b.name),email=clean(b.email).toLowerCase(),mobile=clean(b.mobile);
      const whatsapp=clean(b.whatsapp),address=clean(b.address),levels=normalizeLevels(b.levels);
      if(!name||!email||!mobile||!levels.length)return ok(res,400,{error:'Name, email, mobile and at least one level are required'});
      if(students.some((s,j)=>j!==i&&s.email===email))return ok(res,409,{error:'A student with that email already exists'});
      const existing=students[i];
      students[i]={...existing,name,email,mobile,whatsapp,address,levels,updatedAt:new Date().toISOString()};
      if(String(b.password||''))students[i].passwordHash=hashPassword(String(b.password));
      await redis.set(KEY,JSON.stringify(students));
      return ok(res,200,{student:publicStudent(students[i])});
    }

    if(req.method==='DELETE'){
      const next=students.filter(s=>s.id!==b.id);
      if(next.length===students.length)return ok(res,404,{error:'Student not found'});
      await redis.set(KEY,JSON.stringify(next));
      return ok(res,200,{ok:true});
    }

    return res.status(405).json({error:'Method not allowed'});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'Student service error'});
  }
};