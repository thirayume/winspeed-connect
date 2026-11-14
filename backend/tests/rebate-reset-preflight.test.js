'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightResetTargets, REQUIRED_OBJECTS, PRIMARY_OBJECTS } = require('../services/rebate-reset-preflight');

const env = { DB_MODE: 'onprem', ONPREM_TARGET_KIND: 'production', ONPREM_DB_NAME: 'dbwins_worldfert9',
  ONPREM_SWITCHABLE_DATABASES: 'dbwins_worldfert9,dbwins_worldfert2,dbwins_worldfert9_uat',
  REBATE_RESET_DATABASES: 'dbwins_worldfert9,dbwins_worldfert2' };
const tupleResolver = (_env, _operation, name) => ({ database: name, expectedServerName: 'R740-SRV\\SQL2008', password: 'never-output' });
function fixture(rows) {
  let current; const calls = [];
  return { calls, db: {
    runWithTarget: async (_target, fn, name) => { current = name; return fn(); },
    wfQuery: async query => { calls.push({ name: current, query }); return { recordset: [rows[current]] }; },
  } };
}
function ready(name) { return { DatabaseName: name, ServerName: 'R740-SRV\\SQL2008', BusinessActorId:1, BusinessEffectiveId:1, BootstrapId:1,
  ...Object.fromEntries([...REQUIRED_OBJECTS, ...PRIMARY_OBJECTS].map(name => [name, 1])) }; }

test('preflight checks only the reviewed physical targets and never outputs credentials', async () => {
  const f = fixture({ dbwins_worldfert9: ready('dbwins_worldfert9'), dbwins_worldfert2: ready('dbwins_worldfert2') });
  const result = await preflightResetTargets({ env, db: f.db, tupleResolver });
  assert.equal(result.ready, true);
  assert.deepEqual(f.calls.map(c => c.name), ['dbwins_worldfert9', 'dbwins_worldfert2']);
  assert.ok(!JSON.stringify(result).includes('never-output'));
  assert.ok(f.calls.every(c => /^SELECT\s/i.test(c.query) && !/\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(c.query)));
});

test('approval journal and coordinator identity columns are required before reset', async () => {
  const primary=ready('dbwins_worldfert9'), secondary=ready('dbwins_worldfert2');
  primary.BusinessActorId=0; secondary.RebateConversionApprovalRequest=0;
  const f=fixture({dbwins_worldfert9:primary,dbwins_worldfert2:secondary});
  const result=await preflightResetTargets({env,db:f.db,tupleResolver});
  assert.equal(result.ready,false);
  assert.deepEqual(result.targets[0].missing,['BusinessActorId']);
  assert.deepEqual(result.targets[1].missing,['RebateConversionApprovalRequest']);
  assert.doesNotMatch(f.calls[1].query,/COL_LENGTH\('wf.RebateResetAttemptTarget'/);
});

test('a missing migration keeps the entire preflight unready', async () => {
  const secondary = ready('dbwins_worldfert2'); secondary.RebateShipmentEvidence = 0;
  const f = fixture({ dbwins_worldfert9: ready('dbwins_worldfert9'), dbwins_worldfert2: secondary });
  const result = await preflightResetTargets({ env, db: f.db, tupleResolver });
  assert.equal(result.ready, false);
  assert.deepEqual(result.targets[1].missing, ['RebateShipmentEvidence']);
});

test('coordinator is required on the primary, not on every participant', async () => {
  const secondary = ready('dbwins_worldfert2'); delete secondary.RebateResetCoordinator;
  const f = fixture({ dbwins_worldfert9: ready('dbwins_worldfert9'), dbwins_worldfert2: secondary });
  assert.equal((await preflightResetTargets({ env, db: f.db, tupleResolver })).ready, true);
  assert.doesNotMatch(f.calls[1].query, /OBJECT_ID\('wf\.RebateResetCoordinator'/);
  const primary = ready('dbwins_worldfert9'); delete primary.RebateResetCoordinator;
  const bad = fixture({ dbwins_worldfert9: primary, dbwins_worldfert2: secondary });
  assert.equal((await preflightResetTargets({ env, db: bad.db, tupleResolver })).ready, false);
});

test('a profile connecting to the wrong actual database or server fails closed', async () => {
  for (const wrong of [{ DatabaseName: 'dbwins_worldfert9_uat' }, { ServerName: 'unexpected-server' }]) {
    const f = fixture({ dbwins_worldfert9: { ...ready('dbwins_worldfert9'), ...wrong } });
    await assert.rejects(preflightResetTargets({ env, db: f.db, tupleResolver }), { code: 'REBATE_RESET_TARGET_IDENTITY_MISMATCH' });
  }
});
