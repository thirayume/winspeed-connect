'use strict';

// Approve / reject / apply-to-bill after a Rebate reset (generation > 0):
//  - every decision runs inside the fences
//  - rejecting returns the claim's reserved shipment balance, with both identities and the reason
//  - a pending claim with no active reservation in the current epoch cannot be approved
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const shipmentEpoch = { environment: 'uat', generation: 2, resetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  lastResetAtUtc: new Date('2026-11-14T02:00:00Z'), manifestDigest: 'b'.repeat(64), uninitialized: false, fenced: true };
const state = { epoch: shipmentEpoch, fenceError: null, participant: 0, released: [], releaseError: null, reserved: 1, claim: null, verified: [], verificationError: null };

const fencePath = require.resolve('../services/rebate-route-fence');
const realFence = require(fencePath);
require.cache[fencePath].exports = { ...realFence,
  withRebateRouteFence: async operation => { if (state.fenceError) throw state.fenceError; return operation(state.epoch); },
  routeParticipantFence: async (_query, epoch) => { state.participant += 1; return epoch; } };

const claimPath = require.resolve('../services/rebate-shipment-claim');
const realClaim = require(claimPath);
require.cache[claimPath].exports = { ...realClaim,
  releaseShipmentClaimReservations: async (_query, epoch, input) => {
    state.released.push({ epoch, input }); if (state.releaseError) throw state.releaseError; return { released: 2 };
  } };
const verificationPath = require.resolve('../services/rebate-shipment-claim-verification');
const realVerification = require(verificationPath);
require.cache[verificationPath].exports = { ...realVerification,
  verifyShipmentClaimReservations: async (_query, epoch, claim) => {
    state.verified.push({epoch,claim});
    if (state.verificationError) throw state.verificationError;
    if (!state.reserved) throw Object.assign(Error('missing'),{code:'REBATE_CLAIM_RESERVATION_MISSING',status:409});
    return {count:state.reserved};
  } };

const pending = { Id: 4, Status: 'TIER2_PENDING', CurrentTier: 2, PoolId: null, CustId: '1078', ClaimAmt: 1200, SalesUserId: 43, RegionCode: '03' };
const db = h.installDbStub(({ text }) => {
  if (/FROM wf\.RebateClaim WITH \(UPDLOCK, ROWLOCK\) WHERE Id = @id/.test(text)) return [{ ...state.claim }];
  if (/FROM wf\.UserSaleArea WHERE UserId = @uid AND RegionCode = @rcode/.test(text)) return [{ x: 1 }];
  if (/UPDATE wf\.RebateClaim\s+SET Status = 'REJECTED'/.test(text)) return { recordset: [], rowsAffected: [1] };
  if (/FROM wf\.RebateShipmentReservation r/.test(text)) return [{ N: state.reserved }];
  return [];
}, { activeUserIds: h.TEST_USERS });

let app;
test.before(async () => { app = await h.startApp([['/api/rebate', '../../routes/rebate']]); });
test.after(async () => { await app.close(); });
test.beforeEach(() => { Object.assign(state, { epoch: shipmentEpoch, fenceError: null, participant: 0, released: [], releaseError: null, reserved: 1, claim: { ...pending }, verified: [], verificationError: null }); });

const manager = { sub: 25, role: 'MANAGER' };
const reject = (user = manager) => app.call('POST', '/api/rebate/claims/4/reject', { body: { reason: 'เอกสารประกอบไม่ครบ' }, user });
const failure = (code, status) => Object.assign(new Error(code), { code, status });

test('rejecting a claim after a reset returns its reserved shipment balance', async () => {
  const before = db.calls.length;
  const r = await reject();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(state.participant, 1);
  assert.equal(state.released.length, 1);
  const { epoch, input } = state.released[0];
  assert.equal(epoch, shipmentEpoch);
  assert.equal(input.custId, 1078); assert.equal(input.claimId, 4);
  assert.deepEqual({ a: input.release.actorPrimaryId, e: input.release.effectivePrimaryId, ba: input.release.actorBusinessId, be: input.release.effectiveBusinessId },
    { a: 25, e: 25, ba: 25, be: 25 });
  assert.match(input.release.reason, /^ไม่อนุมัติใบขอเคลียร์ \(ขั้นที่ 2\): เอกสารประกอบไม่ครบ$/);

  const calls = db.calls.slice(before);
  const index = text => calls.findIndex(c => text.test(c.text));
  assert.ok(index(/UPDATE wf\.RebateClaim\s+SET Status = 'REJECTED'/) >= 0);
  const audit = calls.find(c => /REJECT_TIER_2/.test(JSON.stringify(c.inputs)));
  const after = JSON.parse(Object.values(audit.inputs).find(v => typeof v === 'string' && v.includes('releasedReservations')));
  assert.deepEqual({ generation: after.resetGeneration, released: after.releasedReservations }, { generation: 2, released: 2 });
});

