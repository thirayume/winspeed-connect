'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let conflict=false,inserted=0,checkedQuery='';
const db=h.installDbStub(({text})=>{
  if (/FROM dbo\.WFCoupon c WITH \(UPDLOCK, ROWLOCK\)/.test(text)) return [{CouponID:42,CouponNo:'C42',GoodID:7,NativeRemaQty:2,OwnerCustId:'10'}];
  if (/FROM wf\.ControlTicketOverlay WITH/.test(text)) return [];
  if (/SELECT TOP 1 1 AS LegacyConflict/.test(text)) {checkedQuery=text;return conflict?[{LegacyConflict:1}]:[];}
  if (/AS NativeRemainingQty/.test(text)) return [{NativeRemainingQty:2,ActiveRemainingQty:1,InvalidReservations:0}];
  if (/WHERE IdempotencyKey = @key/.test(text)) return [];
  if (/AS ActiveReserved/.test(text)) return [{ActiveReserved:0}];
  if (/INSERT INTO wf\.CouponReservation/.test(text)) {inserted++;return [{Id:9}];}
  if (/FROM wf\.CouponReservation WITH \(UPDLOCK, ROWLOCK\)/.test(text)) return [{Id:9,CouponId:42,CouponNo:'C42',GoodId:7,GoodUnit:'ตัน',ReservedQty:1,Status:'RESERVED',BeneficiaryCustId:'10',OwnerCustId:'10',CarrierSoId:'DRAFT'}];
  if (/INSERT INTO wf\.ChangeEvent/.test(text)) return {rowsAffected:[1]};
  return [];
});
const svc=require('../services/coupon-service');
test.beforeEach(()=>{conflict=false;inserted=0;checkedQuery='';});
test('an unresolved legacy reference blocks both a new reservation and binding an existing reservation',async()=>{
 conflict=true;
 await assert.rejects(svc.reserveCoupon({couponId:42,beneficiaryCustId:'10',reservedQty:1,userId:1,idempotencyKey:'fixture'}),{code:'COUPON_LEGACY_RECONCILIATION_REQUIRED',status:409});
 assert.equal(inserted,0);
 const line={couponReservationId:9,goodId:7,qtyTon:1,goodUnit:'ตัน'};
 await assert.rejects(svc.validateAndLockCouponReservations(db.tx,[line],'10'),{code:'COUPON_LEGACY_RECONCILIATION_REQUIRED',status:409});
 assert.equal(line._couponReservationValidated,undefined);
 assert.match(checkedQuery,/wf\.SalesOrderLineExt/);assert.match(checkedQuery,/wf\.SalesOrderLine/);
});
test('a ticket with no unresolved references retains the normal reservation flow',async()=>{
 const r=await svc.reserveCoupon({couponId:42,beneficiaryCustId:'10',reservedQty:1,userId:1,idempotencyKey:'fixture'});
 assert.equal(r.id,9);assert.equal(inserted,1);
});
