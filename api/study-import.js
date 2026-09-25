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
  const text=String(pgn||'').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim();
  if(!text)return [];
  const starts=[];const re=/^\s*\[Event\s+/gm;let m;
  while((m=re.exec(text)))starts.push(m.index);
  if(!starts.length)return [text];
  return starts.map((start,i)=>text.slice(start,i+1<starts.length?starts[i+1]:text.length).trim()).filter(Boolean);
}
function tags(pgn){
  const out={};
  const re=/^\s*\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"])*)"\]\s*$/gm;let m;
  while((m=re.exec(pgn)))out[m[1]]=m[2].replace(/\\(["\\])/g,'$1');
  return out;
}
function tag(pgn,name){return tags(pgn)[name]||''}
function stripVariationsAndComments(game){
  let out=game;
  // Remove semicolon comments and nested RAVs without touching the header section.
  out=out.replace(/;[^\r\n]*/g,' ');
  out=out.replace(/\{[^}]*\}/gs,' ');
  let previous='';
  while(previous!==out){
    previous=out;
    out=out.replace(/\([^()]*\)/g,' ');
  }
  out=out.replace(/\$\d+/g,' ');
  return out;
}
function parseChapter(game,index){
  const h=tags(game);
  const title=h.ChapterName||h.Event||('Chapter '+(index+1));
  const startFen=h.FEN||'start';
  const sourceUrl=h.ChapterURL||'';
  const source=parseLichessStudyUrl(sourceUrl);
  let moves=[];
  let parseError='';
  const load=(text)=>{
    const chess=startFen!=='start'?new Chess(startFen):new Chess();
    chess.loadPgn(text,{strict:false});
    const hist=chess.history({verbose:true});
    return hist.map(m=>({
      id:crypto.randomUUID(),
      parentId:null,
      from:m.from,
      to:m.to,
      promotion:m.promotion||'q',
      san:m.san,
      comment:''
    }));
  };
  try{
    moves=load(game);
  }catch(e){
    parseError=e?.message||'PGN parse failed';
    try{
      moves=load(stripVariationsAndComments(game));
    }catch(e2){
      parseError=e2?.message||parseError;
      moves=[];
    }
  }
  moves.forEach((m,i)=>{m.parentId=i?moves[i-1].id:null});
  return {
    id:crypto.randomUUID(),
    title,
    startFen,
    notes:'Imported from Lichess',
    moves,
    pgn:game,
    sourceUrl,
    sourceStudyId:source?.studyId||'',
    sourceChapterId:source?.chapterId||'',
    parseError,
    shapesByPly:{},
    exercises:{}
  };
}
function parsePgn(pgn,sourceId){
  const games=splitGames(pgn);
  const chapters=games.map(parseChapter);
  const groups=new Map();
  for(const chapter of chapters){
    const studyName=tag(chapter.pgn,'StudyName')||'Imported Lichess Study';
    const groupKey=(chapter.sourceStudyId||sourceId||'unknown')+'::'+studyName;
    if(!groups.has(groupKey))groups.set(groupKey,{sourceStudyId:chapter.sourceStudyId||sourceId||'',title:studyName,chapters:[]});
    groups.get(groupKey).chapters.push(chapter);
  }
  const studies=[...groups.values()].map((g,i)=>({
    studyId:g.sourceStudyId||sourceId||('lichess-'+i+1),
    title:g.title,
    description:'Imported from Lichess',
    chapters:g.chapters,
    chapterCount:g.chapters.length
  }));
  const first=studies[0]||{studyId:sourceId||'lichess',title:'Imported Lichess Study',chapters:[]};
  return {
    studyId:first.studyId,
    title:first.title,
    chapters:first.chapters,
    chapterCount:first.chapterCount,
    studies
  };
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
    const exportUrl=parsed.chapterId
      ? 'https://lichess.org/api/study/'+encodeURIComponent(parsed.studyId)+'/'+encodeURIComponent(parsed.chapterId)+'.pgn?comments=true&variations=true&clocks=false'
      : 'https://lichess.org/api/study/'+encodeURIComponent(parsed.studyId)+'.pgn?comments=true&variations=true&clocks=false';
    let response;
    try{
      response=await fetch(exportUrl,{headers:{Accept:'application/x-chess-pgn','User-Agent':'YPAAT-Chess-Academy-Study-Importer'}});
    }catch(e){
      return ok(res,502,{error:'YPAAT could not reach Lichess from the server. Retrying from your browser is required.',clientFetchUrl:exportUrl});
    }
    if(!response.ok){
      return ok(res,response.status===404?404:502,{error:response.status===404?'Lichess study or chapter was not found.':'Lichess did not allow the server export. Retrying from your browser may work if the study is public.',clientFetchUrl:exportUrl,lichessStatus:response.status});
    }
    const pgn=await response.text();
    if(!pgn.trim())return ok(res,400,{error:'Lichess returned an empty study/chapter.'});
    return ok(res,200,parsePgn(pgn,parsed.studyId));
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'Lichess study import failed'});
  }
};
