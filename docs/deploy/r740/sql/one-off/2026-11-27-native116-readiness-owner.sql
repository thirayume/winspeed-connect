-- R740 release prerequisite for immutable migration 284 (SQL 15151).
-- Run as the approved SQL administrator in the selected company database.
-- Creates only a false-returning wf stub when absent, then assigns that one
-- function to the existing least-privilege migrator. No dbo impersonation,
-- login/role change, migration-ledger write, business write or Rebate Reset.
-- An outer transaction may execute this whole script and roll it back for QA.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF @@SERVERNAME<>N'R740-SRV\SQL2008' OR IS_SRVROLEMEMBER('sysadmin')<>1
 OR DB_NAME() NOT IN(N'dbwins_worldfert9_uat',N'dbwins_worldfert9',N'dbwins_worldfert2')
BEGIN RAISERROR('NATIVE116_OWNER_PREREQUISITE_TARGET_INVALID',16,1);RETURN;END;
DECLARE @migrator sysname,@actor int,@changed bit;
SELECT @migrator=CASE WHEN DB_NAME()=N'dbwins_worldfert9_uat' THEN N'wf_r740_uat_migrator_v2' ELSE N'wf_r740_prod_migrator' END,@changed=0;
IF USER_ID(@migrator) IS NULL OR IS_ROLEMEMBER('db_owner',@migrator)<>0
BEGIN RAISERROR('NATIVE116_OWNER_MIGRATOR_INVALID',16,1);RETURN;END;
SELECT @actor=u.Id FROM wf.AppUser u WHERE u.Username='admin' AND u.IsActive=1
 AND EXISTS(SELECT 1 FROM wf.vUserRole r WHERE r.UserId=u.Id AND r.RoleCode='ADMIN');
IF @actor IS NULL OR(SELECT COUNT(*) FROM wf.AppUser WHERE Username='admin')<>1
BEGIN RAISERROR('NATIVE116_OWNER_ADMIN_REVIEW_REQUIRED',16,1);RETURN;END;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID(N'wf.fn_Native116HooksReady',N'FN') IS NULL
 BEGIN
  EXEC(N'CREATE FUNCTION wf.fn_Native116HooksReady() RETURNS bit AS BEGIN RETURN 0;END');
  SET @changed=1;
 END;
 -- BEGIN REVIEWED NATIVE116 OWNER REMAP
 DECLARE @native_ready_expected nvarchar(max),@native_ready_actual nvarchar(max),@native_ready_owner sysname,@native_ready_exec int;
 SET @native_ready_expected=N'ALTER FUNCTION wf.fn_Native116HooksReady() RETURNS bit WITH EXECUTE AS OWNER AS
BEGIN
 DECLARE @module char(64);SELECT @module=ModulesHash FROM wf.Native116Contract WHERE Version=''NATIVE-116-DIRECT-v1'';
 IF @module IS NULL OR(SELECT COUNT(*) FROM wf.Native116HookContract)<>5 RETURN 0;
 IF EXISTS(SELECT 1 FROM wf.Native116HookContract e LEFT JOIN sys.triggers t ON t.name=e.TriggerName AND t.parent_id=OBJECT_ID(''dbo.''+e.TableName)
  LEFT JOIN sys.sql_modules m ON m.object_id=t.object_id
  WHERE e.ModulesHash<>@module OR t.object_id IS NULL OR t.is_disabled<>0 OR m.definition IS NULL
   OR REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)) COLLATE Latin1_General_BIN2<>e.ExpectedDefinition COLLATE Latin1_General_BIN2
   OR DATALENGTH(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)))<>DATALENGTH(e.ExpectedDefinition)) RETURN 0;
 IF OBJECTPROPERTY(OBJECT_ID(''dbo.WF_CouponNativeEditHeadHook''),''ExecIsFirstDeleteTrigger'')<>1
  OR OBJECTPROPERTY(OBJECT_ID(''dbo.WF_CouponNativeConsume''),''ExecIsFirstUpdateTrigger'')<>1
  OR OBJECTPROPERTY(OBJECT_ID(''dbo.WF_Native116AuditHook''),''ExecIsLastInsertTrigger'')<>1 RETURN 0;
 RETURN 1;
