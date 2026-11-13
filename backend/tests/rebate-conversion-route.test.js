'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
const servicePath = require.resolve('../services/rebate-conversion-execution');
const real = require(servicePath);
let calls = [];
require.cache[servicePath].exports = { ...real, executeReviewedConversion: async (user, body) => {
  calls.push({ user, body }); return { conversion: { id: 1 }, replayed: false };
} };
let app;
test.before(async () => { app = await h.startApp([['/api/rebate-pool', '../../routes/rebate-pool']]); });
test.after(async () => { delete process.env.REBATE_CONVERSION_ENABLED; await app.close(); });

test('conversion is disabled by default even for admin', async () => {
  delete process.env.REBATE_CONVERSION_ENABLED; calls = [];
  const result = await app.call('POST', '/api/rebate-pool/conversions/execute', { user: { sub: 1, role: 'ADMIN' }, body: {} });
  assert.equal(result.status, 503); assert.equal(calls.length, 0);
});

test('an environment flag cannot expose the separate rebate ledger', async () => {
  process.env.REBATE_CONVERSION_ENABLED = 'true'; calls = [];
  const result = await app.call('POST', '/api/rebate-pool/conversions/execute', { user: { sub: 1, role: 'ADMIN' }, body: { requestId: 'fixture' } });
  assert.equal(result.status, 503); assert.equal(result.body.code, 'REBATE_SINGLE_SOURCE_REQUIRED'); assert.equal(calls.length, 0);
});

test('enabled conversion does not allow a user without permission', async () => {
  process.env.REBATE_CONVERSION_ENABLED = 'true'; calls = [];
  const result = await app.call('POST', '/api/rebate-pool/conversions/execute', { user: { sub: 2, role: 'SALES' }, body: {} });
  assert.equal(result.status, 403); assert.equal(calls.length, 0);
});
