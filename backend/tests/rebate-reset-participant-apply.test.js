'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyResetParticipant } = require('../services/rebate-reset-participant-apply');

function fixture() {
  const input = { environment: 'uat', manifestDigest: 'a'.repeat(64), actorId: 1, effectiveId: 2,
    target: { database: 'dbwins_worldfert9_uat', server: 'R740-SRV\\SQL2008' },
    previous: { generation: 0, resetId: null, lastResetAtUtc: null },
    next: { generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lastResetAtUtc: new Date('2026-11-13T12:00:00Z') } };
  const state = { participant: { EnvironmentKind: 'uat', ManifestDigest: input.manifestDigest, Generation: 0, Phase: 'READY', ResetId: null, LastResetAtUtc: null },
    receipt: null, claims: ['DRAFT', 'TIER2_PENDING', 'APPROVED', 'CN_ISSUED'], tickets: ['ISSUED'], incomplete: false, audit: [],
    actual: { DatabaseName: input.target.database, ServerName: input.target.server }, lockResult: 0, failParticipantUpdate: false };
  const query = async (text, p) => {
    if (/SELECT DB_NAME/.test(text)) return { recordset: [state.actual] };
    if (/sp_getapplock/.test(text)) { assert.match(text, /LockMode='Exclusive'/); return { recordset: [{ LockResult: state.lockResult }] }; }
    if (/SELECT EnvironmentKind,ManifestDigest,Generation,Phase/.test(text)) return { recordset: [state.participant] };
    if (/SELECT \* FROM wf.RebateResetReceipt/.test(text)) return { recordset: state.receipt ? [state.receipt] : [] };
    if (/SELECT TOP 1 RequestId FROM wf.RebateConversionRequest/.test(text)) return { recordset: state.incomplete ? [{ RequestId: 'x' }] : [] };
    if (/SELECT TOP 1 Id FROM wf.RebateClaim/.test(text)) return { recordset: state.claims.some(status =>
      !['DRAFT','PENDING','TIER2_PENDING','TIER3_PENDING','TIER4_PENDING','APPROVED','REJECTED','CN_ISSUED','CANCELLED'].includes(status)) ? [{ Id: 9 }] : [] };
    if (/INSERT wf.RebateResetReceipt/.test(text)) { state.receipt = { ManifestDigest: p.digest, PreviousGeneration: p.oldGeneration,
      PreviousResetId: p.oldResetId, PreviousResetAtUtc: p.oldResetAt, NewGeneration: p.newGeneration, ResetAtUtc: p.resetAt,
      IdentityActorId: p.actor, IdentityEffectiveId: p.effective, CancelledClaimCount: 0 }; return {}; }
    if (/UPDATE wf.RebateClaim SET/.test(text)) {
      let n = 0; state.claims = state.claims.map(status => {
        if (!['DRAFT','PENDING','TIER2_PENDING','TIER3_PENDING','TIER4_PENDING'].includes(status)) return status;
        n++; state.audit.push(status); return 'CANCELLED';
      }); return { recordset: [{ CancelledClaimCount: n }] };
    }
    if (/UPDATE wf.RebateResetReceipt/.test(text)) { state.receipt.CancelledClaimCount = p.count; return { rowsAffected: [1] }; }
    if (/UPDATE wf.RebateResetParticipant/.test(text)) { if (state.failParticipantUpdate) throw Error('simulated participant failure'); state.participant.Generation = p.newGeneration;
      state.participant.ResetId = p.resetId; state.participant.LastResetAtUtc = p.resetAt; return { rowsAffected: [1] }; }
    throw Error('Unexpected query');
  };
  const run = async () => { const before = structuredClone(state); try { return await applyResetParticipant(query, input); }
    catch (error) { Object.assign(state, before); throw error; } };
  return { input, state, run };
}

test('participant applies and replays once with audit, preserving issued tickets and final claims', async () => {
  const f = fixture(); assert.deepEqual(await f.run(), { replayed: false, cancelledClaims: 2 });
  assert.deepEqual(f.state.claims, ['CANCELLED','CANCELLED','APPROVED','CN_ISSUED']);
  assert.deepEqual(f.state.audit, ['DRAFT','TIER2_PENDING']); assert.deepEqual(f.state.tickets, ['ISSUED']);
  assert.deepEqual(await f.run(), { replayed: true, cancelledClaims: 2 });
  assert.equal(f.state.audit.length, 2);
});

test('incomplete conversions and mismatched prior state leave all balances unchanged', async () => {
  for (const mutation of [f => f.state.incomplete = true, f => f.state.participant.Generation = 2,
    f => f.state.participant.ManifestDigest = 'b'.repeat(64), f => f.state.claims.push('UNKNOWN')]) {
    const f = fixture(); mutation(f); const before = structuredClone(f.state);
    await assert.rejects(f.run()); assert.deepEqual(f.state, before);
  }
});

test('a retry with a different actor, timestamp or digest cannot claim the receipt', async () => {
  for (const mutation of [f => f.input.actorId = 9, f => f.input.next.lastResetAtUtc = new Date('2026-11-13T12:00:01Z'),
    f => f.input.manifestDigest = 'b'.repeat(64)]) {
    const f = fixture(); await f.run(); mutation(f); const before = structuredClone(f.state);
    await assert.rejects(f.run()); assert.deepEqual(f.state, before);
  }
});

test('wrong physical database or unavailable exclusive lock fail before mutation', async () => {
  for (const mutate of [f => f.state.actual.DatabaseName = 'dbwins_worldfert9', f => f.state.lockResult = -1]) {
    const f = fixture(); mutate(f); const before = structuredClone(f.state);
    await assert.rejects(f.run()); assert.deepEqual(f.state, before);
  }
});

test('late participant update failure rolls back cancellation, audit and receipt together', async () => {
  const f = fixture(); f.state.failParticipantUpdate = true; const before = structuredClone(f.state);
  await assert.rejects(f.run(), /simulated participant failure/);
  assert.deepEqual(f.state, before);
});
