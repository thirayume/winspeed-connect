-- @transaction
-- Default-off native 116 staging. No native table, trigger or contract is
-- changed/enabled here. A native autocommit save is held until its own audit.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.Native116Contract','U') IS NULL
CREATE TABLE wf.Native116Contract(
 Version varchar(30) NOT NULL PRIMARY KEY,Enabled bit NOT NULL DEFAULT(0),
 ProgramName nvarchar(128) NULL,LoginSid varbinary(85) NULL,ModulesHash char(64) NULL,
 ApprovedById int NULL,ApprovedAtUtc datetime2 NULL,Evidence nvarchar(1000) NULL,
 CHECK(Enabled=0 OR(ProgramName IS NOT NULL AND LoginSid IS NOT NULL AND ModulesHash IS NOT NULL
  AND ApprovedById>0 AND ApprovedAtUtc IS NOT NULL AND LEN(Evidence)>=20))
);
IF NOT EXISTS(SELECT 1 FROM wf.Native116Contract WHERE Version='NATIVE-116-DIRECT-v1')
 INSERT wf.Native116Contract(Version,Enabled) VALUES('NATIVE-116-DIRECT-v1',0);
IF OBJECT_ID('wf.Native116HookContract','U') IS NULL
CREATE TABLE wf.Native116HookContract(
 TriggerName varchar(128) NOT NULL PRIMARY KEY,TableName varchar(128) NOT NULL,
 ExpectedDefinition nvarchar(max) NOT NULL,ModulesHash char(64) NOT NULL,
 CHECK((TableName='WFCoupon' AND TriggerName IN('WF_CouponNativeConsume','WF_CouponReservationGuard'))
  OR(TableName='WFRedemtionHD' AND TriggerName='WF_CouponNativeEditHeadHook')
  OR(TableName='WFRedemtionDT' AND TriggerName='WF_CouponNativeEditDetailHook')
  OR(TableName='SMAudit' AND TriggerName='WF_Native116AuditHook'))
);
IF OBJECT_ID('wf.Native116Stage','U') IS NULL
CREATE TABLE wf.Native116Stage(
 StageId uniqueidentifier NOT NULL PRIMARY KEY,
 NativeSpid smallint NOT NULL,ConnectionId uniqueidentifier NOT NULL,LoginSid varbinary(85) NOT NULL,LoginTime datetime NOT NULL,
 NativeId int NULL,DocuNo varchar(25) NULL,DocuDate datetime NULL,
 BeforeCaptured bit NOT NULL DEFAULT(0),BeforeHead nvarchar(max) NOT NULL DEFAULT(N''),BeforeLines nvarchar(max) NOT NULL DEFAULT(N''),
 BeforeHeadImage xml NULL,BeforeLineImage xml NULL,
 State varchar(12) NOT NULL DEFAULT('PENDING') CHECK(State IN('PENDING','COMPLETE','RECOVERED')),
 CreatedAtUtc datetime2 NOT NULL DEFAULT(GETUTCDATE()),CompletedAtUtc datetime2 NULL,
 OperatorUserId int NULL,OperatorEmpId int NULL,NativeAuditId int NULL,AuthorityProof nvarchar(max) NULL,
 FinalAuditId bigint NULL REFERENCES wf.ChangeEvent(EventId)
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.Native116Stage') AND name='IX_Native116Stage_Connection')
 CREATE INDEX IX_Native116Stage_Connection ON wf.Native116Stage(ConnectionId,State);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.Native116Stage') AND name='IX_Native116Stage_Document')
 CREATE INDEX IX_Native116Stage_Document ON wf.Native116Stage(NativeId,State);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.Native116Stage') AND name='IX_Native116Stage_State')
 CREATE INDEX IX_Native116Stage_State ON wf.Native116Stage(State,CreatedAtUtc,StageId);
IF OBJECT_ID('wf.Native116StageCoupon','U') IS NULL
CREATE TABLE wf.Native116StageCoupon(
 StageId uniqueidentifier NOT NULL REFERENCES wf.Native116Stage(StageId),CouponId int NOT NULL,
 NativeBefore decimal(18,4) NOT NULL CHECK(NativeBefore>=0),BeforeQty decimal(18,4) NOT NULL DEFAULT(0) CHECK(BeforeQty>=0),
 CreditQty decimal(18,4) NOT NULL DEFAULT(0) CHECK(CreditQty>=0),DebitQty decimal(18,4) NOT NULL DEFAULT(0) CHECK(DebitQty>=0),
 SourceProof nvarchar(max) NOT NULL,PRIMARY KEY(StageId,CouponId)
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.Native116StageCoupon') AND name='IX_Native116StageCoupon_Coupon')
 CREATE INDEX IX_Native116StageCoupon_Coupon ON wf.Native116StageCoupon(CouponId,StageId);
IF OBJECT_ID('wf.Native116StageReservation','U') IS NULL
CREATE TABLE wf.Native116StageReservation(
 StageId uniqueidentifier NOT NULL REFERENCES wf.Native116Stage(StageId),ReservationId int NOT NULL REFERENCES wf.CouponReservation(Id),
 PRIMARY KEY(StageId,ReservationId)
);
IF OBJECT_ID('wf.Native116StageStep','U') IS NULL
CREATE TABLE wf.Native116StageStep(
 Id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,StageId uniqueidentifier NOT NULL REFERENCES wf.Native116Stage(StageId),
 Entity char(1) NOT NULL CHECK(Entity IN('H','D','B','A')),NativeId int NULL,
 OriginTransactionId bigint NOT NULL,OriginStartedAt datetime NOT NULL,
 CreatedAtUtc datetime2 NOT NULL DEFAULT(GETUTCDATE()),BalanceImage xml NULL
);
IF OBJECT_ID('wf.Native116AuditReceipt','U') IS NULL
CREATE TABLE wf.Native116AuditReceipt(
 NativeAuditId int NOT NULL PRIMARY KEY,StageId uniqueidentifier NOT NULL UNIQUE REFERENCES wf.Native116Stage(StageId),
 PermitId varchar(36) NOT NULL UNIQUE REFERENCES wf.CouponBridgePermit(PermitId)
);
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.Native116Contract TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.Native116HookContract TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.Native116Stage TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.Native116StageCoupon TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.Native116StageReservation TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.Native116StageStep TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.Native116AuditReceipt TO public;
GO
IF OBJECT_ID('wf.fn_Native116HooksReady','FN') IS NULL
 EXEC('CREATE FUNCTION wf.fn_Native116HooksReady() RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_Native116HooksReady() RETURNS bit WITH EXECUTE AS OWNER AS
BEGIN
 DECLARE @module char(64);SELECT @module=ModulesHash FROM wf.Native116Contract WHERE Version='NATIVE-116-DIRECT-v1';
 IF @module IS NULL OR(SELECT COUNT(*) FROM wf.Native116HookContract)<>5 RETURN 0;
 IF EXISTS(SELECT 1 FROM wf.Native116HookContract e LEFT JOIN sys.triggers t ON t.name=e.TriggerName AND t.parent_id=OBJECT_ID('dbo.'+e.TableName)
  LEFT JOIN sys.sql_modules m ON m.object_id=t.object_id
  WHERE e.ModulesHash<>@module OR t.object_id IS NULL OR t.is_disabled<>0 OR m.definition IS NULL
   OR REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)) COLLATE Latin1_General_BIN2<>e.ExpectedDefinition COLLATE Latin1_General_BIN2
   OR DATALENGTH(REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)))<>DATALENGTH(e.ExpectedDefinition)) RETURN 0;
 IF OBJECTPROPERTY(OBJECT_ID('dbo.WF_CouponNativeEditHeadHook'),'ExecIsFirstDeleteTrigger')<>1
  OR OBJECTPROPERTY(OBJECT_ID('dbo.WF_CouponNativeConsume'),'ExecIsFirstUpdateTrigger')<>1
  OR OBJECTPROPERTY(OBJECT_ID('dbo.WF_Native116AuditHook'),'ExecIsLastInsertTrigger')<>1 RETURN 0;
 RETURN 1;
