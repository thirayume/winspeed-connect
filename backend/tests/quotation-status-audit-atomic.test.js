'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true};
let state,failAudit=false,withContext=true;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;if(withContext)require('../services/request-context').runWithUser(user,next);else next();},requireCapability:()=>((_req,_res,next)=>next()),requireRole:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/AS Visible FROM wf\.Quotation/.test(text))return [{Visible:1}];
 if(/SELECT Status FROM wf\.Quotation WITH/.test(text)){assert.equal(kind,'tx');return [{Status:state.status}];}
 if(/UPDATE wf\.Quotation SET Status=@s/.test(text)){assert.equal(kind,'tx');state.status=inputs.s;return {rowsAffected:[1]};}
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(failAudit)throw Error('AUDIT_FAIL');state.events.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async fn=>{const old=structuredClone(state);try{return await fn(db.tx);}catch(e){state=old;throw e;}};
const ctx=require.resolve('../services/request-context'),original=require(ctx);require.cache[ctx].exports={...original,hasColumn:async()=>true};
let app;test.before(async()=>{app=await h.startApp([['/api/quotation','../../routes/quotation']]);});test.after(async()=>app.close());
test.beforeEach(()=>{state={status:'DRAFT',events:[]};failAudit=false;withContext=true;});
test('status update and mapped actor audit commit together and failure rolls back',async()=>{
 failAudit=true;let r=await app.call('PATCH','/api/quotation/5/status',{body:{status:'CANCELLED'}});assert.equal(r.status,500);assert.equal(state.status,'DRAFT');assert.equal(state.events.length,0);
 failAudit=false;r=await app.call('PATCH','/api/quotation/5/status',{body:{status:'CANCELLED'}});assert.equal(r.status,200);assert.equal(state.status,'CANCELLED');assert.equal(state.events[0].actorUserId,'17');assert.equal(state.events[0].userId,'8');
});
test('Access As without actor context rolls back the status change',async()=>{
 withContext=false;const r=await app.call('PATCH','/api/quotation/5/status',{body:{status:'CANCELLED'}});assert.equal(r.status,503);assert.equal(state.status,'DRAFT');assert.equal(state.events.length,0);
});
