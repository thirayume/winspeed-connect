'use strict';

/**
 * Rule incidents: the list, one incident with everyone involved from the first document to the last, and its review.
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getVisibleScope, inScope } = require('../services/visible-scope');
const { INCIDENT_TYPES, localToUtc } = require('../services/rule-incidents');
const { MENUS } = require('../services/role-capabilities');
const { isValidStartDate, boundaries } = require('../services/data-window');

router.use(requireAuth);

const VIEW_ROLES = MENUS.incidents;
const REVIEW_ROLES = ['MANAGER', 'ACCOUNTING', 'C_LEVEL', 'ADMIN'];

// Screens WinSpeed writes to SMAudit, in plain words for the timeline.
const WS_SCREENS = Object.freeze({
  2098003048: 'ใบสั่งจอง (103)',
  2098003080: 'อนุมัติใบสั่งจอง (AI)',
  2098003049: 'ใบสั่งขาย (104)',
  2098003052: 'ตัดตั๋วปุ๋ย (116)',
  2098003054: 'ใบส่งของ (107)',
  558: 'Post GL',
});
const WS_ACTIONS = Object.freeze({ I: 'บันทึก', U: 'แก้ไข/อนุมัติ', D: 'ลบ', P: 'พิมพ์' });
const APP_ACTIONS = Object.freeze({
  CREATED: 'สร้างบิล', UPDATED: 'แก้ไขบิล', VERIFIED: 'ตรวจบิล', CONFIRMED: 'ยืนยันบิล เกิดใบสั่งจอง (103)',
  PICKING: 'คลังเริ่มรอรับสินค้า', LOADED: 'คลังโหลดสินค้า', SHIPPED: 'ส่งออกจากตาชั่ง', CANCELLED: 'ยกเลิกบิล',
  UNLOCKED: 'ปลดล็อกบิล', EDIT_UNLOCKED: 'อนุมัติให้แก้ไขบิล', GIVEAWAY_APPROVED: 'อนุมัติของแถม',
});

const typeLabel = t => INCIDENT_TYPES[t]?.label || t;

router.get('/types', requireRole(...VIEW_ROLES), (_req, res) => {
  res.json(Object.entries(INCIDENT_TYPES).map(([type, v]) => ({ type, ...v })));
});

router.get('/', requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const { status, type, from, to, search } = req.query;
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const where = ['i.OccurredAt >= @globalStartUtc'];
    const inputs = { globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant } };
    if (status && ['OPEN', 'ACK'].includes(status)) { where.push('i.Status = @status'); inputs.status = { type: sql.VarChar(12), value: status }; }
    if (type && INCIDENT_TYPES[type]) { where.push('i.IncidentType = @type'); inputs.type = { type: sql.VarChar(40), value: type }; }
    if (isValidStartDate(from)) { where.push('i.OccurredAt >= @from'); inputs.from = { type: sql.DateTime2, value: boundaries(from).utcInstant }; }
    if (isValidStartDate(to)) { where.push('i.OccurredAt < @toExclusive'); inputs.toExclusive = { type: sql.DateTime2, value: new Date(boundaries(to).utcInstant.getTime() + 86400000) }; }
    if (search) { where.push('(i.DocuNo LIKE @search OR i.Detail LIKE @search OR h.CustName LIKE @search)'); inputs.search = { type: sql.NVarChar(80), value: `%${String(search).slice(0, 60)}%` }; }
    const rows = (await wfQuery(`
      SELECT TOP 500 i.Id, i.IncidentType, i.Severity, i.SOID, i.DocuNo, i.WghdId, i.Detail, i.OccurredAt, i.Status,
             i.AckAt, i.AckNote, ack.DisplayName AS AckByName,
             RTRIM(h.CustName) AS CustName, RTRIM(emp.EmpName) AS SalesName, h.EmpID, e.SalesUserId
      FROM wf.RuleIncident i WITH (NOLOCK)
      LEFT JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = i.SOID
      LEFT JOIN dbo.EMEmp emp WITH (NOLOCK) ON emp.EmpID = h.EmpID
      LEFT JOIN wf.SalesOrderExt e WITH (NOLOCK) ON e.SOID = CONVERT(VARCHAR(50), i.SOID)
      LEFT JOIN wf.AppUser ack WITH (NOLOCK) ON ack.Id = i.AckBy
      WHERE ${where.join(' AND ')}
      ORDER BY i.OccurredAt DESC, i.Id DESC
    `, inputs)).recordset || [];
    const scope = await getVisibleScope(req.user);
    const visible = scope.all ? rows : rows.filter(r => r.SOID == null || inScope(scope, { userId: r.SalesUserId, empId: r.EmpID }));
    res.json(visible.map(({ EmpID, SalesUserId, ...r }) => ({ ...r, TypeLabel: typeLabel(r.IncidentType) })));
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

async function loadIncident(id, dataWindow) {
  return (await wfQuery(`SELECT * FROM wf.RuleIncident WITH (NOLOCK) WHERE Id = @id AND OccurredAt >= @globalStartUtc`,
    { id: { type: sql.Int, value: Number(id) }, globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant } })).recordset?.[0] || null;
}

/** Everyone involved, from the first document to the last, oldest first. */
async function buildTimeline(soid, docuNo, dataWindow) {
  const steps = [];
  const visible = at => {
    const time = at == null ? NaN : new Date(at).getTime();
    return Number.isFinite(time) && time >= dataWindow.utcInstant.getTime();
  };
  const add = (at, step, who, doc, note) => { if (step && visible(at)) steps.push({ at, step, who: who || null, doc: doc || null, note: note || null }); };
  const q = { soid: { type: sql.Int, value: Number(soid) || 0 } };

  const booking = (await wfQuery(`
    SELECT RTRIM(h.DocuNo) AS DocuNo, RTRIM(h.AppvDocuNo) AS AppvDocuNo, h.AppvFlag, h.AppvDate, h.DocuDate,
           RTRIM(h.CustName) AS CustName, RTRIM(h.TransRegistration) AS Plate,
           RTRIM(s.EmpName) AS SalesName, RTRIM(a.EmpName) AS ApproverName
    FROM dbo.SOHD h WITH (NOLOCK)
    LEFT JOIN dbo.EMEmp s WITH (NOLOCK) ON s.EmpID = h.EmpID
    LEFT JOIN dbo.EMEmp a WITH (NOLOCK) ON a.EmpID = h.Appvid
    WHERE h.SOID = @soid`, q)).recordset?.[0] || null;

  const appEvents = (await wfQuery(`
    SELECT a.CreatedAt, a.Action, a.Note, u.DisplayName
    FROM wf.SalesOrderAudit a WITH (NOLOCK)
    LEFT JOIN wf.AppUser u WITH (NOLOCK) ON u.Id = a.UserId
    WHERE a.SoId = CONVERT(VARCHAR(50), @soid)
    ORDER BY a.Id`, q)).recordset || [];
  for (const a of appEvents) add(a.CreatedAt, `Sale-App: ${APP_ACTIONS[a.Action] || a.Action}`, a.DisplayName, booking?.DocuNo, a.Note);

  const deliveries = booking?.AppvDocuNo ? ((await wfQuery(`
    SELECT RTRIM(d.DocuNo) AS DocuNo, d.SOID, d.DocuDate FROM dbo.SOHD d WITH (NOLOCK)
    WHERE d.DocuType = 104 AND d.RefNo = @ai`, { ai: { type: sql.NVarChar(30), value: booking.AppvDocuNo } })).recordset || []) : [];

  const invoices = deliveries.length ? ((await wfQuery(`
    SELECT RTRIM(i.DocuNo) AS DocuNo, i.Docutype, i.DocuDate FROM dbo.SOInvHD i WITH (NOLOCK)
    WHERE i.SONo IN (${deliveries.map((_, n) => `@d${n}`).join(',')})`,
    Object.fromEntries(deliveries.map((d, n) => [`d${n}`, { type: sql.NVarChar(30), value: d.DocuNo }])))).recordset || []) : [];

  const scales = (await wfQuery(`
    SELECT w.Id, RTRIM(w.CarNo) AS CarNo, w.DateIn, w.DateOut, w.WeightIn, w.WeightOut, w.WeightNet, RTRIM(w.MoveBill) AS MoveBill, RTRIM(w.UpdateBy) AS UpdateBy
    FROM dbo.WGHD w WITH (NOLOCK) WHERE w.WGType = 'SO' AND w.SPID = @soid ORDER BY w.Id`, q)).recordset || [];
  for (const w of scales) {
    add(localToUtc(w.DateIn), 'ตาชั่ง: รถชั่งเข้า', w.UpdateBy, w.MoveBill, `${w.CarNo || ''} ${w.WeightIn || 0} กก.`.trim());
    add(localToUtc(w.DateOut), 'ตาชั่ง: รถชั่งออก', w.UpdateBy, w.MoveBill, `${w.CarNo || ''} สุทธิ ${w.WeightNet || 0} กก.`.trim());
  }

  const docNos = [...new Set([booking?.DocuNo, booking?.AppvDocuNo, docuNo, ...deliveries.map(d => d.DocuNo), ...invoices.map(i => i.DocuNo), ...scales.map(w => w.MoveBill)].filter(Boolean))].slice(0, 30);
  if (docNos.length) {
    const inputs = Object.fromEntries(docNos.map((d, n) => [`n${n}`, { type: sql.NVarChar(50), value: d }]));
    const audit = (await wfQuery(`
      SELECT a.audit_datetime, a.audit_screen, a.audit_action, RTRIM(a.audit_username) AS Username, RTRIM(a.audit_docuno) AS DocuNo
      FROM dbo.SMAudit a WITH (NOLOCK)
      WHERE a.audit_docuno IN (${docNos.map((_, n) => `@n${n}`).join(',')})
        AND a.audit_action IN ('I','U','D')
      ORDER BY a.audit_datetime`, inputs)).recordset || [];
    for (const a of audit) {
      const screen = WS_SCREENS[a.audit_screen];
      if (screen) add(localToUtc(a.audit_datetime), `WinSpeed: ${WS_ACTIONS[String(a.audit_action).trim()] || a.audit_action} ${screen}`, a.Username, a.DocuNo);
    }
  }

  steps.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  return {
    booking: booking && visible(localToUtc(booking.DocuDate)) ? booking : null,
    deliveries: deliveries.filter(d => visible(localToUtc(d.DocuDate))),
    invoices: invoices.filter(i => visible(localToUtc(i.DocuDate))),
    scales: scales.filter(w => visible(localToUtc(w.DateOut || w.DateIn))).map(w => ({
      ...w,
      DateIn: visible(localToUtc(w.DateIn)) ? w.DateIn : null,
      DateOut: visible(localToUtc(w.DateOut)) ? w.DateOut : null,
    })),
    steps,
  };
}