END;
GO
-- Fixed boolean-only readiness; callers cannot request definitions or names.
GRANT EXECUTE ON OBJECT::wf.fn_Native116HooksReady TO public;
GO
IF OBJECT_ID('wf.fn_Native116StageOwned','FN') IS NULL
 EXEC('CREATE FUNCTION wf.fn_Native116StageOwned(@stage uniqueidentifier) RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_Native116StageOwned(@stage uniqueidentifier) RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM wf.Native116Stage WHERE StageId=@stage AND NativeSpid=@@SPID
  AND LoginSid=SUSER_SID(ORIGINAL_LOGIN()) AND State='PENDING') RETURN 0;
 DECLARE @connection uniqueidentifier,@login datetime;
 SELECT @connection=connection_id FROM sys.dm_exec_connections WHERE session_id=@@SPID AND parent_connection_id IS NULL;
 SELECT @login=login_time FROM sys.dm_exec_sessions WHERE session_id=@@SPID;
 RETURN CASE WHEN EXISTS(SELECT 1 FROM wf.Native116Stage WHERE StageId=@stage
  AND ConnectionId=@connection AND LoginTime=@login) THEN 1 ELSE 0 END;
END;
GO
IF OBJECT_ID('wf.fn_Native116Eligible','FN') IS NULL
 EXEC('CREATE FUNCTION wf.fn_Native116Eligible() RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_Native116Eligible() RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM wf.Native116Contract WHERE Version='NATIVE-116-DIRECT-v1' AND Enabled=1
  AND ProgramName=APP_NAME() AND LoginSid=SUSER_SID(ORIGINAL_LOGIN())) RETURN 0;
 IF wf.fn_Native116HooksReady()<>1 RETURN 0;
 IF wf.fn_IsNativeDocumentTarget()<>1 OR NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Version='116-BRIDGE-v1' AND Enabled=1) RETURN 0;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeAppContext WHERE SessionId=@@SPID) RETURN 0;
 RETURN 1;
