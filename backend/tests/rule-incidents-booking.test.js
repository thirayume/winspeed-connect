'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { INCIDENT_TYPES, BOOKING_LINES_SQL, bookingLineIncident, bookingLineIncidents, detectBookingIncidents } = require('../services/rule-incidents');
// Hybrid rule (owner, 21 Nov 2026): WinSpeed bookings keep WinSpeed's process, but a breach of Sale-App's
// price rule or a change to a Sale-App booking is recorded, whichever system the document came from.
const line = (o = {}) => ({ SOID: 501, DocuNo: 'BK-TEST-1', DocuDate: new Date('2026-11-21T00:00:00Z'), ListNo: 1, GoodID: 7,
  Price: 9800, Qty: 30, AppSnapshot: 0, AppBill: 0, SnapGoodId: null, SnapPrice: null, SnapQty: null, BasePrice: 10000, Ties: 1, ...o });
test('a WinSpeed booking up to the standard limit below the announced price is not an incident; one step more needs approval; beyond the maximum it is over', () => {
  // prices are whole steps of 100 from the announced price (App Setting PRICE_STEP_PER_TON)
  assert.equal(bookingLineIncident(line({ Price: 9800 })), null);
  assert.equal(bookingLineIncident(line({ Price: 10500 })), null);
  const warn = bookingLineIncident(line({ Price: 9700 }));
  assert.equal(warn.type, 'BOOKING_PRICE_NEEDS_APPROVAL'); assert.equal(warn.key, 'BOOKING_PRICE_NEEDS_APPROVAL:501:1');
  const high = bookingLineIncident(line({ Price: 9600 }));
  assert.equal(high.type, 'BOOKING_PRICE_OVER_MAX'); assert.equal(high.soid, 501); assert.equal(high.docuNo, 'BK-TEST-1');
  assert.match(high.detail, /ราคากลาง 10,000\.00 ขาย 9,600\.00 บาท\/ตัน ต่ำกว่า 400\.00 บาท\/ตัน 30\.000 ตัน/);
  assert.match(high.detail, /ยังไม่อนุมัติใบสั่งจองใน WinSpeed/);
  assert.match(bookingLineIncident(line({ Price: 9000, AppvFlag: 'Y' })).detail, /อนุมัติใบสั่งจองใน WinSpeed แล้ว/);
  // the booking date is Bangkok time stored as if UTC
  assert.equal(high.occurredAt.toISOString(), '2026-11-20T17:00:00.000Z');
  // a customer's own announced price is named as such
  assert.match(bookingLineIncident(line({ Price: 9600, CustomerPrice: 1 })).detail, /ราคาประกาศของลูกค้า 10,000\.00/);
});
test('a price that is not a whole step from the announced price is an incident of its own (owner, 21 Nov 2026)', () => {
  for (const discount of [130, 15, 180, 220, 175, 275, -50]) {
    const all = bookingLineIncidents(line({ Price: 10000 - discount }), { standard: 200, max: 300, step: 100 });
    const off = all.find(i => i.type === 'BOOKING_PRICE_OFF_STEP');
    assert.ok(off, String(discount)); assert.equal(off.key, 'BOOKING_PRICE_OFF_STEP:501:1');
    assert.match(off.detail, /ไม่ลง step 100 บาท\/ตัน/);
    assert.equal(all.length, discount > 200 ? 2 : 1, String(discount));
  }
  assert.deepEqual(bookingLineIncidents(line({ Price: 9850 }), { standard: 200, max: 300, step: 50 }), []);
  assert.equal(bookingLineIncidents(line({ Price: 9800 }), { standard: 200, max: 300, step: 100 }).length, 0);
  assert.equal(INCIDENT_TYPES.BOOKING_PRICE_OFF_STEP.severity, 'HIGH');
});
test('giveaway lines, lines without a single list price, and pre-snapshot Sale-App bills are not judged', () => {
  assert.equal(bookingLineIncident(line({ Price: 0 })), null);
  assert.equal(bookingLineIncident(line({ Price: 5000, BasePrice: null })), null);
  assert.equal(bookingLineIncident(line({ Price: 5000, Ties: 2 })), null);
  assert.equal(bookingLineIncident(line({ Price: 5000, AppBill: 1 })), null);
});
test('a Sale-App booking line is compared with what Sale-App saved, never with the price rule', () => {
  const app = { AppSnapshot: 1, SnapGoodId: 7, SnapPrice: 10000, SnapQty: 30, Price: 10000 };
  assert.equal(bookingLineIncident(line(app)), null);
  assert.equal(bookingLineIncident(line({ ...app, SnapPrice: 9000, Price: 9000 })), null);
  for (const change of [{ Price: 9500 }, { Qty: 31 }, { GoodID: 8 }]) {
    const i = bookingLineIncident(line({ ...app, ...change }));
    assert.equal(i.type, 'BOOKING_CHANGED_IN_WINSPEED', JSON.stringify(change));
  }
  // each distinct change is recorded once
  assert.notEqual(bookingLineIncident(line({ ...app, Price: 9500 })).key, bookingLineIncident(line({ ...app, Price: 9400 })).key);
  const added = bookingLineIncident(line({ AppSnapshot: 1, ListNo: 3, Price: 9000 }));
  assert.equal(added.type, 'BOOKING_CHANGED_IN_WINSPEED'); assert.match(added.key, /:3:ADDED:/);
  assert.equal(bookingLineIncident(line({ AppSnapshot: 1, ListNo: 4, Price: 0 })), null);
});
test('the booking query reads 103 lines only, skips cancelled bookings, chooses the list price like the price authority and never writes', () => {
  for (const part of ['h.DocuType = 103', "ISNULL(h.DocuStatus, '') <> 'C'", '(hd.CustID IS NULL OR hd.CustID = h.CustID)', 'dt.GoodPriceNet > 0',
    'ORDER BY CASE WHEN hd.CustID = h.CustID THEN 0 ELSE 1 END, hd.BeginDate DESC, dt.SetPriceID DESC, dt.ListNo ASC', 's.BookingSOID = h.SOID AND s.[LineNo] = d.ListNo',
    'so.WfRef = h.DocuNo AND so.ConfirmedAt IS NOT NULL', "RTRIM(ISNULL(h.AppvFlag, '')) AS AppvFlag", 'OPTION (RECOMPILE)']) assert.ok(BOOKING_LINES_SQL.includes(part), part);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(BOOKING_LINES_SQL));
});
test('every booking incident type is labelled, and detection records only the lines that breach', async () => {
  for (const t of ['BOOKING_PRICE_NEEDS_APPROVAL', 'BOOKING_PRICE_OVER_MAX', 'BOOKING_PRICE_OFF_STEP', 'BOOKING_CHANGED_IN_WINSPEED'])
    assert.ok(INCIDENT_TYPES[t]?.label && ['WARN', 'HIGH'].includes(INCIDENT_TYPES[t].severity), t);
  const recorded = []; let args;
  const r = await detectBookingIncidents('2026-11-01', { query: async (_s, a) => { args = a; return { recordset: [line(), line({ ListNo: 2, Price: 9000 })] }; },
    record: async i => recorded.push(i), readLimits: async () => ({ standard: 200, max: 300, step: 100 }) });
  assert.equal(args.start.value, '2026-11-01');
  assert.deepEqual(r, { lines: 2, recorded: 1 }); assert.equal(recorded[0].type, 'BOOKING_PRICE_OVER_MAX');
});
