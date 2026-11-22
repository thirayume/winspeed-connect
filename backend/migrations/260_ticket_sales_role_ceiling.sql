-- @transaction
-- Owner 22 Nov 2026: SALES may request a cut, but may not issue new fertilizer tickets.
-- No WinSpeed objects or business rows change. Permission grants are logged for exact rollback.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.RolePermissionGrant260','U') IS NULL
 CREATE TABLE wf.RolePermissionGrant260(RoleCode varchar(30) NOT NULL, PermissionCode varchar(80) NOT NULL,
  CONSTRAINT PK_RolePermissionGrant260 PRIMARY KEY(RoleCode,PermissionCode));
INSERT wf.RolePermissionGrant260(RoleCode,PermissionCode)
 SELECT p.Code,'coupon.request116' FROM wf.RoleProfile p
 WHERE p.Code=p.BaseRole AND p.BaseRole IN('SALES','COUNTER_SALES','WAREHOUSE','ACCOUNTING','MANAGER','C_LEVEL','ADMIN')
 AND NOT EXISTS(SELECT 1 FROM wf.RolePermission r WHERE r.RoleCode=p.Code AND r.PermissionCode='coupon.request116')
 AND NOT EXISTS(SELECT 1 FROM wf.RolePermissionGrant260 r WHERE r.RoleCode=p.Code AND r.PermissionCode='coupon.request116');
INSERT wf.RolePermission(RoleCode,PermissionCode)
 SELECT g.RoleCode,g.PermissionCode FROM wf.RolePermissionGrant260 g
 WHERE NOT EXISTS(SELECT 1 FROM wf.RolePermission r WHERE r.RoleCode=g.RoleCode AND r.PermissionCode=g.PermissionCode);
GO
ALTER FUNCTION wf.fn_UserHasPermission(@UserId int,@Permission varchar(80)) RETURNS bit AS
BEGIN
 DECLARE @ok bit; SET @ok=0;
 IF NOT EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@UserId AND IsActive=1) RETURN 0;
 IF EXISTS(SELECT 1 FROM wf.vUserRole WHERE UserId=@UserId AND RoleCode='SEPARATION') RETURN 0;
 IF @Permission IN('so.create-native-delivery','so.control-ticket') AND NOT EXISTS(
   SELECT 1 FROM wf.vUserRole r JOIN wf.RoleProfile p ON p.Code=r.RoleCode
   WHERE r.UserId=@UserId AND p.BaseRole IN('COUNTER_SALES','APPROVER','ACCOUNTING','MANAGER','C_LEVEL','ADMIN')) RETURN 0;
 IF @Permission='coupon.manual116' AND NOT EXISTS(
   SELECT 1 FROM wf.vUserRole r JOIN wf.RoleProfile p ON p.Code=r.RoleCode
   WHERE r.UserId=@UserId AND p.BaseRole IN('COUNTER_SALES','APPROVER','WAREHOUSE','ACCOUNTING','MANAGER','C_LEVEL','ADMIN')) RETURN 0;
 IF EXISTS(SELECT 1 FROM wf.vUserRole r JOIN wf.RolePermission p ON p.RoleCode=r.RoleCode
   WHERE r.UserId=@UserId AND p.PermissionCode=@Permission) SET @ok=1;
 IF @ok=0 AND LEN(ISNULL(@Permission,''))>0 AND EXISTS(
   SELECT 1 FROM wf.vUserRole r JOIN wf.RoleProfile p ON p.Code=r.RoleCode
   WHERE r.UserId=@UserId AND p.BaseRole='ADMIN') SET @ok=1;
 RETURN @ok;
END
GO
