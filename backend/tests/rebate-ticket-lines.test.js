'use strict';
// Owner, 22 Nov 2026: a Rebate ticket is used as a price-0 line of the ticket's goods inside a normal bill; the
// tickets are deducted at the 103 (RESERVED), given back if that 103 is cancelled (RELEASED) and final at the 116.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lines = require('../services/rebate-ticket-lines');

const admin = { sub: 63, role: 'ADMIN', roles: ['ADMIN'] };
const sales = { sub: 8, role: 'SALES', roles: ['SALES'] };
const ticketLine = (over = {}) => ({ goodId: 1118, qtyTon: 0.05, pricePerTon: 0, isRebateTicket: true, ...over });

test('a ticket line is whole bags at price 0 with no Rebate mode and no other ticket kind', () => {
  assert.deepEqual(lines.assertTicketLineShape(ticketLine()), { goodId: 1118, units: 500n });
  assert.equal(lines.assertTicketLineShape(ticketLine({ qtyTon: 0.2 })).units, 2000n);
  for (const bad of [{ qtyTon: 0.03 }, { qtyTon: 0 }, { pricePerTon: 16000 }, { rebatePricingMode: 'POOL' }, { isGiveaway: true },
    { isCouponDrawn: true }, { couponReservationId: 5 }, { refControlTicketNo: 'X' }, { goodId: 0 }])
    assert.throws(() => lines.assertTicketLineShape(ticketLine(bad)), { code: 'REBATE_TICKET_LINE_INVALID' }, JSON.stringify(bad));
});

function fakeQuery(tickets, custRows = [{ CustID: 1086 }]) {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    if (/FROM dbo\.EMCust/.test(text)) return { recordset: custRows };
    if (/FROM wf\.FertilizerTicket/.test(text)) return { recordset: tickets.filter(t => !params.goodId || t.GoodId === params.goodId) };
    throw new Error('unexpected ' + text.slice(0, 60));
  };
  return { query, calls };
}
const ticket = (id, goodId, remaining) => ({ Id: id, TicketNo: `T${id}`, GoodId: goodId, GoodCode: 'G', GoodName: 'N',
  IssuedTonnage: '0.0500', RemainingTonnage: remaining, IssuedDate: '2026-11-22', ExpiryDate: '2027-02-20', Status: 'ACTIVE' });

test('saving a draft checks the permission, the Pool and enough usable tickets per goods', async () => {
  const env = { REBATE_POOL_103_ENABLED: 'true' };
  const f = fakeQuery([ticket(1, 1118, '0.0500')]);
  assert.equal((await lines.validateDraftTicketLines(f.query, { user: admin, custId: '1086', lines: [ticketLine(), { goodId: 7, qtyTon: 4, pricePerTon: 15800 }], env })).length, 1);
  // normal lines alone need nothing
  assert.deepEqual(await lines.validateDraftTicketLines(async () => { throw new Error('no read'); }, { user: sales, custId: '1', lines: [{ goodId: 7, qtyTon: 1, pricePerTon: 1 }], env: {} }), []);
  await assert.rejects(lines.validateDraftTicketLines(f.query, { user: admin, custId: '1086', lines: [ticketLine(), ticketLine()], env }), { code: 'INSUFFICIENT_TICKET_BALANCE' });
  await assert.rejects(lines.validateDraftTicketLines(f.query, { user: admin, custId: '1086', lines: [ticketLine()], env: {} }), { code: 'REBATE_TICKET_UNAVAILABLE' });
  await assert.rejects(lines.validateDraftTicketLines(f.query, { user: { sub: 4, role: 'MANAGER', roles: ['MANAGER'] }, custId: '1086', lines: [ticketLine()], env }), { code: 'TICKET_PERMISSION_REQUIRED' });
  const none = fakeQuery([], []);
  await assert.rejects(lines.validateDraftTicketLines(none.query, { user: admin, custId: 'X', lines: [ticketLine()], env }), { code: 'REBATE_TICKET_CUSTOMER_REQUIRED' });
  // only usable tickets on the date count
  const usable = f.calls.find(c => /FROM wf\.FertilizerTicket/.test(c.text)).text;
  assert.match(usable, /Status IN \('ACTIVE','PARTIALLY_USED','EXTENDED_ACTIVE'\) AND RemainingTonnage>0/);
  assert.match(usable, /ISNULL\(ExtendedExpiryDate,ExpiryDate\)>=CAST\(@asOfDate AS date\)/);
});

