'use strict';

// Run after wf.sp_ConfirmSalesOrder, before the enclosing transaction commits.
// This proves the persisted 103 has the same sale date, product, quantity and
// billed price as each decision captured while the draft was locked. It does
// not persist a decision, authorize a user, or credit a customer balance.
const { isValidStartDate } = require('./data-window');
const { shipmentUnits } = require('./rebate-shipment-accrual');
const { fingerprintRebateDecision } = require('./rebate-price-authority');
function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;

async function verifyBookingPricing(query, { bookingId, decisions } = {}) {
  if (typeof query !== 'function' || !positive(bookingId) || !Array.isArray(decisions) || !decisions.length) fail('REBATE_BOOKING_PROOF_INVALID');
  const seen = new Set();
  for (const d of decisions) {
    if (!positive(d?.lineNo) || !positive(d?.goodId) || !isValidStartDate(d?.saleDate) ||
        !/^[a-f0-9]{64}$/.test(String(d?.fingerprint || '')) || seen.has(d.lineNo)) fail('REBATE_BOOKING_PROOF_INVALID');
    try { if (fingerprintRebateDecision(d) !== d.fingerprint) fail('REBATE_BOOKING_PROOF_INVALID'); }
    catch (_) { fail('REBATE_BOOKING_PROOF_INVALID'); }
    seen.add(d.lineNo);
  }
  const rows = (await query(`SELECT h.SOID,h.DocuType,CONVERT(varchar(10),h.DocuDate,23) AS SaleDate,
      d.ListNo,d.GoodID,d.GoodQty2,d.GoodPrice2,DB_NAME() AS DatabaseName,
      CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) AS ServerName
    FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK)
    JOIN dbo.SODT d WITH(UPDLOCK,HOLDLOCK) ON d.SOID=h.SOID AND d.DocuType='103'
    WHERE h.SOID=@bookingId AND h.DocuType='103' ORDER BY d.ListNo`, { bookingId })).recordset || [];
  const native = new Map();
  for (const row of rows) {
    const lineNo = Number(row.ListNo);
    if (Number(row.SOID)!==bookingId || String(row.DocuType).trim()!=='103' || !positive(lineNo) || native.has(lineNo)) fail('REBATE_BOOKING_PROOF_MISMATCH');
    native.set(lineNo, row);
  }
  // Until non-commercial line exclusions have their own verified contract,
  // do not accept a subset of the native order as proof of the whole booking.
  if (native.size!==decisions.length) fail('REBATE_BOOKING_PROOF_MISMATCH');
  for (const d of decisions) {
    const row = native.get(d.lineNo);
    if (!row || String(row.DatabaseName||'').trim().toLowerCase()!==d.source.database.toLowerCase() ||
        String(row.ServerName||'').trim().toLowerCase()!==d.source.server.toLowerCase() ||
        Number(row.GoodID)!==d.goodId || row.SaleDate!==d.saleDate ||
        shipmentUnits(row.GoodQty2, 3)!==shipmentUnits(d.quantity, 3) ||
        shipmentUnits(row.GoodPrice2, 2)!==shipmentUnits(d.calculation?.invoiceUnitPrice, 2)) fail('REBATE_BOOKING_PROOF_MISMATCH');
  }
  return { bookingId, matched: decisions.length };
}
module.exports = { verifyBookingPricing };
