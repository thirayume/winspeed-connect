-- @transaction
-- Explicit recovery restores the complete pre-save image only after the
-- original native connection has closed. Never admits a fabricated native audit.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.Native116RecoveryContext','U') IS NULL
CREATE TABLE wf.Native116RecoveryContext(SessionId smallint NOT NULL PRIMARY KEY,StageId uniqueidentifier NOT NULL REFERENCES wf.Native116Stage(StageId));
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::wf.Native116RecoveryContext TO public;
GO
IF OBJECT_ID('wf.fn_Native116RecoveryWriter','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_Native116RecoveryWriter() RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_Native116RecoveryWriter() RETURNS bit AS
BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM wf.Native116RecoveryContext c JOIN wf.Native116Stage s ON s.StageId=c.StageId
  WHERE c.SessionId=@@SPID AND s.State='PENDING') THEN 1 ELSE 0 END;
END;
GO
IF OBJECT_ID('wf.sp_Native116RecoverBefore','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_Native116RecoverBefore AS RETURN');
GO
ALTER PROCEDURE wf.sp_Native116RecoverBefore
 @stage uniqueidentifier,@user int,@actor int,@reason nvarchar(500),@head nvarchar(max),@lines nvarchar(max),@balances nvarchar(max) AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_WARNINGS ON;SET ANSI_PADDING ON;SET ARITHABORT ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1 OR LEN(LTRIM(RTRIM(@reason)))<10 OR @reason IS NULL
 BEGIN RAISERROR('NATIVE_116_RECOVERY_TRANSACTION_OR_REASON_REQUIRED',16,1);RETURN;END;
 -- Recovery is a system-administrator action with truthful actual/effective IDs.
 IF EXISTS(SELECT Id FROM(SELECT @user Id UNION SELECT @actor Id)x WHERE NOT EXISTS(
  SELECT 1 FROM wf.AppUser u WITH(UPDLOCK,HOLDLOCK) JOIN wf.vUserRole r ON r.UserId=u.Id
  JOIN wf.RoleProfile p ON p.Code=r.RoleCode WHERE u.Id=x.Id AND u.IsActive=1 AND u.MustChangePassword=0 AND p.BaseRole='ADMIN')
  OR EXISTS(SELECT 1 FROM wf.vUserRole r WHERE r.UserId=x.Id AND r.RoleCode='SEPARATION'))
 BEGIN RAISERROR('NATIVE_116_RECOVERY_ADMIN_REQUIRED',16,1);RETURN;END;
 IF wf.fn_IsNativeDocumentTarget()<>1 OR wf.fn_Native116HooksReady()<>1
 BEGIN RAISERROR('NATIVE_116_RECOVERY_PROTOCOL_UNAVAILABLE',16,1);RETURN;END;
 DECLARE @lock int,@native int,@oldHead xml,@oldLines xml,@beforeCaptured bit;
 EXEC @lock=sp_getapplock @Resource='WF_NATIVE_DOCUMENTS_V3',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
 IF @lock<0 BEGIN RAISERROR('NATIVE_116_BUSY',16,1);RETURN;END;
 SELECT @native=NativeId,@oldHead=BeforeHeadImage,@oldLines=BeforeLineImage,@beforeCaptured=BeforeCaptured
  FROM wf.Native116Stage WITH(UPDLOCK,HOLDLOCK) WHERE StageId=@stage AND State='PENDING';
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('NATIVE_116_RECOVERY_STAGE_CHANGED',16,1);RETURN;END;
 DECLARE @connectionResource nvarchar(255),@originalSpid smallint;
 SELECT @connectionResource=N'WF_NATIVE116_CONN_'+CONVERT(nvarchar(36),ConnectionId),@originalSpid=NativeSpid FROM wf.Native116Stage WHERE StageId=@stage;
 IF @originalSpid=@@SPID BEGIN RAISERROR('NATIVE_116_RECOVERY_CLOSE_ORIGINAL_CONNECTION',16,1);RETURN;END;
 EXEC @lock=sp_getapplock @Resource=@connectionResource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0;
 IF @lock<0 BEGIN RAISERROR('NATIVE_116_RECOVERY_CLOSE_ORIGINAL_CONNECTION',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.Native116AuditReceipt WHERE StageId=@stage)
  OR EXISTS(SELECT 1 FROM wf.CouponBridgePermit WHERE ReleasedAtUtc IS NULL AND State<>'CANCELLED' AND NativeId=@native)
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native AND(PostInv IS NULL OR PostInv<>'N' OR SOInvID IS NOT NULL OR RemaQty<>GoodQty))
 BEGIN RAISERROR('NATIVE_116_RECOVERY_ALREADY_ADMITTED_OR_INVOICED',16,1);RETURN;END;
 DECLARE @nowHead nvarchar(max),@nowLines nvarchar(max),@nowBalances nvarchar(max);
 SET @nowHead=ISNULL(CONVERT(nvarchar(max),(SELECT * FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native FOR XML RAW('head'),TYPE)),N'');
 SET @nowLines=ISNULL(CONVERT(nvarchar(max),(SELECT * FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native ORDER BY Listno FOR XML RAW('line'),TYPE)),N'');
 SET @nowBalances=ISNULL(CONVERT(nvarchar(max),(SELECT c.CouponId,b.RemaQty FROM wf.Native116StageCoupon c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.WFCoupon b WITH(UPDLOCK,HOLDLOCK) ON b.CouponID=c.CouponId WHERE c.StageId=@stage ORDER BY c.CouponId FOR XML RAW('coupon'),TYPE)),N'');
 IF @head IS NULL OR @lines IS NULL OR @balances IS NULL OR @head<>@nowHead OR @lines<>@nowLines OR @balances<>@nowBalances
 BEGIN RAISERROR('NATIVE_116_RECOVERY_PREVIEW_CHANGED',16,1);RETURN;END;
 IF(@native IS NOT NULL AND @beforeCaptured<>1) OR(@oldHead IS NULL AND EXISTS(SELECT 1 FROM wf.Native116Stage WHERE StageId=@stage AND NULLIF(BeforeHead,N'') IS NOT NULL))
  OR EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.WFRedemtionHD') GROUP BY object_id HAVING COUNT(*)<>13)
  OR EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.WFRedemtionDT') GROUP BY object_id HAVING COUNT(*)<>15)
 BEGIN RAISERROR('NATIVE_116_RECOVERY_SNAPSHOT_UNAVAILABLE',16,1);RETURN;END;
 DECLARE @coupon int,@expected nvarchar(max),@source nvarchar(max);
 DECLARE sources CURSOR LOCAL FAST_FORWARD FOR SELECT CouponId,SourceProof FROM wf.Native116StageCoupon WHERE StageId=@stage ORDER BY CouponId;
 OPEN sources;FETCH NEXT FROM sources INTO @coupon,@expected;
 WHILE @@FETCH_STATUS=0 BEGIN
  EXEC wf.sp_CouponBridgeSource @coupon,0,@source OUTPUT;
  IF @source IS NULL OR @source<>@expected OR NOT EXISTS(SELECT 1 FROM wf.Native116StageCoupon c JOIN dbo.WFCoupon b WITH(UPDLOCK,HOLDLOCK) ON b.CouponID=c.CouponId
   WHERE c.StageId=@stage AND c.CouponId=@coupon AND b.RemaQty=c.NativeBefore+c.CreditQty-c.DebitQty)
  BEGIN RAISERROR('NATIVE_116_RECOVERY_SOURCE_OR_BALANCE_CHANGED',16,1);RETURN;END;
  FETCH NEXT FROM sources INTO @coupon,@expected;
 END;CLOSE sources;DEALLOCATE sources;
 INSERT wf.Native116RecoveryContext(SessionId,StageId) VALUES(@@SPID,@stage);
 IF @native IS NOT NULL BEGIN
  DELETE dbo.WFRedemtionHD WHERE RedemtionID=@native;
  IF EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WHERE RedemtionID=@native)
  BEGIN RAISERROR('NATIVE_116_RECOVERY_NATIVE_CASCADE_FAILED',16,1);RETURN;END;
  INSERT dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,CardNo,IssueName,CarLicense,SaveEmpID,IssueEmpID,AppvEmpID,SumGoodQty,DocuStatus,IsCheckAll)
 SELECT CASE WHEN x.n.exist('@RedemtionID')=1 THEN x.n.value('(@RedemtionID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@DocuNo')=1 THEN x.n.value('(@DocuNo)[1]','varchar(25)') ELSE NULL END,
 CASE WHEN x.n.exist('@DocuDate')=1 THEN x.n.value('(@DocuDate)[1]','datetime') ELSE NULL END,
 CASE WHEN x.n.exist('@DocuType')=1 THEN x.n.value('(@DocuType)[1]','smallint') ELSE NULL END,
 CASE WHEN x.n.exist('@CardNo')=1 THEN x.n.value('(@CardNo)[1]','varchar(25)') ELSE NULL END,
 CASE WHEN x.n.exist('@IssueName')=1 THEN x.n.value('(@IssueName)[1]','varchar(255)') ELSE NULL END,
 CASE WHEN x.n.exist('@CarLicense')=1 THEN x.n.value('(@CarLicense)[1]','varchar(25)') ELSE NULL END,
 CASE WHEN x.n.exist('@SaveEmpID')=1 THEN x.n.value('(@SaveEmpID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@IssueEmpID')=1 THEN x.n.value('(@IssueEmpID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@AppvEmpID')=1 THEN x.n.value('(@AppvEmpID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@SumGoodQty')=1 THEN x.n.value('(@SumGoodQty)[1]','decimal(19,4)') ELSE NULL END,
 CASE WHEN x.n.exist('@DocuStatus')=1 THEN x.n.value('(@DocuStatus)[1]','char(1)') ELSE NULL END,
 CASE WHEN x.n.exist('@IsCheckAll')=1 THEN x.n.value('(@IsCheckAll)[1]','char(1)') ELSE NULL END FROM @oldHead.nodes('/head')x(n);
  INSERT dbo.WFRedemtionDT(RedemtionID,Listno,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,PostInv,GoodQty,RemaQty,SOInvID,SOListNo,IsCheck)
 SELECT CASE WHEN x.n.exist('@RedemtionID')=1 THEN x.n.value('(@RedemtionID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@Listno')=1 THEN x.n.value('(@Listno)[1]','smallint') ELSE NULL END,
 CASE WHEN x.n.exist('@GoodID')=1 THEN x.n.value('(@GoodID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@InveID')=1 THEN x.n.value('(@InveID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@LocaID')=1 THEN x.n.value('(@LocaID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@GoodUnitID')=1 THEN x.n.value('(@GoodUnitID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@GoodPrice')=1 THEN x.n.value('(@GoodPrice)[1]','decimal(19,4)') ELSE NULL END,
 CASE WHEN x.n.exist('@CouponID')=1 THEN x.n.value('(@CouponID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@CouponNo')=1 THEN x.n.value('(@CouponNo)[1]','varchar(25)') ELSE NULL END,
 CASE WHEN x.n.exist('@PostInv')=1 THEN x.n.value('(@PostInv)[1]','char(1)') ELSE NULL END,
 CASE WHEN x.n.exist('@GoodQty')=1 THEN x.n.value('(@GoodQty)[1]','decimal(19,4)') ELSE NULL END,
 CASE WHEN x.n.exist('@RemaQty')=1 THEN x.n.value('(@RemaQty)[1]','decimal(19,4)') ELSE NULL END,
 CASE WHEN x.n.exist('@SOInvID')=1 THEN x.n.value('(@SOInvID)[1]','int') ELSE NULL END,
 CASE WHEN x.n.exist('@SOListNo')=1 THEN x.n.value('(@SOListNo)[1]','smallint') ELSE NULL END,
 CASE WHEN x.n.exist('@IsCheck')=1 THEN x.n.value('(@IsCheck)[1]','char(1)') ELSE NULL END FROM @oldLines.nodes('/line')x(n);
 END;
 UPDATE b SET RemaQty=c.NativeBefore FROM dbo.WFCoupon b JOIN wf.Native116StageCoupon c ON c.CouponId=b.CouponID WHERE c.StageId=@stage AND b.RemaQty<>c.NativeBefore;
 IF EXISTS(SELECT 1 FROM wf.Native116StageCoupon c JOIN dbo.WFCoupon b ON b.CouponID=c.CouponId WHERE c.StageId=@stage AND b.RemaQty<>c.NativeBefore)
 BEGIN RAISERROR('NATIVE_116_RECOVERY_BALANCE_NOT_RESTORED',16,1);RETURN;END;
 DECLARE @proofHead nvarchar(max),@proofLines nvarchar(max);
 EXEC wf.sp_CouponBridgePhysical @native,@proofHead OUTPUT,@proofLines OUTPUT;
 IF @native IS NOT NULL AND EXISTS(SELECT 1 FROM wf.Native116Stage WHERE StageId=@stage AND(BeforeHead<>ISNULL(@proofHead,N'') OR BeforeLines<>ISNULL(@proofLines,N'')))
 BEGIN RAISERROR('NATIVE_116_RECOVERY_DOCUMENT_NOT_RESTORED',16,1);RETURN;END;
 DECLARE @event bigint;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId,BeforeJson,AfterJson)
 VALUES('NATIVE_116',CONVERT(varchar(36),@stage),'RESTORE_BEFORE','ADMIN_RECOVERY',@reason,CONVERT(varchar(20),@user),CONVERT(varchar(20),@actor),
  N'{"state":"PENDING"}',N'{"state":"RECOVERED","nativeAuditFabricated":false}');
 SET @event=SCOPE_IDENTITY();
 DELETE wf.Native116RecoveryContext WHERE SessionId=@@SPID AND StageId=@stage;
 UPDATE wf.Native116Stage SET State='RECOVERED',CompletedAtUtc=GETUTCDATE(),FinalAuditId=@event WHERE StageId=@stage AND State='PENDING';
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('NATIVE_116_RECOVERY_STAGE_CHANGED',16,1);RETURN;END;
END;
GO
DENY EXECUTE ON OBJECT::wf.fn_Native116RecoveryWriter TO public;
-- Existing restricted app principals receive wf schema EXECUTE through the
-- official principal script; all business checks remain inside this procedure.
GO
