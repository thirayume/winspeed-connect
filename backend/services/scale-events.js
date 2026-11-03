'use strict';

/**
 * The scale writes dbo.WGHD (one truck) and dbo.WGDT (what it carries). A record belongs to a booking through
 * WGHD.SPID, or through WGDT.SPID on the rare truck whose header points elsewhere. Status 3 means weighed out.
 * The scale keeps local time, so these times compare with GETDATE(), never GETUTCDATE().
 */
const { sql, wfQuery } = require('../db');

const SCALE_COLUMNS = `
  'WGHD' AS EventSource,
  w.Id AS EventId,
  RTRIM(w.MoveBill) AS MoveBill,
  RTRIM(w.CarNo) AS TruckPlate,
  CAST(w.WeightOut AS DECIMAL(10,2)) AS GrossKg,
  CAST(w.WeightIn AS DECIMAL(10,2)) AS TareKg,
  CAST(ISNULL(w.WeightNet, w.WeightOut - w.WeightIn) AS DECIMAL(10,2)) AS NetKg,
  CAST(w.TotalTon AS DECIMAL(12,3)) AS PlannedTon,
  CASE
    WHEN w.LocationName IS NOT NULL
     AND LTRIM(RTRIM(w.LocationName)) NOT LIKE '%[^0-9]%'
     AND LTRIM(RTRIM(w.LocationName)) <> ''
     AND LEN(LTRIM(RTRIM(w.LocationName))) <= 9
    THEN CAST(LTRIM(RTRIM(w.LocationName)) AS INT)
    ELSE NULL
  END AS ScaleNo,
  w.DateIn,
  w.DateOut AS WeighOutAt`;

const WEIGHED_OUT = `
  w.WGType = 'SO'
  AND RTRIM(w.Status) = '3'
  AND w.WeightOut > 0
  AND w.WeightIn > 0
  AND w.WeightOut > w.WeightIn
  AND w.DateOut IS NOT NULL
  AND w.DateOut <= DATEADD(minute, 5, GETDATE())`;

/** The newest weighed-out scale record of a booking, or null. */
async function findScaleEvent(soId) {
  const id = Number(soId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = await wfQuery(`
    SELECT TOP 1 ${SCALE_COLUMNS}
    FROM dbo.WGHD w WITH (NOLOCK)
    WHERE ${WEIGHED_OUT}
      AND (w.SPID = @soId OR EXISTS (
        SELECT 1 FROM dbo.WGDT d WITH (NOLOCK) WHERE d.WGHDId = w.Id AND d.SPID = @soId))
    ORDER BY w.Id DESC
  `, { soId: { type: sql.Int, value: id } });
  return r.recordset?.[0] || null;
}

/** Bills made in the app, not yet shipped, whose truck the scale has weighed out. */
async function findPendingScaleEvents(limit = 50) {
  const r = await wfQuery(`
    SELECT TOP (@limit) h.SOID, RTRIM(h.DocuNo) AS DocuNo, RTRIM(h.TransRegistration) AS BillPlate,
           h.AppvFlag, e.TripId, ${SCALE_COLUMNS},
           (SELECT SUM(l.GoodQty2) FROM dbo.SODT l WITH (NOLOCK) WHERE l.SOID = h.SOID) AS BillTon
    FROM wf.SalesOrderExt e WITH (NOLOCK)
    JOIN dbo.SOHD h WITH (NOLOCK)
      ON h.SOID = CASE WHEN e.SOID NOT LIKE '%[^0-9]%' AND LEN(e.SOID) BETWEEN 1 AND 9 THEN CAST(e.SOID AS INT) END
     AND h.DocuType = 103
    CROSS APPLY (
      SELECT TOP 1 x.*
      FROM dbo.WGHD x WITH (NOLOCK)
      WHERE (x.SPID = h.SOID OR EXISTS (
        SELECT 1 FROM dbo.WGDT d WITH (NOLOCK) WHERE d.WGHDId = x.Id AND d.SPID = h.SOID))
      ORDER BY x.Id DESC
    ) w
    WHERE e.WeighOutWeight IS NULL
      AND ISNULL(h.DocuStatus, 'N') <> 'C'
      AND ISNULL(e.IsUnlocked, 0) = 0
      AND ${WEIGHED_OUT}
    ORDER BY w.Id
  `, { limit: { type: sql.Int, value: limit } });
  return r.recordset || [];
}

module.exports = { findScaleEvent, findPendingScaleEvents };
