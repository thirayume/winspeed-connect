'use strict';

/**
 * UAT round trip 2026-11-03: WinSpeed's booking approval refuses a line with no quantity, so a bill with a giveaway
 * could not be approved, and its piece count was gone once the bill was confirmed. No real WinSpeed sales document
 * has ever carried a giveaway line. A giveaway now stays out of dbo.SODT and wf keeps the item and its pieces.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/route-harness.cjs');

const bill = { Id: '289031', Status: 'DRAFT', SalesUserId: 43, WfRef: 'I69-05288', CustId: '1086', ImportedDocuNo: 'I69-05288', SoPrefix: 'I' };
const beforeLines = [
  { SoId: '289031', LineNum: 1, GoodId: 1118, QtyTon: 1, QtyBag: 20, PricePerTon: 18200, IsGiveaway: false },
  { SoId: '289031', LineNum: 2, GoodId: 28000, QtyTon: 0, QtyBag: 5, PricePerTon: 0, IsGiveaway: true, GiveawayApprovalStatus: 'APPROVED', GiveawayApprovedBy: 21, GiveawayApprovedAt: '2026-11-03T03:00:00Z' },
];
const db = h.installDbStub(({ text }) => {
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) return [bill];
  if (/FROM wf\.v_AllSalesOrderLines WHERE/.test(text)) return beforeLines;
  if (/FROM dbo\.EMCust/.test(text)) return [{ CustID: 1086 }];
  if (/FROM dbo\.EMSetPriceHD/.test(text)) return [{ SetPriceID: 1, ListNo: 1, AnnouncedPrice: 18200, PriceSource: 'EMSetPrice' }];
  return [];
}, { activeUserIds: h.TEST_USERS });

const so = require('../routes/so');
const { splitBatches } = require('../run_migrations');
const { assertNoCrossDbWrite } = require('../safety-validator');

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so'], ['/api/trips', '../../routes/trips']]); });
test.after(async () => { await app.close(); });

const sales = { sub: 43, role: 'SALES' };
const directory = path.join(__dirname, '../migrations');
const read = file => fs.readFileSync(path.join(directory, file), 'utf8').replace(/\r\n/g, '\n');
const text = read('165_giveaway_stays_out_of_winspeed.sql');
const batches = splitBatches(text);
const procedure = (list, name) => {
  const declaration = new RegExp('^ALTER PROCEDURE wf\\.' + name + '\\b', 'im');
  const found = list.filter(b => declaration.test(b));
  assert.equal(found.length, 1, name);
  return found[0].slice(found[0].search(declaration)).trim();
};

test('migration 165 is transactional, portable and changes no dbo structure', () => {
  assert.match(text, /^-- @transaction/m);
  assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP)\s+(TABLE|VIEW|PROCEDURE|FUNCTION|TRIGGER|INDEX)\s+(\[?dbo\]?\.)/i);
  assert.doesNotMatch(text, /CREATE\s+OR\s+ALTER|\bTHROW\b|\bIIF\s*\(|TRY_CONVERT|\bCONCAT\s*\(|\bOFFSET\b/i);
  assert.doesNotMatch(text, /dbwins_worldfert/i);
  for (const batch of batches) assert.doesNotThrow(() => assertNoCrossDbWrite(batch));
});

test('confirm writes sale lines only to dbo.SODT, numbered from 1', () => {
  const body = procedure(batches, 'sp_ConfirmSalesOrder');
  assert.match(body, /@NewSoid, ROW_NUMBER\(\) OVER \(ORDER BY sol\.LineNum\), sol\.GoodId,/);
  assert.match(body, /WHERE sol\.SoId = @SoId AND ISNULL\(sol\.IsGiveaway,0\) = 0;/);
  assert.doesNotMatch(body, /sol\.IsGiveaway = 1 THEN 'Y'/);
  assert.match(body, /IF NOT EXISTS \(SELECT 1 FROM wf\.SalesOrderLine WHERE SoId=@SoId AND ISNULL\(IsGiveaway,0\)=0\)/);
});

test('confirm numbers wf lines the same way and keeps the giveaway item and pieces', () => {
  const body = procedure(batches, 'sp_ConfirmSalesOrder');
  assert.match(body, /@NewSoid, ROW_NUMBER\(\) OVER \(ORDER BY ISNULL\(IsGiveaway,0\), LineNum\), NetPricePerTon,/);
  assert.match(body, /GiveawayGoodId, GiveawayGoodCode, GiveawayGoodName, GiveawayPieces/);
  assert.match(body, /CASE WHEN IsGiveaway=1 THEN CASE WHEN QtyTon>0 THEN CAST\(QtyTon AS INT\) ELSE QtyBag END END/);
});

test('apart from those edits, confirm equals migration 163', () => {
  const clean = body => body
    .replace(/        -- A giveaway alone leaves[\s\S]*?at least one sale line',16,1\);\n\n/, '')
    .replace('ROW_NUMBER() OVER (ORDER BY sol.LineNum)', 'sol.LineNum')
    .replace("sol.QtyTon, 0, 'N', 1,", "sol.QtyTon, 0, CASE WHEN sol.IsGiveaway = 1 THEN 'Y' ELSE 'N' END, 1,")
    .replace(' AND ISNULL(sol.IsGiveaway,0) = 0;', ';')
    .replace('GiveawayApprovalNote,\n            GiveawayGoodId, GiveawayGoodCode, GiveawayGoodName, GiveawayPieces\n', 'GiveawayApprovalNote\n')
    .replace('ROW_NUMBER() OVER (ORDER BY ISNULL(IsGiveaway,0), LineNum)', 'LineNum')
    .replace(/GiveawayApprovalNote,\n            CASE WHEN IsGiveaway=1 THEN GoodId END[^\n]*\n[^\n]*\n/, 'GiveawayApprovalNote\n');
  assert.equal(clean(procedure(batches, 'sp_ConfirmSalesOrder')), procedure(splitBatches(read('163_native_contact_name.sql')), 'sp_ConfirmSalesOrder'));
});

test('the booking remark still names the giveaway, now with its pieces', () => {
  const body = procedure(batches, 'usp_WriteBookingDescription');
  assert.match(body, /COALESCE\(e\.GiveawayGoodName, d\.GoodName, N''\)/);
  assert.match(body, /N' ชิ้น'/);
  assert.match(body, /FROM wf\.SalesOrderLineExt e\s+LEFT JOIN dbo\.SODT d ON d\.SOID = @SOID AND d\.ListNo = e\.ListNo\s+WHERE e\.SOID = @SOID AND e\.IsGiveaway = 1/);
});

test('the lines view returns a kept giveaway with no tons and its pieces', () => {
  const view = batches.find(b => /^ALTER VIEW wf\.v_AllSalesOrderLines AS/m.test(b));
  assert.ok(view);
  assert.equal(view.split('UNION ALL').length, 3);
  assert.match(view, /ext\.GiveawayPieces AS QtyBag/);
  assert.match(view, /WHERE ext\.IsGiveaway = 1 AND ext\.GiveawayGoodId IS NOT NULL/);
});

test('an unlocked edit compares giveaway pieces, not the ton field', async () => {
  const tx = { request: () => ({ input() { return this; }, query: async () => ({ recordset: [] }) }) };
  const edit = lines => so.checkUnlockedNativeEdit(tx, { user: sales }, bill, { custId: '1086', soPrefix: 'I', deliveryDate: '2026-11-03', lines }, beforeLines);
  const sale = { goodId: '1118', qtyTon: 1, pricePerTon: 18200, isGiveaway: false };
  const gift = (qty) => ({ goodId: '28000', qtyTon: qty, pieceQty: qty, pricePerTon: 0, isGiveaway: true });
  const kept = await edit([sale, gift(5)]);
  assert.equal(kept[1].giveaway.status, 'APPROVED');
  assert.equal(kept[1].giveaway.by, 21);
  assert.equal((await edit([sale, gift(3)]))[1].giveaway.status, 'APPROVED');
  await assert.rejects(edit([sale, gift(6)]), e => /ของแถม .* 6 ชิ้น/.test(e.message));
});

test('saving the same giveaway pieces is not a change, other pieces are', () => {
  const sale = { goodId: '1118', qtyTon: 1, pricePerTon: 18200 };
  const gift = qty => ({ goodId: '28000', qtyTon: qty, pieceQty: qty, pricePerTon: 0, isGiveaway: true });
  assert.equal(so.materialChange(beforeLines, [sale, gift(5)]), false);
  assert.equal(so.materialChange(beforeLines, [sale, gift(4)]), true);
});

test('saving an unlocked bill leaves the giveaway out of dbo.SODT and numbers the sale line from 1', async () => {
  const before = db.calls.length;
  const r = await app.call('PUT', '/api/so/289031', {
    body: {
      custId: '1086', soPrefix: 'I', deliveryDate: '2026-11-03', truckPlate: 'UAT2-QA51',
      lines: [
        { goodId: '28000', goodName: 'shirt', qtyTon: 5, masterQty: 5, childQty: 0, pieceQty: 5, pricePerTon: 0, isGiveaway: true },
        { goodId: '1118', goodName: '12-4-40', qtyTon: 1, pricePerTon: 18200, isGiveaway: false },
      ],
    },
    user: sales,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  const native = calls.filter(c => /INSERT INTO dbo\.SODT/.test(c.text));
  assert.equal(native.length, 1, 'one sale line in the WinSpeed document');
  assert.equal(native[0].inputs.goodId?.value ?? native[0].inputs.goodId, '1118');
  assert.equal(native[0].inputs.lineNum?.value ?? native[0].inputs.lineNum, 1);
  const kept = calls.filter(c => /GiveawayPieces/.test(c.text) && /INSERT INTO wf\.SalesOrderLineExt/.test(c.text));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].inputs.pieces?.value ?? kept[0].inputs.pieces, 5);
  assert.equal(kept[0].inputs.lineNum?.value ?? kept[0].inputs.lineNum, 2);
});

test('a bill of giveaways alone is refused when it is saved again', async () => {
  const r = await app.call('PUT', '/api/so/289031', {
    body: {
      custId: '1086', soPrefix: 'I', deliveryDate: '2026-11-03', truckPlate: 'UAT2-QA51',
      lines: [{ goodId: '28000', goodName: 'shirt', qtyTon: 5, masterQty: 5, childQty: 0, pieceQty: 5, pricePerTon: 0, isGiveaway: true }],
    },
    user: sales,
  });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.message, /ของแถมอย่างเดียว/);
});

test('the bill list reads a kept giveaway back with its pieces', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/so.js'), 'utf8');
  assert.match(source, /gw\.GiveawayPieces AS QtyBag/);
  assert.match(source, /FROM wf\.SalesOrderLineExt gw WITH \(NOLOCK\)\s+WHERE gw\.IsGiveaway = 1 AND gw\.GiveawayGoodId IS NOT NULL/);
});

test('trip reads and the load plan see a kept giveaway', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/trips.js'), 'utf8');
  assert.equal((source.match(/le\.IsGiveaway = 1 AND le\.GiveawayGoodId IS NOT NULL/g) || []).length, 3, 'board, loading plan, load plan validation');
  assert.equal((source.match(/CAST\(le\.GiveawayPieces AS DECIMAL\(18,0\)\)/g) || []).length, 2);
});
