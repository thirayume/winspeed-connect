'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let expiry,inserted,existing,duplicate,referenceMatches;
const db=h.installDbStub(({text})=>{
 if(/FROM dbo\.WFCoupon c WITH \(UPDLOCK, ROWLOCK\)/.test(text))return [{CouponID:42,CouponNo:'C42',GoodID:7,GoodName:'fixture',NativeRemaQty:2,OwnerCustId:'10'}];
 if(/SELECT TOP 2 c\.CouponID,c\.CouponNo/.test(text))return Array.from({length:referenceMatches},(_,i)=>({CouponID:42+i,CouponNo:'C42',GoodID:7,RemaQty:2,OwnerCustId:'10',DocuStatus:'Y'}));
 if(/SELECT TOP 1 1 AS ok FROM dbo\.WFCoupon c/.test(text))return [{ok:1}];
 if(/SELECT ExpiryDate FROM wf\.ControlTicketOverlay WITH \(UPDLOCK,HOLDLOCK\)/.test(text))return expiry===undefined?[]:Array.from({length:duplicate?2:1},()=>({ExpiryDate:expiry}));
 if(/WHERE IdempotencyKey = @key/.test(text))return existing?[{Id:9,CouponId:42,CouponNo:'C42',ReservedQty:1,CreatedBy:1,Status:'RESERVED'}]:[];
 if(/AS ActiveReserved/.test(text))return [{ActiveReserved:0}];
 if(/INSERT INTO wf\.CouponReservation/.test(text)){inserted++;return [{Id:9}];}
 if(/INSERT INTO wf\.ChangeEvent/.test(text))return {rowsAffected:[1]};
 if(/FROM wf\.CouponReservation WITH \(UPDLOCK, ROWLOCK\)/.test(text))return [{Id:9,CouponId:42,CouponNo:'C42',GoodId:7,GoodUnit:'ตัน',ReservedQty:1,Status:'RESERVED',BeneficiaryCustId:'10',OwnerCustId:'10',CarrierSoId:'DRAFT'}];
 return [];
});
const {getBangkokDateString,addBangkokCalendarDays}=require('../services/so-pickup-policy');
const svc=require('../services/coupon-service');
const {evaluateTicketExpiry,evaluateTicketEligibility}=require('../services/ticket-policy');
const today=getBangkokDateString();
test.beforeEach(()=>{expiry=undefined;inserted=0;existing=false;duplicate=false;referenceMatches=1;db.calls.length=0;});
const reserve=()=>svc.reserveCoupon({couponId:42,beneficiaryCustId:'10',reservedQty:1,userId:1,idempotencyKey:'fixture'});
test('explicit past date blocks reservation and replay; today and no explicit date remain usable',async()=>{
 expiry=addBangkokCalendarDays(today,-1);await assert.rejects(reserve(),{code:'COUPON_EXPIRED'});assert.equal(inserted,0);
 existing=true;await assert.rejects(reserve(),{code:'COUPON_EXPIRED'});assert.equal(inserted,0);
 existing=false;expiry=today;assert.equal((await reserve()).id,9);assert.equal(inserted,1);
 expiry=undefined;assert.equal((await reserve()).id,9);assert.equal(inserted,2);
});
test('a reservation made earlier cannot be bound to a bill after the actual ticket expires',async()=>{
 expiry=addBangkokCalendarDays(today,-1);const line={couponReservationId:9,goodId:7,qtyTon:1,goodUnit:'ตัน'};
 await assert.rejects(svc.validateAndLockCouponReservations(db.tx,[line],'10'),{code:'COUPON_EXPIRED'});
 assert.equal(line._couponReservationValidated,undefined);assert.equal(line.pricePerTon,undefined);
});
test('legacy direct ticket lines must be reselected and reserved before they can be saved',async()=>{
 const line={isControlTicketDrawn:true,refControlTicketNo:'C42',goodId:7,qtyTon:1};const actor={principal:{sub:1,actorSub:1,role:'ADMIN',isImpersonating:false}};
 for(const date of [addBangkokCalendarDays(today,-1),today,undefined]) {
  expiry=date;await assert.rejects(svc.validateAndLockCouponReservations(db.tx,[line],'10',null,actor),{code:'CONTROL_TICKET_RESERVATION_REQUIRED'});
 }
 await assert.rejects(svc.validateAndLockCouponReservations(db.tx,[{isControlTicketDrawn:true}],'10'),{code:'CONTROL_TICKET_RESERVATION_REQUIRED'});
});
test('expired explicit dates block even when strict mode is off or a legacy override exists',()=>{
 const old=addBangkokCalendarDays(today,-1);
 for(const strict of [false,true])for(const override of [false,true]){
  const value=evaluateTicketExpiry(old,new Date(),7,strict,override);assert.equal(value.blocked,true);
  const decision=evaluateTicketEligibility({couponId:42,availableQtyTon:1,nativeRemainingQtyTon:1,expiryEval:value,strictMode:strict,strictOverride:override});assert.equal(decision.isSpendable,false);
 }
 assert.equal(evaluateTicketExpiry(today).blocked,false);
 assert.equal(evaluateTicketExpiry(null).blocked,false);
});
test('invalid or duplicate explicit expiry data fails closed',async()=>{
 expiry='not-a-date';await assert.rejects(reserve(),{code:'COUPON_EXPIRY_INVALID'});assert.equal(inserted,0);
 expiry=today;duplicate=true;await assert.rejects(reserve(),{code:'COUPON_EXPIRY_AMBIGUOUS'});assert.equal(inserted,0);
});
