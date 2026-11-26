-- @transaction
-- Position-based record scope and independently editable sales/promotion areas.
-- Staff assignments and names are owner data, never seeded in a public migration.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('wf.OrgPosition','RecordScope') IS NULL
BEGIN
 ALTER TABLE wf.OrgPosition ADD RecordScope varchar(8) NOT NULL CONSTRAINT DF_OrgPosition_RecordScope DEFAULT 'ORG';
 EXEC(N'UPDATE wf.OrgPosition SET RecordScope=''GLOBAL'' WHERE DefaultRole IN(''ACCOUNTING'',''WAREHOUSE'',''WEIGHBRIDGE'',''COUNTER_SALES'')');
 EXEC(N'ALTER TABLE wf.OrgPosition ADD CONSTRAINT CK_OrgPosition_RecordScope CHECK(RecordScope IN(''ORG'',''GLOBAL''))');
END;
IF OBJECT_ID('wf.SalesTerritory','U') IS NULL
 CREATE TABLE wf.SalesTerritory(
  TerritoryCode varchar(30) NOT NULL PRIMARY KEY,
  TerritoryName nvarchar(100) NOT NULL,
  TerritoryType varchar(12) NOT NULL CHECK(TerritoryType IN('SALE','PROMOTION')),
  OwnerUserId int NOT NULL REFERENCES wf.AppUser(Id),
  IsActive bit NOT NULL DEFAULT 1,
  Revision int NOT NULL DEFAULT 1,
  UpdatedAt datetime NOT NULL DEFAULT GETUTCDATE(),UpdatedBy int NOT NULL REFERENCES wf.AppUser(Id)
 );
IF OBJECT_ID('wf.SalesTerritoryProvince','U') IS NULL
 CREATE TABLE wf.SalesTerritoryProvince(
  TerritoryCode varchar(30) NOT NULL REFERENCES wf.SalesTerritory(TerritoryCode),
  Province nvarchar(50) NOT NULL,
  CONSTRAINT PK_SalesTerritoryProvince PRIMARY KEY(TerritoryCode,Province)
 );
IF OBJECT_ID('wf.fn_UserScopeAll','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_UserScopeAll(@id int) RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_UserScopeAll(@id int) RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@id AND IsActive=1) RETURN 0;
 IF wf.fn_UserHasRole(@id,'ADMIN')=1 RETURN 1;
 IF EXISTS(SELECT 1 FROM wf.AppUser u JOIN wf.OrgPosition p ON p.PositionCode=u.PositionCode
  WHERE u.Id=@id AND p.IsActive=1 AND p.RecordScope='GLOBAL') RETURN 1;
 IF EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@id AND PositionCode IS NULL)
  AND(wf.fn_UserHasRole(@id,'ACCOUNTING')=1 OR wf.fn_UserHasRole(@id,'WAREHOUSE')=1
   OR wf.fn_UserHasRole(@id,'WEIGHBRIDGE')=1 OR wf.fn_UserHasRole(@id,'COUNTER_SALES')=1) RETURN 1;
 RETURN 0;
END;
GO
IF OBJECT_ID('wf.fn_UserInOrganizationScope','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_UserInOrganizationScope(@id int,@owner int,@emp int) RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_UserInOrganizationScope(@id int,@owner int,@emp int) RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@id AND IsActive=1) RETURN 0;
 IF wf.fn_UserScopeAll(@id)=1 RETURN 1;
 IF @owner=@id OR EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@id AND EmpId=CONVERT(varchar(20),@emp)) RETURN 1;
 DECLARE @root varchar(30),@depth int;SET @depth=0;
 SELECT @root=u.PositionCode FROM wf.AppUser u JOIN wf.OrgPosition p ON p.PositionCode=u.PositionCode AND p.IsActive=1 WHERE u.Id=@id;
 IF @root IS NULL RETURN 0;
 DECLARE @positions TABLE(PositionCode varchar(30) PRIMARY KEY,Depth int);
 INSERT @positions VALUES(@root,0);
 WHILE @depth<32
 BEGIN
  INSERT @positions SELECT p.PositionCode,@depth+1 FROM wf.OrgPosition p
   WHERE p.IsActive=1 AND p.ReportsTo IN(SELECT PositionCode FROM @positions WHERE Depth=@depth)
    AND NOT EXISTS(SELECT 1 FROM @positions x WHERE x.PositionCode=p.PositionCode);
  IF @@ROWCOUNT=0 BREAK;
  SET @depth=@depth+1;
 END;
 IF EXISTS(SELECT 1 FROM wf.AppUser u JOIN @positions p ON p.PositionCode=u.PositionCode AND p.Depth>0
  WHERE u.Id=@owner OR u.EmpId=CONVERT(varchar(20),@emp)) RETURN 1;
 RETURN 0;
