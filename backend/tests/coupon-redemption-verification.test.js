'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let headers,lines;
const db=h.installDbStub(({text})=>{
  if(text.includes('FROM dbo.WFRedemtionHD h'))return headers;
  if(text.includes('FROM dbo.WFRedemtionDT d'))return lines;
  return [];
},{activeUserIds:h.TEST_USERS});
const {verifyRedemptionDocument,allCouponsVisible}=require('../services/coupon-redemption-verification');
const user={sub:43,actorSub:44,isImpersonating:true};
let visibleIds,fenceContext;
const deps={
  readWindow:async()=>({businessDate:'2026-01-01'}),
  transaction:db.stub.wfTransaction,
  assertPrimary:async()=>{},
  allCouponsVisible:async(actual,ids)=>{assert.equal(actual,user);visibleIds.push(...ids);return !ids.includes(99);},
  validateWindow:async(_tx,ctx)=>{fenceContext=ctx;},
};
test.beforeEach(()=>{headers=[{RedemtionID:7}];lines=[{CouponID:10},{CouponID:11}];visibleIds=[];fenceContext=null;db.calls.length=0;});

test('verifies a committed multi-coupon document only after checking each coupon scope',async()=>{
  assert.deepEqual(await verifyRedemptionDocument(user,'  TEST-116  ',deps),{status:'PRESENT',lineCount:2});
  assert.deepEqual(visibleIds,[10,11]);
  assert.deepEqual(fenceContext,{window:{businessDate:'2026-01-01'},redemptionId:7,couponId:10});
  const query=db.calls.find(c=>c.text.includes('FROM dbo.WFRedemtionHD h'));
  assert.match(query.text,/DocuType=116 AND h\.DocuDate>=@start/);
  assert.equal(query.inputs.docNo,'TEST-116');assert.equal(query.inputs.start,'2026-01-01');
});

test('missing, duplicate, incomplete or excessively large documents do not appear verified',async()=>{
  for(const sample of [[],[{RedemtionID:7},{RedemtionID:8}]]){
    headers=sample;assert.deepEqual(await verifyRedemptionDocument(user,'TEST',deps),{status:'NOT_VERIFIED'});
  }
  headers=[{RedemtionID:7}];
  for(const sample of [[],[{CouponID:null}],Array.from({length:101},()=>({CouponID:10}))]){
    lines=sample;assert.deepEqual(await verifyRedemptionDocument(user,'TEST',deps),{status:'NOT_VERIFIED'});
  }
});

test('a single out-of-scope line hides the entire document',async()=>{
  lines=[{CouponID:10},{CouponID:99}];
  assert.deepEqual(await verifyRedemptionDocument(user,'TEST',deps),{status:'NOT_VERIFIED'});
  assert.deepEqual(visibleIds,[10,99]);
});

test('scope checks all coupons in a single parameterized query',async()=>{
  let calls=0,captured;
  const query=async(text,inputs)=>{calls++;captured={text,inputs};return {recordset:[{CouponID:10}]};};
  const scope=async(actual)=>{assert.equal(actual,user);return {sql:'couponOwnerExt.SalesUserId=@owner',inputs:{owner:{type:'Int',value:43}}};};
  assert.equal(await allCouponsVisible(user,[10,11],query,scope),false);
  assert.equal(calls,1);assert.equal(captured.inputs.verifyCoupon0.value,10);assert.equal(captured.inputs.verifyCoupon1.value,11);
  assert.match(captured.text,/couponOwnerExt\.SalesUserId=@owner/);
});

test('bad input and changed cutoff fail without reporting a successful verification',async()=>{
  await assert.rejects(verifyRedemptionDocument(user,'\u0000',deps),{code:'REDEMPTION_NUMBER_INVALID'});
  assert.equal(db.calls.length,0);
  await assert.rejects(verifyRedemptionDocument(user,'TEST',{...deps,validateWindow:async()=>{
    throw Object.assign(Error('changed'),{code:'DATA_WINDOW_CHANGED',status:409});
  }}),{code:'DATA_WINDOW_CHANGED'});
});

test('a secondary database is rejected before reading any document',async()=>{
  await assert.rejects(verifyRedemptionDocument(user,'TEST',{...deps,assertPrimary:async()=>{
    throw Object.assign(Error('primary required'),{code:'MANUAL_SETTLEMENT_PRIMARY_REQUIRED',status:403});
  }}),{code:'MANUAL_SETTLEMENT_PRIMARY_REQUIRED'});
  assert.equal(db.calls.length,0);
});

test('verification route requires the settlement capability and forwards the authenticated identity',async()=>{
  const service=require('../services/coupon-redemption-verification');
  const original=service.verifyRedemptionDocument;let captured;
  service.verifyRedemptionDocument=async(actual,doc)=>{captured={actual,doc};return {status:'NOT_VERIFIED'};};
  const app=await h.startApp([['/api/coupons','../../routes/coupons']]);
  try {
    const denied=await app.call('GET','/api/coupons/verify-redemption?docNo=TEST',{user:{sub:43,role:'SALES'}});
    assert.equal(denied.status,403);assert.equal(captured,undefined);
    const allowed=await app.call('GET','/api/coupons/verify-redemption?docNo=TEST',{user:{sub:43,role:'MANAGER'}});
    assert.equal(allowed.status,200);assert.equal(captured.doc,'TEST');assert.equal(Number(captured.actual.sub),43);
  } finally {service.verifyRedemptionDocument=original;await app.close();}
});
