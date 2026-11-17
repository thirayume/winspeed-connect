'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let conflicts=[1],failed=false;
const db=h.installDbStub(({text,inputs})=>{
 if(text.includes('COL_LENGTH'))return [{hasConsumedQty:1,hasTable:1}];
 if(text.includes('COUPON_SOURCE_CONFLICTS_V1')) {
  if(failed)throw Error('SQL unavailable');
  const allowed=Object.values(inputs).map(Number);return conflicts.filter(x=>allowed.includes(x)).map(ConflictCouponId=>({ConflictCouponId}));
 }
 if(text.includes('FROM dbo.WFCoupon c')) return [
  {couponId:1,couponNo:'C-OLD',sourceSoId:11,sourceDocuNo:'OLD-SOURCE',sourceDocuDate:'2025-12-31',sourceWithinWindow:0,nativeRemainingQty:2,reservedQty:0,availableQty:2,ownerCustId:'1'},
  {couponId:2,couponNo:'C-NEW',sourceSoId:12,sourceDocuNo:'NEW-SOURCE',sourceDocuDate:'2026-01-01',sourceWithinWindow:1,nativeRemainingQty:3,reservedQty:1,availableQty:2,ownerCustId:'1'},
 ];
 if(text.includes('FROM dbo.WFCoupon WHERE'))return [{CouponID:1,CouponNo:'C-OLD',NativeRemaQty:2}];
 return [];
});
const svc=require('../services/coupon-service');
const {findSettlementSourceConflicts,assertLegacySettlementSchema}=require('../services/coupon-settlement-read-hold');
test.beforeEach(()=>{conflicts=[1];failed=false;db.calls.length=0;});
test('changed source holds only affected ticket and preserves opening balance without leaking old document',async()=>{
 const rows=await svc.getCouponsForCustomer('1');
 assert.equal(rows[0].nativeRemainingQty,2);assert.equal(rows[0].availableQty,0);assert.equal(rows[0].sourceConflict,true);
 assert.equal(rows[0].sourceDocuNo,null);assert.equal(rows[0].sourceSoId,null);assert.equal(rows[1].availableQty,2);assert.equal(rows[1].sourceConflict,false);
 const query=db.calls.find(x=>x.text.includes('COUPON_SOURCE_CONFLICTS_V1'));
 assert.ok(query);assert.doesNotMatch(query.text,/globalStart|DocuDate|NOLOCK/i);assert.match(query.text,/NOT IN \('N','Y'\)/);
 assert.equal(query.inputs.cid0,1);assert.equal(query.inputs.cid1,2);
});
test('reconciliation reports source conflict as a hold without altering native balance',async()=>{
 const row=await svc.reconcileCoupon(1,{settle:false,settlementPolicy:{}});
 assert.equal(row.nativeRemaQty,2);assert.equal(row.availableQty,0);assert.equal(row.adjustedAvailableQty,0);
 assert.equal(row.sourceConflict,true);assert.equal(row.hasConflict,true);assert.match(row.overcutNotice,/รอตรวจ/);
 assert.equal(db.calls.some(x=>x.kind==='tx'),false);
});
test('source conflict lookup errors fail closed for list and reconcile',async()=>{
 failed=true;
 await assert.rejects(svc.getCouponsForCustomer('1'),{code:'COUPON_SOURCE_HOLD_UNAVAILABLE',status:503});
 await assert.rejects(svc.reconcileCoupon(1),{code:'COUPON_SOURCE_HOLD_UNAVAILABLE',status:503});
});
test('lookup batches parameters and rejects malformed or unscoped returned IDs',async()=>{
 const calls=[];const ids=Array.from({length:201},(_,i)=>i+1);
 const found=await findSettlementSourceConflicts(async(text,inputs)=>{calls.push({text,inputs});return {recordset:[{ConflictCouponId:Object.values(inputs)[0].value}]};},ids);
 assert.deepEqual([...found],[1,201]);assert.equal(calls.length,2);assert.equal(Object.keys(calls[0].inputs).length,200);
 await assert.rejects(findSettlementSourceConflicts(async()=>({recordset:[{ConflictCouponId:999}]}),[1]),{code:'COUPON_SOURCE_HOLD_UNAVAILABLE'});
 await assert.rejects(findSettlementSourceConflicts(async()=>({recordset:[]}),[null]),{code:'COUPON_SOURCE_HOLD_INVALID'});
});
test('legacy schema must be provably absent; permission and partial schema fail closed',async()=>{
 const base={SchemaState:'COUPON_LEGACY_SETTLEMENT_SCHEMA_V1',SettlementTable:null,ConsumedLength:null,SchemaSelect:1};
 await assertLegacySettlementSchema(async()=>({recordset:[base]}));
 for(const row of [null,{...base,SchemaSelect:0},{...base,SettlementTable:42},{...base,ConsumedLength:8},{}])
  await assert.rejects(assertLegacySettlementSchema(async()=>({recordset:[row]})),{code:'COUPON_SOURCE_HOLD_UNAVAILABLE',status:503});
 await assert.rejects(assertLegacySettlementSchema(async()=>{throw Error('denied');}),{code:'COUPON_SOURCE_HOLD_UNAVAILABLE'});
});