END;';
 SET @native_ready_expected=LTRIM(RTRIM(REPLACE(@native_ready_expected,CHAR(13),N'')));
 SELECT @native_ready_actual=LTRIM(RTRIM(REPLACE(m.definition,CHAR(13),N''))),
  @native_ready_owner=USER_NAME(COALESCE(o.principal_id,s.principal_id)),@native_ready_exec=m.execute_as_principal_id
 FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.sql_modules m ON m.object_id=o.object_id
 WHERE o.object_id=OBJECT_ID(N'wf.fn_Native116HooksReady',N'FN');
 WHILE LEFT(@native_ready_actual,1) IN(NCHAR(10),NCHAR(13)) SET @native_ready_actual=SUBSTRING(@native_ready_actual,2,LEN(@native_ready_actual));
 WHILE RIGHT(@native_ready_actual,1) IN(NCHAR(10),NCHAR(13)) SET @native_ready_actual=LEFT(@native_ready_actual,LEN(@native_ready_actual)-1);
 SET @native_ready_actual=REPLACE(@native_ready_actual,N'CREATE FUNCTION ',N'ALTER FUNCTION ');
 IF @native_ready_owner NOT IN(N'dbo',N'wf_r740_prod_migrator',N'wf_r740_uat_migrator_v2') OR @native_ready_owner IS NULL
  OR NOT((@native_ready_actual COLLATE Latin1_General_BIN2=@native_ready_expected COLLATE Latin1_General_BIN2 AND DATALENGTH(@native_ready_actual)=DATALENGTH(@native_ready_expected) AND @native_ready_exec=-2)
   OR(@native_ready_actual COLLATE Latin1_General_BIN2=N'ALTER FUNCTION wf.fn_Native116HooksReady() RETURNS bit AS BEGIN RETURN 0;END' COLLATE Latin1_General_BIN2 AND @native_ready_exec IS NULL))
  RAISERROR(N'STOP: native116 readiness differs from the reviewed boolean-only function.',16,1);
 IF EXISTS(SELECT 1 FROM sys.database_permissions WHERE class=1 AND major_id=OBJECT_ID(N'wf.fn_Native116HooksReady')
  AND NOT(grantee_principal_id=DATABASE_PRINCIPAL_ID(N'public') AND permission_name=N'EXECUTE' AND state='G'))
  RAISERROR(N'STOP: native116 readiness has unexpected object permissions.',16,1);
 IF @native_ready_owner<>@migrator
 BEGIN
  IF @migrator=N'wf_r740_uat_migrator_v2'
   ALTER AUTHORIZATION ON OBJECT::wf.fn_Native116HooksReady TO [wf_r740_uat_migrator_v2];
  ELSE ALTER AUTHORIZATION ON OBJECT::wf.fn_Native116HooksReady TO [wf_r740_prod_migrator];
 END;
 -- Ownership transfer drops object grants: restore only the reviewed boolean EXECUTE.
 GRANT EXECUTE ON OBJECT::wf.fn_Native116HooksReady TO public;
 -- END REVIEWED NATIVE116 OWNER REMAP
 IF @native_ready_owner<>@migrator SET @changed=1;
 IF @changed=1
  INSERT wf.AdminChangeAudit(ActorId,Action,Target,Detail)
  VALUES(@actor,'NATIVE116_READINESS_OWNER',DB_NAME()+N'.wf.fn_Native116HooksReady',
   N'Owner-authorized release prerequisite; SQL principal='+ORIGINAL_LOGIN()+N'; previous function owner='+@native_ready_owner+N'; new function owner='+@migrator+N'; no dbo impersonation or business write');
 COMMIT TRANSACTION;
 SELECT 'NATIVE116_OWNER_READY' Result,DB_NAME() DatabaseName,@migrator FunctionOwner,@changed Changed;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 DECLARE @message nvarchar(2048);SET @message=ERROR_MESSAGE();RAISERROR('%s',16,1,@message);
END CATCH;
