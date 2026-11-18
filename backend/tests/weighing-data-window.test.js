'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/weighing', '../../routes/weighing']]); });
test.after(async () => { await app.close(); });
const user = { sub: 12, role: 'ACCOUNTING' };

test('weighing reports clamp requested history to the system start date', async () => {
  const before = db.calls.length;
  const response = await app.call('GET', '/api/weighing/by-date?from=2025-01-01&to=2026-01-02', { user });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.from, '2026-01-01');
  const call = db.calls.slice(before).find(c => /FROM dbo\.WGHD h/.test(c.text));
  assert.equal(call.inputs.from, '2026-01-01');
  assert.equal(call.inputs.to, '2026-01-02');
  assert.equal((await app.call('GET', '/api/weighing/by-date?from=2026-02-30', { user })).status, 400);
});

test('direct weighing lookup and sales candidates cannot bypass the date boundary', async () => {
  const before = db.calls.length;
  assert.equal((await app.call('GET', '/api/weighing/tickets/5', { user })).status, 404);
  assert.equal((await app.call('GET', '/api/weighing/for-so/5', { user })).status, 200);
  const calls = db.calls.slice(before).filter(c => /h\.DateReg >= @globalStartDate/.test(c.text));
  assert.equal(calls.length, 2);
  for (const c of calls) assert.equal(c.inputs.globalStartDate, '2026-01-01');
});

test('live, anomalies and coverage apply the same boundary, including detail counts', async () => {
  const before = db.calls.length;
  for (const route of ['/live', '/anomalies', '/coverage']) {
    assert.equal((await app.call('GET', `/api/weighing${route}`, { user })).status, 200);
  }
  const calls = db.calls.slice(before).filter(c => /@globalStartDate/.test(c.text));
  assert.equal(calls.length, 3);
  for (const c of calls) assert.equal(c.inputs.globalStartDate, '2026-01-01');
  assert.match(calls.find(c => /AS DetailRows/.test(c.text)).text, /JOIN dbo\.WGHD h ON h\.Id=d\.WGHDId WHERE h\.DateReg >= @globalStartDate/);
  assert.match(calls.find(c => /AS Issue/.test(c.text)).text, /WHERE h\.DateReg >= @globalStartDate AND \(/);
});
