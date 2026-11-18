'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let current;
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=current;next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({text})=>/COUNT\(\*\) AS Total/.test(text)?[{Total:0}]:[]);
const scopePath=require.resolve('../services/visible-scope'),scope=require('../services/visible-scope');
require.cache[scopePath].exports={...scope,getVisibleScope:async user=>({all:false,basis:'OWN',userIds:[],empIds:[String(require('../services/business-identity').businessIds(user).effective)]})};
const user=(actor)=>({sub:8,actorSub:actor,role:'MANAGER',actorRole:'MANAGER',isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:actor,businessEffectiveUserId:28,businessActorUserId:actor+20}});
let app;test.before(async()=>{app=await h.startApp([['/api/master','../../routes/master']]);});test.after(async()=>app.close());
test('invoice and aging paths intersect mapped effective and actual actor scopes',async()=>{
 current=user(17);
 for(const [url,pattern,prefix] of [['/api/master/invoices',/FROM dbo\.SOInvHD h/,'iv'],['/api/master/aging?bust=1',/TicketLeft AS \(/,'ag'],['/api/master/aging/search?all=1',/TicketLeft AS \(/,'as']]){
  const start=db.calls.length,r=await app.call('GET',url);assert.equal(r.status,200,JSON.stringify(r.body));
  const sqls=db.calls.slice(start).filter(c=>pattern.test(c.text));assert.equal(sqls.length,url.includes('/search')?2:1);
  for(const call of sqls){assert.match(call.text,new RegExp('@'+prefix+'EffectiveE0'));assert.match(call.text,new RegExp('@'+prefix+'ActorE0'));assert.equal(call.inputs[prefix+'EffectiveE0'],'28');assert.equal(call.inputs[prefix+'ActorE0'],'37');assert.equal(call.inputs.globalStartDate,'2026-01-01');}
 }
});
test('aging cache separates two actors impersonating the same effective user',async()=>{
 let start=db.calls.length;current=user(17);let a=await app.call('GET','/api/master/aging');assert.equal(a.status,200);assert.equal(db.calls.slice(start).filter(c=>/TicketLeft AS \(/.test(c.text)).length,0);
 start=db.calls.length;current=user(18);a=await app.call('GET','/api/master/aging');assert.equal(a.status,200);const query=db.calls.slice(start).find(c=>/TicketLeft AS \(/.test(c.text));assert.ok(query);assert.equal(query.inputs.agActorE0,'38');
});
