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
test('invalid reservation identity, quantity and idempotency key fail before database work',async()=>{
 const valid={couponId:10,beneficiaryCustId:'123',reservedQty:1,userId:4,idempotencyKey:'TEST'};
 for(const patch of [{couponId:1.5},{couponId:2147483648},{reservedQty:Infinity},{reservedQty:0.0001},
   {idempotencyKey:'x'.repeat(121)},{idempotencyKey:'test\nkey'},{idempotencyKey:{key:'x'}}]) {
  const before=db.calls.length;
  await assert.rejects(svc.reserveCoupon({...valid,...patch}),e=>e.status===400);
  assert.equal(db.calls.length,before);
 }
});
test('cancellation and audit roll back together; repeat cancellation does not duplicate audit',async()=>{
 reservation={Id:99,Status:'RESERVED',CreatedBy:4,ReservedQty:1,ConsumedQty:0};audits=[];fail=true;const cancel=()=>runWithUser(user,()=>svc.cancelReservation(99,'test reason',4,'SALES'));
 await assert.rejects(cancel(),/AUDIT_FAILED/);assert.equal(reservation.Status,'RESERVED');assert.equal(audits.length,0);fail=false;await cancel();assert.equal(reservation.Status,'CANCELLED');assert.equal(audits[0].action,'CANCEL');assert.equal(audits[0].actorUserId,'8');await cancel();assert.equal(audits.length,1);
});
test('inconsistent remaining balance cannot be released by cancellation',async()=>{
 for(const [reserved,consumed] of [[1,1],[1,1.1],[1,-0.1],[null,0],[1,NaN]]){
  reservation={Id:99,Status:'RESERVED',CreatedBy:4,ReservedQty:reserved,ConsumedQty:consumed};audits=[];fail=false;
  await assert.rejects(runWithUser(user,()=>svc.cancelReservation(99,'review invalid balance',4,'SALES')),
    {code:'COUPON_RESERVATION_QUANTITY_INVALID'});
  assert.equal(reservation.Status,'RESERVED');assert.equal(audits.length,0);
 }
});
test('partial cancellation preserves consumed quantity and audits the outstanding release',async()=>{
 reservation={Id:99,Status:'RESERVED',CreatedBy:4,ReservedQty:2,ConsumedQty:0.5};audits=[];fail=false;
 await runWithUser(user,()=>svc.cancelReservation(99,'release remainder',4,'SALES'));
 assert.equal(reservation.Status,'CANCELLED');assert.equal(reservation.ConsumedQty,0.5);
 assert.deepEqual(JSON.parse(audits[0].beforeJson),{status:'RESERVED',reservedQty:2,consumedQty:0.5});
 assert.deepEqual(JSON.parse(audits[0].afterJson),{status:'CANCELLED',reservedQty:2,consumedQty:0.5});
});
test('fully consumed, posted, expired and unexpected reservations cannot be cancelled',async()=>{
 for(const status of ['CONSUMED','POSTED','EXPIRED','UNKNOWN']){
  reservation={Id:99,Status:status,CreatedBy:4};audits=[];fail=false;
  await assert.rejects(runWithUser(user,()=>svc.cancelReservation(99,'do not cancel used',4,'SALES')),
    e=>e.status===(status==='CONSUMED'||status==='POSTED'?400:409));
  assert.equal(reservation.Status,status);assert.equal(audits.length,0);
 }
});