END;
GO
IF OBJECT_ID('wf.fn_IsOrganizationSuperior','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_IsOrganizationSuperior(@supervisor int,@employee int) RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_IsOrganizationSuperior(@supervisor int,@employee int) RETURNS bit AS
BEGIN
 IF @supervisor=@employee RETURN 0;
 DECLARE @parent varchar(30),@position varchar(30),@depth int;SET @depth=0;
 SELECT @position=u.PositionCode FROM wf.AppUser u JOIN wf.OrgPosition p ON p.PositionCode=u.PositionCode
  WHERE u.Id=@supervisor AND u.IsActive=1 AND p.IsActive=1 AND p.CanApprove=1;
 IF @position IS NULL RETURN 0;
 SELECT @parent=p.ReportsTo FROM wf.AppUser u JOIN wf.OrgPosition p ON p.PositionCode=u.PositionCode
  WHERE u.Id=@employee AND u.IsActive=1 AND p.IsActive=1;
 DECLARE @seen TABLE(PositionCode varchar(30) PRIMARY KEY);
 WHILE @parent IS NOT NULL AND @depth<32
 BEGIN
  IF EXISTS(SELECT 1 FROM @seen WHERE PositionCode=@parent) RETURN 0;
  IF NOT EXISTS(SELECT 1 FROM wf.OrgPosition WHERE PositionCode=@parent AND IsActive=1) RETURN 0;
  IF @parent=@position RETURN 1;
  INSERT @seen VALUES(@parent);
  SELECT @parent=ReportsTo FROM wf.OrgPosition WHERE PositionCode=@parent;
  SET @depth=@depth+1;
 END;
 RETURN 0;
END;
GO
IF OBJECT_ID('wf.sp_ValidateEmployeeLink','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_ValidateEmployeeLink AS RETURN');
GO
ALTER PROCEDURE wf.sp_ValidateEmployeeLink @user int,@emp int,@expected nvarchar(20)=NULL,@checkExpected bit=0 AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT<1 BEGIN RAISERROR('EMPLOYEE_LINK_TRANSACTION_REQUIRED',16,1);RETURN;END;
 IF @emp IS NOT NULL AND(NOT EXISTS(SELECT 1 FROM dbo.EMEmp WITH(UPDLOCK,HOLDLOCK) WHERE EmpID=@emp AND EmpStatus='1')
   OR EXISTS(SELECT 1 FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE EmpId=CONVERT(nvarchar(20),@emp) AND Id<>ISNULL(@user,0)))
 BEGIN RAISERROR('EMPLOYEE_MISSING_OR_ALREADY_LINKED',16,1);RETURN;END;
 IF @checkExpected=1 AND NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@user
  AND ISNULL(NULLIF(RTRIM(EmpId),''),'')=ISNULL(NULLIF(RTRIM(@expected),''),''))
 BEGIN RAISERROR('EMPLOYEE_LINK_CHANGED',16,1);RETURN;END;
END;
GO
IF OBJECT_ID('wf.fn_OrganizationJsonQuote','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_OrganizationJsonQuote(@value nvarchar(max)) RETURNS nvarchar(max) AS BEGIN RETURN NULL;END');
GO
ALTER FUNCTION wf.fn_OrganizationJsonQuote(@value nvarchar(max)) RETURNS nvarchar(max) AS
BEGIN
 IF @value IS NULL RETURN N'null';
 DECLARE @i int,@hex varchar(16),@out nvarchar(max),@ch nvarchar(1),@code int;SET @i=1;SET @hex='0123456789abcdef';SET @out=N'"';
 WHILE @i<=DATALENGTH(@value)/2 BEGIN
  SET @ch=SUBSTRING(@value,@i,1);SET @code=UNICODE(@ch);
  SET @out=@out+CASE WHEN @ch=N'\' THEN N'\\' WHEN @ch=N'"' THEN N'\"'
   WHEN @code<32 THEN N'\u00'+SUBSTRING(@hex,@code/16+1,1)+SUBSTRING(@hex,@code%16+1,1) ELSE @ch END;
  SET @i=@i+1;
 END;
 RETURN @out+N'"';
END;
GO
IF OBJECT_ID('wf.sp_OrganizationSaveEmployee','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_OrganizationSaveEmployee AS RETURN');
GO
ALTER PROCEDURE wf.sp_OrganizationSaveEmployee
 @code varchar(25),@name nvarchar(255),@title nvarchar(50)=NULL,@headCode varchar(25)=NULL,
 @expected nvarchar(max),@create bit=0,@actor int,@reason nvarchar(500),@saved int OUTPUT AS
