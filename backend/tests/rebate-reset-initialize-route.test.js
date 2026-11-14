'use strict';

// Administrator routes for the reset fences: status and first-time initialization.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const dbStub = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
const state = { target: 'onprem', session: null, calls: [], statusCalls: 0, error: null,
  result: { environment: 'uat', generation: 0, targetCount: 1, participantsCreated: 1, coordinatorCreated: true, replayed: false } };
dbStub.stub.getTarget = () => state.target;
dbStub.stub.getDbName = () => state.session;

const servicePath = require.resolve('../services/rebate-reset-initialize');
const real = require(servicePath);
require.cache[servicePath].exports = { ...real,
  initializeRebateEnvironment: async input => { state.calls.push(input); if (state.error) throw state.error; return state.result; },
  readRebateEnvironmentStatus: async () => { state.statusCalls += 1; if (state.error) throw state.error;
    return { environment: 'uat', poolEnabled: true, initialized: false, ready: false, coordinator: null, participants: [] }; } };

const SAVED = {};
const ENV = { ONPREM_DB_NAME: 'dbwins_worldfert9_uat', ONPREM_TARGET_KIND: 'uat', REBATE_POOL_103_ENABLED: 'true' };
let app;
test.before(async () => {
  for (const k of Object.keys(ENV)) SAVED[k] = process.env[k];
  app = await h.startApp([['/api/rebate-pool', '../../routes/rebate-pool']]);
});
test.after(async () => {
  for (const k of Object.keys(ENV)) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
  await app.close();
});
test.beforeEach(() => {
  Object.assign(process.env, ENV);
  Object.assign(state, { target: 'onprem', session: null, calls: [], statusCalls: 0, error: null });
});

const admin = { sub: 1, role: 'ADMIN' };
const body = { confirm: 'INITIALIZE', environment: 'uat', reason: 'เปิดใช้ Rebate Pool บน UAT' };
const initialize = (payload = body, user = admin) => app.call('POST', '/api/rebate-pool/reset/initialize', { body: payload, user });
const failure = (code, status) => Object.assign(new Error(code), { code, status });

test('an administrator on the primary database can initialize the fences', async () => {
  const r = await initialize();
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body, state.result);
  assert.deepEqual(state.calls, [{ actorId: 1, effectiveId: 1, reason: 'เปิดใช้ Rebate Pool บน UAT' }]);

  state.result = { ...state.result, participantsCreated: 0, coordinatorCreated: false, replayed: true };
  const again = await initialize();
  assert.equal(again.status, 200, 'a replay is not reported as created');
  state.result = { ...state.result, participantsCreated: 1, coordinatorCreated: true, replayed: false };
});

test('only an administrator may initialize or read the status', async () => {
  for (const user of [{ sub: 25, role: 'MANAGER' }, { sub: 12, role: 'ACCOUNTING' }, { sub: 43, role: 'SALES' }, { sub: 19, role: 'C_LEVEL' }]) {
    assert.equal((await initialize(body, user)).status, 403, user.role);
    assert.equal((await app.call('GET', '/api/rebate-pool/reset/status', { user })).status, 403, user.role);
  }
  assert.equal(state.calls.length, 0);
  assert.equal(state.statusCalls, 0);
});

test('initialization needs the Pool switch, the typed confirmation and the matching environment', async () => {
  process.env.REBATE_POOL_103_ENABLED = 'false';
  const off = await initialize();
  assert.equal(off.status, 503); assert.equal(off.body.code, 'REBATE_POOL_103_UNAVAILABLE');
  process.env.REBATE_POOL_103_ENABLED = 'true';

  for (const payload of [{ ...body, confirm: 'initialize' }, { ...body, confirm: undefined }, { ...body, environment: 'production' }, { ...body, environment: '' }, {}]) {
    const r = await initialize(payload);
    assert.equal(r.status, 400, JSON.stringify(payload)); assert.equal(r.body.code, 'REBATE_RESET_CONFIRMATION_REQUIRED');
  }
  assert.equal(state.calls.length, 0);
});

test('it runs only on-prem and only from the primary database', async () => {
  state.target = 'LOCAL';
  const local = await initialize();
  assert.equal(local.status, 409); assert.equal(local.body.code, 'REBATE_RESET_ENVIRONMENT_INVALID');
  assert.equal((await app.call('GET', '/api/rebate-pool/reset/status', { user: admin })).status, 409);

  state.target = 'onprem'; state.session = 'dbwins_worldfert2';
  const secondary = await initialize();
  assert.equal(secondary.status, 409); assert.equal(secondary.body.code, 'REBATE_RESET_PRIMARY_SESSION_REQUIRED');
  assert.match(secondary.body.error, /ฐานข้อมูลหลัก/);

  state.session = 'DBWINS_WORLDFERT9_UAT'; // the primary, in another case
  assert.equal((await initialize()).status, 201);
  assert.equal(state.calls.length, 1);
});

test('service refusals reach the administrator with a reason, internal errors do not leak', async () => {
  for (const [code, status, message] of [['REBATE_RESET_HISTORY_EXISTS', 409, /มีประวัติการเริ่มยอดรีเบทใหม่/], ['REBATE_RESET_COORDINATOR_MISMATCH', 409, /ตัวควบคุมรีเบท/],
    ['REBATE_RESET_PREFLIGHT_FAILED', 503, /ตารางที่จำเป็น/], ['REBATE_RESET_REASON_REQUIRED', 400, /เหตุผล/]]) {
    state.error = failure(code, status);
    const r = await initialize();
    assert.equal(r.status, status, code); assert.equal(r.body.code, code); assert.match(r.body.error, message);
  }
  state.error = new Error('Login failed for user wf_r740_uat_app_v2');
  const r = await initialize();
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'REBATE_POOL_ERROR');
  assert.doesNotMatch(JSON.stringify(r.body), /Login failed|wf_r740/);
});

test('status is available to an administrator even while the Pool is switched off', async () => {
  process.env.REBATE_POOL_103_ENABLED = 'false';
  const r = await app.call('GET', '/api/rebate-pool/reset/status', { user: admin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.environment, 'uat');
  assert.equal(state.statusCalls, 1);
});