router.get('/:id', requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const i = await loadIncident(req.params.id, dataWindow);
    if (!i) return res.status(404).json({ message: 'ไม่พบเหตุการณ์นี้' });
    if (i.SOID != null) {
      const owner = (await wfQuery(`
        SELECT h.EmpID, e.SalesUserId FROM dbo.SOHD h WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt e WITH (NOLOCK) ON e.SOID = CONVERT(VARCHAR(50), h.SOID)
        WHERE h.SOID = @s`, { s: { type: sql.Int, value: i.SOID } })).recordset?.[0];
      const scope = await getVisibleScope(req.user);
      if (!scope.all && !inScope(scope, { userId: owner?.SalesUserId, empId: owner?.EmpID })) {
        return res.status(404).json({ message: 'ไม่พบเหตุการณ์นี้' });
      }
    }
    const timeline = await buildTimeline(i.SOID, i.DocuNo, dataWindow);
    res.json({ ...i, TypeLabel: typeLabel(i.IncidentType), timeline });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

router.patch('/:id/ack', requireRole(...REVIEW_ROLES), async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim();
    if (note.length < 5) return res.status(400).json({ message: 'กรุณาระบุผลการตรวจสอบอย่างน้อย 5 ตัวอักษร' });
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const r = await wfQuery(`
      UPDATE wf.RuleIncident SET Status = 'ACK', AckBy = @by, AckAt = SYSUTCDATETIME(), AckNote = @note
      WHERE Id = @id AND Status = 'OPEN' AND OccurredAt >= @globalStartUtc;
      SELECT @@ROWCOUNT AS Affected;`, {
      id: { type: sql.Int, value: Number(req.params.id) },
      by: { type: sql.Int, value: req.user.sub },
      note: { type: sql.NVarChar(500), value: note },
      globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant },
    });
    if (!Number(r.recordset?.[0]?.Affected)) return res.status(409).json({ message: 'เหตุการณ์นี้ตรวจแล้วหรือไม่พบ' });
    res.json({ id: Number(req.params.id), status: 'ACK' });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
