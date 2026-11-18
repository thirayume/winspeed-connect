'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(({ text, inputs }) => {
  if (/AS Visible FROM wf\.Quotation/.test(text) && inputs.id === 43) return [{ Visible: 1 }];
  if (/SELECT Status, ValidUntil, QuoteNo FROM wf\.Quotation/.test(text) && inputs.id === 43) return [{ Status: 'DRAFT', ValidUntil: '2099-01-01', QuoteNo: 'fixture' }];
  return [];
}, { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/quotation', '../../routes/quotation']]); });
test.after(async () => { await app.close(); });

test('quotation listing filters app UTC and WinSpeed business dates separately', async () => {
  const before = db.calls.length;
  const response = await app.call('GET', '/api/quotation', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const call = db.calls.slice(before).find(c => /WITH Rows AS/.test(c.text));
  assert.ok(call);
  assert.match(call.text, /q\.CreatedAt >= @globalStartUtc/);
  assert.match(call.text, /qu\.DocuDate >= @globalStartDate/);
  assert.equal(call.inputs.globalStartDate, '2026-01-01');
  assert.equal(call.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
});

test('old quotations cannot be accessed or changed by a direct ID', async () => {
  const user = { sub: 1, role: 'ADMIN' };
  const before = db.calls.length;
  assert.equal((await app.call('GET', '/api/quotation/42', { user })).status, 404);
  assert.equal((await app.call('GET', '/api/quotation/-42', { user })).status, 404);
  assert.equal((await app.call('PATCH', '/api/quotation/42/status', { user, body: { status: 'SENT' } })).status, 404);
  const calls = db.calls.slice(before).filter(c => /AS Visible/.test(c.text));
  assert.equal(calls.length, 3);
  assert.ok(calls.some(c => /FROM dbo\.SOHD/.test(c.text) && c.inputs.cut === '2026-01-01'));
  assert.ok(calls.some(c => /FROM wf\.Quotation/.test(c.text) && c.inputs.cut.toISOString() === '2025-12-31T17:00:00.000Z'));
  assert.ok(!db.calls.slice(before).some(c => /UPDATE wf\.Quotation/.test(c.text)));
});

test('an in-window quotation can be sent and cancelled without undefined price variables', async () => {
  const user = { sub: 1, role: 'ADMIN' };
  for (const status of ['SENT', 'CANCELLED']) {
    const before = db.calls.length;
    const response = await app.call('PATCH', '/api/quotation/43/status', { user, body: { status } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.status, status);
    assert.ok(db.calls.slice(before).some(c => /UPDATE wf\.Quotation SET Status=@s/.test(c.text) && c.inputs.s === status));
  }
});