test('at confirm each ticket line deducts its tickets on its 103 line number and stores RESERVED with the announced value', async () => {
  const applied = [], states = [];
  const query = async (text, params) => {
    if (/INSERT wf\.RebateTicketReceiptState/.test(text)) { states.push(params); return { rowsAffected: [1] }; }
    throw new Error('unexpected ' + text.slice(0, 60));
  };
  const draftLines = [
    { LineNum: 1, GoodId: '7', QtyTon: 4, PricePerTon: 15800, RebatePricingMode: 'POOL' },
    { LineNum: 2, GoodId: '99', QtyTon: 0, PricePerTon: 0, IsGiveaway: true },
    { LineNum: 3, GoodId: '1118', QtyTon: 0.05, PricePerTon: 0, IsRebateTicket: true },
    { LineNum: 4, GoodId: '1118', QtyTon: 0.1, PricePerTon: 0, IsRebateTicket: true },
  ];
  let n = 0;
  const result = await lines.reserveTicketLinesAtConfirm(query, {
    user: admin, bookingId: 292010, draft: { Id: 5, CustId: '1086', WfRef: 'I69-1' }, lines: draftLines, startDate: '2026-11-01',
    env: { REBATE_POOL_103_ENABLED: 'true' },
    deps: {
      participantReady: async () => ({ kind: 'uat' }), resolveCustomer: async () => 1086, today: '2026-11-22',
      uuid: () => `11111111-2222-4333-8444-55555555555${n++}`,
      apply: async (q, input, options) => {
        applied.push({ input, options });
        assert.equal(typeof options.verifyFinancialTreatment, 'function');
        assert.ok(options.epoch);
        return { id: 100 + applied.length, replayed: false, allocations: [{ ticketId: 1 }] };
      },
      basePrice: async () => ({ basePrice: '16000.00' }),
    },
  });
  // the giveaway is not in the 103, so the ticket lines are 103 lines 2 and 3
  assert.deepEqual(applied.map(a => [a.input.lineNo, a.input.requestedTonnage, a.input.treatment, a.input.bookingId]),
    [[2, '0.0500', 'ZERO', 292010], [3, '0.1000', 'ZERO', 292010]]);
  assert.deepEqual(states.map(s => [s.receiptId, s.price, s.amount]), [[101, 16000, 800], [102, 16000, 1600]]);
  assert.deepEqual(result.map(r => r.lineNo), [2, 3]);
  // no ticket lines: nothing happens; Pool off: refused
  assert.deepEqual(await lines.reserveTicketLinesAtConfirm(query, { user: admin, bookingId: 1, draft: {}, lines: [draftLines[0]], env: {} }), []);
  await assert.rejects(lines.reserveTicketLinesAtConfirm(query, { user: admin, bookingId: 1, draft: {}, lines: draftLines, env: {} }), { code: 'REBATE_TICKET_UNAVAILABLE' });
  // a price that cannot be read leaves the value empty but still reserves
  states.length = 0;
  await lines.reserveTicketLinesAtConfirm(query, { user: admin, bookingId: 3, draft: { CustId: '1086' }, lines: [draftLines[2]], startDate: '2026-11-01',
    env: { REBATE_POOL_103_ENABLED: 'true' }, deps: { participantReady: async () => ({}), resolveCustomer: async () => 1086, today: '2026-11-22',
      uuid: () => '11111111-2222-4333-8444-555555555599', apply: async () => ({ id: 9, replayed: false, allocations: [] }),
      basePrice: async () => { throw new Error('no price'); } } });
  assert.deepEqual([states[0].price, states[0].amount], [null, null]);
});

test('the confirmed 103 line must be the ticket shape: the real verifier is the ZERO treatment check', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'rebate-ticket-lines.js'), 'utf8');
  assert.match(src, /verifyFinancialTreatment: deps\.verifyShape \|\| verifyTicketTreatmentShape/);
  assert.match(src, /treatment: 'ZERO'/);
});

