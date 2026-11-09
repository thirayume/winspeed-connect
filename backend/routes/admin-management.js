"use strict";
const router = require("express").Router();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { sql, wfQuery, wfTransaction } = require("../db");
const {
  requireAuth,
  requireCapability,
  clearAccountStatusCache,
} = require("../middleware/auth");
const { ROLES, ACTIONS, MENUS, hasPermission } = require("../services/role-capabilities");
const {
  EDITABLE,
  parseProfile,
  profiles,
  resolveProfile,
} = require("../services/role-profiles");
router.use(requireAuth, (req, res, next) => {
  if (req.user.isImpersonating)
    return res
      .status(403)
      .json({ message: "กรุณาออกจาก Access As ก่อนจัดการสิทธิ์และผู้ใช้" });
  if (req.user.mustChangePassword)
    return res
      .status(403)
      .json({ message: "กรุณาเปลี่ยนรหัสผ่านของตนเองก่อน" });
  res.set("Cache-Control", "no-store");
  next();
});
const {
  query,
  error,
  lockPolicy,
  assertAdministrator,
  changeMembership,
  setMembership,
} = require("../services/role-policy-write");
function fail(res, e) {
  return res
    .status(e.status || 500)
    .json({
      message: e.status
        ? e.message
        : "ดำเนินการไม่สำเร็จ กรุณาตรวจ migration และโหลดข้อมูลใหม่",
    });
}
router.get(
  "/roles",
  (req, res, next) =>
    require("../services/role-capabilities").hasPermission(
      req.user,
      "roles.manage",
    )
      ? next()
      : requireCapability("users.manage")(req, res, next),
  async (req, res) => {
    try {
      const stored = await profiles();
      res.json({
        roles: stored,
        actions: ACTIONS,
        menus: MENUS,
        editable: EDITABLE,
      });
    } catch (e) {
      fail(res, e);
    }
  },
);
router.put(
  "/roles/:code",
  requireCapability("roles.manage"),
  async (req, res) => {
    if (String(req.params.code).toUpperCase() === "ADMIN") {
      return res.status(400).json({ message: "Role ADMIN ได้รับการสงวนไว้ เป็นสิทธิ์หลักของระบบ ไม่สามารถแก้ไขได้" });
    }
    const p = parseProfile({ ...req.body, code: req.params.code });
    if (!p)
      return res
        .status(400)
        .json({ message: "ตรวจรหัส Role บทบาทต้นแบบ และ Permission" });
    if (p.code === "ADMIN" || p.code === "SEPARATION") {
      return res.status(400).json({ message: `Role ${p.code} ได้รับการสงวนไว้ เป็นสิทธิ์หลักของระบบ ไม่สามารถแก้ไขได้` });
    }
    try {
      await wfTransaction(async (tx) => {
        await lockPolicy(tx, req.user.id, "roles.manage");
        const old = (
          await query(
            tx,
            "SELECT BaseRole,Revision FROM wf.RoleProfile WITH (UPDLOCK,HOLDLOCK) WHERE Code=@code",
            { code: p.code },
          )
        ).recordset[0];
        if (
          (old?.Revision || 0) !== p.expectedRevision ||
          (old && old.BaseRole !== p.baseRole)
        )
          throw error(
            "Role เปลี่ยนแล้ว หรือเปลี่ยนต้นแบบเดิมไม่ได้ กรุณาโหลดใหม่",
          );
        const params = {
          code: p.code,
          name: p.name,
          base: p.baseRole,
          disabled: JSON.stringify(
            EDITABLE.filter((k) => !p.permissions.includes(k)),
          ),
          actor: Number(req.user.id),
        };
        await query(
          tx,
          old
            ? "UPDATE wf.RoleProfile SET Name=@name,DisabledActions=@disabled,Revision=Revision+1,UpdatedBy=@actor,UpdatedAt=GETUTCDATE() WHERE Code=@code"
            : "INSERT INTO wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES(@code,@name,@base,@disabled,@actor)",
          params,
        );
        await query(tx, "DELETE FROM wf.RolePermission WHERE RoleCode=@code", {
          code: p.code,
        });
        for (const permission of p.permissions)
          await query(
            tx,
            "INSERT wf.RolePermission(RoleCode,PermissionCode) VALUES(@code,@permission)",
            { code: p.code, permission },
          );
        await assertAdministrator(tx);
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
  },
);
router.post(
  "/users/batch",
  requireCapability("users.manage"),
  requireCapability("roles.manage"),
  async (req, res) => {
    const {
      ids,
      action,
      roleCode,
      roleCodes,
      roleMode = "replace",
      isActive,
    } = req.body || {};
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 100 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647) ||
      !["role", "status", "reset-password", "clear-line"].includes(action) ||
      (action === "status" && typeof isActive !== "boolean")
    )
      return res
        .status(400)
        .json({ message: "เลือกรายการ 1–100 คน และคำสั่งที่ถูกต้อง" });
    if (ids.includes(Number(req.user.id)))
      return res
        .status(400)
        .json({ message: "ไม่สามารถทำ batch กับบัญชีของตนเองได้" });
    try {
      const requested = roleCodes || (roleCode ? [roleCode] : []);
      if (
        action === "role" &&
        (!Array.isArray(requested) ||
          !requested.length ||
          requested.some(
            (k) => typeof k !== "string" || !/^[A-Z][A-Z0-9_]{1,29}$/.test(k),
          ) ||
          !["add", "remove", "replace"].includes(roleMode))
      )
        return res
          .status(400)
          .json({
            message: "เลือก Role และรูปแบบเพิ่ม/นำออก/แทนที่ให้ถูกต้อง",
          });
      const credentials = [];
      if (action === "reset-password")
        for (const id of ids) {
          const password = crypto.randomBytes(15).toString("base64url");
          credentials.push({
            id,
            password,
            hash: await bcrypt.hash(password, 12),
          });
        }
      await wfTransaction(async (tx) => {
        await lockPolicy(tx, req.user.id, "roles.manage");
        // Lock the actor and selected rows in stable order; updates and audit are all-or-nothing.
        const all = (
          await query(
            tx,
            "SELECT Id,Username,Role,IsActive,RoleCode FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK) ORDER BY Id",
          )
        ).recordset;
        if (ids.some((id) => !all.some((u) => u.Id === id)))
          throw error("รายชื่อผู้ใช้เปลี่ยน กรุณาโหลดใหม่");
        for (const id of [...ids].sort((a, b) => a - b)) {
          const target = all.find((u) => u.Id === id),
            params = { id };
          let set;
          let beforeRoles, afterRoles;
          if (action === "role") {
            beforeRoles = (
              await query(
                tx,
                "SELECT RoleCode FROM wf.vUserRole WHERE UserId=@id",
                { id },
              )
            ).recordset.map((r) => r.RoleCode);
            afterRoles = changeMembership(beforeRoles, requested, roleMode);
            await setMembership(tx, id, afterRoles);
            if (afterRoles.includes("SEPARATION")) {
              set = "IsActive=0,PositionCode=NULL";
            } else {
              set = "Role=Role";
            }
          }
          if (action === "status") {
            set = "IsActive=@active";
            params.active = isActive;
          }
          if (action === "clear-line")
            set = "LineUserId=NULL,LineDisplayName=NULL,LineLinkedAt=NULL";
          if (action === "reset-password") {
            set = "PasswordHash=@hash,MustChangePassword=1";
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
            "INSERT INTO wf.AdminChangeAudit(ActorId,Action,Target,Detail) VALUES(@actor,@action,@target,@detail)",
            {
              actor: Number(req.user.id),
              action: "BATCH_" + action,
              target: String(id),
              detail: JSON.stringify({
                beforeRole: target.Role,
                beforeRoleCode: target.RoleCode || target.Role,
                beforeIsActive: Boolean(target.IsActive),
                beforeRoles,
                afterRoles,
                roleMode: action === "role" ? roleMode : undefined,
                isActive: action === "status" ? isActive : undefined,
              }),
            },
          );
        }
        await assertAdministrator(tx);
      });
      ids.forEach(clearAccountStatusCache);
      const warnings = [];
      if (action === "role" || (action === "status" && isActive))
        for (const id of ids) {
          try {
            await require("../services/rebate-doc-code").ensureRebateDocCode(
              id,
            );
          } catch {
            warnings.push("ตรวจรหัสผู้ขอรีเบทของผู้ใช้ ID " + id);
          }
        }
      res.json({
        ok: true,
        count: ids.length,
        warnings,
        credentials: credentials.map(({ id, username, password }) => ({
          id,
          username,
          password,
        })),
      });
    } catch (e) {
      fail(res, e);
    }
  },
);
router.get("/history", async (req, res) => {
  try {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role].filter(Boolean);
    const isAdmin = roles.includes('ADMIN');
    const isCLevel = roles.includes('C_LEVEL');
    const isManager = roles.includes('MANAGER');
    const hasRolesManage = hasPermission(req.user, 'roles.manage');
    const hasUsersManage = hasPermission(req.user, 'users.manage');

    const domain = String(req.query.domain || 'all').toLowerCase();

    // Domain-level permission check
    if (domain === 'roles' || domain === 'batch') {
      if (!hasRolesManage) return res.status(403).json({ message: 'ไม่มีสิทธิ์ดูประวัติบทบาทและสิทธิ์' });
    } else if (domain === 'positions') {
      if (!hasUsersManage && !hasRolesManage) return res.status(403).json({ message: 'ไม่มีสิทธิ์ดูประวัติตำแหน่งองค์กร' });
    } else if (domain === 'regions') {
      if (!isAdmin && !isCLevel && !isManager && !hasRolesManage) return res.status(403).json({ message: 'ไม่มีสิทธิ์ดูประวัติผู้ดูแลภาค' });
    } else {
      if (!hasRolesManage && !hasUsersManage && !isAdmin) return res.status(403).json({ message: 'ไม่มีสิทธิ์ดูประวัติการดูแลระบบ' });
    }

    let filterClause = '';
    if (domain === 'roles') {
      filterClause = "WHERE Action IN ('ROLE_SAVE', 'ROLE_DELETE')";
    } else if (domain === 'batch') {
      filterClause = "WHERE Action LIKE 'BATCH_%'";
    } else if (domain === 'positions') {
      filterClause = "WHERE Action = 'USER_POSITION'";
    } else if (domain === 'regions') {
      filterClause = "WHERE Action IN ('REGION_ASSIGN', 'REGION_REMOVE')";
    }

    res.json(
      (
        await wfQuery(
          `SELECT TOP (100) Id,ActorId,Action,Target,Detail,CreatedAt FROM wf.AdminChangeAudit ${filterClause} ORDER BY Id DESC`,
        )
      ).recordset || [],
    );
  } catch (e) {
    fail(res, e);
  }
});
router.get(
  "/roles/:code/members",
  requireCapability("roles.manage"),
  async (req, res) => {
    try {
      res.json(
        (
          await wfQuery(
            `SELECT u.Id,u.Username,u.DisplayName,u.IsActive,r.RoleCode FROM wf.AppUser u JOIN wf.vUserRole r ON r.UserId=u.Id
    WHERE u.Id IN(SELECT UserId FROM wf.vUserRole WHERE RoleCode=@code) ORDER BY u.DisplayName,u.Id,r.RoleCode`,
            { code: { type: sql.VarChar(30), value: req.params.code } },
          )
        ).recordset,
      );
    } catch (e) {
      fail(res, e);
    }
  },
);
router.delete(
  "/roles/:code",
  requireCapability("roles.manage"),
  async (req, res) => {
    if (["ADMIN", "SEPARATION"].includes(String(req.params.code).toUpperCase())) {
      return res.status(400).json({ message: `Role ${req.params.code} เป็นสิทธิ์หลักของระบบ ไม่สามารถลบได้` });
    }
    try {
      if (!Number.isInteger(req.body?.expectedRevision))
        return res.status(400).json({ message: "กรุณาโหลด Role ใหม่ก่อนลบ" });
      await wfTransaction(async (tx) => {
        await lockPolicy(tx, req.user.id, "roles.manage");
        const p = (
          await query(
            tx,
            "SELECT Revision FROM wf.RoleProfile WITH(UPDLOCK,HOLDLOCK) WHERE Code=@code",
            { code: req.params.code },
          )
        ).recordset[0];
        if (!p || p.Revision !== req.body.expectedRevision)
          throw error("Role เปลี่ยนแล้ว กรุณาโหลดใหม่");
        const members = (
          await query(
            tx,
            "SELECT UserId FROM wf.vUserRole WHERE RoleCode=@code",
            { code: req.params.code },
          )
        ).recordset;
        if (members.length)
          throw error(
            "ลบ Role ไม่ได้: ยังมีผู้ใช้ " +
              members.length +
              " คน (รวมผู้ใช้ที่ปิดใช้งาน) กรุณาย้ายผู้ใช้ทั้งหมดก่อน",
          );
        await query(tx, "DELETE FROM wf.RoleProfile WHERE Code=@code", {
          code: req.params.code,
        });
        await assertAdministrator(tx);
        await query(
          tx,
          "INSERT wf.AdminChangeAudit(ActorId,Action,Target,Detail) VALUES(@actor,'ROLE_DELETE',@code,@detail)",
          {
            actor: Number(req.user.id),
            code: req.params.code,
            detail: JSON.stringify({ revision: p.Revision }),
          },
        );
      });
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  },
);
module.exports = router;