END;
GO
IF OBJECT_ID('wf.fn_Native116ReservationHeld','FN') IS NULL
 EXEC('CREATE FUNCTION wf.fn_Native116ReservationHeld(@id bigint) RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_Native116ReservationHeld(@id bigint) RETURNS bit AS
BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM wf.Native116StageReservation r JOIN wf.Native116Stage s ON s.StageId=r.StageId
  WHERE r.ReservationId=@id AND s.State='PENDING') THEN 1 ELSE 0 END;
END;
GO
IF OBJECT_ID('wf.sp_Native116StageGet','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_Native116StageGet AS RETURN');
GO
ALTER PROCEDURE wf.sp_Native116StageGet @stage uniqueidentifier OUTPUT AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1 OR wf.fn_Native116Eligible()<>1
 BEGIN RAISERROR('NATIVE_116_SESSION_NOT_AUTHORIZED',16,1);RETURN;END;
 DECLARE @connection uniqueidentifier,@login datetime,@lock int;
 SELECT @connection=connection_id FROM sys.dm_exec_connections WHERE session_id=@@SPID AND parent_connection_id IS NULL;
 SELECT @login=login_time FROM sys.dm_exec_sessions WHERE session_id=@@SPID;
 IF @connection IS NULL OR @login IS NULL BEGIN RAISERROR('NATIVE_116_CONNECTION_REQUIRED',16,1);RETURN;END;
 -- A session-owned lease survives native autocommit statements and is released
 -- only when the connection closes. Recovery can prove closure without granting
 -- the app VIEW SERVER STATE or trusting an idle timeout.
 DECLARE @resource nvarchar(255);SET @resource=N'WF_NATIVE116_CONN_'+CONVERT(nvarchar(36),@connection);
 IF ISNULL(APPLOCK_MODE('public',@resource,'Session'),'NoLock')<>'Exclusive' BEGIN
  EXEC @lock=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Session',@LockTimeout=0;
  IF @lock<0 BEGIN RAISERROR('NATIVE_116_CONNECTION_LEASE_REQUIRED',16,1);RETURN;END;
 END;
 EXEC @lock=sp_getapplock @Resource='WF_NATIVE_DOCUMENTS_V3',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
 IF @lock<0 BEGIN RAISERROR('NATIVE_116_BUSY',16,1);RETURN;END;
 IF (SELECT COUNT(*) FROM wf.Native116Stage WITH(UPDLOCK,HOLDLOCK) WHERE ConnectionId=@connection AND State='PENDING')>1
 BEGIN RAISERROR('NATIVE_116_STAGE_AMBIGUOUS',16,1);RETURN;END;
 SET @stage=NULL;
 SELECT @stage=StageId FROM wf.Native116Stage WHERE ConnectionId=@connection AND State='PENDING';
 IF @stage IS NOT NULL AND wf.fn_Native116StageOwned(@stage)<>1
 BEGIN RAISERROR('NATIVE_116_CONNECTION_CHANGED',16,1);RETURN;END;
 IF @stage IS NULL BEGIN
  SET @stage=NEWID();
  INSERT wf.Native116Stage(StageId,NativeSpid,ConnectionId,LoginSid,LoginTime)
   VALUES(@stage,@@SPID,@connection,SUSER_SID(ORIGINAL_LOGIN()),@login);
 END;
