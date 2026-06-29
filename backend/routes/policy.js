/**
 * policy.js — FR-028 Approval policy management
 * จัดการ wf.ApprovalPolicy (ADMIN/MANAGER) + endpoint resolve
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { resolveApprovalPolicy } = require('../services/approval');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/policy — รายการนโยบายทั้งหมด
router.get('/', async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT p.Id, p.CaseType, p.MinAmount, p.MaxAmount, p.RequiredRole,
             CONVERT(VARCHAR(10), p.EffectiveFrom, 120) AS EffectiveFrom,
             CONVERT(VARCHAR(10), p.EffectiveTo, 120)   AS EffectiveTo,
             p.IsActive, p.Note, u.DisplayName AS CreatedByName, p.CreatedAt
      FROM wf.ApprovalPolicy p
      LEFT JOIN wf.AppUser u ON u.Id = p.CreatedBy
      ORDER BY p.CaseType, ISNULL(p.MinAmount, 0)`);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/policy/resolve?caseType=&amount= — engine ตอบ role ที่ต้องใช้
router.get('/resolve', async (req, res) => {
  try {
    const amount = req.query.amount != null && req.query.amount !== '' ? Number(req.query.amount) : null;
    const hit = await resolveApprovalPolicy(String(req.query.caseType || ''), amount);
    res.json(hit || { RequiredRole: null, message: 'ไม่พบนโยบายที่ตรง' });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/policy — สร้างนโยบาย (ADMIN/MANAGER)
router.post('/', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { caseType, minAmount, maxAmount, requiredRole, effectiveFrom, effectiveTo, note } = req.body || {};
    if (!caseType || !requiredRole) return res.status(400).json({ message: 'caseType และ requiredRole จำเป็น' });
    const r = await wfQuery(`
      INSERT INTO wf.ApprovalPolicy (CaseType, MinAmount, MaxAmount, RequiredRole, EffectiveFrom, EffectiveTo, Note, CreatedBy)
      OUTPUT INSERTED.Id
      VALUES (@c, @min, @max, @role, ISNULL(@from, CAST(GETDATE() AS DATE)), @to, @note, @uid)`,
      {
        c:    { type: sql.NVarChar(40),  value: caseType },
        min:  { type: sql.Decimal(18,2), value: minAmount ?? null },
        max:  { type: sql.Decimal(18,2), value: maxAmount ?? null },
        role: { type: sql.NVarChar(30),  value: requiredRole },
        from: { type: sql.Date,          value: effectiveFrom || null },
        to:   { type: sql.Date,          value: effectiveTo || null },
        note: { type: sql.NVarChar(300), value: note || null },
        uid:  { type: sql.Int,           value: req.user.sub },
      });
    res.json({ id: r.recordset[0].Id });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PUT /api/policy/:id — แก้ไข (ADMIN/MANAGER)
router.put('/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { minAmount, maxAmount, requiredRole, effectiveTo, isActive, note } = req.body || {};
    await wfQuery(`
      UPDATE wf.ApprovalPolicy SET
        MinAmount = @min, MaxAmount = @max, RequiredRole = COALESCE(@role, RequiredRole),
        EffectiveTo = @to, IsActive = COALESCE(@act, IsActive), Note = @note
      WHERE Id = @id`,
      {
        id:   { type: sql.Int,           value: Number(req.params.id) },
        min:  { type: sql.Decimal(18,2), value: minAmount ?? null },
        max:  { type: sql.Decimal(18,2), value: maxAmount ?? null },
        role: { type: sql.NVarChar(30),  value: requiredRole || null },
        to:   { type: sql.Date,          value: effectiveTo || null },
        act:  { type: sql.Bit,           value: isActive == null ? null : (isActive ? 1 : 0) },
        note: { type: sql.NVarChar(300), value: note || null },
      });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// DELETE /api/policy/:id — ปิดใช้งาน (ADMIN)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    await wfQuery(`UPDATE wf.ApprovalPolicy SET IsActive = 0 WHERE Id = @id`,
      { id: { type: sql.Int, value: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
