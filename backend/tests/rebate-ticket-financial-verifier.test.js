'use strict';
// The ticket treatment check reads the locked native 103 again and accepts only a
// ticket-only line shaped as ZERO or DISCOUNT. All figures here are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectTicketTreatmentShape, verifyTicketTreatmentShape } = require('../services/rebate-ticket-financial-verifier');

function source({ header = {}, lines, otherDiscountReceipts = 0 } = {}) {
  const calls = [];
  const query = async (text, inputs) => {
    calls.push({ text, inputs });
    if (/FROM dbo\.SOHD h/.test(text)) return { recordset: header === null ? [] : [{ SumGoodAmnt: '0.0000', BillDiscAmnt: '0.0000', NetAmnt: '0.0000', VATAmnt: '0.0000', BillDiscFormula: '', ...header }] };
    if (/FROM dbo\.SODT d/.test(text)) return { recordset: lines };
    if (/RebateTicketRedemptionReceipt/.test(text)) return { recordset: [{ N: otherDiscountReceipts }] };
    throw new Error('unexpected query');
  };
  return { query, calls };
}
const line = (over = {}) => ({ ListNo: 1, GoodQty2: '0.6000', GoodPrice2: '0.0000', GoodAmnt: '0.0000', GoodDiscAmnt: '0.0000', FreeFlag: 'N', ...over });
const context = (over = {}) => ({ bookingId: 5001, lineNo: 1, requestedTonnage: '0.6000', lineTonnage: '0.6000', ...over });
const discountHeader = (over = {}) => ({ SumGoodAmnt: '10500.0000', BillDiscAmnt: '10500.0000', NetAmnt: '0.0000', VATAmnt: '0.0000', BillDiscFormula: '10500', ...over });
const discountLine = (over = {}) => line({ GoodPrice2: '17500.0000', GoodAmnt: '10500.0000', ...over });
const reason = async (s, c, t) => (await inspectTicketTreatmentShape(s.query, c, t)).reason;

test('ZERO accepts a whole line keyed at price 0 and locks what it reads', async () => {
  const s = source({ lines: [line()] });
  assert.equal(await verifyTicketTreatmentShape(s.query, context(), 'ZERO'), true);
  assert.equal(s.calls.length, 2);
  for (const c of s.calls) { assert.match(c.text, /WITH\(UPDLOCK,HOLDLOCK\)/); assert.equal(c.inputs.bookingId, 5001); }
});

test('ZERO rejects a priced line, a partial quantity, a free line and a line discount', async () => {
  assert.equal(await reason(source({ header: { SumGoodAmnt: '10500.0000', NetAmnt: '10500.0000' }, lines: [discountLine()] }), context(), 'ZERO'), 'ZERO_LINE_HAS_PRICE');
  assert.equal(await reason(source({ lines: [line()] }), context({ requestedTonnage: '0.3000' }), 'ZERO'), 'NOT_WHOLE_LINE');
  assert.equal(await reason(source({ lines: [line({ FreeFlag: 'Y' })] }), context(), 'ZERO'), 'FREE_LINE');
  assert.equal(await reason(source({ lines: [line({ GoodDiscAmnt: '1.0000' })] }), context(), 'ZERO'), 'LINE_DISCOUNT_PRESENT');
});

test('ZERO works beside other paid lines when the header still adds up', async () => {
  const lines = [line(), line({ ListNo: 2, GoodQty2: '2.0000', GoodPrice2: '20000.0000', GoodAmnt: '40000.0000' })];
  assert.equal(await verifyTicketTreatmentShape(source({ header: { SumGoodAmnt: '40000.0000', NetAmnt: '40000.0000' }, lines }).query, context(), 'ZERO'), true);
  assert.equal(await reason(source({ header: { SumGoodAmnt: '39999.0000' }, lines }), context(), 'ZERO'), 'HEADER_SUM_MISMATCH');
});

test('DISCOUNT accepts the selling price with a plain bill discount equal to the line', async () => {
  const s = source({ header: discountHeader(), lines: [discountLine()] });
  const result = await inspectTicketTreatmentShape(s.query, context(), 'DISCOUNT');
  assert.deepEqual(result, { ok: true, reason: null, treatment: 'DISCOUNT', lineAmount: '10500.0000' });
  assert.equal(s.calls.length, 3, 'also checks other receipts on the booking');
});

