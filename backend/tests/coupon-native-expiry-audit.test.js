'use strict';
process.env.NODE_ENV='test';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let reservation,audits,failAudit,adapterCalls,fakeNative,sourceConflict;
const db=h.installDbStub(({kind,text,inputs})=>{
  if(/COL_LENGTH\('wf\.ChangeEvent'/.test(text))return [{HasCol:1}];
  if(/SELECT \* FROM wf\.CouponReservation WITH/.test(text))return [reservation];
  if(/UPDATE wf\.CouponReservation SET Status = 'EXPIRED'/.test(text)){assert.equal(kind,'tx');reservation.Status='EXPIRED';return {rowsAffected:[1]};}
  if(/FROM dbo\.WFCoupon c WITH \(UPDLOCK, HOLDLOCK\)/.test(text))return [{CouponID:42,CouponNo:'C-TEST',GoodID:3,RemaQty:4,SoDocuStatus:'A'}];
  if(/SELECT TOP 1 1 AS SourceConflict/.test(text))return sourceConflict?[{SourceConflict:1}]:[];
  if(/FROM wf\.AppUser u WITH/.test(text))return [{WinSpeedEmpId:44}];
  if(/INSERT INTO TEST_NATIVE/.test(text)){assert.equal(kind,'tx');fakeNative++;return {rowsAffected:[1]};}
  if(/UPDATE wf\.CouponReservation[\s\S]*SET Status = 'POSTED'/.test(text)){assert.equal(kind,'tx');reservation.Status='POSTED';return {rowsAffected:[1]};}
  if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(failAudit)throw Error('AUDIT_FAILED');audits.push(inputs);return {rowsAffected:[1]};}
  return [];
});
db.stub.wfTransaction=async fn=>{const before=structuredClone({reservation,audits,fakeNative});try{return await fn(db.tx);}catch(e){reservation=before.reservation;audits=before.audits;fakeNative=before.fakeNative;throw e;}};
const ticketPolicy=require.resolve('../services/ticket-policy');
require.cache[ticketPolicy]={id:ticketPolicy,filename:ticketPolicy,loaded:true,exports:{
  resolveTicketPolicy:async()=>({strictMode:false,alertDays:30}),evaluateTicketExpiry:()=>({isExpired:false}),evaluateTicketEligibility:()=>({isBlocked:false,warnings:[]}),
}};
const svc=require('../services/coupon-service'),{runWithUser}=require('../services/request-context');
const user={sub:4,actorSub:8,isImpersonating:true};
test.beforeEach(()=>{reservation={Id:12,CouponId:42,Status:'RESERVED',ExpiresAt:new Date('2020-01-01T00:00:00Z')};audits=[];failAudit=false;sourceConflict=false;adapterCalls=0;fakeNative=0;});
test('native posting flag stays closed without a test adapter',async()=>{
  const before=db.calls.length;await assert.rejects(svc.postNativeCouponRedemption(12,4),{code:'NATIVE_POSTING_DISABLED'});assert.equal(db.calls.length,before);
});
test('simulated native adapter and POST audit roll back together if audit fails',async()=>{
  reservation={Id:12,CouponId:42,CouponNo:'C-TEST',GoodId:3,ReservedQty:1,OwnerCustId:'1',BeneficiaryCustId:'1',Status:'RESERVED',Revision:1};
  const invoke=()=>runWithUser(user,()=>svc.postNativeCouponRedemption(12,4,{docuNo:'TEST',adapter:async tx=>{
    await tx.request().query('INSERT INTO TEST_NATIVE VALUES (1)');return {nativeDocuNo:'TEST',redemptionId:9};
  }}));
  failAudit=true;await assert.rejects(invoke(),/AUDIT_FAILED/);assert.equal(fakeNative,0);assert.equal(reservation.Status,'RESERVED');assert.equal(audits.length,0);
  failAudit=false;const result=await invoke();assert.equal(result.status,'POSTED');assert.equal(fakeNative,1);assert.equal(audits[0].action,'POST_NATIVE');assert.equal(audits[0].actorUserId,'8');
});
test('expired reservation and Access As audit commit together without native posting',async()=>{
  const invoke=()=>runWithUser(user,()=>svc.postNativeCouponRedemption(12,4,{docuNo:'TEST',adapter:async()=>{adapterCalls++;}}));
  failAudit=true;await assert.rejects(invoke(),/AUDIT_FAILED/);assert.equal(reservation.Status,'RESERVED');assert.equal(audits.length,0);assert.equal(adapterCalls,0);
  failAudit=false;await assert.rejects(invoke(),{code:'RESERVATION_EXPIRED'});assert.equal(reservation.Status,'EXPIRED');assert.equal(audits.length,1);
  assert.equal(audits[0].action,'EXPIRE');assert.equal(audits[0].userId,'4');assert.equal(audits[0].actorUserId,'8');assert.equal(adapterCalls,0);
});
test('changed settled source prevents native posting before the adapter writes',async()=>{
  reservation={Id:12,CouponId:42,CouponNo:'C-TEST',GoodId:3,ReservedQty:1,OwnerCustId:'1',BeneficiaryCustId:'1',Status:'RESERVED',Revision:1};
  sourceConflict=true;
  await assert.rejects(runWithUser(user,()=>svc.postNativeCouponRedemption(12,4,{docuNo:'TEST',adapter:async()=>{adapterCalls++;}})),{code:'COUPON_SETTLEMENT_SOURCE_CHANGED'});
  assert.equal(adapterCalls,0);assert.equal(reservation.Status,'RESERVED');assert.equal(fakeNative,0);
});
