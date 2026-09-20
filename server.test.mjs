import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer,createDemoHandler} from './server.mjs';

async function setup(t){const s=createDemoServer();await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve);}));const base=`http://127.0.0.1:${s.address().port}`;let cookie='';return{base,async post(route,body,extra={}){const r=await fetch(`${base}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...extra},body:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return{status:r.status,body:await r.json()};}};}
const c={budget:4000,deliveryBy:'2026-09-21',edition:'2026'};
test('HTTP demo exposes only intended public files and refuses cross-origin writes',async t=>{const a=await setup(t);assert.equal((await fetch(a.base)).status,200);assert.equal((await fetch(a.base+'/policy.mjs')).status,404);assert.equal((await fetch(a.base+'/../README.md')).status,404);assert.equal((await a.post('offers',c,{Origin:'https://evil.example'})).status,403);assert.equal((await a.post('offers',null)).status,400);assert.equal((await a.post('offers',c,{'Content-Type':'text/plain'})).status,415);});
test('HTTP happy path requires exact explicit approval and blocks a duplicate',async t=>{const a=await setup(t);const offers=(await a.post('offers',c)).body.offers;assert.equal(offers[0].check.reason,'approval_required');assert.equal(offers[1].check.reason,'late_delivery');const body={...c,offerId:'A',fingerprint:offers[0].fingerprint,scenario:'success'};assert.equal((await a.post('approve',body)).status,400);assert.equal((await a.post('approve',{...body,approved:true})).body.status,'simulation_confirmed');assert.equal((await a.post('retry',{})).body.reason,'attempt_already_claimed');});
test('HTTP changed quote never reaches fictional receipt',async t=>{const a=await setup(t);const offers=(await a.post('offers',c)).body.offers;assert.equal((await a.post('approve',{...c,offerId:'A',fingerprint:offers[0].fingerprint,approved:true,scenario:'changed'})).body.reason,'quote_changed');});
test('HTTP timeout remains unknown and cannot retry a purchase attempt',async t=>{const a=await setup(t);const offers=(await a.post('offers',c)).body.offers;assert.equal((await a.post('approve',{...c,offerId:'A',fingerprint:offers[0].fingerprint,approved:true,scenario:'timeout'})).body.reason,'status_check_required');assert.equal((await a.post('retry',{})).body.reason,'attempt_already_claimed');});
test('HTTP budgets and browser sessions are independent',async t=>{const a=await setup(t);const offers=(await a.post('offers',{...c,budget:3900})).body.offers;assert.equal(offers[0].check.reason,'over_budget');const b=await setup(t);assert.equal((await b.post('retry',{})).status,400);});
test('Reset is explicit and affects only fictional session state',async t=>{const a=await setup(t);assert.equal((await a.post('reset',{})).status,400);assert.equal((await a.post('reset',{action:'reset-demo'})).body.status,'demo_reset');assert.equal((await a.post('retry',{})).status,400);});

async function previewRequest(handler,{body=c,headers={},url='/api/index?studybuy_route=offers'}={}){
 const result={headers:{}};
 await handler({method:'POST',url,body,headers:{host:'studybuy-preview.vercel.app','content-type':'application/json',...headers}},
  {setHeader(k,v){result.headers[k.toLowerCase()]=v;},writeHead(status,h={}){result.status=status;Object.assign(result.headers,h);},end(value){result.body=JSON.parse(value);}});
 return result;
}
test('HTTPS preview supports parsed JSON, explicit rewrites and secure session cookies',async()=>{
 const handler=createDemoHandler(()=> 'https://studybuy-preview.vercel.app');
 const result=await previewRequest(handler);
 assert.equal(result.status,200);assert.equal(result.body.offers.length,2);
 assert.match(result.headers['set-cookie'],/HttpOnly; SameSite=Strict; Path=\/; Secure$/);
 assert.equal((await previewRequest(handler,{body:JSON.stringify(c)})).status,200);
 assert.equal((await previewRequest(handler,{url:'/api/index?studybuy_route=secret'})).status,404);
});
test('HTTPS preview rejects foreign hosts, origins, oversized or malformed parsed bodies',async()=>{
 const handler=createDemoHandler(()=> 'https://studybuy-preview.vercel.app');
 assert.equal((await previewRequest(handler,{headers:{host:'other.example'}})).status,403);
 assert.equal((await previewRequest(handler,{headers:{origin:'https://other.example'}})).status,403);
 assert.equal((await previewRequest(handler,{body:{padding:'x'.repeat(4100)}})).status,413);
 assert.equal((await previewRequest(handler,{body:'{broken'})).status,400);
});
test('A cold preview instance does not recover or repeat a previous fictional attempt',async()=>{
 const handler=createDemoHandler(()=> 'https://studybuy-preview.vercel.app');
 const result=await previewRequest(handler,{url:'/api/index?studybuy_route=retry',body:{},headers:{cookie:'studybuy=0123456789abcdef0123456789abcdef'}});
 assert.equal(result.status,400);assert.equal(result.body.error,'Run a simulation first.');
});