test('DISCOUNT rejects every departure from that shape', async () => {
  const d = (header, lines, extra) => reason(source({ header: discountHeader(header), lines, ...extra }), context(), 'DISCOUNT');
  assert.equal(await d({ SumGoodAmnt: '0.0000', BillDiscAmnt: '0.0000', BillDiscFormula: '' }, [line()]), 'DISCOUNT_LINE_WITHOUT_PRICE');
  assert.equal(await d({ SumGoodAmnt: '10499.0000', BillDiscAmnt: '10499.0000', BillDiscFormula: '10499' }, [discountLine({ GoodAmnt: '10499.0000' })]), 'LINE_AMOUNT_NOT_QTY_TIMES_PRICE');
  assert.equal(await d({ BillDiscFormula: '100%' }, [discountLine()]), 'BILL_DISCOUNT_NOT_PLAIN_AMOUNT');
  assert.equal(await d({ BillDiscFormula: '10000' }, [discountLine()]), 'BILL_DISCOUNT_NOT_PLAIN_AMOUNT');
  assert.equal(await d({ BillDiscAmnt: '10000.0000', BillDiscFormula: '10000', NetAmnt: '500.0000' }, [discountLine()]), 'BILL_DISCOUNT_NOT_TICKET_LINE');
  assert.equal(await d({ NetAmnt: '735.0000', VATAmnt: '735.0000' }, [discountLine()]), 'NET_NOT_GOODS_LESS_DISCOUNT');
  assert.equal(await d({ NetAmnt: '10500.0000' }, [discountLine()]), 'NET_NOT_GOODS_LESS_DISCOUNT');
  assert.equal(await d({}, [discountLine()], { otherDiscountReceipts: 1 }), 'DISCOUNT_ALREADY_USED_ON_BOOKING');
  assert.equal(await d({ BillDiscAmnt: '20000.0000', BillDiscFormula: '20000' }, [discountLine()]), 'HEADER_DISCOUNT_EXCEEDS_GOODS');
});

test('a price that does not multiply to an exact amount is refused, not rounded', async () => {
  const lines = [discountLine({ GoodQty2: '0.3333', GoodPrice2: '17500.0001', GoodAmnt: '5832.7500' })];
  assert.equal(await reason(source({ header: discountHeader({ SumGoodAmnt: '5832.7500', BillDiscAmnt: '5832.7500', BillDiscFormula: '5832.75' }), lines }),
    context({ requestedTonnage: '0.3333' }), 'DISCOUNT'), 'LINE_AMOUNT_NOT_QTY_TIMES_PRICE');
});

test('bad input, a missing booking or unreadable figures fail closed', async () => {
  const ok = source({ lines: [line()] });
  assert.equal(await verifyTicketTreatmentShape(null, context(), 'ZERO'), false);
  assert.equal(await verifyTicketTreatmentShape(ok.query, context(), 'FREE'), false);
  assert.equal(await verifyTicketTreatmentShape(ok.query, context({ bookingId: 0 }), 'ZERO'), false);
  assert.equal(await verifyTicketTreatmentShape(ok.query, context({ requestedTonnage: 'abc' }), 'ZERO'), false);
  assert.equal(await reason(source({ header: null, lines: [line()] }), context(), 'ZERO'), 'BOOKING_NOT_FOUND');
  assert.equal(await reason(source({ lines: [] }), context(), 'ZERO'), 'LINES_UNREADABLE');
  assert.equal(await reason(source({ lines: [line({ ListNo: 2 })] }), context(), 'ZERO'), 'LINE_NOT_FOUND');
  assert.equal(await reason(source({ lines: [line({ GoodAmnt: null })] }), context(), 'ZERO'), 'LINES_UNREADABLE');
  assert.equal(await reason(source({ header: { NetAmnt: '-1.0000' }, lines: [line()] }), context(), 'ZERO'), 'AMOUNTS_UNREADABLE');
  await assert.rejects(() => verifyTicketTreatmentShape(async () => { throw new Error('sql down'); }, context(), 'ZERO'), /sql down/);
});
