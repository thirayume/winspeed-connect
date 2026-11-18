'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
const windowPath = require.resolve('../services/global-data-window-store');
let unavailable = false;
require.cache[windowPath].exports.readGlobalDataWindow = async () => {
  if (unavailable) throw new Error('window unavailable');
  return require('../services/data-window').boundaries('2026-01-01');
};
let app;
test.before(async () => { app = await h.startApp([['/api/admin/reports', '../../routes/admin-reports']]); });
test.after(async () => app.close());
test.beforeEach(() => { db.calls.length = 0; unavailable = false; });

for (const suffix of ['/audit', '/report-audit']) {
  test(`report audit ${suffix} applies the UTC boundary without deleting history`, async () => {
    const result = await app.call('GET', '/api/admin/reports' + suffix, { user:{sub:1,role:'ADMIN'} });
    assert.equal(result.status, 200);
    const call = db.calls.find(c => /FROM wf\.ChangeEvent/.test(c.text));
    assert.match(call.text, /CreatedAt >= @globalStartUtc/);
    assert.equal(call.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
    assert.ok(!db.calls.some(c => /DELETE|UPDATE/i.test(c.text)));
  });
}
test('report audit fails closed when the data window is unavailable', async () => {
  unavailable = true;
  const result = await app.call('GET', '/api/admin/reports/audit', { user:{sub:1,role:'ADMIN'} });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'DATA_WINDOW_UNAVAILABLE');
  assert.ok(!db.calls.some(c => /FROM wf\.ChangeEvent/.test(c.text)));
});
