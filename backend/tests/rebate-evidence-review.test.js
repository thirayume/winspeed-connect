'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewShipmentEvidence, resolveVerifiedTon } = require('../services/rebate-evidence-review');

const resetId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', fingerprint = 'a'.repeat(64);
const epoch = { environment: 'uat', generation: 1, resetId, lastResetAtUtc: new Date('2026-11-13T12:00:00Z'), manifestDigest: 'a'.repeat(64) };
const user = { sub: 1, role: 'ADMIN', actorSub: 1 };
const payload = { id: 5, expectedRevision: 1, decision: 'VERIFY', occurredAtUtc: '2026-11-13T12:30:00Z', reason: 'checked signed record' };
function fixture(options = {}) {
  const calls = [];
  const row = { RedemptionId: 10, RedemptionListNo: 2, Revision: 1, Status: 'HELD', SourceFingerprint: fingerprint,
    QuantityTon: '1.000', ServerNowUtc: new Date('2026-11-13T13:00:00Z'), ...(options.row || {}) };
  let updated;
  const query = async (sql, inputs) => {
    calls.push({ sql, inputs });
    if (/^\s*SELECT RedemptionId/.test(sql)) return { recordset: options.missing ? [] : [row] };
    if (/^\s*SELECT \*,GETUTCDATE/.test(sql)) return { recordset: [row] };
    if (/^\s*UPDATE wf.RebateShipmentEvidence/.test(sql)) { updated = inputs; return { rowsAffected: [options.rowsAffected ?? 1] }; }
    throw new Error('Unexpected SQL');
  };
  return { calls, get updated() { return updated; }, overrides: {
    runFence: async fn => fn(options.epoch || epoch), runTx: async fn => fn(query),
    participantFence: async (_q, e) => { calls.push({ participant: e }); if (options.participantFails) throw new Error('participant failed'); },
    readSource: async (_q, keys) => { calls.push({ source: keys }); return { redemptionId: 10, redemptionListNo: 2,
      fingerprint: options.fingerprint || fingerprint, issues: options.issues || [] }; },
    resolveQuantityTon: async () => options.authoritativeTon || '1.000',
  } };
}
test('review takes both fences, rechecks source and records actor and effective identities', async () => {
  const f = fixture();
  const result = await reviewShipmentEvidence(user, payload, f.overrides);
  assert.deepEqual(result, { id: 5, status: 'MANUALLY_VERIFIED', revision: 2 });
  assert.equal(f.calls[0].participant.resetId, resetId);
  assert.deepEqual(f.calls[2].source, { redemptionId: 10, listNo: 2 });
  assert.match(f.calls[3].sql, /UPDLOCK,HOLDLOCK/);
  assert.equal(f.updated.actorPrimaryId, 1);
  assert.equal(f.updated.businessId, 1);
  assert.equal(f.updated.fingerprint, fingerprint);
});
test('role intersection and stale or changed evidence fail before update', async () => {
  let f = fixture();
  await assert.rejects(reviewShipmentEvidence({ sub: 1, role: 'SALES' }, payload, f.overrides), { code: 'REBATE_EVIDENCE_PERMISSION_REQUIRED' });
  assert.equal(f.calls.length, 0);
  f = fixture();
  await assert.rejects(reviewShipmentEvidence({ sub: 1, role: 'ADMIN', actorSub: 2, actorRole: 'SALES', isImpersonating: true }, payload, f.overrides), { code: 'REBATE_EVIDENCE_PERMISSION_REQUIRED' });
  f = fixture({ fingerprint: 'b'.repeat(64) });
  await assert.rejects(reviewShipmentEvidence(user, payload, f.overrides), { code: 'REBATE_EVIDENCE_SOURCE_CHANGED' });
  assert.equal(f.updated, undefined);
  f = fixture({ row: { Revision: 2 } });
  await assert.rejects(reviewShipmentEvidence(user, payload, f.overrides), { code: 'REBATE_EVIDENCE_STALE' });
  assert.equal(f.updated, undefined);
});
test('a reset not completed, missing source or failed participant cannot update review', async () => {
  for (const options of [{ epoch: { ...epoch, resetId: null } }, { missing: true }, { participantFails: true }, { issues: ['UNIT_UNCONFIRMED'] }]) {
    const f = fixture(options);
    await assert.rejects(reviewShipmentEvidence(user, payload, f.overrides));
    assert.equal(f.updated, undefined);
  }
});
test('verification cannot rely on stored quantity when unit conversion is unproven or changed', async () => {
  let f = fixture(); delete f.overrides.resolveQuantityTon;
  await assert.rejects(reviewShipmentEvidence(user, payload, f.overrides), { code: 'REBATE_EVIDENCE_SOURCE_INCOMPLETE' });
  assert.equal(f.updated, undefined);
  f = fixture({ authoritativeTon: '2.000' });
  await assert.rejects(reviewShipmentEvidence(user, payload, f.overrides), { code: 'REBATE_EVIDENCE_TONNAGE_CHANGED' });
  assert.equal(f.updated, undefined);
});
test('only a locked native tonne unit is accepted; other units remain unverified', async () => {
  const source = { issues: [], goodUnitId: 1002, quantity: '1.250' };
  const query = async () => ({ recordset: [{ GoodUnitID: 1002, GoodUnitCode: 'ตัน ', GoodUnitName: 'ตัน' }] });
  assert.equal(await resolveVerifiedTon(query, source), '1.250');
  await assert.rejects(resolveVerifiedTon(async () => ({ recordset: [{ GoodUnitID: 1002, GoodUnitCode: 'ใบ', GoodUnitName: 'ใบ' }] }), source),
    { code: 'REBATE_EVIDENCE_UNIT_MAPPING_UNAVAILABLE' });
});
test('review writes mapped business IDs separately from Access As primary IDs', async () => {
  const f = fixture();
  const asUser = { sub: 1, role: 'ADMIN', actorSub: 2, actorRole: 'ADMIN', actorRoles: ['ADMIN'], isImpersonating: true,
    identityMapping: { primaryEffectiveUserId: 1, primaryActorUserId: 2, businessEffectiveUserId: 11, businessActorUserId: 22 } };
  await reviewShipmentEvidence(asUser, payload, f.overrides);
  assert.deepEqual([f.updated.primaryId, f.updated.businessId, f.updated.actorPrimaryId, f.updated.actorBusinessId], [1, 11, 2, 22]);
});
