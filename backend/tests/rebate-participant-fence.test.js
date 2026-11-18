'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { acquireRebateParticipantFence } = require('../services/rebate-participant-fence');
const expected = { environment: 'production', generation: 3, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', manifestDigest: 'a'.repeat(64), lastResetAtUtc: '2026-11-13T14:00:00.000Z' };
function queryFor({ lock = 0, row = { EnvironmentKind: 'production', Generation: 3, ManifestDigest: 'a'.repeat(64),
  Phase: 'READY', ResetId: expected.resetId, LastResetAtUtc: new Date('2026-11-13T14:00:00.000Z') } } = {}) {
  const calls = [];
  const query = async (text, inputs) => { calls.push({ text, inputs }); return { recordset: /sp_getapplock/.test(text) ? [{ LockResult: lock }] : row ? [row] : [] }; };
  return { query, calls };
}

test('participant holds a transaction-scoped shared lock and checks the committed generation', async () => {
  const f = queryFor();
  const result = await acquireRebateParticipantFence(f.query, expected);
  assert.equal(result.generation, 3);
  assert.equal(result.resetId, expected.resetId);
  assert.match(f.calls[0].text, /@LockMode='Shared'.*@LockOwner='Transaction'/s);
  assert.match(f.calls[1].text, /WITH \(HOLDLOCK\)/);
});

test('missing, partially reset, stale or differently timed participants fail closed', async () => {
  for (const row of [null, { EnvironmentKind: 'production', Phase: 'APPLYING' },
    { EnvironmentKind: 'production', Phase: 'READY', Generation: 3, ManifestDigest: 'a'.repeat(64), ResetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', LastResetAtUtc: expected.lastResetAtUtc },
    { EnvironmentKind: 'production', Phase: 'READY', Generation: 2, ManifestDigest: 'a'.repeat(64), LastResetAtUtc: expected.lastResetAtUtc },
    { EnvironmentKind: 'production', Phase: 'READY', Generation: 3, ManifestDigest: 'b'.repeat(64), LastResetAtUtc: expected.lastResetAtUtc },
    { EnvironmentKind: 'production', Phase: 'READY', Generation: 3, ManifestDigest: 'a'.repeat(64), LastResetAtUtc: null }]) {
    await assert.rejects(acquireRebateParticipantFence(queryFor({ row }).query, expected));
  }
});

test('lock timeout is not treated as a valid fence', async () => {
  const f = queryFor({ lock: -1 });
  await assert.rejects(acquireRebateParticipantFence(f.query, expected), { code: 'REBATE_RESET_PARTICIPANT_LOCK_UNAVAILABLE' });
  assert.equal(f.calls.length, 1);
});
