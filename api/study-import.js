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
function stripHeaders(game){
  return String(game||'').replace(/^(?:\\s*\\[[^\\n]*\\]\\s*)+/,'').trim();
}
function tokenizeMovetext(game){
  const text=stripHeaders(game).replace(/\\r\\n/g,'\\n');
  const tokens=[];
  let i=0;
  while(i<text.length){
    const ch=text[i];
    if(/\\s/.test(ch)){i++;continue}
    if(ch==='('||ch===')'){tokens.push({type:ch});i++;continue}
    if(ch==='{'){
      let j=i+1,depth=1;
      while(j<text.length&&depth){
        if(text[j]==='{')depth++;
        else if(text[j]==='}')depth--;
        j++;
      }
      tokens.push({type:'comment',value:text.slice(i+1,Math.max(i+1,j-1)).trim()});
      i=j;continue;
    }
    if(ch===';'){
      const j=text.indexOf('\\n',i);
      tokens.push({type:'comment',value:text.slice(i+1,j<0?text.length:j).trim()});
      i=j<0?text.length:j;continue;
    }
    let j=i+1;
    while(j<text.length&&!/[\\s(){};]/.test(text[j]))j++;
    tokens.push({type:'word',value:text.slice(i,j)});
    i=j;
  }
  return tokens;
}
function isMoveNumber(token){
  return /^\\d+\\.(?:\\.\\.)?$/.test(token)||/^\\d+\\.\\.\\.$/.test(token);
}
function isResult(token){return /^(1-0|0-1|1\\/2-1\\/2|\\*)$/.test(token)}
function parseStructuredPgn(game,startFen){
  const chess=startFen!=='start'?new Chess(startFen):new Chess();
  const tokens=tokenizeMovetext(game);
  const moves=[];
  const stack=[];
  let currentId=null;
  let currentBeforeFen=chess.fen();
  let pendingNags=[];
  let chapterNote='';
  const byId=new Map();

  function addComment(value){
    if(!value)return;
    const node=currentId?byId.get(currentId):null;
    if(node)node.comment=node.comment?node.comment+'\\n'+value:value;
    else chapterNote=chapterNote?chapterNote+'\\n'+value:value;
  }
  function addNag(value){
    if(!value)return;
    const node=currentId?byId.get(currentId):null;
    if(node)node.nags=[...(node.nags||[]),value];
    else pendingNags.push(value);
  }

  for(const token of tokens){
    if(token.type==='comment'){addComment(token.value);continue}
    if(token.type==='('){
      if(currentId){
        const current=byId.get(currentId);
        stack.push({fen:currentBeforeFen,parentId:current.parentId});
        chess.load(currentBeforeFen);
        currentId=current.parentId||null;
        currentBeforeFen=chess.fen();
      }else{
        stack.push({fen:chess.fen(),parentId:null});
      }
      continue;
    }
    if(token.type===')'){
      const state=stack.pop();
      if(state){
        chess.load(state.fen);
        currentId=state.parentId||null;
        currentBeforeFen=state.fen;
      }
      continue;
    }

    const word=token.value;
    if(isMoveNumber(word)||/^\\.+$/.test(word))continue;
    if(isResult(word))continue;
    if(/^\\$\\d+$/.test(word)){addNag(word);continue}
    if(/^(?:!!|!\\?|\\?!|\\?\\?|!|\\?)$/.test(word)){addNag(word);continue}

    const beforeFen=chess.fen();
    let made;
    try{
      made=chess.move(word,{sloppy:true});
    }catch(e){
      throw new Error('Could not parse move "'+word+'"');
    }
    const node={
      id:crypto.randomUUID(),
      parentId:currentId,
      from:made.from,
      to:made.to,
      promotion:made.promotion||'q',
      san:made.san,
      comment:'',
      nags:pendingNags
    };
    pendingNags=[];
    moves.push(node);
    byId.set(node.id,node);
    currentId=node.id;
    currentBeforeFen=beforeFen;
  }
  if(stack.length)throw new Error('Unclosed PGN variation');
  return {moves,notes:chapterNote};
}
function parseChapter(game,index){
  const h=tags(game);
  const title=h.ChapterName||h.Event||('Chapter '+(index+1));
  const startFen=h.FEN||'start';
  const sourceUrl=h.ChapterURL||'';
  const source=parseLichessStudyUrl(sourceUrl);
  let moves=[];
  let parseError='';
  let importedNotes='';
  try{
    const parsed=parseStructuredPgn(game,startFen);
    moves=parsed.moves;
    importedNotes=parsed.notes;
  }catch(e){
    parseError=e?.message||'PGN parse failed';
  }
  return {
    id:crypto.randomUUID(),
    title,
    startFen,
    notes:importedNotes||'Imported from Lichess',
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
