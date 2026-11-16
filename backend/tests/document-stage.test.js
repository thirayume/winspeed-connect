'use strict';
// The bill list tells which WinSpeed documents a bill has reached. These tests pin the stage rules to
// the shapes found on the real data (16,850 bookings and sales orders on the UAT copy, 16 Nov 2026)
// and the way the read is split, because a single joined query took 12 seconds a page there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STAGE, deriveDocumentStage, loadDocumentStageFacts, attachDocumentStages, safeIds } = require('../services/document-stage');

const sql = { Int: 'Int' };
const order = extra => ({ DocuType: 104, DocuStatus: 'Y', TicketCount: 1, TicketQty: 11, TicketRemaining: 11, CutQty: 0, InvoicedQty: 0, InvoiceBook: null, ...extra });

test('a booking is waiting, approved, or already taken into a sales order', () => {
  assert.deepEqual(deriveDocumentStage({ DocuType: 103, DocuStatus: 'N', AppvFlag: 'W', HasApproval: 0 }),
    { code: STAGE.BOOKING_WAITING_APPROVAL, docType: 103 });
  assert.deepEqual(deriveDocumentStage({ DocuType: 103, DocuStatus: 'N', AppvFlag: 'Y', HasApproval: 1 }),
    { code: STAGE.BOOKING_APPROVED, docType: 103 });
  // an approval flag without the AI number is not an approval
  assert.equal(deriveDocumentStage({ DocuType: 103, DocuStatus: 'N', AppvFlag: 'Y', HasApproval: 0 }).code, STAGE.BOOKING_WAITING_APPROVAL);
  assert.deepEqual(deriveDocumentStage({ DocuType: 103, DocuStatus: 'Y', AppvFlag: 'Y', HasApproval: 1 }),
    { code: STAGE.BOOKING_ORDERED, docType: 104 });
  assert.equal(deriveDocumentStage({ DocuType: 103, DocuStatus: 'C', AppvFlag: 'Y', HasApproval: 1 }).code, STAGE.CANCELLED);
});

test('a sales order moves from ticket issued, through the cut, to the delivery note', () => {
  assert.equal(deriveDocumentStage(order()).code, STAGE.TICKET_ISSUED);
  const partlyHauled = deriveDocumentStage(order({ TicketRemaining: 6, CutQty: 5 }));
  assert.deepEqual(partlyHauled, { code: STAGE.CUT_PARTLY, docType: 116, ticketQty: 11, ticketRemaining: 6, cutQty: 5, invoicedQty: 0, invoiceBook: null });
  assert.equal(deriveDocumentStage(order({ TicketRemaining: 0, CutQty: 11 })).code, STAGE.CUT_WAITING_INVOICE);
  // part of what was hauled is invoiced, or the tickets still hold tonnes
  assert.equal(deriveDocumentStage(order({ TicketRemaining: 0, CutQty: 11, InvoicedQty: 5, InvoiceBook: 'J' })).code, STAGE.INVOICED_PARTLY);
  assert.equal(deriveDocumentStage(order({ TicketRemaining: 6, CutQty: 5, InvoicedQty: 5, InvoiceBook: 'J' })).code, STAGE.INVOICED_PARTLY);
  const done = deriveDocumentStage(order({ TicketRemaining: 0, CutQty: 11, InvoicedQty: 11, InvoiceBook: 'n ' }));
  assert.deepEqual(done, { code: STAGE.INVOICED, docType: 107, ticketQty: 11, ticketRemaining: 0, cutQty: 11, invoicedQty: 11, invoiceBook: 'N' });
});

test('a ticket with nothing left and no cut is reported as such, never as hauled', () => {
  const closed = deriveDocumentStage(order({ TicketRemaining: 0, CutQty: 0 }));
  assert.equal(closed.code, STAGE.TICKET_CLOSED_WITHOUT_CUT);
  assert.equal(closed.docType, 104);
  assert.equal(deriveDocumentStage(order({ TicketCount: 0, TicketQty: 0, TicketRemaining: 0 })).code, STAGE.ORDER_ISSUED);
  assert.equal(deriveDocumentStage(order({ DocuStatus: 'C' })).code, STAGE.CANCELLED);
  assert.equal(deriveDocumentStage({ DocuType: 107 }), null);
  assert.equal(deriveDocumentStage(null), null);
});

