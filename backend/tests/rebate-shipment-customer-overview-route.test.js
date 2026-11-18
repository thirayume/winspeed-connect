'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
function replace(path, exports) { const p = require.resolve(path); require(p); require.cache[p].exports = exports; }
let generation = 1, calls = 0, input;
replace('../services/rebate-route-fence', {
  withRebateRouteFence: fn => fn({ environment: 'uat', generation, resetId: 'abc' }),
  routeParticipantFence: async () => {}, isShipmentEpoch: e => e.generation > 0,
});
replace('../services/rebate-cycle-policy', { readRebateCycleMonths: async () => 12 });
replace('../services/rebate-shipment-customer-overview', { getShipmentCustomerOverview: async (_q, options) => {
  calls++; input = options; return { items: [{ custId: 5, balance: 50 }], nextAfter: null };
} });
let app, previous;
test.before(async () => { previous = process.env.REBATE_POOL_103_ENABLED; process.env.REBATE_POOL_103_ENABLED = 'true';
  app = await h.startApp([['/api/rebate-pool', '../../routes/rebate-pool']]); });
test.after(async () => { await app.close(); if (previous === undefined) delete process.env.REBATE_POOL_103_ENABLED; else process.env.REBATE_POOL_103_ENABLED = previous; });
test('overview requires amount access, reset fence and scope', async () => {
  let r = await app.call('GET', '/api/rebate-pool/customers?after=2&limit=5&search=test', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(input.after, 2); assert.equal(input.limit, 5);
  assert.equal(input.search, 'test'); assert.equal(input.cutoff, '2026-01-01'); assert.ok(input.scope.sql);
  generation = 0;
  r = await app.call('GET', '/api/rebate-pool/customers', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 409); assert.equal(calls, 1);
  generation = 1;
  r = await app.call('GET', '/api/rebate-pool/customers', { user: { sub: 2, role: 'SALES' } });
  assert.equal(r.status, 403); assert.equal(calls, 1);
  process.env.REBATE_POOL_103_ENABLED = 'false';
  r = await app.call('GET', '/api/rebate-pool/customers', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 503); assert.equal(calls, 1);
});
