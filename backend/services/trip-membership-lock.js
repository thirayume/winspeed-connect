'use strict';

// One lock for "who is in this trip". Attaching a bill to a trip and deleting a trip both
// take an update lock on the trip row first, inside their own transaction, so the two can
// no longer interleave: a bill cannot land on a trip that is being deleted, and a trip
// cannot be deleted while a bill is being attached to it.
const { sql } = require('../db');

function conflict(code, message) { return Object.assign(new Error(message), { status: 409, code }); }
function tripIdOf(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

/** Locks the trip row until the transaction ends. Returns the row, or null when absent. */
async function lockTripRow(tx, tripId) {
  const id = tripIdOf(tripId);
  if (!id) return null;
  const result = await tx.request().input('tripLockId', sql.Int, id)
    .query('SELECT TripId, Status FROM wf.SalesTrip WITH (UPDLOCK, HOLDLOCK) WHERE TripId = @tripLockId');
  return result.recordset?.[0] || null;
}

/** Call before a bill is written with this trip. Refuses a missing or deleted trip. */
async function lockTripForMembership(tx, tripId) {
  if (tripId == null || tripId === '') return null;
  if (!tripIdOf(tripId)) throw conflict('TRIP_NOT_FOUND', 'ไม่พบเที่ยวรถที่เลือก กรุณาเลือกเที่ยวรถใหม่');
  const row = await lockTripRow(tx, tripId);
  if (!row) throw conflict('TRIP_NOT_FOUND', 'ไม่พบเที่ยวรถที่เลือก กรุณาเลือกเที่ยวรถใหม่');
  if (String(row.Status || '').trim().toUpperCase() === 'DELETED')
    throw conflict('TRIP_DELETED', 'เที่ยวรถนี้ถูกลบแล้ว กรุณาโหลดข้อมูลใหม่แล้วเลือกเที่ยวรถอีกครั้ง');
  return row;
}

/** Bills still attached to the trip, read with committed data (never NOLOCK). */
async function countActiveTripBills(tx, tripId) {
  const result = await tx.request().input('tripCountId', sql.Int, tripIdOf(tripId)).query(`
    SELECT COUNT(*) AS Cnt FROM (
      SELECT CAST(so.Id AS VARCHAR(50)) AS Id
      FROM wf.SalesOrder so
      WHERE so.TripId = @tripCountId AND so.Status NOT IN ('CANCELLED', 'DELETED')
      UNION ALL
      SELECT CAST(hd.SOID AS VARCHAR(50)) AS Id
      FROM wf.SalesOrderExt ext
      INNER JOIN dbo.SOHD hd WITH (NOLOCK) ON CONVERT(VARCHAR(50), hd.SOID) = CONVERT(VARCHAR(50), ext.SOID)
      WHERE ext.TripId = @tripCountId AND ISNULL(hd.DocuStatus, '') <> 'C' AND ISNULL(ext.IsDeleted, 0) = 0
    ) active`);
  return Number(result.recordset?.[0]?.Cnt || 0);
}

/**
 * Marks the trip deleted only if no bill is attached, under the membership lock.
 * Returns { deleted, found, activeBills }.
 */
async function deleteTripIfEmpty(tx, tripId) {
  const row = await lockTripRow(tx, tripId);
  if (!row || String(row.Status || '').trim().toUpperCase() === 'DELETED') return { deleted: false, found: false, activeBills: 0 };
  const activeBills = await countActiveTripBills(tx, tripId);
  const previousStatus = String(row.Status || '').trim();
  if (activeBills > 0) return { deleted: false, found: true, activeBills, previousStatus };
  const update = await tx.request().input('tripDeleteId', sql.Int, tripIdOf(tripId))
    .query("UPDATE wf.SalesTrip SET Status = 'DELETED' WHERE TripId = @tripDeleteId AND Status <> 'DELETED'");
  return { deleted: Number(update.rowsAffected?.[0]) === 1, found: true, activeBills: 0, previousStatus };
}

module.exports = { lockTripForMembership, deleteTripIfEmpty, countActiveTripBills, lockTripRow };
