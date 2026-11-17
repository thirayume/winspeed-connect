'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let expiry,inserted,existing,duplicate,referenceMatches,issueDate,lifeDays,ticketDate,incidents;
const db=h.installDbStub(({text,inputs})=>{
 if(/FROM dbo\.WFCoupon c WITH \(UPDLOCK, ROWLOCK\)/.test(text))return [{CouponID:42,CouponNo:'C42',GoodID:7,GoodName:'fixture',NativeRemaQty:2,OwnerCustId:'10'}];
 if(/SELECT TOP 2 c\.CouponID,c\.CouponNo/.test(text))return Array.from({length:referenceMatches},(_,i)=>({CouponID:42+i,CouponNo:'C42',GoodID:7,RemaQty:2,OwnerCustId:'10',DocuStatus:'Y'}));
 if(/SELECT TOP 1 1 AS ok FROM dbo\.WFCoupon c/.test(text))return [{ok:1}];
 if(/SELECT TOP 1 c\.DocuID, RTRIM\(c\.CouponNo\) AS CouponNo/.test(text))return [{DocuID:500,CouponNo:'C42',IssueDate:issueDate??null,TicketExpiryDate:ticketDate??null,DefaultDays:lifeDays??null}];
 if(/INSERT INTO wf\.RuleIncident/.test(text)){incidents.push(inputs);return {rowsAffected:[1]};}
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
test.beforeEach(()=>{expiry=undefined;inserted=0;existing=false;duplicate=false;referenceMatches=1;issueDate=undefined;lifeDays=undefined;ticketDate=undefined;incidents=[];db.calls.length=0;});
const reserve=()=>svc.reserveCoupon({couponId:42,beneficiaryCustId:'10',reservedQty:1,userId:1,idempotencyKey:'fixture'});
test('owner policy: an expired control-ticket date no longer blocks; the use is warned and recorded once',async()=>{
 expiry=addBangkokCalendarDays(today,-1);let r=await reserve();assert.equal(r.id,9);assert.equal(inserted,1);
 assert.match(r.expiryWarning,/หมดอายุแล้วเมื่อ .*ตั๋วคุม.*เหตุการณ์ผิดปกติ/);assert.equal(incidents.length,1);
 assert.equal(String(incidents[0].key),'TICKET_USED_EXPIRED:9');assert.equal(incidents[0].type,'TICKET_USED_EXPIRED');assert.equal(incidents[0].soid,500);
 // A replay is judged on its own record (this fixture row has no fingerprint), never refused for the ticket's age.
 existing=true;await assert.rejects(reserve(),{code:'COUPON_RESERVATION_REPLAY_UNVERIFIABLE'});assert.equal(inserted,1);
 existing=false;incidents=[];expiry=today;r=await reserve();assert.equal(r.expiryWarning,undefined);assert.equal(incidents.length,0);
 expiry=undefined;r=await reserve();assert.equal(r.expiryWarning,undefined);assert.equal(incidents.length,0);
});
test('without a set date the standard life counts from the sales order: 90 days, or the configured value',async()=>{
 issueDate=addBangkokCalendarDays(today,-91);let r=await reserve();assert.match(r.expiryWarning,/อายุมาตรฐาน 90 วัน/);assert.equal(incidents.length,1);
 incidents=[];issueDate=addBangkokCalendarDays(today,-89);r=await reserve();assert.equal(r.expiryWarning,undefined);assert.equal(incidents.length,0);
 issueDate=addBangkokCalendarDays(today,-31);lifeDays='30';r=await reserve();assert.match(r.expiryWarning,/อายุมาตรฐาน 30 วัน/);
 incidents=[];lifeDays=undefined;ticketDate=addBangkokCalendarDays(today,5);r=await reserve();assert.equal(r.expiryWarning,undefined);assert.equal(incidents.length,0);
 ticketDate=addBangkokCalendarDays(today,-2);r=await reserve();assert.match(r.expiryWarning,/วันที่กำหนดบนตั๋ว\)/);
 expiry=addBangkokCalendarDays(today,3);incidents=[];r=await reserve();assert.equal(r.expiryWarning,undefined,'the control-ticket date wins over the ticket date');
});
test('a reservation made earlier is still bound to a bill after the ticket expires, with the warning and one incident',async()=>{
 expiry=addBangkokCalendarDays(today,-1);const line={couponReservationId:9,goodId:7,qtyTon:1,goodUnit:'ตัน'};
 let error=null;try{await svc.validateAndLockCouponReservations(db.tx,[line],'10');}catch(e){error=e;}
 assert.notEqual(error?.code,'COUPON_EXPIRED');assert.match(line._ticketExpiryWarning,/หมดอายุแล้ว/);
 assert.equal(incidents.length,1);assert.equal(String(incidents[0].key),'TICKET_USED_EXPIRED:9');
});
test('legacy direct ticket lines must be reselected and reserved before they can be saved',async()=>{
 const line={isControlTicketDrawn:true,refControlTicketNo:'C42',goodId:7,qtyTon:1};const actor={principal:{sub:1,actorSub:1,role:'ADMIN',isImpersonating:false}};
 for(const date of [addBangkokCalendarDays(today,-1),today,undefined]) {
  expiry=date;await assert.rejects(svc.validateAndLockCouponReservations(db.tx,[line],'10',null,actor),{code:'CONTROL_TICKET_RESERVATION_REQUIRED'});
 }
 await assert.rejects(svc.validateAndLockCouponReservations(db.tx,[{isControlTicketDrawn:true}],'10'),{code:'CONTROL_TICKET_RESERVATION_REQUIRED'});
});
test('expired explicit dates warn but never block, whatever the legacy strict or override flags say',()=>{
 const old=addBangkokCalendarDays(today,-1);
 for(const strict of [false,true])for(const override of [false,true]){
  const value=evaluateTicketExpiry(old,new Date(),7,strict,override);assert.equal(value.blocked,false);assert.equal(value.isExpired,true);assert.match(value.warning,/เหตุการณ์ผิดปกติ/);
  const decision=evaluateTicketEligibility({couponId:42,availableQtyTon:1,nativeRemainingQtyTon:1,expiryEval:value,strictMode:strict,strictOverride:override});
  assert.equal(decision.isSpendable,true);assert.match(decision.warnings.join(' '),/หมดอายุแล้ว/);
 }
 assert.equal(evaluateTicketExpiry(today).blocked,false);
 assert.equal(evaluateTicketExpiry(null).blocked,false);
});
test('invalid or duplicate explicit expiry data fails closed',async()=>{
 expiry='not-a-date';await assert.rejects(reserve(),{code:'COUPON_EXPIRY_INVALID'});assert.equal(inserted,0);
 expiry=undefined;ticketDate='not-a-date';await assert.rejects(reserve(),{code:'COUPON_EXPIRY_INVALID'});assert.equal(inserted,0);ticketDate=undefined;
 expiry=today;duplicate=true;await assert.rejects(reserve(),{code:'COUPON_EXPIRY_AMBIGUOUS'});assert.equal(inserted,0);
});