END;
GO
IF OBJECT_ID('wf.sp_Native116StageStep','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_Native116StageStep AS RETURN');
GO
ALTER PROCEDURE wf.sp_Native116StageStep @stage uniqueidentifier,@entity char(1),@native int=NULL,@changes xml=NULL AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @tx bigint,@began datetime;
 SELECT @tx=c.transaction_id,@began=a.transaction_begin_time FROM sys.dm_tran_current_transaction c
  JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
 IF @tx IS NULL OR @began IS NULL OR wf.fn_Native116StageOwned(@stage)<>1
 BEGIN RAISERROR('NATIVE_116_STAGE_TRANSACTION_REQUIRED',16,1);RETURN;END;
 INSERT wf.Native116StageStep(StageId,Entity,NativeId,OriginTransactionId,OriginStartedAt,BalanceImage)
  VALUES(@stage,@entity,@native,@tx,@began,@changes);
END;
GO
IF OBJECT_ID('wf.sp_Native116StageCoupon','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_Native116StageCoupon AS RETURN');
GO
ALTER PROCEDURE wf.sp_Native116StageCoupon @stage uniqueidentifier,@coupon int,@before decimal(18,4)=NULL AS
BEGIN
 SET NOCOUNT ON;
 IF wf.fn_Native116StageOwned(@stage)<>1 BEGIN RAISERROR('NATIVE_116_CONNECTION_CHANGED',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.Native116StageCoupon c WITH(UPDLOCK,HOLDLOCK) JOIN wf.Native116Stage s ON s.StageId=c.StageId
  WHERE c.CouponId=@coupon AND s.State='PENDING' AND s.StageId<>@stage)
  OR EXISTS(SELECT 1 FROM wf.CouponBridgeLine c WITH(UPDLOCK,HOLDLOCK) JOIN wf.CouponBridgePermit p ON p.PermitId=c.PermitId
   WHERE c.CouponId=@coupon AND p.ReleasedAtUtc IS NULL AND p.State<>'CANCELLED')
 BEGIN RAISERROR('NATIVE_116_COUPON_PENDING_REVIEW',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.Native116StageCoupon WHERE StageId=@stage AND CouponId=@coupon) RETURN;
 DECLARE @balance decimal(18,4),@source nvarchar(max);
 SELECT @balance=RemaQty FROM dbo.WFCoupon WITH(UPDLOCK,HOLDLOCK) WHERE CouponID=@coupon AND DocuType=104;
 IF @balance IS NULL OR @before<0 BEGIN RAISERROR('NATIVE_116_BALANCE_UNKNOWN',16,1);RETURN;END;
 EXEC wf.sp_CouponBridgeSource @coupon,0,@source OUTPUT;
 IF NULLIF(@source,N'') IS NULL BEGIN RAISERROR('NATIVE_116_SOURCE_REQUIRED',16,1);RETURN;END;
 INSERT wf.Native116StageCoupon(StageId,CouponId,NativeBefore,SourceProof)
  VALUES(@stage,@coupon,ISNULL(@before,@balance),@source);
 -- Only holds that were alive when this save touched the coupon are frozen.
 -- Old expired reservations are not revived by a new native save.
 INSERT wf.Native116StageReservation(StageId,ReservationId)
 SELECT @stage,r.Id FROM wf.CouponReservation r WITH(UPDLOCK,HOLDLOCK)
 WHERE r.CouponId=@coupon AND r.Status='RESERVED' AND(r.ExpiresAt IS NULL OR r.ExpiresAt>GETUTCDATE()
  OR wf.fn_CouponBridgeReservationHeld(r.Id)=1
  OR EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine l JOIN wf.CouponNativeCutAuthorization a ON a.Id=l.AuthorizationId
   WHERE l.ReservationId=r.Id AND(a.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WHERE e.AuthorizationLineId=l.Id))))
  AND NOT EXISTS(SELECT 1 FROM wf.Native116StageReservation x WHERE x.StageId=@stage AND x.ReservationId=r.Id);
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_Native116StageGet TO public;
DENY EXECUTE ON OBJECT::wf.sp_Native116StageStep TO public;
DENY EXECUTE ON OBJECT::wf.sp_Native116StageCoupon TO public;
DENY EXECUTE ON OBJECT::wf.fn_Native116StageOwned TO public;
DENY EXECUTE ON OBJECT::wf.fn_Native116Eligible TO public;
DENY EXECUTE ON OBJECT::wf.fn_Native116ReservationHeld TO public;
GO
IF OBJECT_ID('wf.sp_Native116ObserveHead','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_Native116ObserveHead AS RETURN');
GO
ALTER PROCEDURE wf.sp_Native116ObserveHead @native int,@before xml,@after xml AS
BEGIN
 SET NOCOUNT ON;SET ANSI_WARNINGS ON;SET ARITHABORT ON;SET ANSI_PADDING ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;
 IF wf.fn_Native116Eligible()<>1 RETURN 0;
 DECLARE @number varchar(25),@date datetime,@stage uniqueidentifier,@captured bit,@old xml,@lines nvarchar(max),@qty decimal(18,4),@coupon int;
 SET @before=ISNULL(@before,CONVERT(xml,N''));SET @after=ISNULL(@after,CONVERT(xml,N''));
 IF CONVERT(nvarchar(max),@before)=CONVERT(nvarchar(max),@after) RETURN 0;
 SET @number=COALESCE(@before.value('(/head/@DocuNo)[1]','varchar(25)'),@after.value('(/head/@DocuNo)[1]','varchar(25)'));
 IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE ReleasedAtUtc IS NULL
  AND State IN('APPROVED','STARTED') AND(NativeId=@native OR DocuNo=@number)) RETURN 0;
 IF @native IS NULL OR @native<=0 OR NULLIF(RTRIM(@number),'') IS NULL
  OR @before.exist('/head[@DocuType != 116]')=1 OR @after.exist('/head[@DocuType != 116]')=1
 BEGIN RAISERROR('NATIVE_116_HEADER_INVALID',16,1);RETURN 1;END;
 EXEC wf.sp_Native116StageGet @stage OUTPUT;
 IF EXISTS(SELECT 1 FROM wf.Native116Stage WITH(UPDLOCK,HOLDLOCK) WHERE State='PENDING' AND NativeId=@native AND StageId<>@stage)
  OR EXISTS(SELECT 1 FROM wf.Native116Stage WHERE StageId=@stage AND NativeId IS NOT NULL AND NativeId<>@native)
 BEGIN RAISERROR('NATIVE_116_DOCUMENT_PENDING_REVIEW',16,1);RETURN 1;END;
 SELECT @captured=BeforeCaptured FROM wf.Native116Stage WHERE StageId=@stage;
 IF @captured=0
 BEGIN
  IF @before.exist('/head')=1
  BEGIN
   -- This callback must run FIRST on header DELETE, before WinSpeed's own
   -- cascade removes details. No native trigger definition is changed.
   IF NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native)
    OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native
     AND(PostInv IS NULL OR PostInv<>'N' OR SOInvID IS NOT NULL OR RemaQty IS NULL OR RemaQty<>GoodQty OR GoodQty<=0))
    OR EXISTS(SELECT CouponID FROM dbo.WFRedemtionDT WHERE RedemtionID=@native GROUP BY CouponID HAVING COUNT(*)<>1)
   BEGIN RAISERROR('NATIVE_116_BEFORE_LINES_OR_INVOICE_INVALID',16,1);RETURN 1;END;
   SET @lines=CONVERT(nvarchar(max),(SELECT Listno,CouponID,CouponNo,GoodID,InveID,LocaID,GoodUnitID,
    CONVERT(decimal(18,4),GoodPrice) GoodPrice,CONVERT(decimal(18,4),GoodQty) GoodQty,IsCheck
    FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native ORDER BY Listno FOR XML RAW('line'),TYPE));
   SET @old=@before;SET @old.modify('delete /head/@DocuType');SET @old.modify('delete /head/@DocuStatus');
   IF EXISTS(SELECT 1 FROM wf.CouponBridgeDocument WITH(UPDLOCK,HOLDLOCK) WHERE NativeId=@native
    AND(State<>'ACTIVE' OR HeaderProof<>CONVERT(nvarchar(max),@old) OR LineProof<>@lines))
   BEGIN RAISERROR('NATIVE_116_DOCUMENT_PROOF_CHANGED',16,1);RETURN 1;END;
   DECLARE old_lines CURSOR LOCAL FAST_FORWARD FOR SELECT CouponID,CONVERT(decimal(18,4),GoodQty)
    FROM dbo.WFRedemtionDT WHERE RedemtionID=@native ORDER BY CouponID;
   OPEN old_lines;FETCH NEXT FROM old_lines INTO @coupon,@qty;
   WHILE @@FETCH_STATUS=0 BEGIN
    EXEC wf.sp_Native116StageCoupon @stage,@coupon;
    UPDATE wf.Native116StageCoupon SET BeforeQty=@qty WHERE StageId=@stage AND CouponId=@coupon;
    FETCH NEXT FROM old_lines INTO @coupon,@qty;
   END;CLOSE old_lines;DEALLOCATE old_lines;
   IF EXISTS(SELECT 1 FROM wf.Native116StageCoupon WHERE StageId=@stage AND CreditQty>0 AND CreditQty<>BeforeQty)
   BEGIN RAISERROR('NATIVE_116_UNWIND_NOT_THIS_DOCUMENT',16,1);RETURN 1;END;
   SET @date=@before.value('(/head/@DocuDate)[1]','datetime');
   UPDATE wf.Native116Stage SET BeforeCaptured=1,BeforeHead=CONVERT(nvarchar(max),@old),BeforeLines=@lines,BeforeHeadImage=@before,
    BeforeLineImage=(SELECT * FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native ORDER BY Listno FOR XML RAW('line'),TYPE),
    NativeId=@native,DocuNo=@number,DocuDate=@date WHERE StageId=@stage;
  END
  ELSE BEGIN
   IF EXISTS(SELECT 1 FROM wf.Native116StageCoupon WHERE StageId=@stage)
   BEGIN RAISERROR('NATIVE_116_UNCLAIMED_UNWIND',16,1);RETURN 1;END;
   SET @date=@after.value('(/head/@DocuDate)[1]','datetime');
   UPDATE wf.Native116Stage SET BeforeCaptured=1,NativeId=@native,DocuNo=@number,DocuDate=@date WHERE StageId=@stage;
  END;
 END;
 IF EXISTS(SELECT 1 FROM wf.Native116Stage WHERE StageId=@stage AND DocuNo<>@number)
 BEGIN RAISERROR('NATIVE_116_NUMBER_CHANGED',16,1);RETURN 1;END;
 EXEC wf.sp_Native116StageStep @stage,'H',@native;
 RETURN 1;