BEGIN
 SET NOCOUNT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1 BEGIN RAISERROR('EMPLOYEE_TRANSACTION_REQUIRED',16,1);RETURN;END;
 IF NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@actor AND IsActive=1)
  OR wf.fn_UserHasRole(@actor,'ADMIN')<>1 OR wf.fn_UserHasPermission(@actor,'users.manage')<>1
 BEGIN RAISERROR('EMPLOYEE_ADMIN_REQUIRED',16,1);RETURN;END;
 SET @code=UPPER(LTRIM(RTRIM(@code)));SET @name=LTRIM(RTRIM(@name));SET @title=NULLIF(LTRIM(RTRIM(@title)),N'');
 IF NULLIF(@code,'') IS NULL OR NULLIF(@name,N'') IS NULL OR LEN(LTRIM(RTRIM(ISNULL(@reason,N''))))<10
 BEGIN RAISERROR('EMPLOYEE_PROFILE_INVALID',16,1);RETURN;END;
 IF NOT EXISTS(SELECT 1 FROM sys.triggers WHERE parent_id=OBJECT_ID('dbo.EMEmp') AND name='tI_EMEmp' AND is_disabled=0)
  OR NOT EXISTS(SELECT 1 FROM sys.triggers WHERE parent_id=OBJECT_ID('dbo.EMEmp') AND name='tU_EMEmp' AND is_disabled=0)
 BEGIN RAISERROR('EMPLOYEE_NATIVE_TRIGGERS_REQUIRED',16,1);RETURN;END;
 DECLARE @head int,@next int,@depth int,@before nvarchar(max),@after nvarchar(max),@snapshot xml;
 SELECT @saved=EmpID FROM dbo.EMEmp WITH(UPDLOCK,HOLDLOCK) WHERE UPPER(RTRIM(EmpCode))=@code;
 IF (SELECT COUNT(*) FROM dbo.EMEmp WITH(UPDLOCK,HOLDLOCK) WHERE UPPER(RTRIM(EmpCode))=@code)>1
 BEGIN RAISERROR('EMPLOYEE_CODE_AMBIGUOUS',16,1);RETURN;END;
 IF @headCode IS NOT NULL BEGIN
  IF(SELECT COUNT(*) FROM dbo.EMEmp WITH(UPDLOCK,HOLDLOCK) WHERE UPPER(RTRIM(EmpCode))=UPPER(RTRIM(@headCode)) AND EmpStatus='1')<>1
  BEGIN RAISERROR('EMPLOYEE_HEAD_INVALID',16,1);RETURN;END;
  SELECT @head=EmpID FROM dbo.EMEmp WHERE UPPER(RTRIM(EmpCode))=UPPER(RTRIM(@headCode)) AND EmpStatus='1';
 END;
 SET @next=@head;SET @depth=0;
 DECLARE @seen TABLE(Id int PRIMARY KEY);
 WHILE @next IS NOT NULL BEGIN
  IF @next=@saved OR @depth>=32 OR EXISTS(SELECT 1 FROM @seen WHERE Id=@next)
  BEGIN RAISERROR('EMPLOYEE_HEAD_CYCLE',16,1);RETURN;END;
  INSERT @seen VALUES(@next);SET @depth=@depth+1;
  SELECT @next=EmpHead FROM dbo.EMEmp WITH(UPDLOCK,HOLDLOCK) WHERE EmpID=@next;
 END;
 IF @saved IS NOT NULL BEGIN
  SET @snapshot=(SELECT EmpID,EmpCode,EmpName,EmpTitle,EmpHead,EmpStatus,EmpType FROM dbo.EMEmp WHERE EmpID=@saved FOR XML RAW('employee'),TYPE);
  SET @before=CONVERT(nvarchar(max),@snapshot);
  IF @create=1 OR @expected IS NULL OR @expected<>@before
  BEGIN RAISERROR('EMPLOYEE_PROFILE_CHANGED',16,1);RETURN;END;
  -- Never update EmpID: WinSpeed's trigger cascades that key into historical documents.
  UPDATE dbo.EMEmp SET EmpName=@name,EmpTitle=@title,EmpHead=@head WHERE EmpID=@saved;
 END
 ELSE BEGIN
  IF @create<>1 OR ISNULL(@expected,N'')<>N'' BEGIN RAISERROR('EMPLOYEE_PROFILE_CHANGED',16,1);RETURN;END;
  SELECT @saved=ISNULL(MAX(EmpID),0)+1 FROM dbo.EMEmp WITH(UPDLOCK,HOLDLOCK);
  INSERT dbo.EMEmp(EmpID,EmpCode,EmpName,EmpTitle,EmpHead,EmpType,EmpStatus)
   VALUES(@saved,@code,@name,@title,@head,'G','1');
 END;
 SET @snapshot=(SELECT EmpID,EmpCode,EmpName,EmpTitle,EmpHead,EmpStatus,EmpType FROM dbo.EMEmp WHERE EmpID=@saved FOR XML RAW('employee'),TYPE);
 SET @after=CONVERT(nvarchar(max),@snapshot);
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,BeforeJson,AfterJson,ReasonCode,ReasonText,UserId,ActorUserId)
  VALUES('WINSPEED_EMPLOYEE',CONVERT(varchar(20),@saved),'SAVE',
   N'{"snapshotXml":'+wf.fn_OrganizationJsonQuote(@before)+N'}',N'{"snapshotXml":'+wf.fn_OrganizationJsonQuote(@after)+N'}',
   'ORGANIZATION_EMPLOYEE',@reason,CONVERT(varchar(20),@actor),CONVERT(varchar(20),@actor));
END;
GO