function releaseFake({ status = 'RESERVED', remaining = '0.0000', expiry = '2027-02-20', extended = null } = {}) {
  const writes = [];
  const query = async (text, params) => {
    if (/FROM wf\.RebateTicketRedemptionReceipt r WITH \(UPDLOCK,HOLDLOCK\)\s+LEFT JOIN wf\.RebateTicketReceiptState/.test(text))
      return { recordset: [{ Id: 7, Status: status }] };
    if (/sp_getapplock/.test(text)) return { recordset: [{ LockResult: 0 }] };
    if (/FROM wf\.RebateResetParticipant/.test(text)) return { recordset: [{ Phase: 'READY' }] };
    if (/FROM wf\.RebateTicketRedemptionAllocation/.test(text)) return { recordset: [{ TicketId: 1, Ordinal: 1, QuantityTon: '0.0500' }] };
    if (/FROM wf\.FertilizerTicket WITH \(UPDLOCK,HOLDLOCK\)/.test(text))
      return { recordset: [{ Id: 1, Status: 'REDEEMED', IssuedTonnage: '0.0500', RemainingTonnage: remaining, ExpiryDate: expiry, ExtendedExpiryDate: extended }] };
    if (/UPDATE wf\.FertilizerTicket/.test(text)) { writes.push(['ticket', params]); return { rowsAffected: [1] }; }
    if (/INSERT wf\.TicketRedemptionHistory/.test(text)) { writes.push(['history', params]); return { rowsAffected: [1] }; }
    if (/UPDATE wf\.RebateTicketReceiptState SET Status='RELEASED'/.test(text)) { writes.push(['state', params]); return { rowsAffected: [1] }; }
    throw new Error('unexpected ' + text.slice(0, 80));
  };
  return { query, writes };
}

test('cancelling the 103 gives RESERVED tickets back; a final cut still blocks the cancel', async () => {
  const f = releaseFake();
  assert.equal(await lines.releaseReservedTicketsForBooking(f.query, { bookingId: 292010, reason: 'ยกเลิก', env: { ONPREM_TARGET_KIND: 'uat' } }), 1);
  const t = f.writes.find(w => w[0] === 'ticket')[1];
  assert.deepEqual([t.before, t.after, t.status], ['0.0000', '0.0500', 'ACTIVE']);
  const h = f.writes.find(w => w[0] === 'history')[1];
  assert.equal(h.qty, '-0.0500');
  assert.ok(f.writes.find(w => w[0] === 'state'));
  for (const status of ['FINAL', null])
    await assert.rejects(lines.releaseReservedTicketsForBooking(releaseFake({ status }).query, { bookingId: 1, reason: 'x', env: { ONPREM_TARGET_KIND: 'uat' } }),
      { code: 'TICKET_REDEMPTION_LINKED' });
  // a released receipt is ignored
  assert.equal(await lines.releaseReservedTicketsForBooking(releaseFake({ status: 'RELEASED' }).query, { bookingId: 1, reason: 'x', env: {} }), 0);
});

test('a returned ticket gets the status it would have had: active, extended, partly used or expired', () => {
  const t = (over = {}) => ({ IssuedTonnage: '0.1000', ExpiryDate: '2027-02-20', ExtendedExpiryDate: null, ...over });
  assert.equal(lines.nextTicketStatus(t(), 1000n, '2026-11-22'), 'ACTIVE');
  assert.equal(lines.nextTicketStatus(t({ ExtendedExpiryDate: '2027-05-01', ExpiryDate: '2027-05-01' }), 1000n, '2026-11-22'), 'EXTENDED_ACTIVE');
  assert.equal(lines.nextTicketStatus(t(), 500n, '2026-11-22'), 'PARTIALLY_USED');
  assert.equal(lines.nextTicketStatus(t(), 1000n, '2027-03-01'), 'EXPIRED');
});

