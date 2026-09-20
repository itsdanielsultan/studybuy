import {createDemoHandler} from '../server.mjs';
// Public preview serves fictional sessions only. No payment credential or adapter.
const handle=createDemoHandler(req=>{
 const host=req.headers.host;
 return typeof host==='string'&&/^[a-z0-9-]+\.vercel\.app$/.test(host)?`https://${host}`:null;
});
export default handle;
