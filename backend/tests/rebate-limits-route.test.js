'use strict';
// The Rebate page states the discount limits the server applies (App Settings), read by the bill's price check reader.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
const priceAuthority = require('../services/price-authority');
let limits = { standard: 300, max: 400, step: 100 };
priceAuthority.readDiscountLimits = async () => ({ ...limits });
let app;
test.before(async () => { app = await h.startApp([['/api/rebate-pool', '../../routes/rebate-pool']]); });
test.after(async () => { await app.close(); });
test('GET /limits returns the limits in force to a signed-in user and follows a settings change', async () => {
  let r = await app.call('GET', '/api/rebate-pool/limits', { user: { sub: 2, role: 'SALES' } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body, { standard: 300, max: 400, step: 100 });
  limits = { standard: 200, max: 300, step: 50 };
  r = await app.call('GET', '/api/rebate-pool/limits', { user: { sub: 1, role: 'ADMIN' } });
  assert.deepEqual(r.body, { standard: 200, max: 300, step: 50 });
});
test('GET /limits needs a signed-in user', async () => {
  const r = await app.call('GET', '/api/rebate-pool/limits', {});
  assert.equal(r.status, 401);
});