function settleFake(over = {}) {
  const writes = [], incidents = [];
  const head = { ReceiptId: 7, Status: 'RESERVED', BookingSOID: 292010, BookingLineNo: 2, CustId: 1086, GoodId: 1118, Qty: '0.0500',
    HeadSOID: 292010, HeadStatus: 'N', DocuNo: 'I69-1', HeadCust: 1086, LineListNo: 2, LineGood: 1118, LineQty: '0.0500',
    LinePrice: '0.0000', LineAmount: '0.0000', LineFree: 'N', ...over.head };
  const deliveries = over.deliveries ?? [{ SOID: 292011, DocuNo: 'I69-2', ListNo: 2, GoodID: 1118, Qty: '0.0500', Price: '0.0000', Amount: '0.0000',
    CouponID: 5, CouponQty: '0.0500', CouponRema: '0.0000' }];
  const cuts = over.cuts ?? [{ RedemtionID: 192002, DocuNo: '9900104', Qty: '0.0500' }];
  const query = async (text, params) => {
    if (/FROM wf\.RebateTicketReceiptState st WITH \(UPDLOCK,HOLDLOCK\)/.test(text)) return { recordset: [head] };
    if (/WHERE l\.DocuType=104 AND l\.RefSOID=@bookingId/.test(text)) return { recordset: deliveries };
    if (/FROM dbo\.WFRedemtionDT x/.test(text)) return { recordset: cuts };
    if (/SET Status='FINAL'/.test(text)) { writes.push(params); return { rowsAffected: [1] }; }
    if (/FROM wf\.RebateTicketRedemptionAllocation/.test(text)) return { recordset: [{ TicketId: 1, Ordinal: 1, QuantityTon: '0.0500' }] };
    if (/FROM wf\.FertilizerTicket WITH \(UPDLOCK,HOLDLOCK\)/.test(text))
      return { recordset: [{ Id: 1, Status: 'REDEEMED', IssuedTonnage: '0.0500', RemainingTonnage: '0.0000', ExpiryDate: '2027-02-20' }] };
    if (/UPDATE wf\.FertilizerTicket|INSERT wf\.TicketRedemptionHistory|SET Status='RELEASED'/.test(text)) { writes.push({ released: true }); return { rowsAffected: [1] }; }
    throw new Error('unexpected ' + text.slice(0, 80));
  };
  return { query, writes, incidents, recordIncident: async i => incidents.push(i) };
}

test('the worker makes a ticket final at its 116, waits before that, releases on a cancelled 103 and records mismatches', async () => {
  let f = settleFake();
  assert.deepEqual(await lines.settleReceipt(f.query, 7, { recordIncident: f.recordIncident }), { receiptId: 7, outcome: 'FINAL', redemptionNo: '9900104' });
  assert.equal(f.writes[0].no, '9900104'); assert.equal(f.writes[0].id, 192002);
  // waiting states
  assert.equal((await lines.settleReceipt(settleFake({ deliveries: [] }).query, 7, {})).outcome, 'WAITING_104');
  assert.equal((await lines.settleReceipt(settleFake({ cuts: [] }).query, 7, {})).outcome, 'WAITING_116');
  assert.equal((await lines.settleReceipt(settleFake({ cuts: [{ RedemtionID: 1, DocuNo: 'x', Qty: '0.0200' }] }).query, 7, {})).outcome, 'WAITING_116');
  // the 103 was cancelled or deleted in WinSpeed: tickets go back
  for (const head of [{ HeadStatus: 'C' }, { HeadSOID: null }]) {
    f = settleFake({ head });
    assert.equal((await lines.settleReceipt(f.query, 7, {})).outcome, 'RELEASED');
    assert.ok(f.writes.some(w => w.released));
  }
  // documents changed in WinSpeed: an incident, nothing final
  const cases = [
    [{ head: { LinePrice: '16000.0000', LineAmount: '800.0000' } }, 'BOOKING_LINE_CHANGED'],
    [{ head: { LineQty: '0.1000' } }, 'BOOKING_LINE_CHANGED'],
    [{ head: { LineListNo: null } }, 'BOOKING_LINE_MISSING'],
    [{ deliveries: [{ SOID: 1, DocuNo: 'D', GoodID: 1118, Qty: '0.0500', Price: '100.0000', Amount: '5.0000', CouponID: 5, CouponQty: '0.0500', CouponRema: '0' }] }, 'DELIVERY_LINE_CHANGED'],
    [{ deliveries: [{}, {}] }, 'DELIVERY_SPLIT'],
  ];
  for (const [over, reason] of cases) {
    f = settleFake(over);
    const r = await lines.settleReceipt(f.query, 7, { recordIncident: f.recordIncident });
    assert.equal(r.outcome, 'MISMATCH'); assert.equal(r.reason, reason);
    assert.equal(f.incidents[0].type, 'REBATE_TICKET_DOCUMENT_MISMATCH');
    assert.equal(f.incidents[0].key, `REBATE_TICKET_DOCUMENT_MISMATCH:7:${reason}`);
    assert.equal(f.writes.length, 0);
  }
});