test('quantities are rounded to four decimals and tolerate float noise', () => {
  const stage = deriveDocumentStage(order({ TicketQty: 0.6, TicketRemaining: 0.30000000000000004, CutQty: 0.3, InvoicedQty: 0.30000000000000004, InvoiceBook: 'J' }));
  assert.equal(stage.code, STAGE.INVOICED_PARTLY);
  assert.equal(stage.ticketRemaining, 0.3);
  assert.equal(deriveDocumentStage(order({ TicketQty: 0.3, TicketRemaining: 0.00000001, CutQty: 0.3, InvoicedQty: 0.29999999 })).code, STAGE.INVOICED);
});

test('only whole positive ids reach SQL, each once', () => {
  assert.deepEqual(safeIds(['12', 12, ' 7 ', 'abc', '1;DROP', '-3', 0, null, undefined, '99999999999', 2147483648, '2147483647']), [12, 7, 2147483647]);
  assert.equal(safeIds(Array.from({ length: 500 }, (_, i) => i + 1)).length, 200);
});

function stubQuery(tables) {
  const calls = [];
  const query = async (text, inputs) => {
    calls.push({ text, inputs });
    const values = Object.values(inputs || {}).map(i => i.value);
    if (/FROM dbo\.SOHD h/.test(text)) return { recordset: tables.heads.filter(h => values.includes(h.SOID)) };
    if (/FROM dbo\.WFCoupon c/.test(text)) return { recordset: tables.tickets.filter(t => values.includes(t.DocuID)) };
    if (/FROM dbo\.WFRedemtionDT rd/.test(text)) return { recordset: tables.cuts.filter(c => values.includes(c.CouponID)) };
    if (/FROM dbo\.SOInvDT i/.test(text)) return { recordset: tables.books.filter(b => values.includes(b.RefID)) };
    throw new Error('unexpected query');
  };
  return { query, calls };
}

const tables = {
  heads: [
    { SOID: 501, DocuType: 104, DocuNo: 'I00-00001', DocuStatus: 'P', AppvFlag: '', HasApproval: 0 },
    { SOID: 502, DocuType: 103, DocuNo: 'K00-00002', DocuStatus: 'N', AppvFlag: 'W', HasApproval: 0 },
    { SOID: 503, DocuType: 104, DocuNo: 'K00-00003', DocuStatus: 'C', AppvFlag: '', HasApproval: 0 },
  ],
  tickets: [
    { CouponID: 9001, DocuID: 501, GoodQty: 5, RemaQty: 0 },
    { CouponID: 9002, DocuID: 501, GoodQty: 6, RemaQty: 6 },
    { CouponID: 9003, DocuID: 503, GoodQty: 4, RemaQty: 4 },
  ],
  cuts: [{ CouponID: 9001, CutQty: 5, InvoicedQty: 5 }],
  books: [{ RefID: 501, InvoiceBook: 'J' }],
};

