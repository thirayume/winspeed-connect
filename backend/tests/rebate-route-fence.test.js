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

const poolOn = { ...env, REBATE_POOL_103_ENABLED: 'true' };

test('route fence: on-prem targets go through the global fence, other targets run unfenced at generation 0', async () => {
  let fenceOptions = null;
  const onprem = await withRebateRouteFence(async epoch => epoch, {
    db: { getTarget: () => 'onprem' }, env: poolOn,
    neverReset: async () => { throw new Error('the switched-off check must not run when the Pool is on'); },
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
  await assert.rejects(withRebateRouteFence(async () => 'ran', { db: { getTarget: () => 'onprem' }, env: poolOn,
    fence: async () => { throw Object.assign(new Error('REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED'), { code: 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED', status: 503 }); } }),
  { code: 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED' });
});

// ── Rebate Pool switched off: live claim routes must keep working exactly as before ──
const { assertEnvironmentNeverReset, rebatePoolEnabled } = require('../services/rebate-route-fence');
const { beginResetAttempt } = require('../services/rebate-reset-begin');
const { recoverResetAttempt } = require('../services/rebate-reset-recover');

// db fixture for the switched-off check: `row` is the coordinator row on the primary database.
function primaryDb({ row = null, error = null } = {}) {
  const calls = [];
  return { calls, sql: { VarChar: n => `varchar(${n})` }, getTarget: () => 'onprem',
    runWithDb: async (database, fn) => { calls.push(`db:${database}`); return fn(); },
    wfQuery: async (text, inputs) => { calls.push({ text, inputs }); if (error) throw error; return { recordset: row ? [row] : [] }; } };
}

test('with the Pool switched off an on-prem route runs unfenced without touching the fence', async () => {
  for (const flag of [undefined, 'false', 'TRUE', '1']) {
    const db = primaryDb(); let fenceCalled = false;
    const epoch = await withRebateRouteFence(async e => e, { db, env: { ...env, REBATE_POOL_103_ENABLED: flag },
      fence: async () => { fenceCalled = true; } });
    assert.equal(epoch, UNFENCED, `flag=${flag}`);
    assert.equal(fenceCalled, false);
    assert.equal(rebatePoolEnabled({ REBATE_POOL_103_ENABLED: flag }), false);
    // the history check reads the coordinator of this environment on the primary database
    assert.equal(db.calls[0], 'db:dbwins_worldfert9');
    assert.match(db.calls[1].text, /FROM wf\.RebateResetCoordinator WHERE EnvironmentKind=@kind/);
    assert.equal(db.calls[1].inputs.kind.value, 'production');
  }
  assert.equal(rebatePoolEnabled({ REBATE_POOL_103_ENABLED: 'true' }), true);
});

test('a database that was reset is never served from the pre-reset balance when the switch is off', async () => {
  for (const row of [{ Generation: 1, Phase: 'READY' }, { Generation: 0, Phase: 'PREPARING' }, { Generation: 2, Phase: 'APPLYING' }, { Generation: 0, Phase: 'FAILED' }]) {
    let ran = false;
    await assert.rejects(withRebateRouteFence(async () => { ran = true; }, { db: primaryDb({ row }), env }),
      { code: 'REBATE_POOL_DISABLED_AFTER_RESET', status: 503 });
    assert.equal(ran, false);
  }
  // initialized but never reset: still the pre-reset balance, so the routes run
  assert.equal(await withRebateRouteFence(async e => e, { db: primaryDb({ row: { Generation: 0, Phase: 'READY' } }), env }), UNFENCED);
  assert.match(rebateFenceMessage('REBATE_POOL_DISABLED_AFTER_RESET'), /Rebate Pool ถูกปิดอยู่/);
});

test('the switched-off check tolerates only a missing coordinator table', async () => {
  const missing = new Error("Invalid object name 'wf.RebateResetCoordinator'.");
  await assertEnvironmentNeverReset({ db: primaryDb({ error: missing }), env });
  await assert.rejects(assertEnvironmentNeverReset({ db: primaryDb({ error: new Error('Login failed') }), env }), /Login failed/);
  await assert.rejects(assertEnvironmentNeverReset({ db: primaryDb(), env: { ...env, ONPREM_DB_NAME: '' } }), { code: 'REBATE_RESET_ENVIRONMENT_INVALID' });
  await assert.rejects(assertEnvironmentNeverReset({ db: primaryDb(), env: { ...env, ONPREM_TARGET_KIND: 'staging' } }), { code: 'REBATE_RESET_ENVIRONMENT_INVALID' });
  // the compose default applies when the kind is not pinned
  const db = primaryDb(); await assertEnvironmentNeverReset({ db, env: { ONPREM_DB_NAME: 'dbwins_worldfert9_uat' } });
  assert.equal(db.calls[1].inputs.kind.value, 'uat');
});

test('no reset can begin or resume while the switch is off, which is what makes unfenced routes safe', async () => {
  const off = { ...env };
  const never = () => { throw new Error('must not reach the database'); };
  const options = { env: off, db: { rebateFenceTransaction: never, runWithTarget: never, wfQuery: never }, tupleResolver, preflight: never };
  await assert.rejects(beginResetAttempt({ actorId: 1, effectiveId: 1 }, options), { code: 'REBATE_POOL_103_UNAVAILABLE', status: 503 });
  await assert.rejects(recoverResetAttempt('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', options), { code: 'REBATE_POOL_103_UNAVAILABLE', status: 503 });
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
