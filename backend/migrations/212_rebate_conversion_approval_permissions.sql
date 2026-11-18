-- Separate, role-configurable permissions for the owner-approved request and
-- decision workflow. This migration does not create requests or move money.
IF OBJECT_ID('wf.RoleProfile','U') IS NULL OR OBJECT_ID('wf.RolePermission','U') IS NULL
  RAISERROR('Role Management tables are required',16,1);
ELSE
BEGIN
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code='SALES')
    AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode='SALES' AND PermissionCode='rebate.conversion.request')
    INSERT INTO wf.RolePermission(RoleCode,PermissionCode) VALUES('SALES','rebate.conversion.request');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code='MANAGER')
    AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode='MANAGER' AND PermissionCode='rebate.conversion.approve')
    INSERT INTO wf.RolePermission(RoleCode,PermissionCode) VALUES('MANAGER','rebate.conversion.approve');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code='C_LEVEL')
    AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode='C_LEVEL' AND PermissionCode='rebate.conversion.approve')
    INSERT INTO wf.RolePermission(RoleCode,PermissionCode) VALUES('C_LEVEL','rebate.conversion.approve');
END;
GO