test('one page is read in four short steps and summed per sales order', async () => {
  const { query, calls } = stubQuery(tables);
  const facts = await loadDocumentStageFacts(query, sql, ['501', '502', '503', 'not-a-number']);
  assert.equal(facts.size, 3);
  assert.deepEqual(deriveDocumentStage(facts.get(501)),
    { code: STAGE.INVOICED_PARTLY, docType: 107, ticketQty: 11, ticketRemaining: 6, cutQty: 5, invoicedQty: 5, invoiceBook: 'J' });
  assert.equal(deriveDocumentStage(facts.get(502)).code, STAGE.BOOKING_WAITING_APPROVAL);
  assert.equal(deriveDocumentStage(facts.get(503)).code, STAGE.CANCELLED);

  assert.equal(calls.length, 4);
  const [head, ...rest] = calls;
  assert.match(head.text, /h\.DocuType IN \(103, 104\)/);
  assert.deepEqual(Object.values(head.inputs).map(i => i.value), [501, 502, 503]);
  // tickets, cuts and invoice books are asked only for the live sales order, never for the booking or the cancelled one
  const ticketCall = rest.find(c => /FROM dbo\.WFCoupon c/.test(c.text));
  assert.deepEqual(Object.values(ticketCall.inputs).map(i => i.value), [501]);
  const cutCall = rest.find(c => /FROM dbo\.WFRedemtionDT rd/.test(c.text));
  assert.match(cutCall.text, /rd\.CouponID BETWEEN @cutLow AND @cutHigh AND rd\.CouponID IN \(/);
  assert.match(cutCall.text, /rh\.DocuType = 116 AND ISNULL\(rh\.DocuStatus, ''\) <> 'C'/);
  assert.equal(cutCall.inputs.cutLow.value, 9001);
  assert.equal(cutCall.inputs.cutHigh.value, 9002);
  const bookCall = rest.find(c => /FROM dbo\.SOInvDT i/.test(c.text));
  assert.match(bookCall.text, /i\.RefID IN \(/);
  // every statement is a plain read with dirty-read hints, as the list itself is
  for (const call of calls) {
    assert.doesNotMatch(call.text, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
    assert.match(call.text, /WITH \(NOLOCK\)/);
    for (const input of Object.values(call.inputs)) assert.equal(input.type, 'Int');
  }
});

test('nothing is asked when the page has no native document', async () => {
  const { query, calls } = stubQuery(tables);
  const orders = [{ id: 'abc', importedDocuNo: null, status: 'DRAFT' }, { id: 77, importedDocuNo: null, status: 'CONFIRMED' }];
  await attachDocumentStages(orders, { query, sql });
  assert.equal(calls.length, 0);
  assert.deepEqual(orders[0].docStage, { code: STAGE.DRAFT, docType: null });
  assert.equal(orders[1].docStage, null);
});

test('a row gets a stage only when both its id and its own document number match', async () => {
  const { query } = stubQuery(tables);
  const orders = [
    { id: '501', importedDocuNo: 'I00-00001 ', status: 'IMPORTED' },
    // a draft whose id equals another document's SOID must not borrow that document's stage
    { id: '502', importedDocuNo: 'I00-99999', status: 'CONFIRMED' },
    { id: '502', importedDocuNo: 'K00-00002', status: 'CONFIRMED' },
  ];
  await attachDocumentStages(orders, { query, sql });
  assert.equal(orders[0].docStage.code, STAGE.INVOICED_PARTLY);
  assert.equal(orders[1].docStage, null);
  assert.equal(orders[2].docStage.code, STAGE.BOOKING_WAITING_APPROVAL);
});

test('the list and the single bill carry the stage, and keep working when it cannot be read', () => {
  const route = fs.readFileSync(path.join(__dirname, '../routes/so.js'), 'utf8');
  const list = route.slice(route.indexOf("for (const o of orders) o.lines = linesByso[o.id] || [];"), route.indexOf("router.get('/rebate-availability/:custId'"));
  assert.match(list, /try \{\s*await require\('\.\.\/services\/document-stage'\)\.attachDocumentStages\(orders, \{ query: wfQuery, sql \}\);\s*\} catch \(stageError\) \{\s*console\.warn/);
  assert.ok(list.indexOf('attachDocumentStages') < list.indexOf('res.json({ data: orders.map'));
  const detail = route.slice(route.indexOf('const stageCarrier ='), route.indexOf('lines: camelizeRows(lines),'));
  assert.match(detail, /importedDocuNo: so\.ImportedDocuNo, status: so\.Status/);
  assert.match(detail, /docStage: stageCarrier\[0\]\.docStage \|\| null,/);
});

test('the screens name every stage the server can send', () => {
  const meta = fs.readFileSync(path.join(__dirname, '../../WSSale-App/src/constants/docStage.ts'), 'utf8');
  const types = fs.readFileSync(path.join(__dirname, '../../WSSale-App/src/types/index.ts'), 'utf8');
  for (const code of Object.values(STAGE)) {
    assert.match(meta, new RegExp(`\\n  ${code}: \\{\\n    label: '`), `label for ${code}`);
    assert.match(types, new RegExp(`\\| '${code}'`), `type for ${code}`);
  }
  // the words accounting uses, with the document number in brackets
  assert.match(meta, /ใบสั่งจอง \(103\) · รออนุมัติ/);
  assert.match(meta, /ใบสั่งขาย \(104\) · ออกตั๋วปุ๋ยแล้ว ยังไม่ขน/);
  assert.match(meta, /ตัดตั๋ว \(116\) · ขนครบ รอใบส่งของ \(107\)/);
  assert.match(meta, /ใบส่งของ \(107\) · ออกครบแล้ว/);
});
