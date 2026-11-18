'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let pool = {};
let metadataLoads = 0;
const { stub } = h.installDbStub(({ text }) => {
  if (/INFORMATION_SCHEMA\.COLUMNS/.test(text)) { metadataLoads++; return [{ COLUMN_NAME: metadataLoads === 1 ? 'SaleAreaID' : 'RegionID' }]; }
  return [];
}, { activeUserIds: h.TEST_USERS });
stub.pools = () => pool;
let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master']]); });
test.after(async () => app.close());

test('master schema metadata is coalesced per pool and reloaded when the pool changes', async () => {
  const user = { sub: 1, role: 'ADMIN' };
  for (let i = 0; i < 2; i++) {
    const response = await app.call('GET', '/api/master/customer-filters', { user });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  assert.equal(metadataLoads, 1);
  pool = {};
  const response = await app.call('GET', '/api/master/customer-filters', { user });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(metadataLoads, 2);
});
