-- @transaction
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.RolePermissionGrant260','U') IS NOT NULL
BEGIN
 DELETE p FROM wf.RolePermission p JOIN wf.RolePermissionGrant260 g ON g.RoleCode=p.RoleCode AND g.PermissionCode=p.PermissionCode;
 DROP TABLE wf.RolePermissionGrant260;
END
GO
ALTER FUNCTION wf.fn_UserHasPermission(@UserId int,@Permission varchar(80)) RETURNS bit AS
 BEGIN DECLARE @ok bit; SET @ok=0;
 IF EXISTS(SELECT 1 FROM wf.vUserRole r JOIN wf.RolePermission p ON p.RoleCode=r.RoleCode
 JOIN wf.AppUser u ON u.Id=r.UserId WHERE r.UserId=@UserId AND u.IsActive=1 AND p.PermissionCode=@Permission) SET @ok=1;
 IF @ok=0 AND LEN(ISNULL(@Permission,''))>0
  AND EXISTS(SELECT 1 FROM wf.vUserRole r JOIN wf.RoleProfile p ON p.Code=r.RoleCode JOIN wf.AppUser u ON u.Id=r.UserId
   WHERE r.UserId=@UserId AND u.IsActive=1 AND p.BaseRole='ADMIN')
  AND NOT EXISTS(SELECT 1 FROM wf.vUserRole s WHERE s.UserId=@UserId AND s.RoleCode='SEPARATION') SET @ok=1;
 RETURN @ok; END
GO
