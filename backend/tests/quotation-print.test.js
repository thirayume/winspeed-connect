'use strict';

/**
 * UAT QT-09 (owner 2026-10-09: print quotations from Sale-App): the quotation detail carries what the printed A4
 * needs, the customer's code, address and phone from the customer master and the salesperson's name.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const db = h.installDbStub(({ text }) => {
  if (/SELECT \* FROM wf\.Quotation WHERE Id=@id/.test(text)) {
    return [{ Id: 3, QuoteNo: 'QU6910-00003', CustId: '1078', CustName: 'ลูกค้าทดสอบ', Status: 'ACCEPTED', SalesUserId: 43,
      ValidUntil: new Date(Date.now() + 5 * 86400000), WinspeedQuoteSOID: 278009 }];
  }
  if (/FROM wf\.QuotationLine WHERE QuoteId=@id/.test(text)) {
    return [{ LineNum: 1, GoodId: '1', GoodCode: '15-15-15', GoodName: 'ปุ๋ย 15-15-15', QtyTon: 2, PricePerTon: 19500, NetPricePerTon: 18300, LineAmount: 39000 }];
  }
  if (/LEFT JOIN dbo\.EMCust c WITH \(NOLOCK\) ON c\.CustID = @cid/.test(text) && /CustCode/.test(text)) {
    return [{ CustCode: '0330004', CustAddr1: '99 หมู่ 1', CustAddr2: null, Amphur: 'เมือง', Province: 'ขอนแก่น', PostCode: '40000',
      ContTel: 'TAX 0105', ContTel1: '043-000000', SalesName: 'พนักงานทดสอบ' }];
  }
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/quotation', '../../routes/quotation']]); });
test.after(async () => { await app.close(); });

test('the quotation detail names the customer and the salesperson for the printed copy', async () => {
  const r = await app.call('GET', '/api/quotation/3', { user: { sub: 43, role: 'SALES' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.CustCode, '0330004');
  assert.equal(r.body.CustAddress, '99 หมู่ 1 เมือง ขอนแก่น 40000');
  assert.equal(r.body.CustTel, '043-000000', 'a tax id stored in a phone field is skipped');
  assert.equal(r.body.SalesName, 'พนักงานทดสอบ');
  assert.equal(r.body.TotalAmount, 39000);
  const party = db.calls.find(c => /CustCode/.test(c.text) && /EMCust/.test(c.text));
  assert.equal(party.inputs.cid, 1078);
});
