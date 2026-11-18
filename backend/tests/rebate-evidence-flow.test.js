'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stageShipmentEvidence } = require('../services/rebate-evidence-intake');
const { reviewShipmentEvidence } = require('../services/rebate-evidence-review');

// Exercises both actual services together with an in-memory transactional
// query adapter. It does not claim SQL concurrency or physical-scale proof.
function system() {
  const epoch = { environment: 'uat', generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    lastResetAtUtc: new Date('2026-11-13T12:00:00Z'), manifestDigest: 'a'.repeat(64) };
  const source = { redemptionId: 10, redemptionListNo: 1, couponId: 30, sourceSOID: 40, sourceListNo: 1,
    goodId: 20, goodUnitId: 1002, quantity: '1.000', fingerprint: 'a'.repeat(64), issues: [] };
  let row = null;
  const query = async (sql, inputs) => {
    if (/SELECT Id,Status,Revision,SourceFingerprint/.test(sql)) return { recordset: row ? [row] : [] };
    if (/INSERT INTO wf.RebateShipmentEvidence/.test(sql)) {
      row = { Id: 1, RedemptionId: inputs.redemptionId, RedemptionListNo: inputs.listNo, Status: 'HELD', Revision: 1,
        QuantityTon: inputs.quantityTon, SourceFingerprint: inputs.fingerprint, ServerNowUtc: new Date('2026-11-13T14:00:00Z') };
      return { recordset: [row] };
    }
    if (/SELECT RedemptionId,RedemptionListNo/.test(sql)) return { recordset: row ? [row] : [] };
    if (/SELECT \*,GETUTCDATE/.test(sql)) return { recordset: row ? [row] : [] };
    if (/UPDATE wf.RebateShipmentEvidence/.test(sql)) {
      if (!row || row.Status !== 'HELD' || row.Revision !== inputs.revision || row.SourceFingerprint !== inputs.fingerprint) return { rowsAffected: [0] };
      row = { ...row, Status: inputs.status, Revision: row.Revision + 1, actor: inputs.actorPrimaryId, effective: inputs.primaryId };
      return { rowsAffected: [1] };
    }
    throw new Error('Unexpected SQL');
  };
  const overrides = { runFence: async fn => fn(epoch), runTx: async fn => fn(query), participantFence: async () => {},
    readSource: async () => ({ ...source }), resolveQuantityTon: async () => source.quantity };
  return { source, overrides, get row() { return row; } };
}
test('source is held, retries are idempotent, then permitted review records identities exactly once', async () => {
  const s = system();
  const input = { redemptionId: 10, listNo: 1 };
  assert.equal((await stageShipmentEvidence(input, s.overrides)).status, 'HELD');
  assert.equal((await stageShipmentEvidence(input, s.overrides)).replayed, true);
  const reviewer = { sub: 1, role: 'ADMIN', actorSub: 2, actorRole: 'ADMIN', actorRoles: ['ADMIN'], isImpersonating: true };
  const decision = { id: 1, expectedRevision: 1, decision: 'VERIFY', occurredAtUtc: '2026-11-13T13:00:00Z', reason: 'checked actual documents' };
  assert.equal((await reviewShipmentEvidence(reviewer, decision, s.overrides)).status, 'MANUALLY_VERIFIED');
  assert.deepEqual([s.row.actor, s.row.effective, s.row.Revision], [2, 1, 2]);
  await assert.rejects(reviewShipmentEvidence(reviewer, decision, s.overrides), { code: 'REBATE_EVIDENCE_STALE' });
});
test('a changed source or an event before reset remains held', async () => {
  const s = system();
  await stageShipmentEvidence({ redemptionId: 10, listNo: 1 }, s.overrides);
  const user = { sub: 1, role: 'ADMIN' };
  const decision = { id: 1, expectedRevision: 1, decision: 'VERIFY', occurredAtUtc: '2026-11-13T12:00:00Z', reason: 'checked' };
  await assert.rejects(reviewShipmentEvidence(user, decision, s.overrides), { code: 'REBATE_EVIDENCE_BEFORE_RESET' });
  s.source.fingerprint = 'b'.repeat(64);
  await assert.rejects(reviewShipmentEvidence(user, { ...decision, occurredAtUtc: '2026-11-13T13:00:00Z' }, s.overrides), { code: 'REBATE_EVIDENCE_SOURCE_CHANGED' });
  assert.equal(s.row.Status, 'HELD');
});
