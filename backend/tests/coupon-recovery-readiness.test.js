'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assertRecoveryReadiness}=require('../services/coupon-recovery-readiness');
const meta=(overrides={})=>({RecoverySchemaState:'COUPON_RECOVERY_READINESS_V1',Ledger232:0,EditHoldVisible:0,Ledger231:0,RecoveryVisible:0,SchemaSelect:1,RecoverySelect:0,...overrides});
function fixture(metadata,rows=[],release={Ledger236:0,ViewVisible:0}) {
  const calls=[];
  return {calls,query:async text=>{
    calls.push(text);
    if(text.includes('COUPON_RECOVERY_READINESS_V1'))return {recordset:[metadata]};
    if(text.includes('COUPON_RELEASE_SCHEMA_V1'))return {recordset:[{ReleaseSchemaState:'COUPON_RELEASE_SCHEMA_V1',...release}]};
    return {recordset:rows};
  }};
}
test('pre-migration and empty migrated ledger permit legacy settlement reads',async()=>{
  let f=fixture(meta());await assertRecoveryReadiness(f.query);assert.equal(f.calls.length,1);
  f=fixture(meta({Ledger231:1,RecoveryVisible:1,RecoverySelect:1}));
  await assertRecoveryReadiness(f.query);assert.equal(f.calls.length,2);
  assert.match(f.calls[1],/WITH \(HOLDLOCK\)/);assert.doesNotMatch(f.calls[1],/DocuDate|globalStart/i);
});
test('any recovery row stops legacy settlement arithmetic without exposing its contents',async()=>{
  const f=fixture(meta({Ledger231:1,RecoveryVisible:1,RecoverySelect:1}),[{RecoveryExists:1}]);
  await assert.rejects(assertRecoveryReadiness(f.query),{code:'COUPON_RECOVERY_REVIEW_REQUIRED',status:409});
  assert.doesNotMatch(f.calls[1],/CouponId|RecoveryKey|NativeRedemptionId/);
});
test('a pending native edit blocks legacy reads and reservation mutations without a date filter',async()=>{
  const metadata=meta({Ledger231:1,RecoveryVisible:1,RecoverySelect:1,Ledger232:1,EditHoldVisible:1,EditHoldSelect:1});
  const f=fixture(metadata,[{PendingNativeEdit:1}]);
  const code={code:'COUPON_NATIVE_EDIT_HOLD_REVIEW_REQUIRED',status:409};
  await assert.rejects(assertRecoveryReadiness(f.query),code);
  const tx={request(){return {query:f.query};}};
  await assert.rejects(require('../services/coupon-authorization-hold').assertNoActiveAuthorization(tx,10),code);
  const checks=f.calls.filter(text=>text.includes('AS PendingNativeEdit'));
  assert.equal(checks.length,2);
  for(const sql of checks) {
    assert.match(sql,/WITH \(HOLDLOCK\)/);
    assert.doesNotMatch(sql,/DocuDate|ExpiresAt|CouponId|NativeRedemptionId/i);
  }
  assert.equal(f.calls.some(text=>text.includes('AS RecoveryExists')),false);
});
test('edit hold lookup fails closed on missing permission, partial schema or absent dependency',async()=>{
  const recovery={Ledger231:1,RecoveryVisible:1,RecoverySelect:1};
  for(const m of [meta({Ledger232:1,EditHoldVisible:1,EditHoldSelect:1}),
    meta({...recovery,Ledger232:1,EditHoldVisible:0}),
    meta({...recovery,Ledger232:1,EditHoldVisible:1,EditHoldSelect:0}),meta({Ledger232:null})]){
    const f=fixture(m);
    await assert.rejects(assertRecoveryReadiness(f.query),{code:'COUPON_RECOVERY_SCHEMA_UNAVAILABLE',status:503});
  }
});
test('reviewed releases select effective settlement while unreleased rows still halt',async()=>{
  const metadata=meta({Ledger231:1,RecoveryVisible:1,RecoverySelect:1,Ledger232:1,EditHoldVisible:1,EditHoldSelect:1});
  const release={Ledger236:1,ViewVisible:1,ViewSelect:1,ReleaseSelect:1};
  const f=fixture(metadata,[],release);
  assert.equal(await assertRecoveryReadiness(f.query),'wf.CouponEffectiveSettlement');
  assert.ok(f.calls.filter(text=>text.includes('WHERE NOT EXISTS')).every(text=>text.includes('CouponNativeEditRelease')));
  const blocked=fixture(metadata,[{PendingNativeEdit:1}],release);
  await assert.rejects(assertRecoveryReadiness(blocked.query),{code:'COUPON_NATIVE_EDIT_HOLD_REVIEW_REQUIRED'});
  const hidden=fixture(metadata,[],{...release,ViewSelect:0});
  await assert.rejects(assertRecoveryReadiness(hidden.query),{code:'COUPON_RECOVERY_SCHEMA_UNAVAILABLE'});
});
test('missing metadata, inconsistent migration or inaccessible schema fails closed',async()=>{
  for(const m of [null,meta({SchemaSelect:0}),meta({Ledger231:0,RecoveryVisible:1}),
    meta({Ledger231:1,RecoveryVisible:0}),meta({Ledger231:1,RecoveryVisible:1,RecoverySelect:0}),meta({Ledger231:2}),
    meta({Ledger231:null}),meta({RecoveryVisible:null}),meta({Ledger231:''})]) {
    const f=fixture(m);await assert.rejects(assertRecoveryReadiness(f.query),{code:'COUPON_RECOVERY_SCHEMA_UNAVAILABLE',status:503});
  }
  await assert.rejects(assertRecoveryReadiness(async()=>{throw Error('permission');}),{code:'COUPON_RECOVERY_SCHEMA_UNAVAILABLE'});
});
test('customer coupon and reconciliation services stop before calculating legacy balances',async()=>{
  const h=require('./helpers/route-harness.cjs');
  const db=h.installDbStub(({text})=>text.includes('AS RecoveryExists')?[{RecoveryExists:1}]:[],{
    nativeRecoverySchema:meta({Ledger231:1,RecoveryVisible:1,RecoverySelect:1}),
  });
  const service=require('../services/coupon-service');
  await assert.rejects(service.getCouponsForCustomer('123'),{code:'COUPON_RECOVERY_REVIEW_REQUIRED',status:409});
  await assert.rejects(service.reconcileCoupon(123,{settle:false}),{code:'COUPON_RECOVERY_REVIEW_REQUIRED',status:409});
  assert.equal(db.calls.filter(c=>c.text.includes('AS RecoveryExists')).length,2);
  assert.equal(db.calls.some(c=>/FROM dbo\.WFCoupon/i.test(c.text)),false);
});
