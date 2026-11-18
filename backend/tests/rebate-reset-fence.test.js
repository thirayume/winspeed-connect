'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { digestTargets, withRebateOperationFence } = require('../services/rebate-reset-fence');
const { resolvePhysicalResetTargets } = require('../services/rebate-reset-targets');

const env = { DB_MODE: 'onprem', ONPREM_TARGET_KIND: 'production', ONPREM_DB_NAME: 'dbwins_worldfert9',
  ONPREM_SWITCHABLE_DATABASES: 'dbwins_worldfert9,dbwins_worldfert2,dbwins_worldfert9_uat',
  REBATE_RESET_DATABASES: 'dbwins_worldfert9,dbwins_worldfert2' };
const tupleResolver = (_env, _operation, name) => ({ database: name, expectedServerName: 'R740-SRV\\SQL2008' });
const digest = digestTargets(resolvePhysicalResetTargets(env, tupleResolver));
function fixture({ phase = 'READY', hash = digest, lock = 0, kind = 'production', primary = 'dbwins_worldfert9', generation = 2 } = {}) {
  const calls = []; let active = false;
  const db = { sql: { NVarChar: () => 'nvarchar', VarChar: () => 'varchar' },
    getTarget: () => 'onprem', getDbName: () => 'dbwins_worldfert2',
    runWithTarget: async (_mode, fn, database) => { calls.push(`target:${database}`); return fn(); },
    rebateFenceTransaction: async (fn, primaryDatabase) => {
      calls.push(`fence:${primaryDatabase}`);
      active = true; calls.push('transaction:start');
      const tx = { request: () => ({ input() { return this; }, async query(text) {
        if (/sp_getapplock/.test(text)) { calls.push('lock:shared'); return { recordset: [{ LockResult: lock }] }; }
        calls.push('state:read'); return { recordset: [{ EnvironmentKind: kind, PrimaryDatabase: primary,
          ManifestDigest: hash, Generation: generation, Phase: phase, ResetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', LastResetAtUtc: '2026-11-13T12:00:00Z' }] };
      } }) };
      try { return await fn(tx); } finally { active = false; calls.push('transaction:end'); }
    },
  };
  return { db, calls, isActive: () => active };
}

test('business operation remains inside a primary shared fence and returns to its selected database', async () => {
  const f = fixture();
  const result = await withRebateOperationFence(async state => {
    assert.equal(f.isActive(), true); assert.equal(state.generation, 2);
    assert.equal(state.environment, 'production'); assert.equal(state.manifestDigest, digest);
    assert.equal(state.resetId, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); return 'done';
  }, { env, db: f.db, tupleResolver });
  assert.equal(result, 'done');
  assert.deepEqual(f.calls, ['fence:dbwins_worldfert9', 'transaction:start', 'lock:shared', 'state:read',
    'target:dbwins_worldfert2', 'transaction:end']);
});

test('unfinished reset, stale target manifest and lock failure do not run the business operation', async () => {
  for (const [options, code] of [[{ phase: 'APPLYING' }, 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED'],
    [{ hash: '0'.repeat(64) }, 'REBATE_RESET_COORDINATOR_MISMATCH'],
    [{ lock: -1 }, 'REBATE_RESET_FENCE_UNAVAILABLE'], [{ kind: 'uat' }, 'REBATE_RESET_COORDINATOR_MISMATCH'],
    [{ generation: null }, 'REBATE_RESET_COORDINATOR_MISMATCH']]) {
    const f = fixture(options); let ran = false;
    await assert.rejects(withRebateOperationFence(() => { ran = true; }, { env, db: f.db, tupleResolver }), { code });
    assert.equal(ran, false); assert.equal(f.isActive(), false);
  }
});

test('an unapproved session target cannot use the fence', async () => {
  const f = fixture(); f.db.getDbName = () => 'dbwins_worldfert9_uat';
  await assert.rejects(withRebateOperationFence(() => {}, { env, db: f.db, tupleResolver }), { code: 'REBATE_RESET_TARGET_NOT_ALLOWED' });
  assert.deepEqual(f.calls, []);
});
