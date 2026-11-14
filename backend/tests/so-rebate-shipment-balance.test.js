'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
function replace(path, exports) { const p = require.resolve(path); require(p); require.cache[p].exports = exports; }
let generation = 1, failure = null, calls = 0, amount = 125.5, received;
replace('../services/rebate-route-fence', {
  withRebateRouteFence: fn => fn({ environment: 'uat', generation, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
  routeParticipantFence: async () => {}, isShipmentEpoch: epoch => epoch.generation > 0,
});
replace('../services/rebate-cycle-policy', { readRebateCycleMonths: async () => 12 });
replace('../services/rebate-shipment-queue', { getShipmentCustomerQueue: async (_query, options) => {
  calls++; received = options;
  if (failure) throw Object.assign(new Error('private source data'), { code: failure, status: 409 });
  return { totalFifoEligibleBalance: amount, openingEligibleBalance: 25 };
} });
let app, previous;
test.before(async () => {
  previous = process.env.REBATE_POOL_103_ENABLED;
  process.env.REBATE_POOL_103_ENABLED = 'true';
  app = await h.startApp([['/api/so', '../../routes/so']]);
});
test.after(async () => {
  await app.close();
  if (previous === undefined) delete process.env.REBATE_POOL_103_ENABLED;
  else process.env.REBATE_POOL_103_ENABLED = previous;
});
test('bill balance uses verified shipment queue including opening balance and scope', async () => {
  const before = db.calls.length;
  const r = await app.call('GET', '/api/so/rebate-balance/123', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.availableRebate, 125.5);
  assert.equal(r.body.source, 'shipment');
  assert.equal(received.custId, 123); assert.equal(received.cutoff, '2026-01-01');
  assert.equal(received.epoch.generation, 1); assert.ok(received.scope.sql);
  assert.ok(!db.calls.slice(before).some(c => /v_RebateAccrualRemaining/.test(c.text)));
});
test('reset, changed source and invalid balance fail without falling back to old lots', async () => {
  const before = db.calls.length;
  generation = 0;
  let r = await app.call('GET', '/api/so/rebate-balance/123', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'REBATE_RESET_NOT_COMPLETED');
  generation = 1; failure = 'REBATE_RESERVATION_SOURCE_CHANGED';
  r = await app.call('GET', '/api/so/rebate-balance/123', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 409); assert.doesNotMatch(JSON.stringify(r.body), /private source data/);
  failure = null; amount = NaN;
  r = await app.call('GET', '/api/so/rebate-balance/123', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 503);
  assert.ok(!db.calls.slice(before).some(c => /v_RebateAccrualRemaining/.test(c.text)));
});
test('salesperson without amount access cannot call shipment balance', async () => {
  const before = calls;
  const r = await app.call('GET', '/api/so/rebate-balance/123', { user: { sub: 2, role: 'SALES' } });
  assert.equal(r.status, 403); assert.equal(calls, before);
});
test('salesperson can check availability without receiving an amount',async()=>{
  amount=125.5;generation=1;failure=null;
  let r=await app.call('GET','/api/so/rebate-availability/123',{user:{sub:2,role:'SALES'}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body,{hasAvailableRebate:true});
  amount=0;r=await app.call('GET','/api/so/rebate-availability/123',{user:{sub:2,role:'SALES'}});
  assert.deepEqual(r.body,{hasAvailableRebate:false});
  failure='REBATE_RESERVATION_SOURCE_CHANGED';
  r=await app.call('GET','/api/so/rebate-availability/123',{user:{sub:2,role:'SALES'}});
  assert.equal(r.status,409);assert.equal(r.body.hasAvailableRebate,undefined);failure=null;
});
