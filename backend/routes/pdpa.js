/**
 * pdpa.js — FR-032 Retention policy + DSAR (PDPA)
 *   - policies: นโยบายเก็บข้อมูล (วัน) ต่อ data class
 *   - DSAR export: รวมข้อมูลส่วนบุคคลของ subject (ลูกค้า/ผู้ใช้) + log
 *   - retention run: ลบข้อมูลเก่าตามนโยบาย (ErrorLog, Outbox DONE) — best-effort
 */
const router = require('express').Router();
const { sql, query, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('ADMIN', 'MANAGER'));

// GET /api/pdpa/policies
router.get('/policies', async (req, res) => {
  try {
    const r = await wfQuery(`SELECT Id, DataClass, RetentionDays, Note, UpdatedAt FROM wf.RetentionPolicy ORDER BY DataClass`);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PUT /api/pdpa/policies/:id — แก้ retention (ADMIN)
router.put('/policies/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const rawDays = req.body?.retentionDays;
    if (rawDays === undefined || rawDays === null || String(rawDays).trim() === '') return res.status(400).json({ message: 'กรุณาระบุจำนวนวันเก็บข้อมูล' });
    const result = await require('../services/retention-audit').updateRetentionPolicy({
      id: Number(req.params.id), retentionDays: Number(rawDays),
      note: req.body?.note || null, user: req.user, ipAddress: req.ip,
    });
    if (!result) return res.status(404).json({ message: 'ไม่พบรายการที่ระบุ' });
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// GET /api/pdpa/dsar — log คำขอ
router.get('/dsar', async (req, res) => {
  let window;
  try { window = await require('../services/global-data-window-store').readGlobalDataWindow(); }
  catch { return res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถตรวจวันเริ่มข้อมูลได้' }); }
  try {
    const r = await wfQuery(`SELECT TOP 100 d.Id, d.SubjectType, d.SubjectId, d.Action, d.Status, u.DisplayName AS ByName, d.RequestedAt, d.Note
                             FROM wf.DsarLog d LEFT JOIN wf.AppUser u ON u.Id=d.RequestedBy
                             WHERE d.RequestedAt >= @globalStartUtc ORDER BY d.Id DESC`,
      { globalStartUtc: { type: sql.DateTime2, value: window.utcInstant } });
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/pdpa/dsar/export  { subjectType, subjectId } — รวมข้อมูลส่วนบุคคล (PDPA สิทธิ์เข้าถึง)
router.post('/dsar/export', async (req, res) => {
  try {
    const { subjectType, subjectId } = req.body || {};
    if (!subjectType || !subjectId) return res.status(400).json({ message: 'subjectType และ subjectId จำเป็น' });
    const data = {};
    let historyStartDate = null;
    if (subjectType === 'CUSTOMER') {
      let window;
      try { window = await require('../services/global-data-window-store').readGlobalDataWindow(); }
      catch { return res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถตรวจวันเริ่มข้อมูลได้' }); }
      historyStartDate = window.businessDate;
      data.master = (await query(`SELECT TOP 1 * FROM dbo.EMCust WHERE CAST(CustID AS NVARCHAR(20))=@c`,
        { c: { type: sql.NVarChar(20), value: String(subjectId) } }))[0] || null;
      // Read the two base tables by customer id instead of wf.v_AllSalesOrders with CAST(CustId …): the view
      // spans every native booking/sales order and the cast defeats the CustID index, so the export timed out
      // on real data (UAT batch 7, ADM-06).
      const custNo = /^\d{1,10}$/.test(String(subjectId)) ? Number(subjectId) : null;
      data.salesOrders = (await wfQuery(`SELECT TOP 200 Id, WfRef, DocuType, Status, CONVERT(VARCHAR(10), CreatedAt, 120) AS CreatedAt FROM (
          SELECT CAST(s.Id AS VARCHAR(50)) AS Id, s.WfRef, CAST(NULL AS INT) AS DocuType, s.Status, s.CreatedAt
          FROM wf.SalesOrder s WHERE CAST(s.CustId AS NVARCHAR(20)) = @c AND s.CreatedAt >= @globalStartUtc
          UNION ALL
          SELECT CAST(h.SOID AS VARCHAR(50)), h.DocuNo, h.DocuType,
                 CASE WHEN h.DocuStatus = 'C' THEN 'CANCELLED' ELSE 'NATIVE' END, h.DocuDate
          FROM dbo.SOHD h WITH (NOLOCK) WHERE @cid IS NOT NULL AND h.CustID = @cid AND h.DocuType IN (103, 104)
            AND h.DocuDate >= @globalStartDate
        ) x ORDER BY CreatedAt DESC`,
        { c: { type: sql.NVarChar(20), value: String(subjectId) }, cid: { type: sql.Int, value: custNo },
          globalStartUtc: { type: sql.DateTime2, value: window.utcInstant }, globalStartDate: { type: sql.Date, value: window.businessDate } })).recordset;
      data.creditMaster = (await wfQuery(`SELECT CustId, CreditLimit, CreditHold, Note FROM wf.CreditMaster WHERE CustId=@c`,
        { c: { type: sql.NVarChar(20), value: String(subjectId) } })).recordset[0] || null;
    } else if (subjectType === 'USER') {
      data.account = (await wfQuery(`SELECT Id, Username, DisplayName, Role, EmpId, IsActive FROM wf.AppUser WHERE Id=@id`,
        { id: { type: sql.Int, value: Number(subjectId) } })).recordset[0] || null;
    } else {
      return res.status(400).json({ message: 'subjectType ต้องเป็น CUSTOMER หรือ USER' });
    }
    await require('../services/retention-audit').recordDsarExport({ subjectType, subjectId, user: req.user, ipAddress: req.ip });
    res.json({ subjectType, subjectId, exportedAt: new Date().toISOString(), historyStartDate, data });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// POST /api/pdpa/retention/run — ลบข้อมูลเก่าตามนโยบาย (ADMIN)
router.post('/retention/run', requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await require('../services/retention-audit').runRetention({ user: req.user, ipAddress: req.ip });
    res.json({ ok: true, ranAt: new Date().toISOString(), result });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

module.exports = router;
