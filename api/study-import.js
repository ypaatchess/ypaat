const {adminFromRequest}=require('../lib/auth');
const {Chess}=require('chess.js');
const crypto=require('crypto');

function ok(res,status,data){res.status(status).json(data)}
function clean(v){return String(v??'').trim()}
function readBody(req){
  if(req.body&&typeof req.body==='object')return Promise.resolve(req.body);
  return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});req.on('error',reject)});
}
function parseLichessStudyUrl(value){
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.hostname!=='lichess.org')return null;
    const parts=u.pathname.split('/').filter(Boolean);
    if(parts[0]!=='study'||!parts[1])return null;
    return {studyId:parts[1],chapterId:parts[2]||null};
  }catch{return null}
}
function splitGames(pgn){
  const text=String(pgn||'').replace(/^\uFEFF/,'').trim();
  if(!text)return [];
  const starts=[];const re=/^\s*\[Event\s+/gm;let m;
  while((m=re.exec(text)))starts.push(m.index);
  if(!starts.length)return [text];
  return starts.map((start,i)=>text.slice(start,i+1<starts.length?starts[i+1]:text.length).trim()).filter(Boolean);
}
function tag(pgn,name){
  const re=new RegExp('^\\s*\\['+name+'\\s+"([^"]*)"\\]','mi');
  return re.exec(pgn)?.[1]||'';
}
function parsePgn(pgn,sourceId){
  const games=splitGames(pgn);
  const chapters=games.map((game,index)=>{
    const title=tag(game,'ChapterName')||tag(game,'Event')||('Chapter '+(index+1));
    const startFen=tag(game,'FEN')||'start';
    const chess=startFen!=='start'?new Chess(startFen):new Chess();
    let moves=[];
    try{
      chess.loadPgn(game);
      const hist=chess.history({verbose:true});
      moves=hist.map(m=>({id:crypto.randomUUID(),parentId:null,from:m.from,to:m.to,promotion:m.promotion||'q',san:m.san,comment:''}));
      moves.forEach((m,i)=>{m.parentId=i?moves[i-1].id:null});
    }catch(e){}
    return {id:crypto.randomUUID(),title,startFen,notes:'Imported from Lichess',moves,pgn:game,shapesByPly:{},exercises:{}};
  });
  return {studyId:sourceId,title:tag(games[0]||'','StudyName')||('Imported Lichess Study '+sourceId),chapters,chapterCount:chapters.length};
}
module.exports=async function(req,res){
  try{
    const admin=await adminFromRequest(req);
    if(!admin)return ok(res,401,{error:'Administrator login required'});
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const raw=await readBody(req);
    const suppliedPgn=clean(raw.pgn);
    if(suppliedPgn){
      const parsed=parseLichessStudyUrl(clean(raw.url));
      return ok(res,200,parsePgn(suppliedPgn,parsed?.studyId||'lichess'));
    }
    const url=clean(raw.url);
    const parsed=parseLichessStudyUrl(url);
    if(!parsed)return ok(res,400,{error:'Enter a valid public Lichess study URL such as https://lichess.org/study/xxxxxxxx'});
    const exportUrl='https://lichess.org/api/study/'+encodeURIComponent(parsed.studyId)+'.pgn?comments=true&variations=true&clocks=false';
    let response;
    try{
      response=await fetch(exportUrl,{headers:{Accept:'application/x-chess-pgn','User-Agent':'YPAAT-Chess-Academy-Study-Importer'}});
    }catch(e){
      return ok(res,502,{error:'YPAAT could not reach Lichess from the server. Retrying from your browser is required.',clientFetchUrl:exportUrl});
    }
    if(!response.ok){
      return ok(res,response.status===404?404:502,{error:response.status===404?'Lichess study was not found.':'Lichess did not allow the server export. Retrying from your browser may work if the study is public.',clientFetchUrl:exportUrl,lichessStatus:response.status});
    }
    const pgn=await response.text();
    if(!pgn.trim())return ok(res,400,{error:'Lichess returned an empty study.'});
    return ok(res,200,parsePgn(pgn,parsed.studyId));
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'Lichess study import failed'});
  }
};
