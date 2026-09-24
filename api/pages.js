const {getRedis}=require('../lib/store');
const {adminFromRequest}=require('../lib/auth');
const crypto=require('crypto');
const KEY='ypaat:pages';
const seed=[
{title:'General Chess Curriculum',slug:'general-chess-curriculum',description:'Six progressive levels of chess topics.',status:'published',nav:'yes',content:'<h1>General Chess Curriculum</h1><p>YPAAT\'s general chess curriculum is organised into six progressive levels. The curriculum moves from board fundamentals and tactical patterns toward strategic planning, advanced endgames and practical defence.</p><h2>Level 1 — Foundations</h2><ul><li>The board and naming of squares</li><li>Moves of the pieces</li><li>Attacking, defending and checkmate</li><li>Castling, exchanges and notation</li><li>Basic tactics and winning material</li></ul><h2>Level 2 — Tactical Patterns</h2><ul><li>Piece activity and targets</li><li>Double attacks and pins</li><li>Elimination of defence</li><li>Discovered attacks</li></ul><h2>Levels 3–6</h2><p>Later levels introduce mating patterns, pawn structures, mobility, passed pawns, rook endings, king attacks, zugzwang, bishop endings, practical defence and deeper strategic concepts.</p>'},
{title:'Advanced Training',slug:'advanced-training',description:'Overview of YPAAT advanced training methodology.',status:'published',nav:'yes',content:'<h1>Advanced Training</h1><p>YPAAT\'s advanced training approach emphasises active calculation, strategic understanding and practical technique rather than passive content consumption.</p><h2>Core pillars</h2><ul><li><b>Tactical precision:</b> coordinated attacks, forcing moves and intermediate ideas.</li><li><b>Calculation discipline:</b> candidate moves, short variations and concrete evaluation.</li><li><b>Strategic depth:</b> pawn structures, weaknesses, space and exchanges.</li><li><b>Practical technique:</b> prophylaxis, conversion and endgame decision-making.</li></ul><h2>Training loop</h2><p>Study a position or game → solve timed exercises → evaluate the result → identify gaps → repeat targeted work.</p>'},
{title:'Opening Repertoire',slug:'opening-repertoire',description:'A flexible 1.Nf3 repertoire guide.',status:'published',nav:'yes',content:'<h1>1.Nf3 Opening Repertoire</h1><p>The 1.Nf3 move offers a flexible route into several opening families. YPAAT\'s guide focuses on plans, key squares, piece placement and model-game ideas rather than memorising moves in isolation.</p><h2>Against 1...d5</h2><p>A common plan is 2.c4, placing pressure on the centre and allowing transpositions into systems such as the Catalan.</p><h2>What to study</h2><ul><li>Central control and flexible pawn structures</li><li>Key squares and typical piece placement</li><li>Plans after transposition</li><li>Model games and practical middlegame ideas</li></ul>'}
];
function body(req){return new Promise((resolve,reject)=>{let r='';req.on('data',c=>r+=c);req.on('end',()=>{try{resolve(r?JSON.parse(r):{})}catch(e){reject(e)}});req.on('error',reject)})}
function ok(res,status,data){res.status(status).json(data)}
async function load(redis){let pages=await redis.get(KEY);if(!Array.isArray(pages)){pages=seed.map(p=>({...p,id:crypto.randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));await redis.set(KEY,pages)}return pages}
async function handler(req,res){
 try{
  const redis=await getRedis();
  if(req.query?.health==='1') return ok(res,200,{ok:true});
  if(req.method==='GET'){
    const pages=await load(redis);
    const slug=req.query?.slug;
    if(slug){const page=pages.find(p=>p.slug===slug&&p.status==='published');return page?ok(res,200,{page}):ok(res,404,{error:'Page not found'})}
    const isAdmin=!!(await adminFromRequest(req));
    return ok(res,200,{pages:isAdmin?pages:pages.filter(p=>p.status==='published')});
  }
  if(!(await adminFromRequest(req))) return ok(res,401,{error:'Administrator login required'});
  let pages=await load(redis);
  if(req.method==='POST'){
    const b=await body(req);if(!b.title||!b.slug||!b.content)return ok(res,400,{error:'Title, slug and content are required'});
    if(pages.some(p=>p.slug===b.slug))return ok(res,409,{error:'That URL slug already exists'});
    const page={id:crypto.randomUUID(),title:b.title,slug:b.slug,description:b.description||'',content:b.content,status:b.status==='draft'?'draft':'published',nav:b.nav==='yes'?'yes':'no',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    pages.push(page);await redis.set(KEY,pages);return ok(res,201,{page});
  }
  if(req.method==='PUT'){
    const b=await body(req);const i=pages.findIndex(p=>p.id===b.id);if(i<0)return ok(res,404,{error:'Page not found'});
    if(b.slug&&pages.some((p,j)=>j!==i&&p.slug===b.slug))return ok(res,409,{error:'That URL slug already exists'});
    pages[i]={...pages[i],title:b.title,slug:b.slug,description:b.description||'',content:b.content,status:b.status==='draft'?'draft':'published',nav:b.nav==='yes'?'yes':'no',updatedAt:new Date().toISOString()};
    await redis.set(KEY,pages);return ok(res,200,{page:pages[i]});
  }
  if(req.method==='DELETE'){
    const b=await body(req);const next=pages.filter(p=>p.id!==b.id);if(next.length===pages.length)return ok(res,404,{error:'Page not found'});await redis.set(KEY,next);return ok(res,200,{ok:true});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error(e);return res.status(500).json({error:'Page service error'})}
}
module.exports=handler;
