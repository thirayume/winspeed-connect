'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,role:'SALES',actorRole:'ADMIN',isImpersonating:true,
 identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:28,businessActorUserId:37}};
let state,auditFailure,scopeRevoked;
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{
 requireAuth:(req,_res,next)=>{req.user=user;require('../services/request-context').runWithUser(user,next);},
 requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs})=>{
 if(text.includes("COL_LENGTH('wf.ChangeEvent'"))return [{HasCol:1}];
 if(text.includes('SELECT 1 AS ok FROM wf.SalesTrip'))return kind==='tx'&&scopeRevoked?[]:[{ok:1}];
 if(text.includes('SELECT TripId, Status FROM wf.SalesTrip'))return [{TripId:2,Status:'DRAFT'}];
 if(text.includes('SELECT Id,TripId,Status,RequestedBy FROM wf.TripMultiCustomerApproval')){
  assert.equal(kind,'tx');assert.match(text,/UPDLOCK,HOLDLOCK/);return [{...state.request}];
 }
 if(text.includes('UPDATE wf.TripMultiCustomerApproval')){
  assert.equal(kind,'tx');assert.equal(inputs.aid,4);assert.equal(inputs.tid,2);
  if(state.request.Status!=='PENDING')return {rowsAffected:[0]};state.request.Status='CANCELLED';return {rowsAffected:[1]};
 }
 if(text.includes('INSERT INTO wf.ChangeEvent')){assert.equal(kind,'tx');if(auditFailure)throw Error('QA_AUDIT_FAILURE');state.audits.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async(fn,options)=>{assert.equal(options.isolationLevel,db.stub.sql.ISOLATION_LEVEL.SERIALIZABLE);const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}};
let app;test.before(async()=>{app=await h.startApp([['/api/trips','../../routes/trips']]);});test.after(async()=>app.close());
test.beforeEach(()=>{state={request:{Id:4,TripId:2,Status:'PENDING',RequestedBy:28},audits:[]};auditFailure=false;scopeRevoked=false;});
test('withdrawal and its mapped actor audit commit together; replay cannot fabricate another cancellation',async()=>{
 auditFailure=true;let r=await app.call('PATCH','/api/trips/2/multi-cust-approval/4/cancel');assert.equal(r.status,500);assert.equal(state.request.Status,'PENDING');assert.equal(state.audits.length,0);
 auditFailure=false;r=await app.call('PATCH','/api/trips/2/multi-cust-approval/4/cancel');assert.equal(r.status,200);assert.equal(state.request.Status,'CANCELLED');assert.equal(state.audits.length,1);
 assert.equal(state.audits[0].userId,'28');assert.equal(state.audits[0].actorUserId,'37');assert.equal(state.audits[0].reasonCode,'MULTI_CUST_TRIP');
 assert.equal((await app.call('PATCH','/api/trips/2/multi-cust-approval/4/cancel')).status,409);assert.equal(state.audits.length,1);
});
test('scope revocation, a different requester and an already approved request deny withdrawal without writes',async()=>{
 scopeRevoked=true;assert.equal((await app.call('PATCH','/api/trips/2/multi-cust-approval/4/cancel')).status,404);assert.equal(state.request.Status,'PENDING');
 scopeRevoked=false;state.request.RequestedBy=99;assert.equal((await app.call('PATCH','/api/trips/2/multi-cust-approval/4/cancel')).status,403);assert.equal(state.request.Status,'PENDING');
 state.request.RequestedBy=28;state.request.Status='APPROVED';assert.equal((await app.call('PATCH','/api/trips/2/multi-cust-approval/4/cancel')).status,409);assert.equal(state.request.Status,'APPROVED');assert.equal(state.audits.length,0);
});
