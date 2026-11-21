'use strict';

/**
 * Breaches of the sales process, kept so they can be reviewed and stopped (owner, 3 November 2026). None of them
 * blocks work. Each is recorded once: IncidentKey is unique. Detection reads WinSpeed and the scale; nothing here
 * writes to dbo.
 */
const { sql, wfQuery } = require('../db');

const INCIDENT_TYPES = Object.freeze({
  SHIP_BEFORE_AI: { label: 'รถชั่งออกก่อนอนุมัติใบสั่งจอง (AI)', severity: 'HIGH' },
  SHIP_MANUAL_EXCEPTION: { label: 'ส่งออกโดยไม่มีบันทึกชั่ง (ข้อยกเว้นผู้จัดการ)', severity: 'HIGH' },
  SHIP_BEFORE_LOAD_ACK: { label: 'รถชั่งออกก่อนคลังรับทราบแผนจัดของ', severity: 'WARN' },
  WEIGHT_OUT_OF_TOLERANCE: { label: 'น้ำหนักชั่งต่างจากตันที่จะขนเกินเกณฑ์', severity: 'WARN' },
  PLATE_MISMATCH: { label: 'ทะเบียนรถที่ตาชั่งไม่ตรงกับใบสั่งจอง', severity: 'WARN' },
  SCALE_TONS_MISMATCH: { label: 'ตันในบันทึกชั่งไม่ตรงกับบิล', severity: 'WARN' },
  DELIVERY_ON_CANCELLED_BOOKING: { label: 'ออกใบสั่งขาย (104) จากใบสั่งจองที่ยกเลิกแล้ว', severity: 'HIGH' },
  INVOICE_BOOK_MISMATCH: { label: 'เล่มใบส่งของ (107) ไม่ตรงสายใบสั่งขาย (104)', severity: 'WARN' },
  // Owner, 17 November 2026: an expired fertilizer ticket may still be used, but each use is recorded here.
  TICKET_USED_EXPIRED: { label: 'ใช้ตั๋วปุ๋ยที่หมดอายุแล้ว', severity: 'WARN' },
  // Owner, 20 Nov 2026: a cut after the 104's ShipDate is allowed but recorded (NATIVE_116_SHIPDATE_POLICY = 1).
  TICKET_CUT_AFTER_SHIPDATE: { label: 'ตัดตั๋ว 116 หลังวันส่งของของใบสั่งขาย', severity: 'WARN' },
  // Owner, 20 Nov 2026: accounting deletes a wrong 107 and posts it again; Sale-App follows and records it.
  INVOICE_107_REPLACED: { label: 'ใบส่งของ (107) ถูกลบใน WinSpeed และออกใหม่', severity: 'INFO' },
  // Hybrid rule (owner, 21 Nov 2026): a booking made in WinSpeed keeps WinSpeed's own process, but a
  // breach of Sale-App's price rule is still recorded, whichever system the document came from.
  BOOKING_PRICE_NEEDS_APPROVAL: { label: 'ใบสั่งจองจาก WinSpeed ขายต่ำกว่าราคากลางเกิน 200 บาท/ตัน (ต้องมีผู้อนุมัติ)', severity: 'WARN' },
  BOOKING_PRICE_OVER_MAX: { label: 'ใบสั่งจองจาก WinSpeed ขายต่ำกว่าราคากลางเกิน 300 บาท/ตัน (เกินเพดาน)', severity: 'HIGH' },
  BOOKING_CHANGED_IN_WINSPEED: { label: 'ใบสั่งจองจาก Sale-App ถูกแก้สินค้า ราคา หรือจำนวนใน WinSpeed', severity: 'HIGH' },
});

const INSERT_INCIDENT_SQL = `
    IF NOT EXISTS (SELECT 1 FROM wf.RuleIncident WITH (UPDLOCK, HOLDLOCK) WHERE IncidentKey = @key)
      INSERT INTO wf.RuleIncident (IncidentKey, IncidentType, Severity, SOID, DocuNo, WghdId, Detail, OccurredAt)
      VALUES (@key, @type, @sev, @soid, @docuNo, @wghdId, @detail, @occurredAt)`;

