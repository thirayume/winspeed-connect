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
    await wfQuery(`UPDATE wf.RetentionPolicy SET RetentionDays=@d, Note=@n, UpdatedAt=GETUTCDATE() WHERE Id=@id`, {
      d: { type: sql.Int, value: Number(req.body?.retentionDays) || 0 },
      n: { type: sql.NVarChar(300), value: req.body?.note || null },
      id:{ type: sql.Int, value: Number(req.params.id) },
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/pdpa/dsar — log คำขอ
router.get('/dsar', async (req, res) => {
  try {
    const r = await wfQuery(`SELECT TOP 100 d.Id, d.SubjectType, d.SubjectId, d.Action, d.Status, u.DisplayName AS ByName, d.RequestedAt, d.Note
                             FROM wf.DsarLog d LEFT JOIN wf.AppUser u ON u.Id=d.RequestedBy ORDER BY d.Id DESC`);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/pdpa/dsar/export  { subjectType, subjectId } — รวมข้อมูลส่วนบุคคล (PDPA สิทธิ์เข้าถึง)
router.post('/dsar/export', async (req, res) => {
  try {
    const { subjectType, subjectId } = req.body || {};
    if (!subjectType || !subjectId) return res.status(400).json({ message: 'subjectType และ subjectId จำเป็น' });
    const data = {};
    if (subjectType === 'CUSTOMER') {
      data.master = (await query(`SELECT TOP 1 * FROM dbo.EMCust WHERE CAST(CustID AS NVARCHAR(20))=@c`,
        { c: { type: sql.NVarChar(20), value: String(subjectId) } }))[0] || null;
      data.salesOrders = (await wfQuery(`SELECT TOP 200 Id, WfRef, Status, CONVERT(VARCHAR(10),CreatedAt,120) AS CreatedAt
        FROM wf.v_AllSalesOrders WHERE CAST(CustId AS NVARCHAR(20))=@c ORDER BY CreatedAt DESC`,
        { c: { type: sql.NVarChar(20), value: String(subjectId) } })).recordset;
      data.creditMaster = (await wfQuery(`SELECT CustId, CreditLimit, CreditHold, Note FROM wf.CreditMaster WHERE CustId=@c`,
        { c: { type: sql.NVarChar(20), value: String(subjectId) } })).recordset[0] || null;
    } else if (subjectType === 'USER') {
      data.account = (await wfQuery(`SELECT Id, Username, DisplayName, Role, EmpId, IsActive FROM wf.AppUser WHERE Id=@id`,
        { id: { type: sql.Int, value: Number(subjectId) } })).recordset[0] || null;
    } else {
      return res.status(400).json({ message: 'subjectType ต้องเป็น CUSTOMER หรือ USER' });
    }
    await wfQuery(`INSERT INTO wf.DsarLog (SubjectType, SubjectId, Action, RequestedBy, Note) VALUES (@t,@s,'EXPORT',@u,@n)`, {
      t: { type: sql.NVarChar(20), value: subjectType }, s: { type: sql.NVarChar(40), value: String(subjectId) },
      u: { type: sql.Int, value: req.user.sub }, n: { type: sql.NVarChar(400), value: 'DSAR export' },
    });
    res.json({ subjectType, subjectId, exportedAt: new Date().toISOString(), data });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/pdpa/retention/run — ลบข้อมูลเก่าตามนโยบาย (ADMIN)
router.post('/retention/run', requireRole('ADMIN'), async (req, res) => {
  try {
    const pol = (await wfQuery(`SELECT DataClass, RetentionDays FROM wf.RetentionPolicy`)).recordset || [];
    const days = (cls) => pol.find(p => p.DataClass === cls)?.RetentionDays;
    const result = {};
    const errDays = days('ERROR_LOG');
    if (errDays) {
      const r = await wfQuery(`DELETE FROM wf.ErrorLog WHERE OccurredAt < DATEADD(day, -@d, GETUTCDATE())`,
        { d: { type: sql.Int, value: errDays } });
      result.errorLogDeleted = r.rowsAffected?.[0] ?? 0;
    }
    const obDays = days('OUTBOX_DONE');
    if (obDays) {
      const r = await wfQuery(`DELETE FROM wf.OutboxEvent WHERE Status='DONE' AND ProcessedAt < DATEADD(day, -@d, GETUTCDATE())`,
        { d: { type: sql.Int, value: obDays } });
      result.outboxDeleted = r.rowsAffected?.[0] ?? 0;
    }
    res.json({ ok: true, ranAt: new Date().toISOString(), result });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
