/**
 * policy.js — FR-028 Approval policy management
 * จัดการ wf.ApprovalPolicy (ADMIN/MANAGER) + endpoint resolve
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { resolveApprovalPolicy } = require('../services/approval');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logChangeEvent } = require('../services/policy-contract');
const { businessIds } = require('../services/business-identity');
const { hasColumn, currentActorId } = require('../services/request-context');

router.use(requireAuth);

async function txQuery(tx, text, inputs = {}) {
  const request = tx.request();
  for (const [key, input] of Object.entries(inputs)) request.input(key, input.type, input.value);
  return request.query(text);
}

async function auditPolicy(tx, req, id, action, before, after) {
  const ids = businessIds(req.user);
  if (!ids.actor || !ids.effective) throw new Error('POLICY_AUDIT_IDENTITY_REQUIRED');
  if (ids.actor !== ids.effective && (currentActorId() !== ids.actor || !await hasColumn(wfQuery, 'wf.ChangeEvent', 'ActorUserId')))
    throw Object.assign(new Error('POLICY_ACTOR_AUDIT_UNAVAILABLE'), { status: 503 });
  await logChangeEvent(tx, { entityType:'APPROVAL_POLICY', entityId:String(id), action,
    beforeJson:before, afterJson:after, reasonCode:'APPROVAL_POLICY_CHANGE',
    userId:String(ids.effective), ipAddress:req.ip });
}

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
router.post('/', requireRole('ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const { caseType, minAmount, maxAmount, requiredRole, effectiveFrom, effectiveTo, note } = req.body || {};
    if (!caseType || !requiredRole) return res.status(400).json({ message: 'caseType และ requiredRole จำเป็น' });
    const r = await wfTransaction(async tx => {
      const inserted = await txQuery(tx, `
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
        uid:  { type: sql.Int,           value: businessIds(req.user).effective },
      });
      const id = inserted.recordset?.[0]?.Id;
      if (!id) throw new Error('POLICY_INSERT_FAILED');
      const after = (await txQuery(tx, 'SELECT * FROM wf.ApprovalPolicy WHERE Id=@id', {id:{type:sql.Int,value:id}})).recordset?.[0];
      if (!after) throw new Error('POLICY_INSERT_NOT_VISIBLE');
      await auditPolicy(tx, req, id, 'CREATE', null, after);
      return inserted;
    });
    res.json({ id: r.recordset[0].Id });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// PUT /api/policy/:id — แก้ไข (ADMIN/MANAGER)
router.put('/:id', requireRole('ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const { minAmount, maxAmount, requiredRole, effectiveTo, isActive, note } = req.body || {};
    const __r = await wfTransaction(async tx => {
      const id = Number(req.params.id);
      const before = (await txQuery(tx, 'SELECT * FROM wf.ApprovalPolicy WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id', {id:{type:sql.Int,value:id}})).recordset?.[0];
      if (!before) return {rowsAffected:[0]};
      const result = await txQuery(tx, `
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
      if (!result.rowsAffected?.[0]) return result;
      const after = (await txQuery(tx, 'SELECT * FROM wf.ApprovalPolicy WHERE Id=@id', {id:{type:sql.Int,value:id}})).recordset?.[0];
      if (!after) throw new Error('POLICY_UPDATE_NOT_VISIBLE');
      await auditPolicy(tx, req, id, 'UPDATE', before, after);
      return result;
    });
    if (!__r.rowsAffected[0]) return res.status(404).json({ message: 'ไม่พบรายการที่ระบุ' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// DELETE /api/policy/:id — ปิดใช้งาน (ADMIN)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const r = await wfTransaction(async tx => {
      const id=Number(req.params.id), input={ id: { type: sql.Int, value: id } };
      const before=(await txQuery(tx,'SELECT * FROM wf.ApprovalPolicy WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id',input)).recordset?.[0];
      if (!before) return {rowsAffected:[0]};
      const result=await txQuery(tx,`UPDATE wf.ApprovalPolicy SET IsActive = 0 WHERE Id = @id`,input);
      if (!result.rowsAffected?.[0]) return result;
      const after=(await txQuery(tx,'SELECT * FROM wf.ApprovalPolicy WHERE Id=@id',input)).recordset?.[0];
      if (!after) throw new Error('POLICY_UPDATE_NOT_VISIBLE');
      await auditPolicy(tx,req,id,'DEACTIVATE',before,after);
      return result;
    });
    if (!r.rowsAffected[0]) return res.status(404).json({ message: 'ไม่พบนโยบายที่ระบุ' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

module.exports = router;
