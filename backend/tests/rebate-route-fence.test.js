'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { digestTargets, withRebateOperationFence } = require('../services/rebate-reset-fence');
const { resolvePhysicalResetTargets } = require('../services/rebate-reset-targets');
const { UNFENCED, isShipmentEpoch, withRebateRouteFence, routeParticipantFence, rebateFenceMessage } = require('../services/rebate-route-fence');

const env = { DB_MODE: 'onprem', ONPREM_TARGET_KIND: 'production', ONPREM_DB_NAME: 'dbwins_worldfert9',
  ONPREM_SWITCHABLE_DATABASES: 'dbwins_worldfert9,dbwins_worldfert2,dbwins_worldfert9_uat',
  REBATE_RESET_DATABASES: 'dbwins_worldfert9,dbwins_worldfert2' };
const tupleResolver = (_env, _operation, name) => ({ database: name, expectedServerName: 'R740-SRV\\SQL2008' });
const digest = digestTargets(resolvePhysicalResetTargets(env, tupleResolver));

// Coordinator fixture: `row` is what wf.RebateResetCoordinator returns (null = never initialized).
function coordinator(row) {
  const calls = []; let active = false;
  const db = { sql: { NVarChar: () => 'nvarchar', VarChar: () => 'varchar' },
    getTarget: () => 'onprem', getDbName: () => 'dbwins_worldfert2',
    runWithTarget: async (_mode, fn, database) => { calls.push(`target:${database}`); return fn(); },
    rebateFenceTransaction: async (fn) => {
      active = true;
      const tx = { request: () => ({ input() { return this; }, async query(text) {
        if (/sp_getapplock/.test(text)) { calls.push(/@LockMode='Shared'/.test(text) ? 'lock:shared' : 'lock:other'); return { recordset: [{ LockResult: 0 }] }; }
        calls.push('state:read'); return { recordset: row ? [row] : [] };
      } }) };
      try { return await fn(tx); } finally { active = false; }
    } };
  return { db, calls, isActive: () => active };
}
const ready = { EnvironmentKind: 'production', PrimaryDatabase: 'dbwins_worldfert9', ManifestDigest: digest, Generation: 2,
  Phase: 'READY', ResetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', LastResetAtUtc: '2026-11-13T12:00:00Z' };

test('missing coordinator remains closed even if a caller asks for legacy fallback', async () => {
  const f = coordinator(null);
  await assert.rejects(withRebateOperationFence(async () => 'ran',
    { env, db: f.db, tupleResolver, allowUninitialized: true }), { code: 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED' });
  assert.deepEqual(f.calls, ['lock:shared', 'state:read']);

  // default stays strict: every existing caller of the fence still fails closed
  await assert.rejects(withRebateOperationFence(async () => 'ran', { env, db: coordinator(null).db, tupleResolver }),
    { code: 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED' });
});

test('a reset in progress fails closed even when an uninitialized environment would be allowed', async () => {
  for (const phase of ['PREPARING', 'APPLYING', 'FAILED']) {
    let ran = false;
    await assert.rejects(withRebateOperationFence(async () => { ran = true; },
      { env, db: coordinator({ ...ready, Phase: phase }).db, tupleResolver, allowUninitialized: true }),
    { code: 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED', status: 503 });
    assert.equal(ran, false);
  }
});

test('route fence: on-prem targets go through the global fence, other targets run unfenced at generation 0', async () => {
  let fenceOptions = null;
  const onprem = await withRebateRouteFence(async epoch => epoch, {
    db: { getTarget: () => 'onprem' }, env,
    fence: async (operation, options) => { fenceOptions = options; return operation({ environment: 'production', generation: 3,
      resetId: ready.ResetId, lastResetAtUtc: new Date('2026-11-13T12:00:00Z'), manifestDigest: digest }); },
  });
  assert.equal(fenceOptions.allowUninitialized, undefined);
  assert.equal(onprem.fenced, true); assert.equal(onprem.uninitialized, false); assert.equal(onprem.generation, 3);
  assert.equal(isShipmentEpoch(onprem), true);

  let fenceCalled = false;
  for (const db of [{ getTarget: () => 'LOCAL' }, {}]) {
    const local = await withRebateRouteFence(async epoch => epoch, { db, fence: async () => { fenceCalled = true; } });
    assert.equal(local, UNFENCED); assert.equal(isShipmentEpoch(local), false);
  }
  assert.equal(fenceCalled, false);
  assert.equal(Object.isFrozen(UNFENCED), true);
});

test('route fence does not swallow a fence failure', async () => {
  await assert.rejects(withRebateRouteFence(async () => 'ran', { db: { getTarget: () => 'onprem' },
    fence: async () => { throw Object.assign(new Error('REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED'), { code: 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED', status: 503 }); } }),
  { code: 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED' });
});

test('participant fence by epoch: none when unfenced, the strict fence once initialized', async () => {
  const noQuery = async () => { throw new Error('no SQL expected'); };
  assert.equal(await routeParticipantFence(noQuery, UNFENCED), UNFENCED);

  const epoch = { environment: 'production', generation: 2, resetId: ready.ResetId, lastResetAtUtc: new Date(), manifestDigest: digest, uninitialized: false, fenced: true };
  const seen = [];
  await routeParticipantFence(noQuery, epoch, { participantFence: async (_q, e) => { seen.push(e); } });
  assert.deepEqual(seen, [epoch]);
  await assert.rejects(routeParticipantFence(noQuery, epoch, { participantFence: async () => { throw Object.assign(new Error('x'), { code: 'REBATE_RESET_PARTICIPANT_MISMATCH' }); } }),
    { code: 'REBATE_RESET_PARTICIPANT_MISMATCH' });
  await assert.rejects(routeParticipantFence(null, epoch), { code: 'REBATE_RESET_PARTICIPANT_MISMATCH' });
});

test('uninitialized participant never falls back to the legacy balance', async () => {
  const epoch = { environment: 'uat', generation: 0, resetId: null, lastResetAtUtc: null, manifestDigest: digest, uninitialized: true, fenced: true };
  const make = ({ lock = 0, row = null } = {}) => {
    const calls = [];
    return { calls, query: async (text, inputs) => { calls.push({ text, inputs });
      return { recordset: /sp_getapplock/.test(text) ? [{ LockResult: lock }] : row ? [row] : [] }; } };
  };
  const ok = make();
  await assert.rejects(routeParticipantFence(ok.query, epoch), { code: 'REBATE_RESET_PARTICIPANT_MISMATCH' });
  assert.equal(ok.calls.length, 0);
  await assert.rejects(routeParticipantFence(make().query, { ...epoch, generation: 1 }), { code: 'REBATE_RESET_PARTICIPANT_MISMATCH' });
});

test('fence failures have a user message; other codes do not', () => {
  assert.match(rebateFenceMessage('REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED'), /กำลังเริ่มยอดรีเบทใหม่/);
  assert.match(rebateFenceMessage('REBATE_RESET_TARGET_NOT_ALLOWED'), /ฐานข้อมูล/);
  assert.match(rebateFenceMessage('REBATE_RESET_COORDINATOR_MISMATCH'), /ไม่พร้อมใช้งาน/);
  assert.equal(rebateFenceMessage('REBATE_CLAIM_INSUFFICIENT'), null);
  assert.equal(rebateFenceMessage(undefined), null);
});
