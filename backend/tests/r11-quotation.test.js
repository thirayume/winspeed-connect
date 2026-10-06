'use strict';

/**
 * R11 C — U-3 quotation create without INSERT on dbo.SOHD.
 * With migration 142 present, POST /api/quotation writes the native 102 quote only
 * through wf.sp_QuotationInsertNativeHeader / Line / Remark, with the values the
 * route computes (customer address, document number, totals). R12 item 7: MANAGER may create.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const db = h.installDbStub(({ kind, text, inputs, proc }) => {
  if (kind === 'proc') return { recordset: [], rowsAffected: [1] };
  if (/OBJECT_ID\('wf\.sp_AdvanceDocuCounter', 'P'\)/.test(text)) return [{ HasProc: 1 }];
  if (/EXEC wf\.sp_AdvanceDocuCounter/.test(text)) return [{ Updated: 1, Location: 'EMRunBrch' }];
  if (/HasNativeTables/.test(text)) return [{ HasNativeTables: 1, HasLinkColumns: 1, HasConfirmColumns: 1 }];
  if (/COL_LENGTH\('wf\.QuotationLine', 'IsGiveaway'\)/.test(text)) return [{ HasColumn: 1 }];
  if (/AS NextSeq/.test(text)) return [{ NextSeq: 12 }];
  if (/INSERT INTO wf\.Quotation \(/.test(text)) return [{ Id: 77 }];
  if (/INSERT INTO wf\.QuotationLine/.test(text)) return { recordset: [], rowsAffected: [1] };
  if (/FROM wf\.Quotation q\s+LEFT JOIN wf\.AppUser u/.test(text)) {
    return [{ Id: 77, QuoteNo: inputs.no || 'QU6910-00012', CustId: '1141', CustName: 'ร้านสุวรรณภัณฑ์', ValidUntil: '2026-10-21', Remark: 'UAT', SalesUserId: 25, SalesEmpId: '1004', WinspeedQuoteSOID: null }];
  }
  if (/FROM wf\.QuotationSourceSO src\s+INNER JOIN wf\.SalesOrder/.test(text)) return [];
  if (/FROM wf\.QuotationLine\s+WHERE QuoteId=@id/.test(text)) {
    return [
      { LineNum: 1, GoodId: '1114', GoodCode: '7-15151500BBCAR', GoodName: '15-15-15', QtyTon: 2, PricePerTon: 19000, NetPricePerTon: 19000, IsGiveaway: 0 },
      { LineNum: 2, GoodId: '28000', GoodCode: 'P-1', GoodName: 'เสื้อยืดแขนยาว', QtyTon: 10, PricePerTon: 0, NetPricePerTon: 0, IsGiveaway: 1 },
    ];
  }
  if (/FROM sys\.columns c WITH \(NOLOCK\)/.test(text)) {
    return ['CustID', 'CustName', 'SaleAreaID', 'CreditDays', 'VATGroupID', 'VatType', 'BillAddr1', 'BillAddr2', 'District', 'Amphur', 'Province', 'PostCode', 'Tel', 'Fax'].map(name => ({ name }));
  }
  if (/FROM dbo\.EMCust c WITH \(NOLOCK\)/.test(text)) {
    return [{ CustID: 1141, CustName: 'ร้านสุวรรณภัณฑ์', SaleAreaID: 1061, CreditDays: 30, VATGroupID: 1000, VatType: '3', BillAddr1: '1 ถนน', BillAddr2: '', District: 'ต.', Amphur: 'อ.', Province: 'จ.', PostCode: '10000', Tel: '02', Fax: '' }];
  }
  if (/AS BrchID,/.test(text)) return [{ BrchID: 1, VATGroupID: 1000, InveID: 1000, LocaID: 1000 }];
  if (/AS NextId/.test(text)) return [{ NextId: 290001 }];
  if (/AS IdValue FROM/.test(text)) return [{ IdValue: inputs.id }];
  if (/AS HasProcs/.test(text)) return [{ HasProcs: 1 }];
  if (/FROM dbo\.EMGood WITH \(NOLOCK\) WHERE GoodID=@goodId/.test(text)) return [{ GoodID: 1114, GoodName1: '15-15-15 เชิงผสม ตรารถเกษตร', MainGoodUnitID: 1002, VatType: '3' }];
  if (/UPDATE wf\.Quotation/.test(text)) return { recordset: [], rowsAffected: [1] };
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/quotation', '../../routes/quotation']]); });
test.after(async () => { await app.close(); });

test('U-3: create writes the native 102 quote only through wf procedures (no INSERT INTO dbo.SOHD)', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/quotation', {
    body: { custId: '1141', custName: 'ร้านสุวรรณภัณฑ์', validDays: 15, remark: 'UAT', lines: [
      { goodId: '1114', goodCode: '7-15151500BBCAR', goodName: '15-15-15', qtyTon: 2, pricePerTon: 19000, netPricePerTon: 19000 },
      { goodId: '28000', goodName: 'เสื้อยืดแขนยาว', qtyTon: 10, pricePerTon: 0, isGiveaway: true },
    ] },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.winspeedQuoteSoid, 290001);
  const calls = db.calls.slice(before);
  assert.equal(calls.filter(c => /INSERT INTO dbo\.(SOHD|SOHDRemark)\b/.test(c.text)).length, 0, 'no direct dbo.SOHD/SOHDRemark insert');

  const header = calls.find(c => c.proc === 'wf.sp_QuotationInsertNativeHeader');
  assert.ok(header, 'header procedure called');
  assert.equal(header.inputs.SOID, 290001);
  assert.equal(header.inputs.CustID, 1141);
  assert.equal(header.inputs.SaleAreaID, 1061, 'customer sale area kept');
  assert.equal(header.inputs.BillAddr1, '1 ถนน', 'customer address kept');
  assert.equal(Number(header.inputs.NetAmnt), 38000, 'giveaway line excluded from the native total');
  assert.match(header.inputs.DocuNo, /^QU\d{4}-\d{5}$/);

  const lines = calls.filter(c => c.proc === 'wf.sp_QuotationInsertNativeLine');
  assert.equal(lines.length, 1, 'only the sale line goes to WINSpeed');
  assert.equal(lines[0].inputs.GoodID, 1114);
  assert.equal(Number(lines[0].inputs.GoodAmnt), 38000);
  assert.ok(calls.find(c => c.proc === 'wf.sp_QuotationInsertNativeRemark'), 'remark procedure called');
});

test('R12-7: SALES/MANAGER may create; WAREHOUSE may not', async () => {
  const r = await app.call('POST', '/api/quotation', { body: { custId: '1141', lines: [{ goodId: '1114', qtyTon: 1, pricePerTon: 1 }] }, user: { sub: 66, role: 'WAREHOUSE' } });
  assert.equal(r.status, 403);
});

test('QT-F1 (live finding): the QU number counts WINSpeed\'s 102 counter and advances it in the same transaction', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/quotation', {
    body: { custId: '1141', custName: 'ร้านสุวรรณภัณฑ์', validDays: 15, lines: [{ goodId: '1114', goodName: '15-15-15', qtyTon: 1, pricePerTon: 19000 }] },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  const alloc = calls.find(c => /AS NextSeq/.test(c.text));
  assert.match(alloc.text, /FROM dbo\.EMRunBrch WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.equal(alloc.inputs.rc, '102');
  const adv = calls.find(c => /EXEC wf\.sp_AdvanceDocuCounter/.test(c.text));
  assert.ok(adv, 'counter advanced');
  assert.equal(adv.kind, 'tx', 'inside the quotation transaction');
  assert.equal(adv.inputs.rc, '102');
  assert.equal(adv.inputs.no, r.body.quoteNo);
});

test('UAT SO-21: "+N days" counts from the Bangkok business day, stored as a date-only value', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/quotation', {
    body: { custId: '1141', custName: 'ร้านสุวรรณภัณฑ์', validDays: 45, lines: [{ goodId: '1114', goodName: '15-15-15', qtyTon: 1, pricePerTon: 19000 }] },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ins = db.calls.slice(before).find(c => /INSERT INTO wf\.Quotation \(/.test(c.text));
  const stored = new Date(ins.inputs.vu);
  const bkkToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const expected = new Date(bkkToday + 'T00:00:00Z'); expected.setUTCDate(expected.getUTCDate() + 45);
  assert.equal(stored.toISOString(), expected.toISOString());
});
