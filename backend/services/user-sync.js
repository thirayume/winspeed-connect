'use strict';

/**
 * user-sync.js — Cross-Database User & Role Synchronization (Single Auth Authority)
 * Synchronizes wf.AppUser, wf.RoleProfile, wf.RolePermission, and wf.UserRole
 * from the Primary Database (dbwins_worldfert9) to any switchable target database.
 */

const { sql, pools } = require('../db');
const { primaryDatabase, primaryOwnerPool, onpremEnabled } = require('./active-database');
const { isSwitchableDb } = require('../onprem-target');
const { randomUUID } = require('crypto');

async function syncUsersToTarget(targetDbName, identity) {
  if (!targetDbName || typeof targetDbName !== 'string') {
    throw Object.assign(new Error('ระบุชื่อฐานข้อมูลปลายทาง'), { status: 400, code: 'INVALID_TARGET_DB' });
  }
  const cleanTarget = targetDbName.trim();
  const primaryDb = primaryDatabase();

  if (cleanTarget.toLowerCase() === primaryDb.toLowerCase()) {
    return { ok: true, message: 'ฐานข้อมูลปลายทางเป็นฐานหลักอยู่แล้ว ไม่จำเป็นต้องซิงค์', affected: 0 };
  }

  if (onpremEnabled() && !isSwitchableDb(cleanTarget)) {
    throw Object.assign(new Error('ฐานข้อมูลปลายทางไม่อยู่ในรายการที่อนุญาต'), { status: 403, code: 'DB_NOT_ALLOWED' });
  }

  // The operator IDs come from the primary authentication database. They are
  // intentionally not interpreted as IDs of people in the target database.
  const actorPrimaryId = Number(identity?.actorPrimaryId);
  const effectivePrimaryId = Number(identity?.effectivePrimaryId);
  if (![actorPrimaryId, effectivePrimaryId].every(n => Number.isSafeInteger(n) && n > 0))
    throw Object.assign(new Error('ไม่สามารถยืนยันผู้สั่งซิงค์ได้'), { status: 403, code: 'SYNC_AUDIT_IDENTITY_REQUIRED' });

  // 1. Fetch source rows from Primary Database
  const srcPool = await primaryOwnerPool();
  // SQL Server serializable shared/range locks provide one consistent source
  // view. The transaction ends before opening the target; later source changes
  // are not reflected in this sync. Queries must be sequential on one session.
  const sourceTx = new sql.Transaction(srcPool);
  await sourceTx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  let sourceContext, rolesRs, permsRs, usersRs, userRolesRs;
  try {
    sourceContext = (await sourceTx.request().query('SELECT DB_NAME() AS DatabaseName, @@SERVERNAME AS ServerName')).recordset?.[0];
    if (!sourceContext?.ServerName || String(sourceContext.DatabaseName || '').toLowerCase() !== primaryDb.toLowerCase())
      throw Object.assign(new Error('ฐานต้นทางไม่ตรงกับฐานตัวตนหลัก'), { status: 409, code: 'SYNC_SOURCE_CONTEXT_MISMATCH' });
    rolesRs = await sourceTx.request().query('SELECT Code, Name, BaseRole, DisabledActions, Revision FROM wf.RoleProfile');
    permsRs = await sourceTx.request().query('SELECT RoleCode, PermissionCode FROM wf.RolePermission');
    usersRs = await sourceTx.request().query(`
      SELECT Id, Username, PasswordHash, DisplayName, Role, RoleCode, IsActive, EmpId,
             PositionCode, MustChangePassword, AuthVersion, SignatureFile
      FROM wf.AppUser
    `);
    userRolesRs = await sourceTx.request().query('SELECT UserId, RoleCode FROM wf.UserRole');
    await sourceTx.commit();
  } catch (error) {
    try { await sourceTx.rollback(); } catch (_) { /* preserve the original error */ }
    throw error;
  }

  const roles = rolesRs.recordset || [];
  const perms = permsRs.recordset || [];
  const users = usersRs.recordset || [];
  const userRoles = userRolesRs.recordset || [];
  // The target audit table displays ActorId through its own AppUser table.
  // Require both primary principals in this snapshot so the identity conflict
  // checks and upserts below establish the same IDs before audit commit.
  if (![actorPrimaryId, effectivePrimaryId].every(id => users.some(u => Number(u.Id) === id && Boolean(u.IsActive))))
    throw Object.assign(new Error('ไม่พบผู้สั่งหรือผู้ทำแทนที่ยังใช้งานในข้อมูลต้นทาง'), { status: 409, code: 'SYNC_AUDIT_PRINCIPAL_INACTIVE' });
  const syncId = randomUUID();

  // 2. Connect to Target Database
  const tgtEntry = pools('onprem', cleanTarget);
  await tgtEntry.ready;
  const tgtPool = tgtEntry.ownerPool;
  const tx = new sql.Transaction(tgtPool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
  const targetContext = (await tx.request().query('SELECT DB_NAME() AS DatabaseName, @@SERVERNAME AS ServerName')).recordset?.[0];
  if (!targetContext?.ServerName || String(targetContext.DatabaseName || '').toLowerCase() !== cleanTarget.toLowerCase())
    throw Object.assign(new Error('ฐานปลายทางไม่ตรงกับที่เลือก'), { status: 409, code: 'SYNC_TARGET_CONTEXT_MISMATCH' });

  // Schema belongs to migrations. Never synthesize a different role schema
  // during sync: require the migrated contract before any target mutation.
  const schema = (await tx.request().query(`SELECT CASE WHEN
    OBJECT_ID('wf.RoleProfile','U') IS NOT NULL AND COL_LENGTH('wf.RoleProfile','DisabledActions') IS NOT NULL
    AND COL_LENGTH('wf.RoleProfile','UpdatedBy') IS NOT NULL AND OBJECT_ID('wf.RolePermission','U') IS NOT NULL
    AND OBJECT_ID('wf.AppUser','U') IS NOT NULL AND OBJECT_ID('wf.UserRole','U') IS NOT NULL
    AND OBJECT_ID('wf.AdminChangeAudit','U') IS NOT NULL THEN 1 ELSE 0 END AS IsReady`)).recordset?.[0];
  if (Number(schema?.IsReady) !== 1)
    throw Object.assign(new Error('ฐานปลายทางยังไม่มี schema ที่รองรับการซิงค์'), { status: 409, code: 'SYNC_SCHEMA_NOT_READY' });

  // Capture role-policy impact, including target-only users who retain a role
  // whose permissions will be changed by this sync.
  const priorRoles = (await tx.request().query('SELECT Code, Name, BaseRole, DisabledActions, Revision FROM wf.RoleProfile WITH (UPDLOCK,HOLDLOCK)')).recordset || [];
  const priorPermissions = (await tx.request().query('SELECT RoleCode, PermissionCode FROM wf.RolePermission WITH (UPDLOCK,HOLDLOCK)')).recordset || [];
  const targetUsers = (await tx.request().query('SELECT Id, Username, Role, RoleCode FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK)')).recordset || [];
  const targetMemberships = (await tx.request().query('SELECT UserId, RoleCode FROM wf.UserRole WITH (UPDLOCK,HOLDLOCK)')).recordset || [];
  const sourceUserIds = new Set(users.map(u => Number(u.Id)));
  const roleKey = value => String(value || '').trim().toUpperCase();
  const managedCodes = new Set(roles.map(r => roleKey(r.Code)));
  const policyView = (code, profiles, permissions) => {
    const profile = profiles.find(p => roleKey(p.Code) === roleKey(code));
    return profile ? { name: profile.Name, baseRole: profile.BaseRole, disabledActions: profile.DisabledActions, revision: profile.Revision || 0,
      permissions: permissions.filter(p => roleKey(p.RoleCode) === roleKey(code)).map(p => p.PermissionCode).sort() } : null;
  };
  const effectsFor = codes => [...new Set(codes.map(roleKey).filter(c => c && managedCodes.has(c)))].sort().map(code => ({ code,
    before: policyView(code, priorRoles, priorPermissions), after: policyView(code, roles, perms) }));

  // Lock the matching keys until commit. Reusing either an ID or username
  // for a different person cannot be repaired by overwriting the target row:
  // existing documents and audit records already refer to those IDs.
  const beforeUsers = new Map();
  for (const u of users) {
    const found = await tx.request().input('id', sql.Int, u.Id).input('username', sql.NVarChar(50), u.Username)
      .input('empId', sql.NVarChar(20), u.EmpId == null ? null : String(u.EmpId))
      .query(`SELECT Id, Username, DisplayName, Role, RoleCode, IsActive, EmpId, PositionCode, MustChangePassword, AuthVersion,
              CASE WHEN Id=@id AND Username=@username
                AND ISNULL(NULLIF(RTRIM(CONVERT(NVARCHAR(20),EmpId)),''),'')=ISNULL(NULLIF(RTRIM(@empId),''),'')
                THEN 1 ELSE 0 END AS IsExact
              FROM wf.AppUser WITH (UPDLOCK, HOLDLOCK) WHERE Id=@id OR Username=@username`);
    const rows = found.recordset || [];
    if (rows.length > 1 || (rows.length === 1 && Number(rows[0].IsExact) !== 1)) {
      throw Object.assign(new Error('พบข้อมูลบัญชีที่ ID หรือ Username ไม่ตรงกันระหว่างฐาน กรุณาตรวจจับคู่ก่อนซิงค์'),
        { status: 409, code: 'SYNC_IDENTITY_CONFLICT' });
    }
    const memberships = (await tx.request().input('uid', sql.Int, u.Id)
      .query('SELECT RoleCode FROM wf.UserRole WITH (UPDLOCK,HOLDLOCK) WHERE UserId=@uid')).recordset || [];
    const row = rows[0];
    beforeUsers.set(Number(u.Id), row ? { username: row.Username, displayName: row.DisplayName, role: row.Role,
      roleCode: row.RoleCode, isActive: Boolean(row.IsActive), empId: row.EmpId, positionCode: row.PositionCode,
      mustChangePassword: Boolean(row.MustChangePassword), authVersion: row.AuthVersion,
      memberships: memberships.map(m => m.RoleCode).sort() } : null);
  }

  // 5. Sync RoleProfile
  for (const r of roles) {
    await tx.request()
      .input('code', sql.NVarChar(50), r.Code)
      .input('name', sql.NVarChar(100), r.Name)
      .input('baseRole', sql.NVarChar(50), r.BaseRole)
      .input('disabled', sql.NVarChar(sql.MAX), r.DisabledActions)
      .input('rev', sql.Int, r.Revision || 0)
      .input('updatedBy', sql.Int, effectivePrimaryId)
      .query(`
        IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = @code)
          UPDATE wf.RoleProfile
          SET Name = @name, BaseRole = @baseRole, DisabledActions = @disabled, Revision = @rev, UpdatedBy = @updatedBy, UpdatedAt = SYSUTCDATETIME()
          WHERE Code = @code;
        ELSE
          INSERT INTO wf.RoleProfile (Code, Name, BaseRole, DisabledActions, Revision, UpdatedBy)
          VALUES (@code, @name, @baseRole, @disabled, @rev, @updatedBy);
      `);
  }

  // 6. Sync RolePermission
  // Replace only source-managed roles. Target-only roles may be used by other
  // accounts and must not silently lose their permissions during a sync.
  for (const r of roles) {
    await tx.request().input('rc', sql.NVarChar(50), r.Code)
      .query('DELETE FROM wf.RolePermission WHERE RoleCode = @rc');
  }
  for (const p of perms) {
    await tx.request()
      .input('rc', sql.NVarChar(50), p.RoleCode)
      .input('pc', sql.NVarChar(100), p.PermissionCode)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = @rc AND PermissionCode = @pc)
          INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES (@rc, @pc);
      `);
  }

  // 7. Sync AppUser
  for (const u of users) {
    await tx.request()
      .input('id', sql.Int, u.Id)
      .input('username', sql.NVarChar(50), u.Username)
      .input('ph', sql.NVarChar(255), u.PasswordHash)
      .input('dn', sql.NVarChar(100), u.DisplayName)
      .input('role', sql.NVarChar(50), u.Role)
      .input('rc', sql.NVarChar(50), u.RoleCode || null)
      .input('isActive', sql.Bit, u.IsActive ? 1 : 0)
      .input('empId', sql.NVarChar(20), u.EmpId || null)
      .input('pos', sql.NVarChar(50), u.PositionCode || null)
      .input('mcp', sql.Bit, u.MustChangePassword ? 1 : 0)
      .input('av', sql.Int, u.AuthVersion || 1)
      .input('sig', sql.NVarChar(255), u.SignatureFile || null)
      .query(`
        IF EXISTS (SELECT 1 FROM wf.AppUser WHERE Id = @id AND Username = @username)
          UPDATE wf.AppUser
          SET Username = @username, PasswordHash = @ph, DisplayName = @dn, Role = @role,
              RoleCode = @rc, IsActive = @isActive, EmpId = @empId, PositionCode = @pos,
              MustChangePassword = @mcp, AuthVersion = @av, SignatureFile = @sig, UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id AND Username = @username;
        ELSE
        BEGIN
          BEGIN TRY
            SET IDENTITY_INSERT wf.AppUser ON;
            INSERT INTO wf.AppUser (Id, Username, PasswordHash, DisplayName, Role, RoleCode, IsActive, EmpId, PositionCode, MustChangePassword, AuthVersion, SignatureFile)
            VALUES (@id, @username, @ph, @dn, @role, @rc, @isActive, @empId, @pos, @mcp, @av, @sig);
            SET IDENTITY_INSERT wf.AppUser OFF;
          END TRY
          BEGIN CATCH
            SET IDENTITY_INSERT wf.AppUser OFF;
            DECLARE @syncError NVARCHAR(2048) = ERROR_MESSAGE();
            RAISERROR(@syncError, 16, 1);
          END CATCH
        END
      `);
  }

  // 8. Sync UserRole
  // Target-only accounts retain their memberships.
  for (const u of users) {
    await tx.request().input('uid', sql.Int, u.Id)
      .query('DELETE FROM wf.UserRole WHERE UserId = @uid');
  }
  for (const ur of userRoles) {
    await tx.request()
      .input('uid', sql.Int, ur.UserId)
      .input('rc', sql.NVarChar(50), ur.RoleCode)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM wf.UserRole WHERE UserId = @uid AND RoleCode = @rc)
          INSERT INTO wf.UserRole (UserId, RoleCode) VALUES (@uid, @rc);
      `);
  }

  for (const u of users) {
    const after = { username: u.Username, displayName: u.DisplayName, role: u.Role, roleCode: u.RoleCode || null,
      isActive: Boolean(u.IsActive), empId: u.EmpId || null, positionCode: u.PositionCode || null,
      mustChangePassword: Boolean(u.MustChangePassword), authVersion: u.AuthVersion || 1,
      memberships: userRoles.filter(r => Number(r.UserId) === Number(u.Id)).map(r => r.RoleCode).sort() };
    const accountDetail = JSON.stringify({ syncId, identityServer: String(sourceContext.ServerName), identityDatabase: primaryDb,
      actorPrimaryId, effectivePrimaryId, targetServer: String(targetContext.ServerName), targetDatabase: cleanTarget,
      targetUserId: u.Id, before: beforeUsers.get(Number(u.Id)), after,
      rolePolicyEffects: effectsFor([beforeUsers.get(Number(u.Id))?.roleCode, beforeUsers.get(Number(u.Id))?.role, ...(beforeUsers.get(Number(u.Id))?.memberships || []), after.roleCode, after.role, ...after.memberships]),
      passwordHashCopied: true, signatureFileCopied: true });
    await tx.request().input('actor', sql.Int, actorPrimaryId).input('target', sql.NVarChar(100), String(u.Id))
      .input('detail', sql.NVarChar(sql.MAX), accountDetail)
      .query("INSERT INTO wf.AdminChangeAudit (ActorId, Action, Target, Detail) VALUES (@actor, 'USER_SYNC_ACCOUNT', @target, @detail)");
  }
  for (const targetUser of targetUsers.filter(u => !sourceUserIds.has(Number(u.Id)))) {
    const membership = targetMemberships.filter(m => Number(m.UserId) === Number(targetUser.Id)).map(m => m.RoleCode);
    const effects = effectsFor([targetUser.RoleCode, targetUser.Role, ...membership]);
    if (!effects.length) continue;
    const accountDetail = JSON.stringify({ syncId, identityServer: String(sourceContext.ServerName), identityDatabase: primaryDb,
      actorPrimaryId, effectivePrimaryId, targetServer: String(targetContext.ServerName), targetDatabase: cleanTarget,
      targetUserId: targetUser.Id, username: targetUser.Username, memberships: membership.sort(), rolePolicyEffects: effects });
    await tx.request().input('actor', sql.Int, actorPrimaryId).input('target', sql.NVarChar(100), String(targetUser.Id))
      .input('detail', sql.NVarChar(sql.MAX), accountDetail)
      .query("INSERT INTO wf.AdminChangeAudit (ActorId, Action, Target, Detail) VALUES (@actor, 'USER_SYNC_ROLE_EFFECT', @target, @detail)");
  }

  // Fail closed if the target lacks the audit table or this insert fails.
  // Never include password hashes or other credentials in the audit payload.
  const detail = JSON.stringify({ syncId, identityServer: String(sourceContext.ServerName), identityDatabase: primaryDb, actorPrimaryId, effectivePrimaryId,
    sourceDatabase: primaryDb, targetServer: String(targetContext.ServerName), targetDatabase: cleanTarget,
    counts: { users: users.length, roles: roles.length, permissions: perms.length, memberships: userRoles.length },
    sourceSnapshotConsistent: true, sourceMayChangeAfterSnapshot: true });
  await tx.request().input('actor', sql.Int, actorPrimaryId).input('target', sql.NVarChar(100), cleanTarget)
    .input('detail', sql.NVarChar(sql.MAX), detail)
    .query("INSERT INTO wf.AdminChangeAudit (ActorId, Action, Target, Detail) VALUES (@actor, 'USER_ROLE_SYNC', @target, @detail)");
  await tx.commit();
  return {
    ok: true,
    message: `ซิงค์บัญชีผู้ใช้และสิทธิ์ไปยังฐานข้อมูล ${cleanTarget} สำเร็จเรียบร้อย`,
    synced: {
      users: users.length,
      roles: roles.length,
      permissions: perms.length,
      memberships: userRoles.length,
    },
  };
  } catch (error) {
    try { await tx.rollback(); } catch (_) { /* preserve the original error */ }
    throw error;
  }
}

module.exports = { syncUsersToTarget };