test('if the reserved balance cannot be returned the rejection is not recorded', async () => {
  state.releaseError = failure('REBATE_RELEASE_CLAIM_INVALID', 409);
  const before = db.calls.length;
  const r = await reject();
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'REBATE_RELEASE_CLAIM_INVALID');
  const calls = db.calls.slice(before);
  assert.equal(calls.some(c => /INSERT INTO wf\.RebateClaimApproval/.test(c.text)), false);
  assert.equal(calls.some(c => /REJECT_TIER_/.test(JSON.stringify(c.inputs))), false);
});

test('before any reset a rejection does not touch the shipment ledger', async () => {
  state.epoch = realFence.UNFENCED;
  const r = await reject();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(state.released.length, 0);
  assert.equal(state.participant, 1);
});

test('a pending claim with no active reservation in the current epoch cannot be approved', async () => {
  state.reserved = 0;
  const before = db.calls.length;
  const r = await app.call('POST', '/api/rebate/claims/4/approve', { body: {}, user: manager });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'REBATE_CLAIM_RESERVATION_MISSING');
  assert.match(r.body.message, /ไม่มียอดรีเบทที่จองไว้/);
  const calls = db.calls.slice(before);
  assert.equal(state.verified.length,1);
  assert.equal(state.verified[0].epoch,shipmentEpoch);
  assert.equal(state.verified[0].claim.Id,4);
  assert.equal(calls.some(c => /UPDATE wf\.RebateClaim/.test(c.text)), false);
  assert.equal(calls.some(c => /INSERT INTO wf\.RebateClaimApproval/.test(c.text)), false);
});

test('changed transport evidence blocks approval and leaves the reservation untouched', async () => {
  state.verificationError=failure('REBATE_EVIDENCE_SOURCE_CHANGED',409);
  const before=db.calls.length;
  const r=await app.call('POST','/api/rebate/claims/4/approve',{body:{},user:manager});
  assert.equal(r.status,409);assert.equal(r.body.code,'REBATE_EVIDENCE_SOURCE_CHANGED');
  assert.equal(db.calls.slice(before).some(c=>/UPDATE wf\.RebateClaim|UPDATE wf\.RebateShipmentReservation/.test(c.text)),false);
  assert.equal(state.released.length,0);
});

test('the reservation check applies only to pending claims after a reset', async () => {
  // legacy epoch: no ledger query at all
  state.epoch = realFence.UNFENCED; state.reserved = 0;
  let before = db.calls.length;
  await app.call('POST', '/api/rebate/claims/4/approve', { body: {}, user: manager });
  assert.equal(state.verified.length,0);

  // already approved claim after a reset: answered by the normal terminal guard, not by the ledger check
  state.epoch = shipmentEpoch; state.claim = { ...pending, Status: 'APPROVED', CurrentTier: 5 };
  before = db.calls.length;
  const r = await app.call('POST', '/api/rebate/claims/4/approve', { body: {}, user: manager });
  assert.notEqual(r.body.code, 'REBATE_CLAIM_RESERVATION_MISSING');
  assert.equal(state.verified.length,0);
});

test('decisions and apply-to-bill are refused with 503 while a reset is in progress', async () => {
  state.fenceError = failure('REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED', 503);
  for (const [path, body, user] of [['/api/rebate/claims/4/reject', { reason: 'เอกสารประกอบไม่ครบ' }, manager],
    ['/api/rebate/claims/4/approve', {}, manager], ['/api/rebate/claims/4/apply-to-bill', { soId: 9 }, { sub: 12, role: 'ACCOUNTING' }]]) {
    const before = db.calls.length;
    const r = await app.call('POST', path, { body, user });
    assert.equal(r.status, 503, path);
    assert.equal(r.body.code, 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED');
    assert.match(r.body.message, /กำลังเริ่มยอดรีเบทใหม่/);
    assert.equal(db.calls.slice(before).some(c => /UPDATE wf\.|INSERT INTO wf\.RebateClaimApproval/.test(c.text)), false, path);
  }
  assert.equal(state.participant, 0);
});
