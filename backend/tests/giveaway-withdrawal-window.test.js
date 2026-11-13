'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS, strictTypedInputs: true });
const windows = require('../services/global-data-window-store');
let start = '2026-01-01';
windows.readGlobalDataWindow = async () => require('../services/data-window').boundaries(start);
let app;
test.before(async () => { app = await h.startApp([['/api/giveaway', '../../routes/giveaway']]); });
test.after(async () => { await app.close(); });

test('withdrawal months before the window are hidden; first-day cutoff includes boundary month', async () => {
  start = '2026-01-01';
  const before = db.calls.length;
  const response = await app.call('GET', '/api/giveaway/withdrawals?year=2569', { user: { sub: 12, role: 'ADMIN' } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const call = db.calls.slice(before).find(c => /FROM wf.GiveawayWithdrawal/.test(c.text));
  assert.equal(call.inputs.y, 2569);
  assert.equal(call.inputs.startPeriod, 2026 * 12 + 1);
  assert.match(call.text, /PeriodYear-543/);
  assert.match(call.text, /IssueMonth\) >= @startPeriod/);
});

test('mid-month cutoff holds the boundary month in a separate scope-filtered read-only query', async () => {
  start = '2026-06-15';
  const user = { sub: 12, role: 'ADMIN' };
  let before = db.calls.length;
  assert.equal((await app.call('GET', '/api/giveaway/withdrawals?year=2569', { user })).status, 200);
  let call = db.calls.slice(before).find(c => /FROM wf.GiveawayWithdrawal/.test(c.text));
  assert.equal(call.inputs.startPeriod, 2026 * 12 + 6);
  assert.match(call.text, /IssueMonth\) > @startPeriod/);
  before = db.calls.length;
  assert.equal((await app.call('GET', '/api/giveaway/withdrawals/date-review?year=2569', { user })).status, 200);
  call = db.calls.slice(before).find(c => /FROM wf.GiveawayWithdrawal/.test(c.text));
  assert.match(call.text, /IssueMonth\) = @startPeriod/);
  assert.match(call.text, /IssueMonth IS NULL OR IssueMonth NOT BETWEEN 1 AND 12/);
  assert.match(call.text, /SELECT TOP 300/);
  assert.ok(!db.calls.slice(before).some(c => /\b(?:UPDATE|INSERT|DELETE)\b/i.test(c.text)));
});