/** Records an incident inside the caller's transaction, so it is kept only if the work it describes is kept. */
async function recordIncidentTx(tx, { key, type, soid = null, docuNo = null, detail = null, occurredAt = new Date() }) {
  const spec = INCIDENT_TYPES[type];
  if (!spec) throw new Error(`Unknown incident type ${type}`);
  await tx.request()
    .input('key', sql.NVarChar(120), String(key).slice(0, 120))
    .input('type', sql.VarChar(40), type)
    .input('sev', sql.VarChar(10), spec.severity)
    .input('soid', sql.Int, soid == null ? null : Number(soid))
    .input('docuNo', sql.NVarChar(30), docuNo == null ? null : String(docuNo).slice(0, 30))
    .input('wghdId', sql.Int, null)
    .input('detail', sql.NVarChar(500), detail == null ? null : String(detail).slice(0, 500))
    .input('occurredAt', sql.DateTime, occurredAt ? new Date(occurredAt) : new Date())
    .query(INSERT_INCIDENT_SQL);
}

// WinSpeed writes this screen's row when a booking is approved (อนุมัติใบสั่งจอง (WF)).
const APPROVAL_SCREEN = 2098003080;

async function recordIncident({ key, type, soid = null, docuNo = null, wghdId = null, detail = null, occurredAt = null }) {
  const spec = INCIDENT_TYPES[type];
  if (!spec) throw new Error(`Unknown incident type ${type}`);
  await wfQuery(`
    IF NOT EXISTS (SELECT 1 FROM wf.RuleIncident WHERE IncidentKey = @key)
      INSERT INTO wf.RuleIncident (IncidentKey, IncidentType, Severity, SOID, DocuNo, WghdId, Detail, OccurredAt)
      VALUES (@key, @type, @sev, @soid, @docuNo, @wghdId, @detail, @occurredAt)
  `, {
    key: { type: sql.NVarChar(120), value: key },
    type: { type: sql.VarChar(40), value: type },
    sev: { type: sql.VarChar(10), value: spec.severity },
    soid: { type: sql.Int, value: soid == null ? null : Number(soid) },
    docuNo: { type: sql.NVarChar(30), value: docuNo },
    wghdId: { type: sql.Int, value: wghdId == null ? null : Number(wghdId) },
    detail: { type: sql.NVarChar(500), value: detail },
    occurredAt: { type: sql.DateTime, value: occurredAt ? new Date(occurredAt) : null },
  });
}

