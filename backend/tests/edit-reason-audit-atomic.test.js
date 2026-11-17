'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let state,failAudit=false;
const user={sub:8,actorSub:17,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true};
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;require('../services/request-context').runWithUser(user,next);},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/SELECT (ReasonCode|\*) FROM wf\.EditReason WITH/.test(text)){assert.equal(kind,'tx');return state.reason?[{...state.reason}]:[];}
 if(/SELECT COUNT\(\*\) AS n FROM wf\.EditRequest WITH/.test(text)){assert.equal(kind,'tx');return [{n:state.used}];}
 if(/INSERT INTO wf\.EditReason/.test(text)){assert.equal(kind,'tx');state.reason={ReasonCode:inputs.c,ReasonText:inputs.t,AppliesTo:inputs.a,RequiresHold:inputs.h,SortOrder:inputs.s,IsActive:inputs.i};return {rowsAffected:[1]};}
 if(/UPDATE wf\.EditReason SET/.test(text)){assert.equal(kind,'tx');state.reason.ReasonText=inputs.t;state.reason.IsActive=inputs.i;return {rowsAffected:[1]};}
 if(/DELETE FROM wf\.EditReason/.test(text)){assert.equal(kind,'tx');state.reason=null;return {rowsAffected:[1]};}
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(failAudit)throw Error('AUDIT_FAIL');state.audit.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async(fn,opts)=>{assert.equal(opts.isolationLevel,db.stub.sql.ISOLATION_LEVEL.SERIALIZABLE);const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}};
const ctx=require.resolve('../services/request-context'),real=require(ctx);require.cache[ctx].exports={...real,hasColumn:async()=>true};
let app;test.before(async()=>{app=await h.startApp([['/api/edit-requests','../../routes/edit-requests']]);});test.after(async()=>app.close());
test.beforeEach(()=>{state={reason:{ReasonCode:'QA',ReasonText:'Original',AppliesTo:'CONFIRMED',RequiresHold:0,SortOrder:1,IsActive:1},used:0,audit:[]};failAudit=false;});
for(const [method,path,body,action] of [['POST','/api/edit-requests/admin/reasons',{reasonCode:'QA',reasonText:'New',appliesTo:['CONFIRMED']},'CREATE'],['PUT','/api/edit-requests/admin/reasons/QA',{reasonText:'Changed',appliesTo:['CONFIRMED']},'UPDATE'],['DELETE','/api/edit-requests/admin/reasons/QA',undefined,'DELETE']]){
 test(`${action} reason and audit roll back together`,async()=>{
  if(method==='POST')state.reason=null;const before=structuredClone(state.reason);failAudit=true;let r=await app.call(method,path,{body});assert.equal(r.status,500);assert.deepEqual(state.reason,before);assert.equal(state.audit.length,0);
  failAudit=false;r=await app.call(method,path,{body});assert.equal(r.status,200);assert.equal(state.audit[0].action,action);assert.equal(state.audit[0].userId,'8');assert.equal(state.audit[0].actorUserId,'17');
 });
}
test('referenced reason cannot be removed or disabled',async()=>{
 state.used=1;let r=await app.call('DELETE','/api/edit-requests/admin/reasons/QA');assert.equal(r.status,409);
 r=await app.call('PUT','/api/edit-requests/admin/reasons/QA',{body:{reasonText:'Changed',appliesTo:['CONFIRMED'],isActive:false}});assert.equal(r.status,409);assert.equal(state.reason.IsActive,1);assert.equal(state.audit.length,0);
});