END;
GO
IF OBJECT_ID('wf.sp_Native116ObserveDetail','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_Native116ObserveDetail AS RETURN');
GO
ALTER PROCEDURE wf.sp_Native116ObserveDetail @native int AS
BEGIN
 SET NOCOUNT ON;SET ANSI_WARNINGS ON;SET ARITHABORT ON;SET ANSI_PADDING ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;
 IF wf.fn_Native116Eligible()<>1 RETURN 0;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE NativeId=@native
  AND ReleasedAtUtc IS NULL AND State IN('APPROVED','STARTED')) RETURN 0;
 DECLARE @stage uniqueidentifier,@coupon int;
 SELECT @stage=StageId FROM wf.Native116Stage WHERE NativeId=@native AND State='PENDING' AND wf.fn_Native116StageOwned(StageId)=1;
 IF @stage IS NULL BEGIN RAISERROR('NATIVE_116_HEADER_STAGE_REQUIRED',16,1);RETURN 1;END;
 IF EXISTS(SELECT CouponID FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native GROUP BY CouponID HAVING COUNT(*)<>1)
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WHERE RedemtionID=@native AND(GoodQty<=0 OR GoodQty<>CONVERT(decimal(18,4),GoodQty)))
 BEGIN RAISERROR('NATIVE_116_LINES_INVALID',16,1);RETURN 1;END;
 DECLARE new_lines CURSOR LOCAL FAST_FORWARD FOR SELECT CouponID FROM dbo.WFRedemtionDT WHERE RedemtionID=@native ORDER BY CouponID;
 OPEN new_lines;FETCH NEXT FROM new_lines INTO @coupon;
 WHILE @@FETCH_STATUS=0 BEGIN
  EXEC wf.sp_Native116StageCoupon @stage,@coupon;
  FETCH NEXT FROM new_lines INTO @coupon;
 END;CLOSE new_lines;DEALLOCATE new_lines;
 EXEC wf.sp_Native116StageStep @stage,'D',@native;
 RETURN 1;
