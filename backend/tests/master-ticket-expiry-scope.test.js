'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let principal,ownerEmp,withinTx,scopeAllowed,applied,received;
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{
  requireAuth:(req,_res,next)=>{req.user=principal;require('../services/request-context').runWithUser(principal,next);},
  requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next()),
}};
const db=h.installDbStub(({text,inputs,kind})=>{
  if(/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(text))return [{Id:inputs.id,EmpId:Number(inputs.id)+1000,PositionCode:null}];
  if(/SELECT CAST\(s\.EmpID AS VARCHAR/.test(text))return [{EmpID:ownerEmp}];
  if(/SELECT c\.CouponID FROM dbo\.WFCoupon c WITH \(UPDLOCK,HOLDLOCK\)/.test(text)){assert.equal(kind,'tx');withinTx=true;return [{CouponID:42}];}
  if(/SELECT TOP 1 1 AS ok FROM dbo\.WFCoupon c/.test(text)){assert.equal(kind,'tx');return scopeAllowed?[{ok:1}]:[];}
  return [];
});
const ctx=require('../services/request-context');ctx.hasColumn=async()=>true;
const policy=require('../services/ticket-policy');
policy.updateTicketExpiryOverlay=async options=>{received=options;await options.authorizeInTransaction(db.tx,42);applied++;return {success:true};};
let app;test.before(async()=>{app=await h.startApp([['/api/master','../../routes/master']]);});test.after(async()=>app.close());
test.beforeEach(()=>{principal={sub:8,actorSub:17,role:'ADMIN',actorRole:'SALES',isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:34,businessActorUserId:47}};ownerEmp='1047';withinTx=false;scopeAllowed=true;applied=0;received=null;});
const url='/api/master/control-tickets/D42/expiry';
test('actual actor scope is checked even when the effective user sees all',async()=>{
 ownerEmp='1999';const r=await app.call('PATCH',url,{body:{exactId:42}});assert.equal(r.status,404);assert.equal(applied,0);assert.equal(withinTx,false);
});
test('transaction rechecks access before any expiry change',async()=>{
 scopeAllowed=false;const r=await app.call('PATCH',url,{body:{exactId:42}});assert.equal(r.status,404);assert.equal(withinTx,true);assert.equal(applied,0);
});
test('allowed change passes the mapped business effective ID to the audit service',async()=>{
 const r=await app.call('PATCH',url,{body:{exactId:42}});assert.equal(r.status,200);assert.equal(withinTx,true);assert.equal(applied,1);assert.equal(received.userId,34);
});
