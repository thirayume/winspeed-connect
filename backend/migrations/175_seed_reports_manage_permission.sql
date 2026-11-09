-- @transaction
-- SQL Server 2008 R2 compatible. Idempotent.
-- เพิ่มสิทธิ์ 'reports.manage' ให้กับ Role ที่มีสิทธิ์จัดการแม่แบบและหัวกระดาษรายงาน
-- ได้แก่ ADMIN, C_LEVEL, MANAGER, ACCOUNTING

IF OBJECT_ID('wf.RolePermission', 'U') IS NOT NULL AND OBJECT_ID('wf.RoleProfile', 'U') IS NOT NULL
BEGIN
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode)
    SELECT p.Code, 'reports.manage'
    FROM wf.RoleProfile p
    WHERE p.BaseRole IN ('ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING')
      AND NOT EXISTS (
          SELECT 1 FROM wf.RolePermission rp
          WHERE rp.RoleCode = p.Code AND rp.PermissionCode = 'reports.manage'
      );
END;
