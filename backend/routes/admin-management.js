'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole, clearAccountStatusCache } = require('../middleware/auth');
const { ROLES, ACTIONS, MENUS } = require('../services/role-capabilities');
const { EDITABLE, parseProfile, profiles, resolveProfile } = require('../services/role-profiles');
router.use(requireAuth, requireRole('ADMIN'), (req, res, next) => {
  if (req.user.isImpersonating)
    return res.status(403).json({ message: 'กรุณาออกจาก Access As ก่อนจัดการสิทธิ์และผู้ใช้' });
  if (req.user.mustChangePassword)
    return res.status(403).json({ message: 'กรุณาเปลี่ยนรหัสผ่านของตนเองก่อน' });
  res.set('Cache-Control', 'no-store');
  next();
});
async function query(tx, text, params = {}) {
  const q = tx.request();
  for (const [k, v] of Object.entries(params)) q.input(k, v);
  return q.query(text);
}
function fail(res, e) {
  return res
    .status(e.status || 500)
    .json({ message: e.status ? e.message : 'ดำเนินการไม่สำเร็จ กรุณาตรวจ migration และโหลดข้อมูลใหม่' });
}
function error(message, status = 409) {
  return Object.assign(new Error(message), { status });
}
router.get('/roles', async (req, res) => {
  try {
    const stored = await profiles();
    res.json({
      roles: ROLES.map(
        (code) =>
          stored.find((p) => p.Code === code) || {
            Code: code,
            Name: code,
            BaseRole: code,
            disabledActions: [],
            Revision: 0,
          },
      ).concat(stored.filter((p) => !ROLES.includes(p.Code))),
      actions: ACTIONS,
      menus: MENUS,
      editable: EDITABLE,
    });
  } catch (e) {
    fail(res, e);
  }
});
router.put('/roles/:code', async (req, res) => {
  const p = parseProfile({ ...req.body, code: req.params.code });
  if (!p)
    return res
      .status(400)
      .json({ message: 'ตรวจรหัส Role บทบาทต้นแบบ และ Permission (ADMIN คงสิทธิ์ดูแลระบบ)' });
  try {
    await wfTransaction(async (tx) => {
      const actor = (
        await query(
          tx,
          'SELECT Id,Username,Role,IsActive,RoleCode FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id',
          { id: Number(req.user.id) },
        )
      ).recordset.find((u) => u.Id === Number(req.user.id));
      if (!actor || actor.Role !== 'ADMIN' || !actor.IsActive)
        throw error('สิทธิ์ผู้ทำรายการเปลี่ยน กรุณาเข้าสู่ระบบใหม่', 403);
      const old = (
        await query(
          tx,
          'SELECT BaseRole,Revision FROM wf.RoleProfile WITH (UPDLOCK,HOLDLOCK) WHERE Code=@code',
          { code: p.code },
        )
      ).recordset[0];
      if ((old?.Revision || 0) !== p.expectedRevision || (old && old.BaseRole !== p.baseRole))
        throw error('Role เปลี่ยนแล้ว หรือเปลี่ยนต้นแบบเดิมไม่ได้ กรุณาโหลดใหม่');
      const params = {
        code: p.code,
        name: p.name,
        base: p.baseRole,
        disabled: JSON.stringify(p.disabledActions),
        actor: Number(req.user.id),
      };
      await query(
        tx,
        old
          ? 'UPDATE wf.RoleProfile SET Name=@name,DisabledActions=@disabled,Revision=Revision+1,UpdatedBy=@actor,UpdatedAt=GETUTCDATE() WHERE Code=@code'
          : 'INSERT INTO wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES(@code,@name,@base,@disabled,@actor)',
        params,
      );
      await query(
        tx,
        "INSERT INTO wf.AdminChangeAudit(ActorId,Action,Target,Detail) VALUES(@actor,'ROLE_SAVE',@code,@detail)",
        { actor: params.actor, code: p.code, detail: JSON.stringify(p) },
      );
    });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});
router.post('/users/batch', async (req, res) => {
  const { ids, action, roleCode, isActive } = req.body || {};
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 100 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647) ||
    !['role', 'status', 'reset-password', 'clear-line'].includes(action) ||
    (action === 'status' && typeof isActive !== 'boolean')
  )
    return res.status(400).json({ message: 'เลือกรายการ 1–100 คน และคำสั่งที่ถูกต้อง' });
  if (ids.includes(Number(req.user.id)))
    return res.status(400).json({ message: 'ไม่สามารถทำ batch กับบัญชีของตนเองได้' });
  try {
    const profile = action === 'role' ? await resolveProfile(roleCode) : null;
    if (action === 'role' && !profile) return res.status(400).json({ message: 'ไม่พบ Role' });
    const credentials = [];
    if (action === 'reset-password')
      for (const id of ids) {
        const password = crypto.randomBytes(15).toString('base64url');
        credentials.push({ id, password, hash: await bcrypt.hash(password, 12) });
      }
    await wfTransaction(async (tx) => {
      // Lock the actor and selected rows in stable order; updates and audit are all-or-nothing.
      const all = (
        await query(
          tx,
          'SELECT Id,Username,Role,IsActive,RoleCode FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK) ORDER BY Id',
        )
      ).recordset;
      const actor = all.find((u) => u.Id === Number(req.user.id));
      if (!actor || actor.Role !== 'ADMIN' || !actor.IsActive)
        throw error('สิทธิ์ผู้ทำรายการเปลี่ยน กรุณาเข้าสู่ระบบใหม่', 403);
      if (ids.some((id) => !all.some((u) => u.Id === id))) throw error('รายชื่อผู้ใช้เปลี่ยน กรุณาโหลดใหม่');
      for (const id of [...ids].sort((a, b) => a - b)) {
        const target = all.find((u) => u.Id === id),
          params = { id };
        let set;
        if (action === 'role') {
          set = 'Role=@role,RoleCode=@code';
          params.role = profile.BaseRole;
          params.code = ROLES.includes(roleCode) ? null : roleCode;
        }
        if (action === 'status') {
          set = 'IsActive=@active';
          params.active = isActive;
        }
        if (action === 'clear-line') set = 'LineUserId=NULL,LineDisplayName=NULL,LineLinkedAt=NULL';
        if (action === 'reset-password') {
          set = 'PasswordHash=@hash,MustChangePassword=1';
          const c = credentials.find((x) => x.id === id);
          params.hash = c.hash;
          c.username = target.Username;
        }
        await query(
          tx,
          `UPDATE wf.AppUser SET ${set},AuthVersion=AuthVersion+1,UpdatedAt=GETUTCDATE() WHERE Id=@id`,
          params,
        );
        await query(
          tx,
          'INSERT INTO wf.AdminChangeAudit(ActorId,Action,Target,Detail) VALUES(@actor,@action,@target,@detail)',
          {
            actor: Number(req.user.id),
            action: 'BATCH_' + action,
            target: String(id),
            detail: JSON.stringify({
              beforeRole: target.Role,
              beforeRoleCode: target.RoleCode || target.Role,
              beforeIsActive: Boolean(target.IsActive),
              roleCode: profile?.Code,
              isActive: action === 'status' ? isActive : undefined,
            }),
          },
        );
      }
    });
    ids.forEach(clearAccountStatusCache);
    const warnings = [];
    if (action === 'role' || (action === 'status' && isActive))
      for (const id of ids) {
        try {
          await require('../services/rebate-doc-code').ensureRebateDocCode(id);
        } catch {
          warnings.push('ตรวจรหัสผู้ขอรีเบทของผู้ใช้ ID ' + id);
        }
      }
    res.json({
      ok: true,
      count: ids.length,
      warnings,
      credentials: credentials.map(({ id, username, password }) => ({ id, username, password })),
    });
  } catch (e) {
    fail(res, e);
  }
});
router.get('/history', async (req, res) => {
  try {
    res.json(
      (
        await wfQuery(
          'SELECT TOP (100) Id,ActorId,Action,Target,Detail,CreatedAt FROM wf.AdminChangeAudit ORDER BY Id DESC',
        )
      ).recordset,
    );
  } catch (e) {
    fail(res, e);
  }
});
module.exports = router;
