'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stageShipmentEvidence } = require('../services/rebate-evidence-intake');
const resetId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', fingerprint = 'a'.repeat(64);
const epoch = { environment: 'uat', generation: 1, resetId, lastResetAtUtc: new Date('2026-11-13T12:00:00Z'), manifestDigest: 'a'.repeat(64) };
const item = { redemptionId: 10, listNo: 2 };
function fixture(options = {}) {
  const calls = []; let insert;
  const source = { redemptionId: 10, redemptionListNo: 2, couponId: 3, sourceSOID: 4, sourceListNo: 5,
    goodId: 6, goodUnitId: 7, quantity: '1.000', fingerprint, issues: [], ...(options.source || {}) };
  const query = async (sql, inputs) => {
    calls.push({ sql, inputs });
    if (/SELECT Id,Status,Revision/.test(sql)) return { recordset: options.existing || [] };
    if (/INSERT INTO wf.RebateShipmentEvidence/.test(sql)) { insert = inputs; return { recordset: [{ Id: 11, Status: 'HELD', Revision: 1 }] }; }
    throw new Error('Unexpected query');
  };
  return { calls, get insert() { return insert; }, overrides: {
    runFence: async fn => fn(options.epoch || epoch), runTx: async fn => fn(query),
    participantFence: async (_q, current) => { calls.push({ participant: current }); },
    readSource: async (_q, keys) => { calls.push({ source: keys }); return source; },
    resolveQuantityTon: async () => { if (options.unitError) throw Object.assign(new Error(options.unitError), { code: options.unitError }); return source.quantity; },
  } };
}
test('stages a source as HELD under both fences, never grants automatic eligibility', async () => {
  const f = fixture();
  assert.deepEqual(await stageShipmentEvidence(item, f.overrides), { id: 11, status: 'HELD', revision: 1, replayed: false });
  assert.equal(f.calls[0].participant.resetId, resetId);
  assert.deepEqual(f.calls[1].source, { redemptionId: 10, listNo: 2 });
  assert.match(f.calls[2].sql, /UPDLOCK,HOLDLOCK/);
  assert.equal(f.insert.holdReason, 'MANUAL_SHIPMENT_PROOF_REQUIRED');
  assert.equal(f.insert.quantityTon, '1.000');
});
test('incomplete link or unverified unit remains held with unknown tonnage', async () => {
  let f = fixture({ source: { issues: ['COUPON_UNAVAILABLE'], couponId: null } });
  await stageShipmentEvidence(item, f.overrides);
  assert.equal(f.insert.quantityTon, null); assert.equal(f.insert.holdReason, 'SOURCE_INCOMPLETE');
  f = fixture({ unitError: 'REBATE_EVIDENCE_UNIT_MAPPING_UNAVAILABLE' });
  await stageShipmentEvidence(item, f.overrides);
  assert.equal(f.insert.quantityTon, null); assert.equal(f.insert.holdReason, 'UNIT_OR_QUANTITY_UNCONFIRMED');
});
test('idempotent replay does not insert, and source mutation is a conflict', async () => {
  const existing = [{ Id: 11, Status: 'HELD', Revision: 1, SourceFingerprint: fingerprint }];
  let f = fixture({ existing });
  assert.equal((await stageShipmentEvidence(item, f.overrides)).replayed, true);
  assert.equal(f.insert, undefined);
  f = fixture({ existing: [{ ...existing[0], SourceFingerprint: 'b'.repeat(64) }] });
  await assert.rejects(stageShipmentEvidence(item, f.overrides), { code: 'REBATE_EVIDENCE_SOURCE_CHANGED' });
  assert.equal(f.insert, undefined);
});
test('invalid identifiers, unfinished reset, and unexpected DB failures fail closed', async () => {
  let f = fixture();
  await assert.rejects(stageShipmentEvidence({ redemptionId: 0, listNo: 2 }, f.overrides), { code: 'REBATE_SHIPMENT_SOURCE_INVALID' });
  f = fixture({ epoch: { ...epoch, resetId: null } });
  await assert.rejects(stageShipmentEvidence(item, f.overrides), { code: 'REBATE_RESET_NOT_COMPLETED' });
  f = fixture({ unitError: 'DATABASE_DOWN' });
  await assert.rejects(stageShipmentEvidence(item, f.overrides), { code: 'DATABASE_DOWN' });
  assert.equal(f.insert, undefined);
});
