const crypto = require('crypto');
const { getRedis } = require('../lib/store');

const SESSION_TTL = 60 * 60 * 24 * 7;
const ADMIN_KEY = 'ypaat:admin';
const SESSION_PREFIX = 'ypaat:session:';

function json(res, status, body, extraHeaders={}) {
  Object.entries(extraHeaders).forEach(([k,v]) => res.setHeader(k,v));
  res.status(status).json(body);
}
function parseBody(req) {
  return new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',chunk=>{raw+=chunk});
    req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});
    req.on('error',reject);
  });
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{
    const i=x.indexOf('=');
    return [i<0?x:x.slice(0,i),i<0?'':decodeURIComponent(x.slice(i+1))];
  }));
}
function hashPassword(password) {
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.scryptSync(password,salt,64).toString('hex');
  return 'scrypt$'+salt+'$'+hash;
}
function verifyPassword(password,stored) {
  const parts=String(stored||'').split('$');
  if(parts.length!==3||parts[0]!=='scrypt') return false;
  const derived=crypto.scryptSync(password,parts[1],64);
  const expected=Buffer.from(parts[2],'hex');
  return expected.length===derived.length && crypto.timingSafeEqual(expected,derived);
}
async function adminFromRequest(req) {
  const token=cookies(req).ypaat_session;
  if(!token) return null;
  const redis=await getRedis();
  const raw=await redis.get(SESSION_PREFIX+token);
  if(!raw) return null;
  try{return JSON.parse(raw)}catch{return null}
}
async function login(req,res) {
  const body=await parseBody(req);
  const email=String(body.email||'').trim().toLowerCase();
  const password=String(body.password||'');
  if(!email||!password) return json(res,400,{error:'Email and password are required'});
  const redis=getRedis();
  const rawAdmin=await redis.get(ADMIN_KEY);
  let record=null;
  if(rawAdmin){try{record=JSON.parse(rawAdmin)}catch{record=null}}
  if(!record){
    const bootstrapEmail=String(process.env.YPAAT_ADMIN_EMAIL||'').trim().toLowerCase();
    const bootstrapPassword=String(process.env.YPAAT_ADMIN_PASSWORD||'');
    if(!bootstrapEmail||!bootstrapPassword) return json(res,503,{error:'Admin credentials are not configured'});
    if(email!==bootstrapEmail||password!==bootstrapPassword) return json(res,401,{error:'Invalid email or password'});
    record={email:bootstrapEmail,passwordHash:hashPassword(bootstrapPassword),createdAt:new Date().toISOString()};
    await redis.set(ADMIN_KEY,JSON.stringify(record));
  } else if(email!==record.email||!verifyPassword(password,record.passwordHash)) {
    return json(res,401,{error:'Invalid email or password'});
  }
  const token=crypto.randomBytes(32).toString('hex');
  await redis.set(SESSION_PREFIX+token,JSON.stringify({email:record.email}), {EX:SESSION_TTL});
  return json(res,200,{user:{email:record.email}},{
    'Set-Cookie':`ypaat_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`
  });
}
async function me(req,res) {
  const user=await adminFromRequest(req);
  return json(res,200,{user});
}
async function logout(req,res) {
  const token=cookies(req).ypaat_session;
  if(token) const redis=await getRedis(); await redis.del(SESSION_PREFIX+token);
  return json(res,200,{ok:true},{'Set-Cookie':'ypaat_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'});
}
module.exports={login,me,logout,adminFromRequest};
