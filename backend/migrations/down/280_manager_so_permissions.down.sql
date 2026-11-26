-- @transaction
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.RolePermissionGrant280','U') IS NOT NULL
BEGIN
 IF OBJECT_ID('wf.RolePermission','U') IS NOT NULL
  DELETE p FROM wf.RolePermission p
  JOIN wf.RolePermissionGrant280 g ON g.RoleCode=p.RoleCode AND g.PermissionCode=p.PermissionCode;
 DROP TABLE wf.RolePermissionGrant280;
END
GO