END;
GO
IF OBJECT_ID('wf.sp_Native116ObserveBalance','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_Native116ObserveBalance AS RETURN');
GO
ALTER PROCEDURE wf.sp_Native116ObserveBalance @changes xml AS
BEGIN
 SET NOCOUNT ON;SET ANSI_WARNINGS ON;SET ARITHABORT ON;SET ANSI_PADDING ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;
 IF wf.fn_Native116Eligible()<>1 RETURN 0;
 IF @changes.exist('/changes/row')=0 RETURN 0;
 IF EXISTS(SELECT 1 FROM @changes.nodes('/changes/row')t(n) JOIN wf.CouponBridgeLine l ON l.CouponId=n.value('@couponId','int')
  JOIN wf.CouponBridgePermit p ON p.PermitId=l.PermitId WHERE p.ReleasedAtUtc IS NULL AND p.State IN('APPROVED','STARTED')) RETURN 0;
 DECLARE @stage uniqueidentifier,@coupon int,@before decimal(18,4),@after decimal(18,4),@native int,@qty decimal(18,4);
 EXEC wf.sp_Native116StageGet @stage OUTPUT;
 SELECT @native=NativeId FROM wf.Native116Stage WHERE StageId=@stage;
 DECLARE balances CURSOR LOCAL FAST_FORWARD FOR SELECT n.value('@couponId','int'),n.value('@before','decimal(18,4)'),n.value('@after','decimal(18,4)')
  FROM @changes.nodes('/changes/row')t(n) ORDER BY n.value('@couponId','int');
 OPEN balances;FETCH NEXT FROM balances INTO @coupon,@before,@after;
 WHILE @@FETCH_STATUS=0 BEGIN
  IF @before<0 OR @after<0 OR @before=@after OR(@native IS NULL AND @after<@before)
  BEGIN RAISERROR('NATIVE_116_BALANCE_SEQUENCE_INVALID',16,1);RETURN 1;END;
  EXEC wf.sp_Native116StageCoupon @stage,@coupon,@before;
  IF NOT EXISTS(SELECT 1 FROM wf.Native116StageCoupon WHERE StageId=@stage AND CouponId=@coupon
   AND NativeBefore+CreditQty-DebitQty=@before)
  BEGIN RAISERROR('NATIVE_116_BALANCE_IMAGE_CHANGED',16,1);RETURN 1;END;
  IF @after>@before
  BEGIN
   IF EXISTS(SELECT 1 FROM wf.Native116StageCoupon c JOIN wf.Native116Stage s ON s.StageId=c.StageId
    WHERE c.StageId=@stage AND c.CouponId=@coupon AND(c.CreditQty<>0 OR c.DebitQty<>0 OR(s.BeforeCaptured=1 AND c.BeforeQty<>@after-@before)))
   BEGIN RAISERROR('NATIVE_116_UNWIND_QUANTITY_CHANGED',16,1);RETURN 1;END;
   UPDATE wf.Native116StageCoupon SET CreditQty=@after-@before WHERE StageId=@stage AND CouponId=@coupon;
  END
  ELSE BEGIN
   SELECT @qty=SUM(CONVERT(decimal(18,4),GoodQty)) FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native AND CouponID=@coupon;
   IF @qty IS NULL OR @qty<>@before-@after
    OR EXISTS(SELECT 1 FROM wf.Native116StageCoupon WHERE StageId=@stage AND CouponId=@coupon AND DebitQty<>0)
   BEGIN RAISERROR('NATIVE_116_DEBIT_QUANTITY_CHANGED',16,1);RETURN 1;END;
   UPDATE wf.Native116StageCoupon SET DebitQty=@before-@after WHERE StageId=@stage AND CouponId=@coupon;
  END;
  FETCH NEXT FROM balances INTO @coupon,@before,@after;
 END;CLOSE balances;DEALLOCATE balances;
 EXEC wf.sp_Native116StageStep @stage,'B',@native,@changes;
 RETURN 1;
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_Native116ObserveHead TO public;
DENY EXECUTE ON OBJECT::wf.sp_Native116ObserveDetail TO public;
DENY EXECUTE ON OBJECT::wf.sp_Native116ObserveBalance TO public;
GO
