'use strict';

/**
 * UAT batch 7, ADM-06 — the customer DSAR export reads wf.SalesOrder and dbo.SOHD by customer id
 * (indexable), not the all-documents view with a cast, which timed out on real data.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const db = h.installDbStub(({ text }) => {
  if (/FROM dbo\.EMCust WHERE/.test(text)) return [{ CustID: 1078, CustName: 'ลูกค้าทดสอบ' }];
  return [];
}, { activeUserIds: h.TEST_USERS });
const windowPath = require.resolve('../services/global-data-window-store');
let windowUnavailable = false;
require.cache[windowPath].exports.readGlobalDataWindow = async () => {
  if (windowUnavailable) throw new Error('window unavailable');
  return require('../services/data-window').boundaries('2026-01-01');
};

let app;
test.before(async () => { app = await h.startApp([['/api/pdpa', '../../routes/pdpa']]); });
test.after(async () => { await app.close(); });

test('ADM-06: customer export uses the base tables with an integer customer id', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/pdpa/dsar/export', { body: { subjectType: 'CUSTOMER', subjectId: '1078' }, user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.historyStartDate, '2026-01-01');
  const so = db.calls.slice(before).find(c => /FROM dbo\.SOHD h WITH \(NOLOCK\) WHERE @cid IS NOT NULL AND h\.CustID = @cid/.test(c.text));
  assert.ok(so, 'native documents read by CustID');
  assert.equal(so.inputs.cid, 1078);
  assert.equal(so.inputs.globalStartDate, '2026-01-01');
  assert.equal(so.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.match(so.text, /s\.CreatedAt >= @globalStartUtc/);
  assert.match(so.text, /h\.DocuDate >= @globalStartDate/);
  assert.ok(!db.calls.slice(before).some(c => /v_AllSalesOrders/.test(c.text)), 'no all-documents view');
});

test('DSAR log displays only entries since the UTC boundary', async () => {
  const before = db.calls.length;
  const r = await app.call('GET', '/api/pdpa/dsar', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 200);
  const call = db.calls.slice(before).find(c => /FROM wf\.DsarLog/.test(c.text));
  assert.match(call.text, /d\.RequestedAt >= @globalStartUtc/);
  assert.equal(call.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
});

test('customer export and DSAR log fail closed if the cutoff is unavailable', async () => {
  windowUnavailable = true;
  try {
    const before = db.calls.length;
    const r = await app.call('POST', '/api/pdpa/dsar/export', { body: { subjectType: 'CUSTOMER', subjectId: '1078' }, user: { sub: 1, role: 'ADMIN' } });
    assert.equal(r.status, 503);
    assert.equal((await app.call('GET', '/api/pdpa/dsar', { user: { sub: 1, role: 'ADMIN' } })).status, 503);
    assert.ok(!db.calls.slice(before).some(c => /FROM dbo\.EMCust WHERE|FROM wf\.DsarLog|INSERT INTO wf\.DsarLog/.test(c.text)));
  } finally { windowUnavailable = false; }
});
