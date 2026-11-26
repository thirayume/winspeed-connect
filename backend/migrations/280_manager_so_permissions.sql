-- @transaction
-- Owner 25 Nov 2026: MANAGER joins the sales bill chain (SALES -> COUNTER_SALES -> MANAGER -> C_LEVEL -> ADMIN)
-- with so.create, so.edit and so.confirm. Logged in wf.RolePermissionGrant280 for exact rollback; no dbo changes.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.RoleProfile','U') IS NOT NULL AND OBJECT_ID('wf.RolePermission','U') IS NOT NULL
BEGIN
 IF OBJECT_ID('wf.RolePermissionGrant280','U') IS NULL
  CREATE TABLE wf.RolePermissionGrant280(
   RoleCode varchar(30) NOT NULL,
   PermissionCode varchar(80) NOT NULL,
   CONSTRAINT PK_RolePermissionGrant280 PRIMARY KEY(RoleCode,PermissionCode)
  );
 INSERT INTO wf.RolePermissionGrant280(RoleCode,PermissionCode)
 SELECT p.Code,g.PermissionCode
 FROM wf.RoleProfile p
 JOIN (
  SELECT 'MANAGER' AS BaseRole,'so.create' AS PermissionCode
  UNION ALL SELECT 'MANAGER','so.edit'
  UNION ALL SELECT 'MANAGER','so.confirm'
 ) g ON g.BaseRole=p.BaseRole
 WHERE p.Code=p.BaseRole
   AND NOT EXISTS(SELECT 1 FROM wf.RolePermission r WHERE r.RoleCode=p.Code AND r.PermissionCode=g.PermissionCode)
   AND NOT EXISTS(SELECT 1 FROM wf.RolePermissionGrant280 s WHERE s.RoleCode=p.Code AND s.PermissionCode=g.PermissionCode);
 INSERT INTO wf.RolePermission(RoleCode,PermissionCode)
 SELECT s.RoleCode,s.PermissionCode
 FROM wf.RolePermissionGrant280 s
 WHERE NOT EXISTS(SELECT 1 FROM wf.RolePermission r WHERE r.RoleCode=s.RoleCode AND r.PermissionCode=s.PermissionCode);
END
GO