async function incidentStartDate() {
  const r = await wfQuery(`SELECT SettingValue FROM wf.SystemSetting WHERE SettingKey = 'INCIDENT_START_DATE'`);
  const v = String(r.recordset?.[0]?.SettingValue || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '2026-11-01';
}

// WinSpeed and the scale store Bangkok time, and the driver hands it over as if it were UTC.
const localToUtc = v => (v ? new Date(new Date(v).getTime() - 7 * 3600 * 1000) : null);

const plate = v => String(v || '').replace(/[\s-]/g, '').toUpperCase();
const NO_PLATE = new Set(['', 'ตั๋วคุม', 'ยังไม่ระบุรถ', 'ไม่ระบุทะเบียนรถ']);
const plateMatches = (a, b) => NO_PLATE.has(plate(b)) || plate(a) === plate(b);

/** Scale records since the start date, checked against their booking. */
async function detectScaleIncidents(start, tolerance) {
  const rows = (await wfQuery(`
    SELECT w.Id AS WghdId, w.SPID, RTRIM(w.CarNo) AS CarNo, w.DateOut, w.WeightNet, w.TotalTon,
           RTRIM(h.DocuNo) AS DocuNo, h.AppvFlag, RTRIM(h.AppvDocuNo) AS AppvDocuNo, RTRIM(h.TransRegistration) AS BillPlate,
           (SELECT MIN(a.audit_datetime) FROM dbo.SMAudit a WITH (NOLOCK)
             WHERE a.audit_docuno = h.DocuNo AND a.audit_screen = ${APPROVAL_SCREEN}) AS ApprovedAt
    FROM dbo.WGHD w WITH (NOLOCK)
    JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = w.SPID AND h.DocuType = 103
    WHERE w.WGType = 'SO' AND RTRIM(w.Status) = '3' AND w.DateOut >= @start
      AND w.DateOut >= DATEADD(day, -14, GETDATE())
  `, { start: { type: sql.VarChar(10), value: start } })).recordset || [];

  for (const r of rows) {
    const base = { soid: r.SPID, docuNo: r.DocuNo, wghdId: r.WghdId, occurredAt: localToUtc(r.DateOut) };
    const approvedLater = r.AppvFlag === 'Y' && r.ApprovedAt && new Date(r.ApprovedAt) > new Date(r.DateOut);
    if (r.AppvFlag !== 'Y' || approvedLater) {
      await recordIncident({
        ...base, key: `SHIP_BEFORE_AI:${r.WghdId}`, type: 'SHIP_BEFORE_AI',
        detail: r.AppvFlag === 'Y' ? `อนุมัติ ${r.AppvDocuNo || ''} หลังรถชั่งออก` : 'รถชั่งออกแล้ว แต่ใบสั่งจองยังไม่อนุมัติ',
      });
    }
    const plannedKg = Number(r.TotalTon) * 1000;
    const net = Number(r.WeightNet);
    if (plannedKg > 0 && net > 0) {
      const min = plannedKg * (1 + tolerance.minPct / 100);
      const max = plannedKg * (1 + tolerance.maxPct / 100);
      if (net < min || net > max) {
        const pct = (((net - plannedKg) / plannedKg) * 100).toFixed(2);
        await recordIncident({
          ...base, key: `WEIGHT_OUT_OF_TOLERANCE:${r.WghdId}`, type: 'WEIGHT_OUT_OF_TOLERANCE',
          detail: `ชั่งได้ ${net.toLocaleString('en-US')} กก. จากที่จะขน ${plannedKg.toLocaleString('en-US')} กก. (${pct}%)`,
        });
      }
    }
    if (!plateMatches(r.CarNo, r.BillPlate)) {
      await recordIncident({
        ...base, key: `PLATE_MISMATCH:${r.WghdId}`, type: 'PLATE_MISMATCH',
        detail: `ตาชั่ง ${r.CarNo || '-'} · ใบสั่งจอง ${r.BillPlate || '-'}`,
      });
    }
  }
  return rows.length;
}

async function detectDocumentIncidents(start) {
  const exceptions = (await wfQuery(`
    SELECT t.Id, t.SoId, t.WfRef, t.OverrideReason, t.OverrideApprovedByName, t.WeighOutAt
    FROM wf.WeighTicket t WITH (NOLOCK)
    WHERE t.OverrideApprovedBy IS NOT NULL AND t.WeighOutAt >= @start
  `, { start: { type: sql.VarChar(10), value: start } })).recordset || [];
  for (const t of exceptions) {
    await recordIncident({
      key: `SHIP_MANUAL_EXCEPTION:${t.Id}`, type: 'SHIP_MANUAL_EXCEPTION', soid: t.SoId, docuNo: t.WfRef,
      occurredAt: t.WeighOutAt, detail: `${t.OverrideApprovedByName || ''}: ${t.OverrideReason || ''}`.slice(0, 500),
    });
  }

  const cancelled = (await wfQuery(`
    SELECT b.SOID, RTRIM(b.DocuNo) AS DocuNo, RTRIM(d.DocuNo) AS DeliveryNo, d.DocuDate
    FROM dbo.SOHD b WITH (NOLOCK)
    JOIN dbo.SOHD d WITH (NOLOCK) ON d.DocuType = 104 AND d.RefNo = b.AppvDocuNo AND ISNULL(d.DocuStatus, '') <> 'C'
    WHERE b.DocuType = 103 AND b.DocuStatus = 'C' AND b.AppvDocuNo IS NOT NULL AND b.DocuDate >= @start
  `, { start: { type: sql.VarChar(10), value: start } })).recordset || [];
  for (const c of cancelled) {
    await recordIncident({
      key: `DELIVERY_ON_CANCELLED_BOOKING:${c.SOID}:${c.DeliveryNo}`, type: 'DELIVERY_ON_CANCELLED_BOOKING',
      soid: c.SOID, docuNo: c.DocuNo, occurredAt: localToUtc(c.DocuDate), detail: `ใบสั่งขาย (104) ${c.DeliveryNo}`,
    });
  }

  const books = (await wfQuery(`
    SELECT i.SOInvID, RTRIM(i.DocuNo) AS DocuNo, RTRIM(i.SONo) AS SONo, i.DocuDate
    FROM dbo.SOInvHD i WITH (NOLOCK)
    WHERE i.Docutype = 107 AND i.DocuDate >= @start
      AND ((i.SONo LIKE 'I%' AND i.DocuNo NOT LIKE 'J%') OR (i.SONo LIKE 'K%' AND i.DocuNo NOT LIKE 'N%'))
  `, { start: { type: sql.VarChar(10), value: start } })).recordset || [];
  for (const b of books) {
    await recordIncident({
      key: `INVOICE_BOOK_MISMATCH:${b.SOInvID}`, type: 'INVOICE_BOOK_MISMATCH', docuNo: b.DocuNo,
      occurredAt: localToUtc(b.DocuDate), detail: `ใบส่งของ (107) ${b.DocuNo} จากใบสั่งขาย (104) ${b.SONo}`,
    });
  }
}

const baht = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tons = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * 103 booking lines since the start date (bounded to the last 120 days), each with its origin and the
 * general price list effective on the booking date, chosen the way the Sale-App price authority chooses
 * it. A line whose list price ties on the same begin date is ambiguous and is not judged.
 */
const BOOKING_LINES_SQL = `
    SELECT h.SOID, RTRIM(h.DocuNo) AS DocuNo, h.DocuDate, d.ListNo, d.GoodID, RTRIM(ISNULL(h.AppvFlag, '')) AS AppvFlag,
           CAST(d.GoodPrice2 AS decimal(18,2)) AS Price, CAST(d.GoodQty2 AS decimal(18,3)) AS Qty,
           CASE WHEN EXISTS (SELECT 1 FROM wf.RebateBookingPriceSnapshot a WITH (NOLOCK) WHERE a.BookingSOID = h.SOID)
                THEN 1 ELSE 0 END AS AppSnapshot,
           CASE WHEN EXISTS (SELECT 1 FROM wf.SalesOrder so WITH (NOLOCK)
                             WHERE so.WfRef = h.DocuNo AND so.ConfirmedAt IS NOT NULL) THEN 1 ELSE 0 END AS AppBill,
           s.GoodId AS SnapGoodId, CAST(s.InvoicePrice AS decimal(18,2)) AS SnapPrice, CAST(s.QuantityTon AS decimal(18,3)) AS SnapQty,
           bp.BasePrice, bp.Ties
    FROM dbo.SOHD h WITH (NOLOCK)
    JOIN dbo.SODT d WITH (NOLOCK) ON d.SOID = h.SOID AND d.DocuType = 103
    LEFT JOIN wf.RebateBookingPriceSnapshot s WITH (NOLOCK) ON s.BookingSOID = h.SOID AND s.[LineNo] = d.ListNo
    OUTER APPLY (
      SELECT TOP 1 CAST(dt.GoodPriceNet AS decimal(18,2)) AS BasePrice,
             (SELECT COUNT(*) FROM dbo.EMSetPriceHD h2 WITH (NOLOCK)
                JOIN dbo.EMSetPriceDT d2 WITH (NOLOCK) ON d2.SetPriceID = h2.SetPriceID
               WHERE h2.CustID IS NULL AND d2.ListID = d.GoodID AND d2.GoodPriceNet > 0 AND h2.BeginDate = hd.BeginDate
                 AND (h2.EndDate IS NULL OR h2.EndDate >= h.DocuDate)) AS Ties
      FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
      JOIN dbo.EMSetPriceDT dt WITH (NOLOCK) ON dt.SetPriceID = hd.SetPriceID
      WHERE hd.CustID IS NULL AND dt.ListID = d.GoodID AND dt.GoodPriceNet > 0
        AND hd.BeginDate <= h.DocuDate AND (hd.EndDate IS NULL OR hd.EndDate >= h.DocuDate)
      ORDER BY hd.BeginDate DESC, dt.SetPriceID DESC, dt.ListNo ASC) bp
    WHERE h.DocuType = 103 AND ISNULL(h.DocuStatus, '') <> 'C' AND h.DocuDate >= @start
      AND h.DocuDate >= DATEADD(day, -120, GETDATE())
    ORDER BY h.SOID, d.ListNo
    OPTION (RECOMPILE)`;

/** Pure decision for one booking line; returns the incident to record, or null. */
function bookingLineIncident(r, { standard = 200, max = 300 } = {}) {
  const base = { soid: r.SOID, docuNo: r.DocuNo, occurredAt: localToUtc(r.DocuDate) };
  const price = Number(r.Price), qty = Number(r.Qty);
  if (Number(r.AppSnapshot) === 1) {
    // Sale-App issued this booking: the line must still match what Sale-App priced and saved.
    if (r.SnapPrice == null) {
      if (price > 0) return { ...base, key: `BOOKING_CHANGED_IN_WINSPEED:${r.SOID}:${r.ListNo}:ADDED:${price}:${qty}`,
        type: 'BOOKING_CHANGED_IN_WINSPEED', detail: `บรรทัด ${r.ListNo} ถูกเพิ่มใน WinSpeed: ${baht(price)} บาท/ตัน ${tons(qty)} ตัน` };
      return null;
    }
    const changed = Number(r.GoodID) !== Number(r.SnapGoodId) || price !== Number(r.SnapPrice) || qty !== Number(r.SnapQty);
    if (!changed) return null;
    return { ...base, key: `BOOKING_CHANGED_IN_WINSPEED:${r.SOID}:${r.ListNo}:${r.GoodID}:${price}:${qty}`,
      type: 'BOOKING_CHANGED_IN_WINSPEED',
      detail: `บรรทัด ${r.ListNo}: Sale-App ${baht(r.SnapPrice)} บาท/ตัน ${tons(r.SnapQty)} ตัน · WinSpeed ${baht(price)} บาท/ตัน ${tons(qty)} ตัน` };
  }
  // A Sale-App bill confirmed before the price snapshot existed was checked when it was issued.
  if (Number(r.AppBill) === 1) return null;
  if (!(price > 0) || r.BasePrice == null || Number(r.Ties) !== 1) return null;
  const diff = Math.round((Number(r.BasePrice) - price) * 100) / 100;
  if (diff <= standard) return null;
  const type = diff > max ? 'BOOKING_PRICE_OVER_MAX' : 'BOOKING_PRICE_NEEDS_APPROVAL';
  return { ...base, key: `${type}:${r.SOID}:${r.ListNo}`, type,
    detail: `บรรทัด ${r.ListNo}: ราคากลาง ${baht(r.BasePrice)} ขาย ${baht(price)} บาท/ตัน ต่ำกว่า ${baht(diff)} บาท/ตัน ${tons(qty)} ตัน · `
      + `${r.AppvFlag === 'Y' ? 'อนุมัติใบสั่งจองใน WinSpeed แล้ว' : 'ยังไม่อนุมัติใบสั่งจองใน WinSpeed'} (ถ้าเป็นส่วนลดเงินสด ให้ฝ่ายขายยืนยัน)` };
}

async function detectBookingIncidents(start, { query = wfQuery, record = recordIncident } = {}) {
  const { REBATE_CONSTANTS } = require('./rebate-pool-models');
  const rows = (await query(BOOKING_LINES_SQL, { start: { type: sql.VarChar(10), value: start } })).recordset || [];
  let recorded = 0;
  for (const r of rows) {
    const incident = bookingLineIncident(r, { standard: REBATE_CONSTANTS.STANDARD_DISCOUNT_LIMIT, max: REBATE_CONSTANTS.MAX_DISCOUNT_LIMIT });
    if (incident) { await record(incident); recorded++; }
  }
  return { lines: rows.length, recorded };
}

async function detectIncidents() {
  const { getWeightSettings } = require('./weight-reconciliation');
  const start = await incidentStartDate();
  const tolerance = await getWeightSettings();
  await detectScaleIncidents(start, tolerance);
  await detectDocumentIncidents(start);
  await detectBookingIncidents(start);
}

module.exports = { INCIDENT_TYPES, APPROVAL_SCREEN, recordIncident, recordIncidentTx, detectIncidents, plateMatches, localToUtc,
  BOOKING_LINES_SQL, bookingLineIncident, detectBookingIncidents };
