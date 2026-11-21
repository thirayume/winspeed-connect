'use strict';

// Hybrid rule (owner, 21 Nov 2026): Rebate on a booking (103) made in WinSpeed stays with
// WinSpeed's own process and Sale-App does not accrue it. Sale-App accrues Rebate only for
// a booking it issued itself, which is the booking line that carries Sale-App's price
// snapshot (wf.RebateBookingPriceSnapshot, written in the same transaction as the 103).
// The path is the one the accrual itself locks: 116 line -> coupon -> 104 line -> 103 line.

// Correlated fragment for a 116 line aliased as `ref` with columns RedemtionID and Listno.
const SALE_APP_BOOKING_FOR_116_LINE = `SELECT TOP 1 1 AS FromSaleApp
  FROM dbo.WFRedemtionDT od
  JOIN dbo.WFCoupon oc ON oc.CouponID=od.CouponID
  JOIN dbo.SODT osd ON osd.SOID=oc.DocuID AND osd.ListNo=oc.RefListno AND osd.DocuType=104
  JOIN dbo.SOHD ob ON ob.SOID=osd.RefSOID AND ob.DocuType=103
  JOIN wf.RebateBookingPriceSnapshot os ON os.BookingSOID=ob.SOID AND os.[LineNo]=osd.RefListNo
  WHERE od.RedemtionID=ref.RedemtionID AND od.Listno=ref.Listno`;

// Correlated fragment for a queue row aliased as `e` (wf.RebateShipmentEvidence): its 104 line's
// booking line carries the Sale-App price snapshot. A row without a traced 104 line never matches.
const SALE_APP_BOOKING_FOR_EVIDENCE = `SELECT 1 FROM dbo.SODT esd
  JOIN dbo.SOHD eb ON eb.SOID=esd.RefSOID AND eb.DocuType=103
  JOIN wf.RebateBookingPriceSnapshot es ON es.BookingSOID=eb.SOID AND es.[LineNo]=esd.RefListNo
  WHERE esd.SOID=e.SourceSOID AND esd.ListNo=e.SourceListNo AND esd.DocuType=104`;

function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;

/** True when the 104 line's booking line was issued by Sale-App. Run inside the caller's transaction. */
async function isSaleAppBookingLine(query, { sourceSOID, sourceListNo } = {}) {
  if (typeof query !== 'function') fail('REBATE_BOOKING_ORIGIN_INVALID', 400);
  if (!positive(Number(sourceSOID)) || !positive(Number(sourceListNo))) return false;
  const rows = (await query(`SELECT TOP 1 1 AS FromSaleApp
    FROM dbo.SODT sd
    JOIN dbo.SOHD b ON b.SOID=sd.RefSOID AND b.DocuType=103
    JOIN wf.RebateBookingPriceSnapshot s ON s.BookingSOID=b.SOID AND s.[LineNo]=sd.RefListNo
    WHERE sd.SOID=@sourceSOID AND sd.ListNo=@sourceListNo AND sd.DocuType=104`,
  { sourceSOID: Number(sourceSOID), sourceListNo: Number(sourceListNo) })).recordset || [];
  return rows.length === 1;
}

module.exports = { SALE_APP_BOOKING_FOR_116_LINE, SALE_APP_BOOKING_FOR_EVIDENCE, isSaleAppBookingLine };
