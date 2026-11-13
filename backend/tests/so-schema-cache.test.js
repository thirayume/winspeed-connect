'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let database = 'one';
const { stub, calls } = h.installDbStub(({ text }) => {
  if (/COL_LENGTH\('wf\.SalesOrderLine', 'GiveawayApprovalStatus'\)/.test(text)) return [{ HasColumns: database === 'one' ? 1 : 0 }];
  return [];
}, { activeUserIds: h.TEST_USERS });
stub.getDbName = () => database;
const activePath = require.resolve('../services/active-database');
require.cache[activePath] = { id: activePath, filename: activePath, loaded: true, exports: { onpremEnabled: () => false } };
let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so']]); });
test.after(async () => app.close());

test('giveaway schema detection is isolated per database', async () => {
  const user = { sub: 1, role: 'ADMIN' };
  database = 'one';
  assert.equal((await app.call('GET', '/api/so/giveaways/pending', { user })).status, 200);
  assert.equal(calls.filter(c => /FROM wf\.SalesOrderLine l/.test(c.text)).length, 1);
  database = 'two';
  const second = await app.call('GET', '/api/so/giveaways/pending', { user });
  assert.equal(second.status, 200); assert.deepEqual(second.body, []);
  assert.equal(calls.filter(c => /COL_LENGTH\('wf\.SalesOrderLine', 'GiveawayApprovalStatus'\)/.test(c.text)).length, 2);
  assert.equal(calls.filter(c => /FROM wf\.SalesOrderLine l/.test(c.text)).length, 1);
});
