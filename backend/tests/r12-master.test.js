'use strict';

/**
 * R12 items 14–16 (O-2) — with migration 146 the master-data writes run through wf
 * procedures (EXECUTE on wf only); procedure validation errors reach the screen as 400.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const state = { raise: null };
const db = h.installDbStub(({ text }) => {
  if (/OBJECT_ID\('wf\.sp_MasterCreatePrice'/.test(text)) return [{ HasProcs: 1 }];
  if (/EXEC wf\.sp_MasterCreatePrice/.test(text)) {
    if (state.raise) { const e = new Error(state.raise); e.class = 16; e.number = 50000; throw e; }
    return [{ NewSetPriceID: 2101, DocuNo: 'WEB-20261006-0001' }];
  }
  if (/EXEC wf\.sp_Master/.test(text)) return [{ Affected: /9999/.test(JSON.stringify(text)) ? 0 : 1 }];
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master']]); });
test.after(async () => { await app.close(); });
const admin = { sub: 63, role: 'ADMIN' };

test('O-2: customer update and soft delete run through wf procedures (no dbo UPDATE from the app)', async () => {
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/master/customers/1141', { body: { CustName: 'ร้านสุวรรณภัณฑ์', Tel: '02' }, user: admin });
  assert.equal(r.status, 200);
  const d = await app.call('DELETE', '/api/master/customers/1141', { user: admin });
  assert.equal(d.status, 200);
  const calls = db.calls.slice(before);
  assert.ok(calls.some(c => /EXEC wf\.sp_MasterUpdateCustomer @CustID = @CustID/.test(c.text)));
  assert.ok(calls.some(c => /EXEC wf\.sp_MasterSetCustomerInactive/.test(c.text)));
  assert.equal(calls.filter(c => /UPDATE dbo\.EMCust/.test(c.text)).length, 0);
});

test('O-2: goods name and price update run through wf procedures', async () => {
  const before = db.calls.length;
  assert.equal((await app.call('PATCH', '/api/master/goods/1114', { body: { GoodName: '15-15-15 เชิงผสม ตรารถเกษตร' }, user: admin })).status, 200);
  assert.equal((await app.call('PATCH', '/api/master/prices', { body: { SetPriceID: 2016, ListNo: 1, GoodPriceNet: 19000 }, user: admin })).status, 200);
  const calls = db.calls.slice(before);
  assert.ok(calls.some(c => /EXEC wf\.sp_MasterUpdateGoodName/.test(c.text)));
  const price = calls.find(c => /EXEC wf\.sp_MasterUpdatePrice/.test(c.text));
  assert.equal(Number(price.inputs.GoodPriceNet), 19000);
  assert.equal(calls.filter(c => /UPDATE dbo\.EMGood|UPDATE dbo\.EMSetPrice/.test(c.text)).length, 0);
});

test('O-2: price update with price <= 0 is refused before the procedure', async () => {
  const r = await app.call('PATCH', '/api/master/prices', { body: { SetPriceID: 2016, ListNo: 1, GoodPriceNet: 0 }, user: admin });
  assert.equal(r.status, 400);
});

test('O-2: new price documents get SetPriceID and DocuNo from the procedure (allocated under lock)', async () => {
  const r = await app.call('POST', '/api/master/prices', { body: { GoodID: 1114, GoodPriceNet: 19000, BeginDate: '2026-10-01', EndDate: '2026-12-31' }, user: admin });
  assert.equal(r.status, 200);
  assert.equal(r.body.SetPriceID, 2101);
  assert.equal(r.body.DocuNo, 'WEB-20261006-0001');
});

test('O-2 / item 15: a procedure validation error reaches the screen as 400 with its message', async () => {
  state.raise = 'ไม่พบรหัสสินค้า 999';
  const r = await app.call('POST', '/api/master/prices', { body: { GoodID: 999, GoodPriceNet: 1, BeginDate: '2026-10-01', EndDate: '2026-10-02' }, user: admin });
  state.raise = null;
  assert.equal(r.status, 400);
  assert.match(r.body.message, /ไม่พบรหัสสินค้า 999/);
});

test('bulk extend validates every item before creating anything', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/master/prices/bulk-extend', { body: { items: [
    { GoodID: 1114, GoodPriceNet: 19000, BeginDate: '2026-10-01', EndDate: '2026-12-31' },
    { GoodID: 1115, GoodPriceNet: -1, BeginDate: '2026-10-01', EndDate: '2026-12-31' },
  ] }, user: admin });
  assert.equal(r.status, 400);
  assert.equal(db.calls.slice(before).filter(c => /EXEC wf\.sp_MasterCreatePrice/.test(c.text)).length, 0);
});

test('live finding: blank names and non-numeric ids are refused in Thai before the procedure', async () => {
  const before = db.calls.length;
  const blank = await app.call('PATCH', '/api/master/customers/1141', { body: { CustName: '   ' }, user: admin });
  assert.equal(blank.status, 400);
  assert.equal(blank.body.message, 'ชื่อลูกค้าต้องไม่ว่าง');
  const goodBlank = await app.call('PATCH', '/api/master/goods/1114', { body: { GoodName: '' }, user: admin });
  assert.equal(goodBlank.status, 400);
  const badId = await app.call('PATCH', '/api/master/customers/ZZ-NO-SUCH', { body: { CustName: 'x' }, user: admin });
  assert.equal(badId.status, 404);
  assert.equal(db.calls.slice(before).filter(c => /EXEC wf\.sp_Master/.test(c.text)).length, 0);
});

test('live finding: a garbled RAISERROR text (ANSI driver) becomes a readable Thai message', async () => {
  state.raise = '[Microsoft][SQL Server Native Client 10.0][SQL Server]7H-%9I2I-D!H\'H2';
  try {
    const r = await app.call('POST', '/api/master/prices', { body: { GoodID: 1114, GoodPriceNet: 19000, BeginDate: '2026-10-01', EndDate: '2026-12-31' }, user: admin });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /ข้อมูลไม่ผ่านการตรวจของฐานข้อมูล WINSpeed/);
  } finally { state.raise = null; }
});
