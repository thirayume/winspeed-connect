'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS, strictTypedInputs: true });
let app;
test.before(async () => { app = await h.startApp([['/api/budget', '../../routes/budget']]); });
test.after(async () => { await app.close(); });

test('budget displays only annual periods overlapping the configured window in both calendars', async () => {
  const user = { sub: 12, role: 'ADMIN' };
  for (const path of ['/api/budget/plans', '/api/budget/expenditure?year=2569']) {
    const before = db.calls.length;
    const response = await app.call('GET', path, { user });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const q = db.calls.slice(before).find(call => /@startYear/.test(call.text));
    assert.ok(q);
    assert.equal(q.inputs.startYear, 2026);
    assert.match(q.text, /PeriodYear BETWEEN 2400 AND 3000 THEN (?:p\.)?PeriodYear-543 ELSE (?:p\.)?PeriodYear END >= @startYear/);
    assert.doesNotMatch(q.text, /CreatedAt\s*>=/);
  }
});
