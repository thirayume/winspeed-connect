'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const h=require('./helpers/route-harness.cjs');
let reservation=null,audits=[],fail=false;
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/COL_LENGTH\('wf\.ChangeEvent'/.test(text))return [{HasCol:1}];
 if(/FROM dbo\.WFCoupon c WITH \(UPDLOCK/.test(text))return [{CouponID:10,CouponNo:'C1',GoodID:20,GoodName:'TEST',NativeRemaQty:10,OwnerCustId:'123'}];
 if(/WHERE IdempotencyKey = @key/.test(text))return [];
 if(/AS ActiveReserved/.test(text))return [{ActiveReserved:0}];
 if(/INSERT INTO wf\.CouponReservation/.test(text)){assert.equal(kind,'tx');reservation={Id:99,Status:'RESERVED',CreatedBy:4};return [{Id:99}];}
 if(/SELECT \* FROM wf\.CouponReservation WITH/.test(text))return reservation?[reservation]:[];
 if(/FROM wf\.SalesOrderLine sol/.test(text))return [];
 if(/UPDATE wf\.CouponReservation/.test(text)){assert.equal(kind,'tx');reservation.Status='CANCELLED';return {rowsAffected:[1]};}
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(fail)throw Error('AUDIT_FAILED');audits.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async fn=>{const old=structuredClone({reservation,audits});try{return await fn(db.tx);}catch(e){reservation=old.reservation;audits=old.audits;throw e;}};
const svc=require('../services/coupon-service');const {runWithUser}=require('../services/request-context');const user={sub:4,actorSub:8,isImpersonating:true};
test('reserve and audit roll back together',async()=>{
 reservation=null;audits=[];fail=true;const create=()=>runWithUser(user,()=>svc.reserveCoupon({couponId:10,beneficiaryCustId:'123',reservedQty:1,userId:4,idempotencyKey:'TEST'}));
 await assert.rejects(create(),/AUDIT_FAILED/);assert.equal(reservation,null);assert.equal(audits.length,0);fail=false;await create();assert.equal(reservation.Status,'RESERVED');assert.equal(audits[0].action,'RESERVE');assert.equal(audits[0].actorUserId,'8');
});
test('cancellation and audit roll back together; repeat cancellation does not duplicate audit',async()=>{
 reservation={Id:99,Status:'RESERVED',CreatedBy:4};audits=[];fail=true;const cancel=()=>runWithUser(user,()=>svc.cancelReservation(99,'test reason',4,'SALES'));
 await assert.rejects(cancel(),/AUDIT_FAILED/);assert.equal(reservation.Status,'RESERVED');assert.equal(audits.length,0);fail=false;await cancel();assert.equal(reservation.Status,'CANCELLED');assert.equal(audits[0].action,'CANCEL');assert.equal(audits[0].actorUserId,'8');await cancel();assert.equal(audits.length,1);
});
