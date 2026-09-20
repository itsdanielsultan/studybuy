import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {OfflineStudyBuy,inspectQuote,quoteFingerprint} from './policy.mjs';
import {offerA,offerB,limits,NOW,receiptFor} from './fixtures.mjs';

const assets=new Map([['/','index.html'],['/app.js','app.js'],['/style.css','style.css'],['/Inter-Regular.ttf','Inter-Regular.ttf'],['/Inter-Bold.ttf','Inter-Bold.ttf']]);
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',ttf:'font/ttf'};
const publicDir=new URL('./public/',import.meta.url);
const quotes={A:offerA,B:offerB};
export function createDemoHandler(resolveOrigin){
 const sessions=new Map();
 return async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const origin=resolveOrigin(req);
  if(!origin||req.headers.host!==new URL(origin).host)return json(403,{error:'Unexpected host.'});
  if(req.headers.origin&&req.headers.origin!==origin)return json(403,{error:'Cross-origin requests are disabled.'});
  const url=new URL(req.url,origin);
  if(url.pathname==='/api/index'&&url.searchParams.has('studybuy_route'))url.pathname=`/api/${url.searchParams.get('studybuy_route')}`;
  if(req.method==='GET'&&assets.has(url.pathname)){
   const name=assets.get(url.pathname);try{const data=await readFile(new URL(name,publicDir));res.writeHead(200,{'Content-Type':types[name.split('.').pop()]});return res.end(data);}catch{return json(500,{error:'Demo asset unavailable.'});}
  }
  if(req.method!=='POST'||!['/api/offers','/api/approve','/api/retry','/api/reset'].includes(url.pathname))return json(404,{error:'Not found.'});
  if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'JSON required.'});
  let body='',data;try{if(req.body!==undefined){body=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(body.length>4096)return json(413,{error:'Request too large.'});}else{for await(const chunk of req){body+=chunk;if(body.length>4096)return json(413,{error:'Request too large.'});}}data=JSON.parse(body);}catch{return json(400,{error:'Invalid request.'});}
  if(!data||typeof data!=='object'||Array.isArray(data))return json(400,{error:'JSON object required.'});
  let sid=req.headers.cookie?.match(/(?:^|; )studybuy=([a-f0-9]{32})(?:;|$)/)?.[1];
  const now=Date.now();for(const [k,v]of sessions)if(now-v.last>3600000)sessions.delete(k);
  if(!sid||!sessions.has(sid)){if(sessions.size>=100)return json(429,{error:'Too many demo sessions.'});sid=randomBytes(16).toString('hex');sessions.set(sid,{engine:new OfflineStudyBuy(),last:now});res.setHeader('Set-Cookie',`studybuy=${sid}; HttpOnly; SameSite=Strict; Path=/${origin.startsWith('https:')?'; Secure':''}`);}
  const session=sessions.get(sid);session.last=now;
  if(url.pathname==='/api/reset'){
   if(data.action!=='reset-demo')return json(400,{error:'Explicit demo reset required.'});
   session.engine=new OfflineStudyBuy();delete session.attempt;
   return json(200,{status:'demo_reset'});
  }
  if(url.pathname==='/api/retry'){
   if(!session.attempt)return json(400,{error:'Run a simulation first.'});
   const a=session.attempt;return json(200,session.engine.claimSimulation(a.token,a.quote,a.constraints,NOW));
  }
  const c={...limits,budget:data.budget,deliveryBy:data.deliveryBy,edition:data.edition};
  if(url.pathname==='/api/offers')return json(200,{offers:Object.entries(quotes).map(([id,q])=>({id,quote:q,check:inspectQuote(q,c,NOW),fingerprint:quoteFingerprint(q,c)}))});
  const q=quotes[data.offerId];if(!q||data.approved!==true||!['success','timeout','changed'].includes(data.scenario))return json(400,{error:'Explicit simulation approval is required.'});
  const approved=session.engine.approveSimulation(q,c,{action:'approve-simulation',fingerprint:data.fingerprint},NOW);
  if(!approved.token)return json(200,approved);
  const dispatched=data.scenario==='changed'?{...q,item:q.item+1,total:q.total+1}:q;
  const attempt=session.engine.claimSimulation(approved.token,dispatched,c,NOW);
  if(!attempt.attemptId)return json(200,attempt);
  session.attempt={token:approved.token,quote:q,constraints:c};
  return json(200,session.engine.reconcileSimulation(attempt.attemptId,data.scenario==='timeout'?{kind:'timeout'}:receiptFor(q)));
 };
}
export function createDemoServer(){
 const handler=createDemoHandler(()=>`http://127.0.0.1:${server.address().port}`);
 const server=http.createServer(handler);
 return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.STUDYBUY_PORT||4187);
 createDemoServer().listen(port,'127.0.0.1',()=>console.log(`StudyBuy local simulation: http://127.0.0.1:${port}`));
}
