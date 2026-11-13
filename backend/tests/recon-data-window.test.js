'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

let currentTarget = false;
let historicalInvoiceFixture = false;
const db = h.installDbStub(({ text }) => {
  if (/SELECT SOID FROM dbo\.SOHD WHERE SOID = @soId/.test(text)) return currentTarget ? [{ SOID: 2 }] : [];
  if (historicalInvoiceFixture && /SELECT TOP 500 CAST\(hd\.SOID/.test(text)) return [{ SoId: '2', WfRef: 'NEW-SO', ShipDate: '2026-01-01' }];
  if (historicalInvoiceFixture && /FROM dbo\.SOInvDT d/.test(text)) return [{ SoId: '2', SOInvID: 7, DocuNo: 'OLD-INVOICE', DocuDate: new Date('2025-12-31T00:00:00Z'), DocuType: 107, PostID: 77 }];
  return [];
}, { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/recon', '../../routes/recon']]); });
test.after(async () => { await app.close(); });

test('reconciliation cases, summary and mismatches use the shared business-date boundary', async () => {
  const user = { sub: 12, role: 'ACCOUNTING' };
  for (const [path, predicate] of [
    ['/api/recon/cases?days=400', /hd\.DocuDate >= @globalStartDate/],
    ['/api/recon/summary?days=400', /hd\.DocuDate >= @globalStartDate/],
    ['/api/recon/account-mismatches?days=400', /h\.DocuDate >= @globalStartDate/],
  ]) {
    const before = db.calls.length;
    const result = await app.call('GET', path, { user });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const query = db.calls.slice(before).find(call => predicate.test(call.text));
    assert.ok(query, path);
    assert.equal(query.inputs.globalStartDate, '2026-01-01');
  }
});

test('resolving an old or invalid SO does not write a reconciliation record', async () => {
  const user = { sub: 12, role: 'ACCOUNTING' };
  const before = db.calls.length;
  assert.equal((await app.call('POST', '/api/recon/1/resolve', { user, body: { checkType: 'INVOICE' } })).status, 404);
  assert.equal((await app.call('POST', '/api/recon/not-a-number/resolve', { user, body: { checkType: 'INVOICE' } })).status, 400);
  assert.ok(!db.calls.slice(before).some(call => /MERGE wf\.ReconResolution/.test(call.text)));
});

test('resolving a current SO can proceed', async () => {
  currentTarget = true;
  try {
    const result = await app.call('POST', '/api/recon/2/resolve', { user: { sub: 12, role: 'ACCOUNTING' }, body: { checkType: 'INVOICE' } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.ok(db.calls.some(call => /MERGE wf\.ReconResolution/.test(call.text)));
  } finally { currentTarget = false; }
});

test('historical linked invoice is hidden while posted and GL states remain correct', async () => {
  historicalInvoiceFixture = true;
  try {
    const user = { sub: 12, role: 'ACCOUNTING' };
    const cases = await app.call('GET', '/api/recon/cases', { user });
    assert.equal(cases.status, 200);
    assert.equal(cases.body[0].postInvoiceStatus, 'POSTED');
    assert.equal(cases.body[0].readyForPostInvoice, false);
    assert.equal(cases.body[0].wsInvoiceNo, null);
    assert.equal(cases.body[0].invoiceBeforeWindow, true);
    assert.doesNotMatch(JSON.stringify(cases.body), /OLD-INVOICE/);
    const summary = await app.call('GET', '/api/recon/summary', { user });
    assert.equal(summary.body.postedInvoice, 1);
    assert.equal(summary.body.glVerified, 1);
  } finally { historicalInvoiceFixture = false; }
});
