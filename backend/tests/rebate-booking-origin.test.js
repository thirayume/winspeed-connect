'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isSaleAppBookingLine, SALE_APP_BOOKING_FOR_116_LINE } = require('../services/rebate-booking-origin');
// Hybrid rule (owner, 21 Nov 2026): Sale-App accrues Rebate only on bookings it issued itself.
test('a 104 line is from Sale-App only when its 103 line carries the Sale-App price snapshot', async () => {
  let seen;
  const yes = await isSaleAppBookingLine(async (sql, args) => { seen = { sql, args }; return { recordset: [{ FromSaleApp: 1 }] }; },
    { sourceSOID: 40, sourceListNo: 2 });
  assert.equal(yes, true);
  assert.deepEqual(seen.args, { sourceSOID: 40, sourceListNo: 2 });
  assert.match(seen.sql, /JOIN dbo\.SOHD b ON b\.SOID=sd\.RefSOID AND b\.DocuType=103/);
  assert.match(seen.sql, /JOIN wf\.RebateBookingPriceSnapshot s ON s\.BookingSOID=b\.SOID AND s\.\[LineNo\]=sd\.RefListNo/);
  assert.match(seen.sql, /sd\.DocuType=104/);
  assert.equal(await isSaleAppBookingLine(async () => ({ recordset: [] }), { sourceSOID: 40, sourceListNo: 2 }), false);
});
test('a shipment that cannot be traced to a 104 line is not from Sale-App and needs no query', async () => {
  let called = false; const q = async () => { called = true; return { recordset: [{ FromSaleApp: 1 }] }; };
  for (const s of [{}, { sourceSOID: null, sourceListNo: 1 }, { sourceSOID: 4, sourceListNo: 0 }, { sourceSOID: -1, sourceListNo: 1 }])
    assert.equal(await isSaleAppBookingLine(q, s), false);
  assert.equal(called, false);
  await assert.rejects(isSaleAppBookingLine(null, { sourceSOID: 1, sourceListNo: 1 }), { code: 'REBATE_BOOKING_ORIGIN_INVALID' });
});
test('the 116 fragment follows the same coupon, 104 and 103 path as the accrual', () => {
  for (const part of ['JOIN dbo.WFCoupon oc ON oc.CouponID=od.CouponID',
    'JOIN dbo.SODT osd ON osd.SOID=oc.DocuID AND osd.ListNo=oc.RefListno AND osd.DocuType=104',
    'JOIN dbo.SOHD ob ON ob.SOID=osd.RefSOID AND ob.DocuType=103',
    'WHERE od.RedemtionID=ref.RedemtionID AND od.Listno=ref.Listno']) assert.ok(SALE_APP_BOOKING_FOR_116_LINE.includes(part), part);
});
