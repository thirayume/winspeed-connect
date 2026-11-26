-- @transaction
-- Read-only authority primitives for native 116 admission. This migration does
-- not enable direct saves, install hooks, grant a permit or change native data.
-- WinSpeed's PFC identity is distinct from the declared SaveEmpID and AppUser.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.fn_Native116Permission','FN') IS NULL
 EXEC('CREATE FUNCTION wf.fn_Native116Permission(@login varchar(100)) RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_Native116Permission(@login varchar(100)) RETURNS bit AS
BEGIN
 IF NULLIF(LTRIM(RTRIM(@login)),'') IS NULL RETURN 0;
 -- A group or an ambiguous/unknown native login is never an operator.
 IF (SELECT COUNT(*) FROM dbo.security_users WHERE name=@login)<>1
  OR NOT EXISTS(SELECT 1 FROM dbo.security_users WHERE name=@login AND user_type=0) RETURN 0;
 DECLARE @rules TABLE(Priority int NOT NULL,Status char(1) NOT NULL);
 -- PFC appends individual and direct-group rows, sorts priority ascending,
 -- and uses the first rule for the control. Never infer permission from an
 -- AppUser ADMIN role or from a missing rule. Keep the leading window space.
 INSERT @rules(Priority,Status)
 SELECT u.priority,i.status FROM dbo.security_info i
 JOIN dbo.security_users u ON u.name=i.user_name
 WHERE i.application='emapp' AND i.[window]=' Menu SO Data Entry'
  AND i.control=N'ตัดตั๋วปุ๋ย (WF)'
  AND ((u.name=@login AND u.user_type=0) OR (u.user_type=1 AND EXISTS(
   SELECT 1 FROM dbo.security_groupings g WHERE g.user_name=@login AND g.group_name=u.name)));
 DECLARE @priority int;SELECT @priority=MIN(Priority) FROM @rules;
 IF @priority IS NULL RETURN 0;
 -- The vendor build's equal-priority tie order is not an identity guarantee.
 -- A disabled, invisible or unknown winning status blocks admission.
 IF EXISTS(SELECT 1 FROM @rules WHERE Priority=@priority AND Status<>'E') RETURN 0;
 RETURN 1;
END;
GO
IF OBJECT_ID('wf.sp_ResolveNative116Operator','P') IS NULL
 EXEC('CREATE PROCEDURE wf.sp_ResolveNative116Operator AS RETURN');
GO
ALTER PROCEDURE wf.sp_ResolveNative116Operator
 @login varchar(100),@user int OUTPUT,@emp int OUTPUT,@proof nvarchar(max) OUTPUT AS
BEGIN
 SET NOCOUNT ON;SET ANSI_WARNINGS ON;SET ARITHABORT ON;
 SET @user=NULL;SET @emp=NULL;SET @proof=NULL;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1
 BEGIN RAISERROR('NATIVE_116_AUTHORITY_TRANSACTION_REQUIRED',16,1);RETURN;END;
 -- The eventual admission hook must provide the native audit username from
 -- this operation's bound SQL connection, never a request body or SaveEmpID.
 -- Lock metadata in the caller's transaction so revocation cannot race final
 -- settlement. Credential columns are neither selected nor copied.
 DECLARE @nativeUsers xml,@groups xml,@rules xml;
 SET @nativeUsers=(SELECT name,priority,user_type FROM dbo.security_users WITH(HOLDLOCK)
  WHERE name=@login OR name IN(SELECT group_name FROM dbo.security_groupings WITH(HOLDLOCK) WHERE user_name=@login)
  ORDER BY name FOR XML RAW('principal'),TYPE);
 SET @groups=(SELECT group_name FROM dbo.security_groupings WITH(HOLDLOCK) WHERE user_name=@login
  ORDER BY group_name FOR XML RAW('group'),TYPE);
 SET @rules=(SELECT application,[window],control,user_name,status FROM dbo.security_info WITH(HOLDLOCK)
  WHERE application='emapp' AND [window]=' Menu SO Data Entry' AND control=N'ตัดตั๋วปุ๋ย (WF)'
   AND(user_name=@login OR user_name IN(SELECT group_name FROM dbo.security_groupings WITH(HOLDLOCK) WHERE user_name=@login))
  ORDER BY user_name,status FOR XML RAW('rule'),TYPE);
 IF wf.fn_Native116Permission(@login)<>1
 BEGIN RAISERROR('NATIVE_116_OPERATOR_PERMISSION_DENIED',16,1);RETURN;END;
 IF (SELECT COUNT(*) FROM dbo.EMEmp WITH(UPDLOCK,HOLDLOCK)
  WHERE username=@login AND EmpStatus='1' AND EmpResignDate IS NULL)<>1
 BEGIN RAISERROR('NATIVE_116_EMPLOYEE_MAPPING_REQUIRED',16,1);RETURN;END;
 SELECT @emp=EmpID FROM dbo.EMEmp WHERE username=@login AND EmpStatus='1' AND EmpResignDate IS NULL;
 IF (SELECT COUNT(*) FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK)
  WHERE EmpId=CONVERT(varchar(20),@emp) AND IsActive=1)<>1
 BEGIN SET @emp=NULL;RAISERROR('NATIVE_116_ACCOUNT_MAPPING_REQUIRED',16,1);RETURN;END;
 SELECT @user=Id FROM wf.AppUser WHERE EmpId=CONVERT(varchar(20),@emp) AND IsActive=1;
 SET @proof=CONVERT(nvarchar(max),(SELECT @nativeUsers AS Principals,@groups AS Groups,@rules AS Rules,
  @emp AS NativeEmployeeId,@user AS OrganizationUserId FOR XML RAW('nativeAuthority'),TYPE));
END;
GO
-- These are internal primitives, not an API for authenticating an arbitrary
-- username. The native SQL admission hook executes them through ownership.
DENY EXECUTE ON OBJECT::wf.fn_Native116Permission TO public;
DENY EXECUTE ON OBJECT::wf.sp_ResolveNative116Operator TO public;
GO
