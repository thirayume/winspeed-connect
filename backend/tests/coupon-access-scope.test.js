'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let currentUser,visible=false,scopeFailure=false;
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
  if(text.includes('WHERE c.CouponID=@scopeCouponId'))return visible?[{ok:1}]:[];
  return [];
});
const svc=require('../services/coupon-service');
let app;
test.before(async()=>{app=await h.startApp([['/api/coupons','../../routes/coupons']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{currentUser={sub:8,actorSub:17,role:'SALES',actorRole:'SALES',isImpersonating:true,
  identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:34,businessActorUserId:47}};visible=false;scopeFailure=false;db.calls.length=0;svc._resetMigration139Cache();});

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
