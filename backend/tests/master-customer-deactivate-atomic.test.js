'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const principal={sub:8,actorSub:17,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:28,businessActorUserId:37}};
let state,ready,failAudit,withContext;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=principal;if(withContext)require('../services/request-context').runWithUser(principal,next);else next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs,proc})=>{
 if(/OBJECT_ID\('wf\.sp_MasterSetCustomerInactive'/.test(text))return [{Ready:ready?1:0}];
 if(/SELECT CustID, Inactive, InactiveDate/.test(text))return state.row?[structuredClone(state.row)]:[];
 if(proc==='wf.sp_MasterSetCustomerInactive'){assert.equal(kind,'proc');state.row.Inactive='I';state.row.InactiveDate='2026-11-15';return {output:{Affected:1}};}
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(failAudit)throw Error('AUDIT_FAILED');state.events.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async(fn,opts)=>{assert.equal(opts.isolationLevel,db.stub.sql.ISOLATION_LEVEL.SERIALIZABLE);const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}};
require('../services/request-context').hasColumn=async()=>true;
let app;test.before(async()=>{app=await h.startApp([['/api/master','../../routes/master']]);});test.after(async()=>app.close());
test.beforeEach(()=>{state={row:{CustID:42,Inactive:'A',InactiveDate:null},events:[]};ready=true;failAudit=false;withContext=true;});
test('deactivation and both mapped identities commit with the audit or roll back together',async()=>{
 failAudit=true;let r=await app.call('DELETE','/api/master/customers/42');assert.equal(r.status,500);assert.equal(state.row.Inactive,'A');assert.equal(state.events.length,0);
 failAudit=false;r=await app.call('DELETE','/api/master/customers/42');assert.equal(r.status,200);assert.equal(state.row.Inactive,'I');assert.equal(state.events.length,1);assert.equal(state.events[0].userId,'28');assert.equal(state.events[0].actorUserId,'37');assert.equal(JSON.parse(state.events[0].beforeJson).Inactive,'A');assert.equal(JSON.parse(state.events[0].afterJson).Inactive,'I');
});
test('missing procedure, missing context, and unknown customer fail before mutation',async()=>{
 ready=false;assert.equal((await app.call('DELETE','/api/master/customers/42')).status,503);assert.equal(state.row.Inactive,'A');
 ready=true;withContext=false;assert.equal((await app.call('DELETE','/api/master/customers/42')).status,503);assert.equal(state.row.Inactive,'A');
 withContext=true;state.row=null;assert.equal((await app.call('DELETE','/api/master/customers/42')).status,404);assert.equal(state.events.length,0);
});