test('migration 258 adds the ticket line flag and the receipt state table; the rollback refuses while they are in use', () => {
  const dir = path.join(__dirname, '..', 'migrations');
  const up = fs.readFileSync(path.join(dir, '258_rebate_ticket_lines.sql'), 'utf8');
  const down = fs.readFileSync(path.join(dir, 'down', '258_rebate_ticket_lines.down.sql'), 'utf8');
  assert.match(up, /^-- @transaction/);
  assert.match(up, /ADD IsRebateTicket bit NOT NULL CONSTRAINT DF_SalesOrderLine_IsRebateTicket DEFAULT \(0\)/);
  assert.match(up, /IsRebateTicket=0 OR \(PricePerTon=0 AND RebatePricingMode IS NULL/);
  assert.match(up, /CREATE TABLE wf\.RebateTicketReceiptState/);
  assert.match(up, /CHECK \(Status IN \('RESERVED','FINAL','RELEASED'\)\)/);
  assert.doesNotMatch(up, /\bdbo\./);
  assert.match(down, /ROLLBACK_258_BLOCKED: draft Rebate ticket lines exist/);
  assert.match(down, /ROLLBACK_258_BLOCKED: Rebate ticket receipt states exist/);
});

test('the WinSpeed sync check does not report a ticket given back when its 103 was cancelled', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'winspeed-sync-check.js'), 'utf8');
  assert.match(src, /NOT EXISTS \(SELECT 1 FROM wf\.RebateTicketReceiptState st WITH \(NOLOCK\) WHERE st\.ReceiptId = r\.Id AND st\.Status = 'RELEASED'\)/);
});

test('migration 259 lets only a price-0 Rebate ticket line through the UAT 104 writer; the rollback restores 241', () => {
  const dir = path.join(__dirname, '..', 'migrations');
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
  const up = read('259_uat_writer_rebate_ticket_zero_bill.sql');
  const down = read('down/259_uat_writer_rebate_ticket_zero_bill.down.sql');
  const m241 = read('241_native_coupon_sale_financials.sql');
  const block = (s, start) => { const i = s.indexOf(start); return s.slice(i, s.indexOf('\nGO', i)); };
  const fn = s => block(s, 'FUNCTION wf.fn_NativeCouponSaleFinancials');
  const proc = s => block(s, 'ALTER PROCEDURE wf.usp_CreateCompleteInitialDelivery');
  assert.match(up, /^-- @transaction/);
  assert.equal(fn(down), fn(m241));
  assert.equal(proc(down), proc(m241));
  assert.match(fn(up), /amounts\.Gross>0 OR \(amounts\.Gross=0 AND CONVERT\(decimal\(18,4\),l\.GoodPrice2\)=0/);
  assert.match(fn(up), /ts\.Status IN\('RESERVED','FINAL'\)[\s\S]*tr\.Treatment='ZERO'/);
  assert.match(proc(up), /ISNULL\(GoodPrice2,0\)=0 AND NOT EXISTS\(SELECT 1 FROM wf\.RebateTicketRedemptionReceipt tr/);
  assert.match(proc(up), /wf\.fn_IsInitialNativeUatTarget\(\)<>1/);
  // apart from the marked change, the procedure is the 241 body
  const restored = proc(up).replace(/ OR ISNULL\(GoodPrice2,0\)<0 OR \(ISNULL\(GoodPrice2,0\)=0 AND NOT EXISTS\([\s\S]*?tr\.Treatment='ZERO'\)\)/, ' OR ISNULL(GoodPrice2,0)<=0');
  assert.equal(restored, proc(m241));
});
