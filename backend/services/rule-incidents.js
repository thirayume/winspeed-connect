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
});

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
    const base = { soid: r.SPID, docuNo: r.DocuNo, wghdId: r.WghdId, occurredAt: r.DateOut };
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
      soid: c.SOID, docuNo: c.DocuNo, occurredAt: c.DocuDate, detail: `ใบสั่งขาย (104) ${c.DeliveryNo}`,
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
      occurredAt: b.DocuDate, detail: `ใบส่งของ (107) ${b.DocuNo} จากใบสั่งขาย (104) ${b.SONo}`,
    });
  }
}

async function detectIncidents() {
  const { getWeightSettings } = require('./weight-reconciliation');
  const start = await incidentStartDate();
  const tolerance = await getWeightSettings();
  await detectScaleIncidents(start, tolerance);
  await detectDocumentIncidents(start);
}

module.exports = { INCIDENT_TYPES, APPROVAL_SCREEN, recordIncident, detectIncidents, plateMatches };
