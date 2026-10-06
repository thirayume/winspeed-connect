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
});

let app;
test.before(async () => { app = await h.startApp([['/api/pdpa', '../../routes/pdpa']]); });
test.after(async () => { await app.close(); });

test('ADM-06: customer export uses the base tables with an integer customer id', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/pdpa/dsar/export', { body: { subjectType: 'CUSTOMER', subjectId: '1078' }, user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const so = db.calls.slice(before).find(c => /FROM dbo\.SOHD h WITH \(NOLOCK\) WHERE @cid IS NOT NULL AND h\.CustID = @cid/.test(c.text));
  assert.ok(so, 'native documents read by CustID');
  assert.equal(so.inputs.cid, 1078);
  assert.ok(!db.calls.slice(before).some(c => /v_AllSalesOrders/.test(c.text)), 'no all-documents view');
});
