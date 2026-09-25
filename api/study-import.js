const {adminFromRequest}=require('../lib/auth');

function ok(res,status,data){res.status(status).json(data)}
function clean(v){return String(v??'').trim()}

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

module.exports=async function(req,res){
  try{
    const admin=await adminFromRequest(req);
    if(!admin)return ok(res,401,{error:'Administrator login required'});
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const raw=req.body&&typeof req.body==='object'?req.body:{};
    const url=clean(raw.url);
    const parsed=parseLichessStudyUrl(url);
    if(!parsed)return ok(res,400,{error:'Enter a valid public Lichess study URL such as https://lichess.org/study/xxxxxxxx'});
    const exportUrl='https://lichess.org/api/study/'+encodeURIComponent(parsed.studyId)+'.pgn?comments=true&variations=true&clocks=false';
    const response=await fetch(exportUrl,{headers:{Accept:'application/x-chess-pgn','User-Agent':'YPAAT-Chess-Academy-Study-Importer'}});
    if(!response.ok)return ok(res,response.status===404?404:502,{error:'Lichess study could not be exported. Make sure the study is public and the URL is correct.'});
    const pgn=await response.text();
    if(!pgn.trim())return ok(res,400,{error:'Lichess returned an empty study.'});
    const games=splitGames(pgn);
    const chapters=games.map((game,index)=>({title:tag(game,'ChapterName')||tag(game,'Event')||('Chapter '+(index+1)),pgn:game}));
    return ok(res,200,{studyId:parsed.studyId,title:tag(games[0]||'','StudyName')||('Imported Lichess Study '+parsed.studyId),chapters,chapterCount:chapters.length});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'Lichess study import failed'});
  }
};