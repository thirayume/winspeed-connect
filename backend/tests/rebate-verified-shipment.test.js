'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lockVerifiedShipment } = require('../services/rebate-verified-shipment');

function fixture() {
  const epoch = { environment: 'uat', generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lastResetAtUtc: new Date('2026-11-13T12:00:00Z') };
  const source = { redemptionId: 10, redemptionListNo: 1, couponId: 30, sourceSOID: 40, sourceListNo: 1,
    goodId: 20, quantity: '1.000', fingerprint: 'a'.repeat(64), issues: [] };
  const row = { Id: 9, Revision: 2, Status: 'MANUALLY_VERIFIED', CouponId: 30, SourceSOID: 40, SourceListNo: 1,
    GoodId: 20, QuantityTon: '1.000', SourceFingerprint: source.fingerprint, OccurredAtUtc: new Date('2026-11-13T13:00:00Z'),
    ServerNowUtc: new Date('2026-11-13T14:00:00Z'), ReviewedByPrimaryId: 1, ReviewedByBusinessId: 2,
    ReviewActorPrimaryId: 3, ReviewActorBusinessId: 4, ReviewReason: 'proof checked', ReviewedAtUtc: new Date('2026-11-13T13:30:00Z') };
  const calls = [];
  const query = async (sql, p) => { calls.push({ sql, p }); return { recordset: [row] }; };
  const overrides = { participantFence: async () => { calls.push('participant'); },
    readSource: async () => { calls.push('source'); return source; }, resolveQuantityTon: async () => source.quantity };
  const run = () => lockVerifiedShipment(query, epoch, { redemptionId: 10, listNo: 1 }, overrides);
  return { epoch, source, row, calls, run, overrides };
}

test('verified current-epoch shipment is rechecked under source then evidence locks', async () => {
  const f = fixture(), item = await f.run();
  assert.deepEqual(f.calls.slice(0, 2), ['participant', 'source']);
  assert.match(f.calls[2].sql, /UPDLOCK,HOLDLOCK/);
  assert.equal(f.calls[2].p.resetId, f.epoch.resetId);
  assert.deepEqual([item.evidenceId, item.sourceSOID, item.sourceListNo, item.quantityTon], [9, 40, 1, '1.000']);
});

test('held, rejected and unimplemented automatic verification cannot mint a shipment', async () => {
  for (const status of ['HELD', 'REJECTED', 'AUTO_VERIFIED']) {
    const f = fixture(); f.row.Status = status;
    await assert.rejects(f.run(), { code: 'REBATE_EVIDENCE_NOT_VERIFIED' });
  }
});

test('source mutation, cancellation, mismatch and quantity changes fail closed', async () => {
  for (const mutate of [f => f.source.fingerprint = 'b'.repeat(64), f => f.source.issues.push('REDEMPTION_STATUS_UNCONFIRMED'),
    f => f.row.CouponId = 31, f => f.row.SourceSOID = 41]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.run(), { code: 'REBATE_EVIDENCE_SOURCE_CHANGED' });
  }
  const f = fixture(); f.source.quantity = '1.001';
  await assert.rejects(f.run(), { code: 'REBATE_EVIDENCE_TONNAGE_CHANGED' });
});

test('time and reviewer identity are verified again before use', async () => {
  for (const time of [new Date('2026-11-13T12:00:00Z'), new Date('2026-11-13T15:00:00Z'), null,
    '2026-11-13T13:00:00', '2026-02-30T13:00:00Z']) {
    const f = fixture(); f.row.OccurredAtUtc = time;
    await assert.rejects(f.run(), { code: 'REBATE_EVIDENCE_TIME_INVALID' });
  }
  const f = fixture(); f.row.ReviewActorBusinessId = null;
  await assert.rejects(f.run(), { code: 'REBATE_EVIDENCE_REVIEW_INVALID' });
});

test('missing reset and missing evidence cannot produce a lot', async () => {
  const f = fixture(); f.epoch.generation = 0;
  await assert.rejects(f.run(), { code: 'REBATE_EVIDENCE_EPOCH_INVALID' });
  await assert.rejects(lockVerifiedShipment(async () => ({ recordset: [] }), { ...f.epoch, generation: 1 },
    { redemptionId: 10, listNo: 1 }, f.overrides), { code: 'REBATE_EVIDENCE_NOT_FOUND' });
});

test('stale participant stops before locking source or reading evidence', async () => {
  const f = fixture();
  f.overrides.participantFence = async () => { throw Object.assign(Error('stale'), { code: 'REBATE_RESET_PARTICIPANT_MISMATCH' }); };
  await assert.rejects(f.run(), { code: 'REBATE_RESET_PARTICIPANT_MISMATCH' });
  assert.deepEqual(f.calls, []);
});
