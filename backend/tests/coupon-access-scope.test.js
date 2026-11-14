'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let currentUser,visible=false,scopeFailure=false,creator=8,beneficiaryVisible=false,grant=false,crossFixture=false,reservationVisible=false,reconcileFixture=false;
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{
  requireAuth:(req,_res,next)=>{req.user=currentUser;next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next()),
}};
const db=h.installDbStub(({text,inputs})=>{
  if(text.includes('SELECT Id, EmpId, PositionCode FROM wf.AppUser')){
    if(scopeFailure)throw Error('SCOPE_UNAVAILABLE');
    return [{Id:Number(inputs.id),EmpId:Number(inputs.id)+1000,PositionCode:null}];
  }
  if(text.includes('COL_LENGTH'))return [{hasConsumedQty:1,hasTable:1}];
  if(text.includes('FROM dbo.WFCoupon c WITH (UPDLOCK, ROWLOCK)'))return [{CouponID:42,CouponNo:'C-TEST',GoodID:3,NativeRemaQty:5,OwnerCustId:'123'}];
  if(text.includes('FROM dbo.EMCust beneficiary'))return beneficiaryVisible?[{ok:1}]:[];
  if(text.includes('WHERE cr.Id IN ('))return reservationVisible?[{Id:12}]:[];
  if(text.includes('FROM wf.CouponBeneficiary WITH (UPDLOCK, ROWLOCK)'))return grant?[{Id:10,Scope:'3'}]:[];
  if(text.includes('WHERE IdempotencyKey = @key') && crossFixture)return [{Id:77,CouponId:42,CouponNo:'C-TEST',ReservedQty:1,Status:'RESERVED',CreatedBy:8}];
  if(text.includes('AS sourceWithinWindow') && crossFixture)return [{couponId:42,couponNo:'C-TEST',sourceSoId:11,sourceDocuNo:'OTHER-SO',sourceDocuDate:new Date('2026-01-01T00:00:00Z'),sourceWithinWindow:1,ownerDocumentWithinScope:0,ownerCustId:'123',ownerCustName:'owner',goodId:3,rightType:'BENEFICIARY',nativeRemainingQty:5,reservedQty:1,availableQty:4}];
  if(text.includes('FROM dbo.WFCoupon WITH (NOLOCK) WHERE CouponID') && reconcileFixture)return [{CouponID:42,CouponNo:'C-TEST',NativeRemaQty:5}];
  if(text.includes('FROM wf.CouponReservation cr WITH (NOLOCK)') && reconcileFixture)return [{Id:12,CouponId:42,ReservedQty:1,RemainingReservedQty:1}];
  if(text.includes('SELECT * FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK)'))return [{Id:12,CouponId:42,GoodId:3,OwnerCustId:'123',BeneficiaryCustId:'456',Status:'CANCELLED',CreatedBy:creator}];
  if(text.includes('SELECT CAST(s.CustID AS VARCHAR(50)) AS OwnerCustId,c.GoodID'))return [{OwnerCustId:'123',GoodID:3}];
  if(text.includes('WHERE c.CouponID=@scopeCouponId'))return visible?[{ok:1}]:[];
  return [];
});
const svc=require('../services/coupon-service');
let app;
test.before(async()=>{app=await h.startApp([['/api/coupons','../../routes/coupons']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{currentUser={sub:8,actorSub:17,role:'SALES',actorRole:'SALES',isImpersonating:true,
  identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:34,businessActorUserId:47}};visible=false;scopeFailure=false;creator=8;beneficiaryVisible=false;grant=false;crossFixture=false;reservationVisible=false;reconcileFixture=false;db.calls.length=0;svc._resetMigration139Cache();});

test('list and pre-settlement each intersect effective and actor document scope',async()=>{
  const result=await app.call('GET','/api/coupons?customerId=123');assert.equal(result.status,200);
  const presettle=db.calls.find(c=>c.text.includes('SELECT DISTINCT c.CouponID'));
  const list=db.calls.find(c=>c.text.includes('AS sourceWithinWindow'));
  for(const q of [presettle,list]){
    assert.ok(q);assert.match(q.text,/couponOwnerExt\.SalesUserId IN \(@couponScope0U0\)/);
    assert.match(q.text,/couponOwnerExt\.SalesUserId IN \(@couponScope1U0\)/);
    assert.equal(q.inputs.couponScope0U0,34);assert.equal(q.inputs.couponScope1U0,47);
    assert.equal(q.inputs.couponScope0E0,'1034');assert.equal(q.inputs.couponScope1E0,'1047');
  }
});
test('out-of-scope reconcile and expiry return 404 before service data or settlement',async()=>{
  for(const path of ['/api/coupons/reconcile/42','/api/coupons/42/expiry']){
    db.calls.length=0;const result=await app.call('GET',path);assert.equal(result.status,404);
    assert.ok(db.calls.some(c=>c.text.includes('WHERE c.CouponID=@scopeCouponId')));
    assert.equal(db.calls.some(c=>c.text.includes('FROM dbo.WFCoupon WITH (NOLOCK) WHERE CouponID')),false);
    assert.equal(db.calls.some(c=>c.kind==='tx'),false);
  }
});
test('scope failure rejects before list reads or pre-settlement',async()=>{
  scopeFailure=true;const result=await app.call('GET','/api/coupons?customerId=123');assert.equal(result.status,500);
  assert.equal(db.calls.some(c=>c.text.includes('SELECT DISTINCT c.CouponID')),false);
  assert.equal(db.calls.some(c=>c.text.includes('AS sourceWithinWindow')),false);
});
test('allowed detail check uses both identities and rejects invalid ID before query',async()=>{
  const access=require('../services/coupon-access-scope');visible=true;
  assert.equal(await access.couponVisible(currentUser,42),true);
  const q=db.calls.find(c=>c.text.includes('WHERE c.CouponID=@scopeCouponId'));
  assert.equal(q.inputs.couponScope0U0,34);assert.equal(q.inputs.couponScope1U0,47);
  const n=db.calls.length;assert.equal(await access.couponVisible(currentUser,'42 OR 1=1'),false);assert.equal(db.calls.length,n);
});
test('reservation rejects out-of-scope coupon inside transaction before replay or mutation',async()=>{
  const result=await app.call('POST','/api/coupons/reserve',{body:{couponId:42,beneficiaryCustId:'123',reservedQty:1}});
  assert.equal(result.status,404);
  const q=db.calls.find(c=>c.text.includes('WHERE c.CouponID=@scopeCouponId'));
  assert.ok(q);assert.equal(q.kind,'tx');assert.equal(q.inputs.couponScope0U0,34);assert.equal(q.inputs.couponScope1U0,47);
  assert.equal(db.calls.some(c=>/INSERT INTO wf\.CouponReservation|IdempotencyKey = @key/.test(c.text)),false);
});
test('expiry update rejects out-of-scope coupon within transaction before mutation',async()=>{
  const result=await app.call('PUT','/api/coupons/42/expiry',{body:{expiryDate:'2027-01-01'}});
  assert.equal(result.status,404);
  const q=db.calls.find(c=>c.text.includes('WHERE c.CouponID=@scopeCouponId'));
  assert.ok(q);assert.equal(q.kind,'tx');assert.equal(q.inputs.couponScope0U0,34);assert.equal(q.inputs.couponScope1U0,47);
  assert.equal(db.calls.some(c=>/UPDATE wf\.CouponExpiry|INSERT INTO wf\.CouponExpiry/.test(c.text)),false);
});
test('cancelled reservation cannot be probed or replayed outside document scope',async()=>{
  const result=await app.call('POST','/api/coupons/cancel',{body:{reservationId:12,reason:'test cancel'}});
  assert.equal(result.status,404);
  const q=db.calls.find(c=>c.text.includes('WHERE c.CouponID=@scopeCouponId'));
  assert.ok(q);assert.equal(q.kind,'tx');assert.equal(db.calls.some(c=>/UPDATE wf\.CouponReservation/.test(c.text)),false);
});
test('cancel replay rejects non-owner or missing creator before disclosing state',async()=>{
  for(const value of [9,null]){creator=value;db.calls.length=0;
    const result=await app.call('POST','/api/coupons/cancel',{body:{reservationId:12,reason:'test cancel'}});
    assert.equal(result.status,403);assert.equal(db.calls.some(c=>/UPDATE wf\.CouponReservation/.test(c.text)),false);
  }
});
test('valid cross-sales beneficiary can list a ticket without seeing another salesperson’s source document',async()=>{
  beneficiaryVisible=true;grant=true;crossFixture=true;
  const response=await app.call('GET','/api/coupons?customerId=456');assert.equal(response.status,200);assert.equal(response.body.data.length,1);
  const row=response.body.data[0];assert.equal(row.couponNo,'C-TEST');assert.equal(row.availableQty,4);
  assert.equal(row.sourceHiddenByAccess,true);assert.equal(row.sourceDocuNo,null);assert.equal(row.sourceSoId,null);assert.equal(row.ownerCustId,null);assert.deepEqual(row.beneficiaries,[]);
  const customerCheck=db.calls.find(c=>c.text.includes('FROM dbo.EMCust beneficiary'));
  assert.equal(customerCheck.inputs.beneficiaryAssigned0U0,34);assert.equal(customerCheck.inputs.beneficiaryAssigned1U0,47);
  assert.match(db.calls.find(c=>c.text.includes('AS sourceWithinWindow')).text,/b\.Id IS NOT NULL/);
  assert.doesNotMatch(db.calls.find(c=>c.text.includes('SELECT DISTINCT c.CouponID')).text,/b\.Id IS NOT NULL/);
});
test('beneficiary reservation needs both customer scope and current product grant',async()=>{
  crossFixture=true;beneficiaryVisible=true;grant=true;
  const request={body:{couponId:42,beneficiaryCustId:'456',reservedQty:1,idempotencyKey:'test-beneficiary'}};
  const allowed=await app.call('POST','/api/coupons/reserve',request);assert.equal(allowed.status,200);assert.equal(allowed.body.idempotent,true);
  const customerCheck=db.calls.find(c=>c.kind==='tx'&&c.text.includes('FROM dbo.EMCust beneficiary'));
  assert.ok(customerCheck);assert.equal(customerCheck.inputs.beneficiaryAssigned0U0,34);assert.equal(customerCheck.inputs.beneficiaryAssigned1U0,47);
  grant=false;db.calls.length=0;const revoked=await app.call('POST','/api/coupons/reserve',request);assert.equal(revoked.status,404);
  assert.equal(db.calls.some(c=>c.text.includes('WHERE IdempotencyKey = @key')),false);
  beneficiaryVisible=false;grant=true;db.calls.length=0;const outside=await app.call('POST','/api/coupons/reserve',request);assert.equal(outside.status,404);
  assert.equal(db.calls.some(c=>c.text.includes('FROM wf.CouponBeneficiary WITH (UPDLOCK, ROWLOCK)')),false);
});
test('beneficiary cancellation replay needs the same customer scope and current grant',async()=>{
  beneficiaryVisible=true;grant=true;
  const request={body:{reservationId:12,reason:'cancel test'}};
  const allowed=await app.call('POST','/api/coupons/cancel',request);assert.equal(allowed.status,200);assert.equal(allowed.body.idempotent,true);
  grant=false;const denied=await app.call('POST','/api/coupons/cancel',request);assert.equal(denied.status,404);
});
test('reservation scope checks both identities and all colliding source namespaces',async()=>{
  const access=require('../services/coupon-access-scope');reservationVisible=true;
  assert.equal(await access.reservationsVisible(currentUser,[12]),true);
  const q=db.calls.find(c=>c.text.includes('WHERE cr.Id IN ('));
  assert.equal(q.inputs.reservationDraft0U0,34);assert.equal(q.inputs.reservationDraft1U0,47);
  assert.equal(q.inputs.reservationNative0E0,'1034');assert.equal(q.inputs.reservationNative1E0,'1047');
  assert.match(q.text,/so\.Id IS NULL OR/);assert.match(q.text,/hd\.SOID IS NULL OR/);assert.match(q.text,/cr\.CreatedBy IN/);
  reservationVisible=false;assert.equal(await access.reservationsVisible(currentUser,[12]),false);
});
test('reconcile denies a shared ticket containing an out-of-scope reservation before reading cuts',async()=>{
  visible=true;reservationVisible=false;reconcileFixture=true;
  const result=await svc.reconcileCoupon(42,{actor:currentUser,settle:false});assert.equal(result,null);
  assert.equal(db.calls.some(c=>c.text.includes('FROM dbo.WFRedemtionDT rd')),false);
});
