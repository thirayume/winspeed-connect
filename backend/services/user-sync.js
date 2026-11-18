'use strict';

/**
 * user-sync.js — Cross-Database User & Role Synchronization (Single Auth Authority)
 * Synchronizes wf.AppUser, wf.RoleProfile, wf.RolePermission, and wf.UserRole
 * from the Primary Database (dbwins_worldfert9) to any switchable target database.
 */

const { sql, pools } = require('../db');
const { primaryDatabase, primaryOwnerPool, onpremEnabled } = require('./active-database');
const { isSwitchableDb } = require('../onprem-target');

async function syncUsersToTarget(targetDbName) {
  if (!targetDbName || typeof targetDbName !== 'string') {
    throw Object.assign(new Error('INVALID_TARGET_DB'), { status: 400, message: 'ระบุชื่อฐานข้อมูลปลายทาง' });
  }
  const cleanTarget = targetDbName.trim();
  const primaryDb = primaryDatabase();

  if (cleanTarget.toLowerCase() === primaryDb.toLowerCase()) {
    return { ok: true, message: 'ฐานข้อมูลปลายทางเป็นฐานหลักอยู่แล้ว ไม่จำเป็นต้องซิงค์', affected: 0 };
  }

  if (onpremEnabled() && !isSwitchableDb(cleanTarget)) {
    throw Object.assign(new Error('DB_NOT_ALLOWED'), { status: 403, message: 'ฐานข้อมูลปลายทางไม่อยู่ในรายการที่อนุญาต' });
  }

  // 1. Fetch source rows from Primary Database
  const srcPool = await primaryOwnerPool();

  const [rolesRs, permsRs, usersRs, userRolesRs] = await Promise.all([
    srcPool.request().query('SELECT Code, Name, BaseRole, Description, IsActive, Revision FROM wf.RoleProfile'),
    srcPool.request().query('SELECT RoleCode, PermissionCode FROM wf.RolePermission'),
    srcPool.request().query(`
      SELECT Id, Username, PasswordHash, DisplayName, Role, RoleCode, IsActive, EmpId,
             PositionCode, MustChangePassword, AuthVersion, SignatureFile
      FROM wf.AppUser
    `),
    srcPool.request().query('SELECT UserId, RoleCode FROM wf.UserRole'),
  ]);

  const roles = rolesRs.recordset || [];
  const perms = permsRs.recordset || [];
  const users = usersRs.recordset || [];
  const userRoles = userRolesRs.recordset || [];

  // 2. Connect to Target Database
  const tgtEntry = pools('onprem', cleanTarget);
  await tgtEntry.ready;
  const tgtPool = tgtEntry.ownerPool;
  const tx = new sql.Transaction(tgtPool);
  await tx.begin();
  try {

  // 3. Ensure schema wf exists on target
  await tx.request().batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'wf')
    BEGIN
      EXEC('CREATE SCHEMA wf');
    END
  `);

  // 4. Ensure tables exist on target (basic DDL check)
  await tx.request().batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'wf' AND t.name = 'RoleProfile')
    BEGIN
      CREATE TABLE wf.RoleProfile (
        Code NVARCHAR(50) NOT NULL PRIMARY KEY,
        Name NVARCHAR(100) NOT NULL,
        BaseRole NVARCHAR(50) NOT NULL,
        Description NVARCHAR(250) NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        Revision INT NOT NULL DEFAULT 0,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'wf' AND t.name = 'RolePermission')
    BEGIN
      CREATE TABLE wf.RolePermission (
        RoleCode NVARCHAR(50) NOT NULL,
        PermissionCode NVARCHAR(100) NOT NULL,
        CONSTRAINT PK_RolePermission PRIMARY KEY (RoleCode, PermissionCode)
      );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'wf' AND t.name = 'AppUser')
    BEGIN
      CREATE TABLE wf.AppUser (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Username NVARCHAR(50) NOT NULL UNIQUE,
        PasswordHash NVARCHAR(255) NOT NULL,
        DisplayName NVARCHAR(100) NOT NULL,
        Role NVARCHAR(50) NOT NULL,
        RoleCode NVARCHAR(50) NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        EmpId NVARCHAR(20) NULL,
        PositionCode NVARCHAR(50) NULL,
        MustChangePassword BIT NOT NULL DEFAULT 0,
        AuthVersion INT NOT NULL DEFAULT 1,
        SignatureFile NVARCHAR(255) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'wf' AND t.name = 'UserRole')
    BEGIN
      CREATE TABLE wf.UserRole (
        UserId INT NOT NULL,
        RoleCode NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_UserRole PRIMARY KEY (UserId, RoleCode)
      );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.views v JOIN sys.schemas s ON v.schema_id = s.schema_id WHERE s.name = 'wf' AND v.name = 'vUserRole')
    BEGIN
      EXEC('
        CREATE VIEW wf.vUserRole AS
        SELECT UserId, RoleCode FROM wf.UserRole
        UNION
        SELECT Id AS UserId, RoleCode FROM wf.AppUser WHERE RoleCode IS NOT NULL AND RoleCode <> ''''
      ');
    END;
  `);

  // Lock the matching keys until commit. Reusing either an ID or username
  // for a different person cannot be repaired by overwriting the target row:
  // existing documents and audit records already refer to those IDs.
  for (const u of users) {
    const found = await tx.request().input('id', sql.Int, u.Id).input('username', sql.NVarChar(50), u.Username)
      .input('empId', sql.NVarChar(20), u.EmpId == null ? null : String(u.EmpId))
      .query(`SELECT Id, CASE WHEN Id=@id AND Username=@username
                AND ISNULL(NULLIF(RTRIM(CONVERT(NVARCHAR(20),EmpId)),''),'')=ISNULL(NULLIF(RTRIM(@empId),''),'')
                THEN 1 ELSE 0 END AS IsExact
              FROM wf.AppUser WITH (UPDLOCK, HOLDLOCK) WHERE Id=@id OR Username=@username`);
    const rows = found.recordset || [];
    if (rows.length > 1 || (rows.length === 1 && Number(rows[0].IsExact) !== 1)) {
      throw Object.assign(new Error('พบข้อมูลบัญชีที่ ID หรือ Username ไม่ตรงกันระหว่างฐาน กรุณาตรวจจับคู่ก่อนซิงค์'),
        { status: 409, code: 'SYNC_IDENTITY_CONFLICT' });
    }
  }

  // 5. Sync RoleProfile
  for (const r of roles) {
    await tx.request()
      .input('code', sql.NVarChar(50), r.Code)
      .input('name', sql.NVarChar(100), r.Name)
      .input('baseRole', sql.NVarChar(50), r.BaseRole)
      .input('desc', sql.NVarChar(250), r.Description || null)
      .input('isActive', sql.Bit, r.IsActive ? 1 : 0)
      .input('rev', sql.Int, r.Revision || 0)
      .query(`
        IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = @code)
          UPDATE wf.RoleProfile
          SET Name = @name, BaseRole = @baseRole, Description = @desc, IsActive = @isActive, Revision = @rev, UpdatedAt = SYSUTCDATETIME()
          WHERE Code = @code;
        ELSE
          INSERT INTO wf.RoleProfile (Code, Name, BaseRole, Description, IsActive, Revision)
          VALUES (@code, @name, @baseRole, @desc, @isActive, @rev);
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
