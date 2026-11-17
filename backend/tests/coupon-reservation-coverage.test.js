'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let coverage,existing=false,inserted=0,nativeRemaining=0.1,active={ActiveReserved:0.2,InvalidReservations:0},lastReservationSql='',sourceConflict=false,nativeHoldSchema;
const db=h.installDbStub(({text})=>{
 if(/FROM dbo\.WFCoupon c WITH \(UPDLOCK, ROWLOCK\)/.test(text))return [{CouponID:42,CouponNo:'C42',GoodID:7,NativeRemaQty:nativeRemaining,OwnerCustId:'10'}];
 if(/FROM wf\.ControlTicketOverlay WITH/.test(text))return [];
 if(/SELECT TOP 1 1 AS LegacyConflict/.test(text))return [];
 if(/AS SourceConflict/.test(text))return sourceConflict?[{SourceConflict:1}]:[];
 if(/AS NativeRemainingQty/.test(text))return coverage?[coverage]:[];
 if(/WHERE IdempotencyKey = @key/.test(text)){
  const hash=require('crypto').createHash('sha256').update(JSON.stringify({couponId:42,goodId:7,reservedQty:0.2,goodUnit:'ตัน',beneficiaryCustId:'10',carrierSoId:'',tripId:null,userId:1,expiresAt:null})).digest('hex');
  return existing?[{Id:9,CouponId:42,CouponNo:'C42',GoodId:7,GoodUnit:'ตัน',BeneficiaryCustId:'10',ReservedQty:0.2,CreatedBy:1,Status:'RESERVED',PayloadHash:hash}]:[];
 }
 if(/AS ActiveReserved/.test(text)){lastReservationSql=text;return active?[active]:[];}
 if(/INSERT INTO wf\.CouponReservation/.test(text)){inserted++;return [{Id:9}];}
 if(/FROM wf\.CouponReservation WITH \(UPDLOCK, ROWLOCK\)/.test(text))return [{Id:9,CouponId:42,CouponNo:'C42',GoodId:7,GoodUnit:'ตัน',ReservedQty:0.2,Status:'RESERVED',BeneficiaryCustId:'10',OwnerCustId:'10',CarrierSoId:'DRAFT'}];
 return [];
}, {nativeHoldSchema:()=>nativeHoldSchema});
const svc=require('../services/coupon-service');
test.beforeEach(()=>{coverage={NativeRemainingQty:0.1,ActiveRemainingQty:0.2,InvalidReservations:0};existing=false;inserted=0;nativeRemaining=0.1;active={ActiveReserved:0.2,InvalidReservations:0};lastReservationSql='';sourceConflict=false;nativeHoldSchema=null;db.calls.length=0;});
test('changed or missing native settlement source prevents a new reservation and bill binding',async()=>{
 sourceConflict=true;
 await assert.rejects(svc.reserveCoupon({couponId:42,beneficiaryCustId:'10',reservedQty:0.1,userId:1,idempotencyKey:'changed-source'}),{code:'COUPON_SETTLEMENT_SOURCE_CHANGED'});
 const line={couponReservationId:9,goodId:7,qtyTon:0.2,pricePerTon:100};
 await assert.rejects(svc.validateAndLockCouponReservations(db.tx,[line],'10'),{code:'COUPON_SETTLEMENT_SOURCE_CHANGED'});
 assert.equal(inserted,0);assert.equal(line.pricePerTon,100);
});
test('an overcommitted reservation cannot bind to a bill after native delivery',async()=>{
 const line={couponReservationId:9,goodId:7,qtyTon:0.2,pricePerTon:100};
 await assert.rejects(svc.validateAndLockCouponReservations(db.tx,[line],'10'),{code:'COUPON_RESERVATION_OVERCOMMITTED',status:409});
 assert.equal(line.pricePerTon,100);assert.equal(line._couponReservationValidated,undefined);
});
test('idempotent reserve replay cannot hide overcommit, and missing or inconsistent balances fail closed',async()=>{
 existing=true;const reserve=()=>svc.reserveCoupon({couponId:42,beneficiaryCustId:'10',reservedQty:0.2,userId:1,idempotencyKey:'fixture'});
 await assert.rejects(reserve(),{code:'COUPON_RESERVATION_OVERCOMMITTED'});
 for(const bad of [null,{NativeRemainingQty:null,ActiveRemainingQty:0,InvalidReservations:0},{NativeRemainingQty:1,ActiveRemainingQty:0,InvalidReservations:1}]){coverage=bad;await assert.rejects(reserve(),{code:'COUPON_COVERAGE_UNAVAILABLE'});}
 assert.equal(inserted,0);
});
test('covered reservations still bind, including exact equality at decimal precision',async()=>{
 coverage={NativeRemainingQty:0.2,ActiveRemainingQty:0.2,InvalidReservations:0};const line={couponReservationId:9,goodId:7,qtyTon:0.2};
 assert.ok((await svc.validateAndLockCouponReservations(db.tx,[line],'10')).has(0));assert.equal(line.pricePerTon,0);
});
test('partially consumed reservations reserve only their outstanding amount',async()=>{
 nativeRemaining=0.5;active={ActiveReserved:0.3,InvalidReservations:0};
 const result=await svc.reserveCoupon({couponId:42,beneficiaryCustId:'10',reservedQty:0.2,userId:1,idempotencyKey:'partial-fixture'});
 assert.equal(result.reservedQty,0.2);assert.ok(Math.abs(result.availableAfter)<1e-9);assert.equal(inserted,1);
 assert.match(lastReservationSql,/cr\.ReservedQty\s*-\s*ISNULL\(cr\.ConsumedQty,\s*0\)/i);
});
test('reserve and coverage include expired holds with active native authorization under locks',async()=>{
 nativeHoldSchema={NativeHoldSchemaState:'NATIVE_HOLD_SCHEMA_V1',Ledger220:1,HeaderVisible:1,LineVisible:1,HeaderSelect:1,LineSelect:1};
 nativeRemaining=0.3;active={ActiveReserved:0.3,InvalidReservations:0};
 await assert.rejects(svc.reserveCoupon({couponId:42,beneficiaryCustId:'10',reservedQty:0.1,userId:1,idempotencyKey:'held-auth'}),e=>e.status===400);
 assert.match(lastReservationSql,/ahl\.ReservationId=cr\.Id AND ah\.State='ACTIVE'/);
 assert.match(lastReservationSql,/UPDLOCK,HOLDLOCK/);assert.equal(inserted,0);
 coverage={NativeRemainingQty:0.3,ActiveRemainingQty:0.3,InvalidReservations:0};
 await svc.assertCouponReservationCoverage(db.tx,42);
 const query=db.calls.findLast(c=>c.text.includes('AS NativeRemainingQty'));
 assert.match(query.text,/ahl\.ReservationId=cr\.Id AND ah\.State='ACTIVE'/);
});
test('exact decimal balance can be reserved without floating point underflow',async()=>{
 nativeRemaining=0.3;active={ActiveReserved:0.2,InvalidReservations:0};
 const result=await svc.reserveCoupon({couponId:42,beneficiaryCustId:'10',reservedQty:0.1,userId:1,idempotencyKey:'decimal-fixture'});
 assert.equal(result.availableAfter,0);assert.equal(inserted,1);
});
test('invalid reservation balances fail closed before accepting another reservation',async()=>{
 nativeRemaining=0.5;active={ActiveReserved:0.1,InvalidReservations:1};
 await assert.rejects(svc.reserveCoupon({couponId:42,beneficiaryCustId:'10',reservedQty:0.2,userId:1,idempotencyKey:'invalid-fixture'}),{code:'COUPON_COVERAGE_UNAVAILABLE'});
 assert.equal(inserted,0);
});
test('migration readiness cache is isolated across database targets',async()=>{
 const original=db.stub.getDbName;let selected='main';let calls=0;
 db.stub.getDbName=()=>selected;svc._resetMigration139Cache();
 const query=async()=>{calls++;return {recordset:[{hasConsumedQty:selected==='main'?9:null,hasTable:selected==='main'?42:null}]};};
 try {
   assert.equal(await svc.checkMigration139(query),true);
   selected='secondary';assert.equal(await svc.checkMigration139(query),false);
   selected='main';assert.equal(await svc.checkMigration139(query),true);
   assert.equal(calls,2);
 } finally {db.stub.getDbName=original;svc._resetMigration139Cache();}
});
