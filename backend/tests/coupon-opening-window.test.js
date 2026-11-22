'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const rows=[
  {couponId:1,couponNo:'C-OLD',sourceSoId:11,sourceDocuNo:'OLD-DOC',sourceDocuDate:new Date('2025-12-31T00:00:00Z'),sourceWithinWindow:0,nativeRemainingQty:2,reservedQty:0.5,availableQty:1.5,ownerCustId:'1',controlExpiryDate:'2020-01-01',controlExpiryOverride:0},
  {couponId:2,couponNo:'C-NEW',sourceSoId:12,sourceDocuNo:'NEW-DOC',sourceDocuDate:new Date('2026-01-01T00:00:00Z'),sourceWithinWindow:1,nativeRemainingQty:3,reservedQty:1,availableQty:2,ownerCustId:'1'},
  {couponId:3,couponNo:'C-UNKNOWN',sourceSoId:13,sourceDocuNo:'UNKNOWN-DOC',sourceDocuDate:null,sourceWithinWindow:0,nativeRemainingQty:1,reservedQty:0,availableQty:1,ownerCustId:'1'},
];
let nativeHoldSchema=null;
const db=h.installDbStub(({text})=>{
  if(text.includes('FROM dbo.WFCoupon c'))return structuredClone(rows);
  return [];
},{nativeHoldSchema:()=>nativeHoldSchema});
const service=require('../services/coupon-service');
test('old and undated source documents are hidden but active tickets and balances remain usable',async()=>{
  const result=await service.getCouponsForCustomer('1',{settle:false,billPrefix:'I'});
  assert.equal(result.length,3);
  for(const item of [result[0],result[2]]){assert.equal(item.sourceDocumentHidden,true);assert.equal(item.sourceDocuNo,null);assert.equal(item.sourceSoId,null);assert.equal(item.sourceDocuDate,null);assert.ok(item.couponNo);assert.ok(item.availableQty>0);}
  assert.equal(result[0].availableQty,1.5);assert.ok(result[0].expiryDate);
  assert.equal(result[0].controlExpiryDate,'2020-01-01');assert.equal(result[0].controlExpiryExpired,true);
  assert.equal(result[1].controlExpiryDate,null);assert.equal(result[1].controlExpiryExpired,false);
  assert.equal(result[1].sourceDocuNo,'NEW-DOC');assert.equal(result[1].sourceDocumentHidden,false);assert.equal(result[1].availableQty,2);
  const sql=db.calls.find(c=>c.text.includes('AS sourceWithinWindow'));assert.equal(sql.inputs.globalStartDate,'2026-01-01');assert.match(sql.text,/s.DocuDate >= @globalStartDate/);assert.match(sql.text,/ov\.DocuId = c\.CouponID/);
});
test('unavailable global window fails before any coupon reads or settlement',async()=>{
  const store=require('../services/global-data-window-store'),original=store.readGlobalDataWindow,before=db.calls.length;
  store.readGlobalDataWindow=async()=>{throw Error('WINDOW_UNAVAILABLE');};
  try{await assert.rejects(service.getCouponsForCustomer('1',{settle:false}),/WINDOW_UNAVAILABLE/);assert.equal(db.calls.length,before);}finally{store.readGlobalDataWindow=original;}
});
test('customer coupon balances count expired active authorizations without hiding old tickets',async()=>{
 nativeHoldSchema={...require('./helpers/coupon-bridge-metadata').absent,NativeHoldSchemaState:'NATIVE_HOLD_SCHEMA_V1',Ledger220:1,HeaderVisible:1,LineVisible:1,HeaderSelect:1,LineSelect:1};
 try{
  const result=await service.getCouponsForCustomer('1',{settle:false,billPrefix:'I'});
  assert.equal(result.length,3);assert.equal(result[0].sourceDocuNo,null);
  const sql=db.calls.findLast(c=>c.text.includes('AS sourceWithinWindow'));
  assert.match(sql.text,/ahl\.ReservationId=cr\.Id AND ah\.State='ACTIVE'/);
  assert.doesNotMatch(sql.text,/wf\.CouponReservation cr WITH \(NOLOCK\)/);
 }finally{nativeHoldSchema=null;}
});
