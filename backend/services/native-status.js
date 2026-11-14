'use strict';

/**
 * Status of a WinSpeed document as the boards show it, and the de-duplication rule.
 *
 * A booking (103) that WinSpeed has turned into a sales order (104) is shown once; counting both showed every closed
 * booking twice — once as "waiting for delivery", once as "closed in WinSpeed".
 *
 * The 104 points at its booking through RefNo: the booking's approval number (AI…/AK…) since 2022, the booking's own
 * number in 2019–2021 (those bookings carry no approval number). The two documents do NOT share a number — 103 and
 * 104 have separate counters, so a 104 can carry the number of an unrelated booking (63,344 same-number pairs, 182 of them real; UAT full loop 2026-10-09,
 * where the 104 for I69-04236 came out as I69-03700). Matching by number hid open bookings of other customers.
 */
function nativeStatusSql(hd = 'hd', ext = 'ext') {
  return `CASE
    WHEN ${hd}.DocuStatus = 'C' THEN 'CANCELLED'
    WHEN ${ext}.WeighOutWeight IS NOT NULL OR ${hd}.clearflag = 'Y' THEN 'SHIPPED'
    WHEN ${hd}.DocuType = 104 THEN 'IMPORTED'
    WHEN ${ext}.IsLoaded = 1 THEN 'LOADED'
    WHEN ${hd}.PkgStatus = 'Y' THEN 'PICKING'
    WHEN ${ext}.IsUnlocked = 1 THEN 'DRAFT'
    WHEN ${hd}.AppvFlag = 'W' AND ${hd}.AppvDocuNo IS NULL THEN 'PENDING_APPROVAL'
    ELSE 'CONFIRMED'
  END`;
}

/**
 * true when the row is shown: a booking and its own 104 count once.
 * A bill made in the app (it has a wf.SalesOrderExt row) keeps its booking number — the salesperson knows it by
 * that number, and the 104 can carry another one — so its 104 is the row left out. A booking made in WinSpeed gives
 * way to its 104.
 *
 * Written as one uncorrelated set of SOIDs to leave out: correlated EXISTS versions were fast on their own but, next
 * to a parameterised scope filter (a salesperson's dashboard), SQL Server picked a nested-loop plan over every
 * 103 × 104 pair and the query timed out at 15 s, even with RECOMPILE. The set form ran in about 0.5 s for every role.
 */
// Only use this option when the outer document is already constrained by the
// same @globalStartDate. Restrict the row being excluded, not its linked
// counterpart: a 2026 delivery can still refer to an older booking.
function nativeDedupSql(hd = 'hd', { boundedByStartDate = false } = {}) {
  const bookingBound = boundedByStartDate ? ' AND b.DocuDate >= @globalStartDate' : '';
  const deliveryBound = boundedByStartDate ? ' AND s.DocuDate >= @globalStartDate' : '';
  return `${hd}.SOID NOT IN (
      SELECT b.SOID FROM dbo.SOHD b WITH (NOLOCK)
      JOIN dbo.SOHD s WITH (NOLOCK) ON s.DocuType = 104 AND s.RefNo = ISNULL(b.AppvDocuNo, b.DocuNo)
      WHERE b.DocuType = 103${bookingBound}
        AND NOT EXISTS (SELECT 1 FROM wf.SalesOrderExt bx WITH (NOLOCK) WHERE bx.SOID = CONVERT(VARCHAR(50), b.SOID))
      UNION ALL
      SELECT s.SOID FROM wf.SalesOrderExt x WITH (NOLOCK)
      JOIN dbo.SOHD b WITH (NOLOCK) ON b.SOID = CASE WHEN x.SOID NOT LIKE '%[^0-9]%' AND LEN(x.SOID) BETWEEN 1 AND 9
                                                     THEN CAST(x.SOID AS INT) END
      JOIN dbo.SOHD s WITH (NOLOCK) ON s.DocuType = 104 AND s.RefNo = ISNULL(b.AppvDocuNo, b.DocuNo)
      WHERE b.DocuType = 103${deliveryBound})`;
}

/**
 * The 104 WinSpeed issued from a booking, or null. From then on WinSpeed holds the sale (its ticket and 202, perhaps
 * 116 and 107), so the app must not cancel or rewrite the booking under it (UAT round trip 2026-11-03).
 */
async function findIssuedDelivery(soid) {
  const { sql, wfQuery } = require('../db');
  const r = await wfQuery(`
    SELECT TOP 1 RTRIM(d.DocuNo) AS DocuNo
    FROM dbo.SOHD b WITH (NOLOCK)
    JOIN dbo.SOHD d WITH (NOLOCK) ON d.DocuType = 104 AND d.RefNo = b.AppvDocuNo AND ISNULL(d.DocuStatus, '') <> 'C'
    WHERE b.SOID = @soid AND b.DocuType = 103 AND b.AppvDocuNo IS NOT NULL
    ORDER BY d.SOID DESC`, { soid: { type: sql.Int, value: Number(soid) } });
  return r.recordset?.[0]?.DocuNo || null;
}

module.exports = { nativeStatusSql, nativeDedupSql, findIssuedDelivery };
