'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { planNativeRecovery } = require('../services/coupon-native-recovery-plan');
const base = () => ({ originalSettledQty:'0.6000', previouslyReturnedQty:'0', targetSettledQty:'0.4000',
  reservedQty:'0.6000', consumedQty:'0.6000', reservationStatus:'CONSUMED',
  evidenceBalanceBefore:'1.0000', evidenceBalanceAfter:'0.4000' });

test('reduced source returns only its difference and retains the reservation hold', () => {
  assert.deepEqual(planNativeRecovery(base()), { pendingReturnQty:'0.2000',expectedNativeNetIncrease:'0.2000',
    totalReturnedAfter:'0.2000',settledAfter:'0.4000',reservationConsumedAfter:'0.4000',
    reservationStatusAfter:'RESERVED',requiresAtomicProof:true });
});
test('cancellation returns the outstanding amount while preserving other consumption', () => {
  const f={...base(),reservedQty:'1.0000',consumedQty:'0.8000',reservationStatus:'RESERVED',targetSettledQty:'0'};
  const r=planNativeRecovery(f);
  assert.equal(r.pendingReturnQty,'0.6000'); assert.equal(r.reservationConsumedAfter,'0.2000');
  assert.equal(r.reservationStatusAfter,'RESERVED');
});
test('replayed or successive reductions count durable prior returns once', () => {
  const f={...base(),previouslyReturnedQty:'0.2000',consumedQty:'0.4000',reservationStatus:'RESERVED'};
  assert.equal(planNativeRecovery(f).pendingReturnQty,'0.0000');
  f.targetSettledQty='0.3000';
  assert.equal(planNativeRecovery(f).pendingReturnQty,'0.1000');
  f.targetSettledQty='0.5000';
  assert.throws(()=>planNativeRecovery(f),{code:'RECOVERY_NEW_AUTHORIZATION_REQUIRED'});
});
test('rejects ambiguous, inconsistent, imprecise and unrepresentable quantities', () => {
  for(const changes of [
    {evidenceBalanceAfter:'0.5000'}, {previouslyReturnedQty:'0.7000'}, {consumedQty:'0.5000'},
    {reservationStatus:'CANCELLED'}, {reservedQty:'0'}, {targetSettledQty:'0.00001'},
    {targetSettledQty:0.4}, {targetSettledQty:'1e-1'}, {targetSettledQty:'-0.1'},
    {targetSettledQty:'9'.repeat(1000)},
    {reservedQty:'100000000.0000'}, {evidenceBalanceBefore:'100000000000000.0000'},
  ]) assert.throws(()=>planNativeRecovery({...base(),...changes}));
});
test('exact four-decimal arithmetic is used at quantity boundaries', () => {
  const r=planNativeRecovery({originalSettledQty:'0.0003',previouslyReturnedQty:'0.0001',targetSettledQty:'0.0001',
    reservedQty:'0.0003',consumedQty:'0.0002',reservationStatus:'RESERVED',evidenceBalanceBefore:'0.0003',evidenceBalanceAfter:'0'});
  assert.equal(r.pendingReturnQty,'0.0001');assert.equal(r.reservationConsumedAfter,'0.0001');
});
test('candidate ledger denies every direct mutation and rolls back before raising', () => {
  const migration=fs.readFileSync(path.join(__dirname,'../migrations/231_coupon_native_recovery_ledger.sql'),'utf8');
  assert.match(migration,/AFTER INSERT,UPDATE,DELETE AS -- WF_RECOVERY_FENCE_231_V1/);
  assert.match(migration,/ROLLBACK TRANSACTION;RAISERROR\(''COUPON_RECOVERY_WRITER_UNAVAILABLE''/);
  assert.match(migration,/is_disabled=0/);
  assert.doesNotMatch(migration,/DISABLE TRIGGER wf\.WF_CouponRecoveryFence/i);
});
test('native guard candidates and their restored downgrade guards roll back before raising', () => {
  for (const [file, marker] of [
    ['219_coupon_native_reservation_guard.sql','WF_GUARD_219_V2'],
    ['221_coupon_native_authorization_reservation_fence.sql','WF_AUTH_FENCE_221_V2'],
    ['222_coupon_guard_active_authorization.sql','WF_GUARD_222_V2'],
    ['224_coupon_guard_durable_evidence.sql','WF_GUARD_224_V2'],
    ['225_coupon_reservation_fence_durable_evidence.sql','WF_AUTH_FENCE_225_V2'],
    ['226_coupon_native_source_evidence_fences.sql','WF_EVIDENCE_HEADER_226_V4'],
    ['227_coupon_native_detail_insert_fence.sql','WF_EVIDENCE_INSERT_227_V4'],
    ['228_coupon_native_prepare_evidence.sql','WF_PREPARE_EVIDENCE_228_V3'],
    ['229_coupon_native_consumption_reservation_fence.sql','WF_AUTH_FENCE_229_V4'],
    ['230_coupon_native_consume.sql','WF_NATIVE_CONSUME_230_V4'],
    ['down/222_coupon_guard_active_authorization.down.sql','WF_GUARD_219_V2'],
    ['down/224_coupon_guard_durable_evidence.down.sql','WF_GUARD_222_V2'],
    ['down/225_coupon_reservation_fence_durable_evidence.down.sql','WF_AUTH_FENCE_221_V2'],
    ['down/229_coupon_native_consumption_reservation_fence.down.sql','WF_AUTH_FENCE_225_V2'],
  ]) {
    const migration=fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8');
    assert.ok(migration.includes(marker),file);
    assert.doesNotMatch(migration,/RAISERROR\(''[A-Z0-9_]+''\s*,\s*16\s*,\s*1\);\s*ROLLBACK TRANSACTION;/,file);
    assert.match(migration,/ROLLBACK TRANSACTION;\s*RAISERROR\(''[A-Z0-9_]+''/,file);
  }
});
test('candidate native 116 authorization and guards do not reject by sales-order ShipDate', () => {
  const service=fs.readFileSync(path.join(__dirname,'../services/coupon-native-authorization.js'),'utf8');
  assert.doesNotMatch(service,/\bShipDate\b/i);
  for (const file of fs.readdirSync(path.join(__dirname,'../migrations')).filter(name=>/^(?:219|22\d|230|231)_.*\.sql$/.test(name))) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'),/\bShipDate\b/i,file);
  }
});
