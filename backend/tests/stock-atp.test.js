'use strict';

/**
 * stock-atp.test.js — UAT case SO-19, stock short of what is being sold (real route, stubbed DB).
 *
 *  1. No stock entered: answers at once without reading the booking tables (every bill dialog calls this).
 *  2. Demand comes from SODT.RemaQty with the legacy cut-off, plus wf drafts.
 *  3. Requested quantity gives FULLY_READY, PARTIALLY_READY or SHORTAGE; no quantity gives FULLY_READY or SHORTAGE.
 *  4. Only a stock figure in tons is netted against bookings; stale figures read UNKNOWN.
 *  5. The bill being edited does not count against itself.
 *  6. Saving stock rejects a bad quantity, a non-ton unit and an unknown code; the code and name come from the master.
 *  7. Sales cannot save stock.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const WAREHOUSE = { sub: 66, role: 'WAREHOUSE' };
const SALES = { sub: 40, role: 'SALES' };

let stock = [];
let confirmed = [];
let drafts = [];
const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.OperationalStock s\b/.test(text)) return stock;
  if (/SettingKey = 'STOCK_FRESHNESS_DAYS'/.test(text)) return [{ SettingValue: '7' }];
  if (/FROM wf\.SystemSetting WHERE SettingKey = @k/.test(text)) return inputs.k === 'LEGACY_DOC_CUTOFF_DATE' ? [{ SettingValue: '2022-01-01' }] : [];
  if (/FROM dbo\.SOHD hd/.test(text)) return confirmed;
  if (/FROM wf\.SalesOrderLine l/.test(text)) return drafts;
  if (/FROM dbo\.EMGood WITH \(NOLOCK\) WHERE GoodCode = @g/.test(text)) {
    return inputs.g === 'GOOD-A' ? [{ GoodCode: 'GOOD-A', GoodName: 'ปุ๋ยทดสอบ A' }] : [];
  }
  return [];
}, { activeUserIds: h.TEST_USERS });

const row = (qty, over = {}) => ({
  GoodId: 'GOOD-A', WarehouseId: '-', GoodName: 'ปุ๋ยทดสอบ A', QtyOnHand: qty, Unit: 'ตัน', Source: 'MANUAL', AsOf: new Date(), ...over,
});
const textsOf = (re) => db.calls.filter(c => re.test(c.text));

let app;
test.before(async () => { app = await h.startApp([['/api/stock', '../../routes/stock']]); });
test.after(async () => { await app.close(); });
test.beforeEach(() => { db.calls.length = 0; stock = []; confirmed = []; drafts = []; });

test('1. no stock entered: empty answer without reading bookings', async () => {
  const r = await app.call('GET', '/api/stock/atp', { user: SALES });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, []);
  assert.equal(textsOf(/dbo\.SOHD/).length, 0);
  assert.equal(textsOf(/wf\.SalesOrderLine/).length, 0);
});

test('2. demand is WinSpeed open quantity plus drafts, under the legacy cut-off', async () => {
  stock = [row(100)];
  confirmed = [{ GoodCode: 'GOOD-A', ConfirmedReservedQty: 30 }];
  drafts = [{ GoodCode: 'GOOD-A', DraftReservedQty: 10 }];
  const r = await app.call('GET', '/api/stock/atp', { user: SALES });
  assert.equal(r.status, 200);
  const [good] = r.body.data;
  assert.equal(good.goodCode, 'GOOD-A');
  assert.equal(good.totalOnHand, 100);
  assert.equal(good.confirmedReserved, 30);
  assert.equal(good.draftReserved, 10);
  assert.equal(good.totalAvailable, 60);
  assert.equal(good.state, 'FULLY_READY');

  const [booking] = textsOf(/FROM dbo\.SOHD hd/);
  assert.match(booking.text, /SUM\(dt\.RemaQty\)/);
  assert.match(booking.text, /dt\.RemaQty > 0/);
  assert.match(booking.text, /hd\.DocuDate >= @legacyCut/);
  assert.ok(booking.inputs.legacyCut, 'cut-off date is passed to the query');
  assert.doesNotMatch(booking.text, /SOInvHD/, 'matching invoices by number hides open bookings: the 103 and 104 counters overlap');
});

test('3. states follow the requested quantity', async () => {
  stock = [row(100)];
  confirmed = [{ GoodCode: 'GOOD-A', ConfirmedReservedQty: 80 }];
  const state = async (qs) => (await app.call('GET', `/api/stock/atp${qs}`, { user: SALES })).body.data[0];

  assert.equal((await state('?requestedQty=20')).state, 'FULLY_READY');

  const partial = await state('?requestedQty=50');
  assert.equal(partial.state, 'PARTIALLY_READY');
  assert.equal(partial.shortageQty, 30);
  assert.match(partial.stateReason, /ขาด 30/);

  confirmed = [{ GoodCode: 'GOOD-A', ConfirmedReservedQty: 150 }];
  const none = await state('?requestedQty=5');
  assert.equal(none.state, 'SHORTAGE');
  assert.equal(none.totalAvailable, -50);
  assert.equal((await state('')).state, 'SHORTAGE');

  stock = [row(0)];
  confirmed = [];
  assert.equal((await state('')).state, 'OUT_OF_STOCK');
});

test('4. a figure not in tons or too old reads UNKNOWN', async () => {
  stock = [row(100, { Unit: 'ถุง' })];
  let [good] = (await app.call('GET', '/api/stock/atp', { user: SALES })).body.data;
  assert.equal(good.state, 'UNKNOWN');
  assert.match(good.stateReason, /หน่วยสินค้าไม่ชัดเจน/);

  stock = [row(100, { AsOf: new Date(Date.now() - 8 * 24 * 3600 * 1000) })];
  [good] = (await app.call('GET', '/api/stock/atp', { user: SALES })).body.data;
  assert.equal(good.state, 'UNKNOWN');
  assert.equal(good.freshness, 'STALE');
});

test('5. the bill being edited does not count against itself', async () => {
  stock = [row(100)];
  await app.call('GET', '/api/stock/atp?excludeSoId=123', { user: SALES });
  const [draft] = textsOf(/FROM wf\.SalesOrderLine l/);
  assert.match(draft.text, /o\.Id <> @exSo/);
  assert.equal(draft.inputs.exSo, 123);

  db.calls.length = 0;
  await app.call('GET', '/api/stock/atp?excludeSoId=undefined', { user: SALES });
  const [plain] = textsOf(/FROM wf\.SalesOrderLine l/);
  assert.doesNotMatch(plain.text, /@exSo/);
});

test('6. saving stock validates, and takes the code and name from the master', async () => {
  const put = (body) => app.call('PUT', '/api/stock', { user: WAREHOUSE, body });
  for (const qtyOnHand of [-1, 'abc', '', null, undefined]) {
    assert.equal((await put({ goodId: 'GOOD-A', qtyOnHand })).status, 400, `qty ${qtyOnHand}`);
  }
  assert.equal((await put({ qtyOnHand: 5 })).status, 400);
  assert.equal((await put({ goodId: 'GOOD-A', qtyOnHand: 5, unit: 'ถุง' })).status, 400);
  const missing = await put({ goodId: 'NOT-A-CODE', qtyOnHand: 5 });
  assert.equal(missing.status, 400);
  assert.match(missing.body.message, /ไม่พบรหัสสินค้า/);
  assert.equal(textsOf(/MERGE wf\.OperationalStock/).length, 0, 'nothing saved so far');

  const ok = await put({ goodId: ' GOOD-A ', goodName: 'ชื่อที่พิมพ์เอง', qtyOnHand: 0 });
  assert.equal(ok.status, 200);
  const [merge] = textsOf(/MERGE wf\.OperationalStock/);
  assert.equal(merge.inputs.g, 'GOOD-A');
  assert.equal(merge.inputs.n, 'ปุ๋ยทดสอบ A');
  assert.equal(merge.inputs.q, 0);
  assert.equal(merge.inputs.u, 'ตัน');
  assert.equal(merge.inputs.uid, WAREHOUSE.sub);
});

test('7. sales cannot save stock', async () => {
  const r = await app.call('PUT', '/api/stock', { user: SALES, body: { goodId: 'GOOD-A', qtyOnHand: 5 } });
  assert.equal(r.status, 403);
  assert.equal(textsOf(/MERGE wf\.OperationalStock/).length, 0);
});
