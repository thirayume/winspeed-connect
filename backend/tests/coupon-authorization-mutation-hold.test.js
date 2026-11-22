'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const current={...require('./helpers/coupon-bridge-metadata').absent,NativeHoldSchemaState:'NATIVE_HOLD_SCHEMA_V1',Ledger220:1,HeaderVisible:1,LineVisible:1,HeaderSelect:1,LineSelect:1};
const reservation={Id:12,CouponId:42,CouponNo:'C-TEST',GoodId:3,ReservedQty:1,ConsumedQty:0,Status:'RESERVED',BeneficiaryCustId:'1',OwnerCustId:'1',CreatedBy:1};
const db=h.installDbStub(({text})=>{
 if(text.includes('FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK)'))return [reservation];
 if(text.includes('FROM wf.CouponReservation WITH (UPDLOCK,HOLDLOCK)'))return [{Id:12}];
 if(text.includes('FROM wf.CouponBeneficiary WITH (UPDLOCK, ROWLOCK)'))return [{Id:2,Status:'ACTIVE',OwnerCustId:'1',BeneficiaryCustId:'2'}];
 if(text.includes('AS ActiveNativeAuthorization'))return [{ActiveNativeAuthorization:1}];
 return [];
},{nativeHoldSchema:current});
const service=require('../services/coupon-service');
test.beforeEach(()=>{db.calls.length=0;});
test('active authorization prevents cancellation and leaves reservation and audit untouched',async()=>{
 await assert.rejects(service.cancelReservation(12,'QA cancellation',1,'ADMIN'),{code:'COUPON_NATIVE_AUTH_RESERVATION_HELD',status:409});
 assert.equal(db.calls.some(c=>/UPDATE wf\.CouponReservation|INSERT INTO wf\.ChangeEvent/.test(c.text)),false);
});
test('active authorization prevents binding to another bill before price changes',async()=>{
 const line={couponReservationId:12,goodId:3,qtyTon:1,pricePerTon:100};
 await assert.rejects(service.validateAndLockCouponReservations(db.tx,[line],'1'),{code:'COUPON_NATIVE_AUTH_RESERVATION_HELD',status:409});
 assert.equal(line.pricePerTon,100);assert.equal(line._couponReservationValidated,undefined);
});
test('active authorization prevents revoking beneficiary before grant or reservation changes',async()=>{
 await assert.rejects(service.revokeBeneficiary(2,'QA revoke',1),{code:'COUPON_NATIVE_AUTH_RESERVATION_HELD',status:409});
 assert.equal(db.calls.some(c=>/UPDATE wf\.CouponBeneficiary|UPDATE wf\.CouponReservation/.test(c.text)),false);
});
