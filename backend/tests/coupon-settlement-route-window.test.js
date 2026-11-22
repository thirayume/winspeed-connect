'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let current=true,serviceCalls=0,lastParams;
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user={sub:8,role:'ADMIN'};next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({text})=>text.includes('SELECT DISTINCT cr.CouponId')?[{CouponId:42},{CouponId:43}]:text.includes('FROM dbo.WFRedemtionHD')&&current?[{RedemtionID:5}]:[]);
const svc=require('../services/coupon-service'),original=svc.manualSettleCouponCut,originalAuto=svc.settleCouponReservations;
const docService=require('../services/coupon-manual-document-settlement'),originalDocument=docService.manualSettleCouponDocument;
svc.manualSettleCouponCut=async params=>{serviceCalls++;lastParams=params;return {success:true,status:'CONSUMED'};};
let app;
test.before(async()=>{app=await h.startApp([['/api/coupons','../../routes/coupons']]);});
test.after(async()=>{svc.manualSettleCouponCut=original;svc.settleCouponReservations=originalAuto;docService.manualSettleCouponDocument=originalDocument;await app.close();});
test('manual settlement rejects old or undated 116 before invoking business writer',async()=>{
  current=false;const response=await app.call('POST','/api/coupons/manual-settle',{body:{reservationId:10,redemptionId:5,reason:'valid reason'}});
  assert.equal(response.status,404);assert.equal(serviceCalls,0);
  assert.equal(db.calls.some(c=>c.text.includes('DocuDate>=@start')),true);
});
test('manual settlement continues for a 116 in the configured window',async()=>{
  current=true;const response=await app.call('POST','/api/coupons/manual-settle',{body:{reservationId:10,redemptionId:5,reason:'valid reason'}});
  assert.equal(response.status,200);assert.equal(serviceCalls,1);
  assert.equal(lastParams.dataWindow.businessDate,'2026-01-01');
  assert.match(db.calls.find(c=>c.text.includes('DocuDate>=@start')).text,/DocuType=116/);
});
test('document settlement forwards authenticated actor and authoritative data window',async()=>{
 let received;docService.manualSettleCouponDocument=async p=>{received=p;return {success:true,settlements:[]};};
 const body={redemptionId:5,items:[{couponId:42,reservationId:10,qty:0.1}],reason:'review complete document'};
 const response=await app.call('POST','/api/coupons/manual-settle-document',{body});
 assert.equal(response.status,200);assert.equal(received.actor.sub,8);assert.equal(received.dataWindow.businessDate,'2026-01-01');
 assert.deepEqual(received.items,body.items);assert.equal(received.redemptionId,5);
});
test('batch reports previously committed settlements and failed coupons as partial',async()=>{
  current=true;svc.settleCouponReservations=async id=>{
    if(id===43)throw Object.assign(Error('DO NOT EXPOSE'),{code:'COUPON_SETTLEMENT_STALE'});
    return {settledCount:1,settlements:[{reservationId:10,redemptionId:5,redemptionDocuNo:'CURRENT',matchedQty:1}],ambiguous:[],unmatched:[]};
  };
  const response=await app.call('POST','/api/coupons/settle-cuts',{body:{}});
  assert.equal(response.status,207);assert.equal(response.body.settledCount,1);assert.equal(response.body.failedCoupons,1);
  assert.equal(response.body.partial,true);assert.equal(response.body.settlements[0].redemptionDocuNo,'CURRENT');
  assert.equal(response.body.failures[0].code,'COUPON_SETTLEMENT_STALE');assert.doesNotMatch(JSON.stringify(response.body),/DO NOT EXPOSE/);
});
test('busy coupon is reported as partial instead of a successful check',async()=>{
  svc.settleCouponReservations=async id=>id===43?{settledCount:0,code:'SETTLEMENT_IN_PROGRESS'}:{settledCount:0};
  const response=await app.call('POST','/api/coupons/settle-cuts',{body:{}});
  assert.equal(response.status,207);assert.equal(response.body.failedCoupons,1);assert.equal(response.body.failures[0].code,'SETTLEMENT_IN_PROGRESS');
});

test('reservation preserves the native review fence code for retry after explicit release',async()=>{
  const originalReserve=svc.reserveCoupon;
  svc.reserveCoupon=async()=>{throw Object.assign(Error('Native save requires review'),{status:409,code:'COUPON_BRIDGE_REVIEW_REQUIRED'});};
  try {
    const response=await app.call('POST','/api/coupons/reserve',{body:{couponId:42,reservedQty:0.1}});
    assert.equal(response.status,409);
    assert.equal(response.body.code,'COUPON_BRIDGE_REVIEW_REQUIRED');
    assert.equal(response.body.message,'Native save requires review');
  } finally {svc.reserveCoupon=originalReserve;}
});
