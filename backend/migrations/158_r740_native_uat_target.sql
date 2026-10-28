-- @transaction
-- Extend the existing restricted simulation to the verified R740 UAT clone.
-- No production target is allowed. No business DML runs at migration time.
-- Each procedure below preserves its prior business body, changing only the
-- target predicate. Single-line/whole-coupon/zero-tax/simulation restrictions,
-- role checks, actor audit, idempotency and transaction guards are unchanged.
-- Original migrations 152/153/155/156/157 remain immutable.
IF OBJECT_ID('wf.usp_ApproveInitialBooking','P') IS NULL RAISERROR('NATIVE_UAT_PREREQUISITE_REQUIRED',16,1);
IF OBJECT_ID('wf.usp_AllocateInitialDeliveryEventId','P') IS NULL RAISERROR('NATIVE_UAT_PREREQUISITE_REQUIRED',16,1);
IF OBJECT_ID('wf.usp_AllocateInitialVATId','P') IS NULL RAISERROR('NATIVE_UAT_PREREQUISITE_REQUIRED',16,1);
IF OBJECT_ID('wf.usp_AllocateInitialSAT','P') IS NULL RAISERROR('NATIVE_UAT_PREREQUISITE_REQUIRED',16,1);
IF OBJECT_ID('wf.usp_CreateCompleteInitialDelivery','P') IS NULL RAISERROR('NATIVE_UAT_PREREQUISITE_REQUIRED',16,1);
IF OBJECT_ID('wf.usp_AllocateInitialRedemptionId','P') IS NULL RAISERROR('NATIVE_UAT_PREREQUISITE_REQUIRED',16,1);
IF OBJECT_ID('wf.usp_CreateInitialManualRedemption','P') IS NULL RAISERROR('NATIVE_UAT_PREREQUISITE_REQUIRED',16,1);
IF OBJECT_ID('wf.usp_AllocateInitialInvoiceSAT','P') IS NULL RAISERROR('NATIVE_UAT_PREREQUISITE_REQUIRED',16,1);
IF OBJECT_ID('wf.usp_PostInitialCouponInvoice','P') IS NULL RAISERROR('NATIVE_UAT_PREREQUISITE_REQUIRED',16,1);
GO
IF OBJECT_ID('wf.fn_IsInitialNativeUatTarget','FN') IS NULL
 EXEC('CREATE FUNCTION wf.fn_IsInitialNativeUatTarget() RETURNS BIT AS BEGIN RETURN 0; END;');
GO
ALTER FUNCTION wf.fn_IsInitialNativeUatTarget() RETURNS BIT
AS
BEGIN
 RETURN CASE
  WHEN CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName'))=N'AMYOU-YOGA7\V2008R2'
   AND DB_NAME()=N'dbwins_worldfert9_uat2' AND DB_ID()=10 THEN 1
  WHEN CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName'))=N'R740-SRV\SQL2008'
   AND DB_NAME()=N'dbwins_worldfert9-uat' AND DB_ID()=8 THEN 1
  ELSE 0 END;
END;
GO
ALTER PROCEDURE wf.usp_ApproveInitialBooking
    @SOID INT, @UserId INT, @ActorId INT, @EmpId INT,
    @Preview BIT, @RequestId VARCHAR(36), @Fingerprint VARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET ARITHABORT ON;
    SET ANSI_WARNINGS ON;
    IF @@TRANCOUNT=0
    BEGIN RAISERROR('AI_CONTRACT_UNSUPPORTED',16,1); RETURN; END;
    IF wf.fn_IsInitialNativeUatTarget()<>1
    BEGIN RAISERROR('AI_TARGET_NOT_SUPPORTED',16,1); RETURN; END;

    DECLARE @Role VARCHAR(30),@ActorRole VARCHAR(30),@Username NVARCHAR(100);
    SELECT @Role=Role,@Username=Username FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK)
    WHERE Id=@UserId AND IsActive=1 AND MustChangePassword=0 AND EmpId=CONVERT(VARCHAR(20),@EmpId);
    SELECT @ActorRole=Role FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK)
    WHERE Id=@ActorId AND IsActive=1 AND MustChangePassword=0;
    IF @Role IS NULL OR @ActorRole IS NULL OR @Role NOT IN ('SALES','COUNTER_SALES','MANAGER','C_LEVEL','ADMIN')
       OR NOT EXISTS(SELECT 1 FROM dbo.EMEmp WHERE EmpID=@EmpId)
    BEGIN RAISERROR('AI_APPROVER_INVALID',16,1); RETURN; END;

    DECLARE @SourceDraftId INT,@RequesterId INT,@RequesterActorId INT,@SalesUserId INT;
    SELECT @SourceDraftId=SourceDraftId,@RequesterId=ConfirmedById,
      @RequesterActorId=ConfirmedActorId,@SalesUserId=SalesUserId
    FROM wf.NativeBookingOrigin WITH(UPDLOCK,HOLDLOCK)
    WHERE SOID=@SOID AND Fingerprint=@Fingerprint AND PolicyVersion='O11-AI-INITIAL-UAT2-v1';
    IF @SourceDraftId IS NULL
    BEGIN RAISERROR('AI_ORIGIN_REQUIRED',16,1); RETURN; END;
    IF EXISTS(SELECT 1 FROM wf.NativeBookingApproval WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID OR RequestId=@RequestId)
    BEGIN RAISERROR('AI_REQUEST_CONFLICT',16,1); RETURN; END;

    -- Only the unchanged, single-line, zero-tax/discount, unreferenced initial
    -- contract observed in UAT2. Preserve rows, remarks and every business value.
    -- Native reverse/reapply upstream quantities have no rows for this subset.
    DECLARE @DocuNo NVARCHAR(30),@DocuDate DATETIME,@Today DATETIME;
    SET @Today=CONVERT(DATETIME,CONVERT(VARCHAR(10),DATEADD(hour,7,GETUTCDATE()),120),120);
    SELECT @DocuNo=DocuNo,@DocuDate=DocuDate FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK)
    WHERE SOID=@SOID AND DocuType=103 AND BrchID=1
      AND AppvFlag='W' AND AppvDocuNo IS NULL AND Appvid IS NULL AND AppvDate IS NULL
      AND DocuStatus='N' AND PkgStatus='N' AND OnHold='N' AND ClearSO='N'
      AND ISNULL(RefSOID,0)=0 AND ISNULL(RefNo,'')=''
      AND ISNULL(VatRate,0)=0 AND ISNULL(VATAmnt,0)=0
      AND ISNULL(BaseDiscAmnt,0)=0 AND ISNULL(BillDiscAmnt,0)=0
      AND ISNULL(ExchRate,1)=1 AND ISNULL(CouponFlag,'N')='N'
      AND ValidDays>=0 AND DocuDate<=@Today AND DATEADD(day,ValidDays,DocuDate)>=@Today;
    IF @DocuNo IS NULL
    BEGIN RAISERROR('AI_BOOKING_UNAVAILABLE',16,1); RETURN; END;
    IF NOT EXISTS(SELECT 1 FROM wf.SalesOrderExt WITH(UPDLOCK,HOLDLOCK)
        WHERE SOID=CONVERT(VARCHAR(50),@SOID) AND SourceDraftId=@SourceDraftId AND SalesUserId=@SalesUserId
        AND ISNULL(IsUnlocked,0)=0 AND ISNULL(IsLoaded,0)=0 AND WeighOutWeight IS NULL)
      OR (SELECT COUNT(*) FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID)<>1
      OR EXISTS(SELECT 1 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID AND
        (DocuType<>103 OR ISNULL(RefSOID,0)<>0 OR ISNULL(Refno,'')<>''
        OR ISNULL(GoodQty2,0)<=0 OR ISNULL(RemaQty,-1)<>GoodQty2 OR ISNULL(FreeFlag,'N')='Y'
        OR ISNULL(GoodDiscAmnt,0)<>0))
      OR EXISTS(SELECT 1 FROM wf.PriceApproval WITH(UPDLOCK,HOLDLOCK) WHERE SoId=@SourceDraftId AND Status='PENDING')
      OR EXISTS(SELECT 1 FROM wf.SalesOrderAudit WITH(UPDLOCK,HOLDLOCK)
        WHERE SoId=CONVERT(VARCHAR(50),@SOID) AND Action IN ('UPDATED','EDIT_UNLOCKED','WINSPEED_APPROVAL_RESET','PICKING','LOADED','SHIPPED','CANCELLED'))
      OR NOT EXISTS(SELECT 1 FROM wf.SalesOrderAudit WITH(UPDLOCK,HOLDLOCK)
        WHERE SoId=CONVERT(VARCHAR(50),@SOID) AND Action='CONFIRMED' AND UserId=@RequesterId AND ActorUserId=@RequesterActorId)
    BEGIN RAISERROR('AI_CONTRACT_UNSUPPORTED',16,1); RETURN; END;

    IF EXISTS(SELECT 1 FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE RefSOID=@SOID)
      OR EXISTS(SELECT 1 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE RefSOID=@SOID)
      OR EXISTS(SELECT 1 FROM dbo.WFCoupon WITH(UPDLOCK,HOLDLOCK) WHERE DocuID=@SOID)
      OR EXISTS(SELECT 1 FROM dbo.SOPickingDT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID)
      OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID=@SOID)
      OR EXISTS(SELECT 1 FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE RefID=@SOID)
      OR EXISTS(SELECT 1 FROM wf.CouponReservation WITH(UPDLOCK,HOLDLOCK) WHERE CarrierSoId=CONVERT(VARCHAR(50),@SOID))
    BEGIN RAISERROR('AI_CONTRACT_UNSUPPORTED',16,1); RETURN; END;

    DECLARE @Last VARCHAR(50),@Fmt VARCHAR(50),@Prefix VARCHAR(5),@DataMax INT,@Next INT,@No VARCHAR(30);
    SELECT @Last=RTRIM(LastNo),@Fmt=RTRIM(RunFormat) FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK)
    WHERE RunCode='119' AND BrchID=1;
    SET @Prefix='AI'+RIGHT(CONVERT(VARCHAR(4),YEAR(@Today)+543),2)+'-';
    -- No inferred reset/year-switch/alternate-book behavior. An unsupported book stops.
    IF @Last IS NULL OR @Fmt<>'AIyy-00000' OR LEN(@Last)<>10
       OR LEFT(@Last,5)<>@Prefix OR SUBSTRING(@Last,6,5) NOT LIKE '[0-9][0-9][0-9][0-9][0-9]'
    BEGIN RAISERROR('AI_COUNTER_UNSUPPORTED',16,1); RETURN; END;
    SELECT @DataMax=ISNULL(MAX(CONVERT(INT,SUBSTRING(AppvDocuNo,6,5))),0)
    FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK)
    WHERE AppvDocuNo LIKE @Prefix+'[0-9][0-9][0-9][0-9][0-9]' AND LEN(AppvDocuNo)=10;
    SET @Next=CONVERT(INT,SUBSTRING(@Last,6,5));
    IF @DataMax>@Next SET @Next=@DataMax;
    SET @Next=@Next+1;
    IF @Next>99999
    BEGIN RAISERROR('AI_NUMBER_EXHAUSTED',16,1); RETURN; END;
    IF @Preview=1
    BEGIN SELECT 1 AS Eligible; RETURN; END;
    IF @RequestId IS NULL OR LEN(@RequestId)<>36 OR LEN(@Fingerprint)<>64
    BEGIN RAISERROR('AI_REQUEST_CONFLICT',16,1); RETURN; END;

    SET @No=@Prefix+RIGHT('00000'+CONVERT(VARCHAR(5),@Next),5);
    IF EXISTS(SELECT 1 FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE AppvDocuNo=@No)
    BEGIN RAISERROR('AI_NUMBER_COLLISION',16,1); RETURN; END;
    UPDATE dbo.EMRunBrch SET LastNo=@No
    WHERE RunCode='119' AND BrchID=1 AND LastNo=@Last AND RunFormat=@Fmt;
    IF @@ROWCOUNT<>1
    BEGIN RAISERROR('AI_COUNTER_UNSUPPORTED',16,1); RETURN; END;
    UPDATE dbo.SOHD SET AppvFlag='Y',AppvDocuNo=@No,Appvid=@EmpId,AppvDate=@Today
    WHERE SOID=@SOID AND DocuType=103 AND AppvFlag='W' AND AppvDocuNo IS NULL;
    IF @@ROWCOUNT<>1
    BEGIN RAISERROR('AI_BOOKING_UNAVAILABLE',16,1); RETURN; END;

    -- Both audits and the durable idempotency receipt share the caller transaction.
    -- Failure anywhere is fatal to the operation; the service rolls back, never retries a write blindly.
    DECLARE @AuditId INT,@Self BIT,@Note NVARCHAR(255),@AuditUser NVARCHAR(100);
    SET @Self=CASE WHEN @RequesterActorId=@ActorId THEN 1 ELSE 0 END;
    SET @Note=N'O11-AI-INITIAL-UAT2-v1; AI='+@No+N'; effective='+CONVERT(NVARCHAR(12),@UserId)
      +N'; actor='+CONVERT(NVARCHAR(12),@ActorId)+N'; self='+CONVERT(NVARCHAR(1),@Self);
    SET @AuditUser=LEFT(N'wf:'+@Username,100);
    EXEC wf.usp_AllocateWinspeedId @TableName='SMAudit',@NewId=@AuditId OUTPUT;
    IF @AuditId IS NULL
    BEGIN RAISERROR('AI_CONTRACT_UNSUPPORTED',16,1); RETURN; END;
    INSERT INTO dbo.SMAudit (audit_id,audit_system,audit_screen,audit_datetime,audit_username,
      audit_action,audit_docuno,audit_docudate,audit_columnid,brchid,audit_computername,audit_query,Version)
    VALUES (@AuditId,990,990000005,GETDATE(),@AuditUser,'APPROVE',@DocuNo,@DocuDate,@SOID,1,HOST_NAME(),@Note,'WF INITIAL-AI UAT2');
    INSERT INTO wf.SalesOrderAudit (SoId,UserId,ActorUserId,Action,FromStatus,ToStatus,Note)
    VALUES (CONVERT(VARCHAR(50),@SOID),@UserId,@ActorId,'NATIVE_AI_APPROVED','PENDING_APPROVAL','CONFIRMED',@Note);
    INSERT INTO wf.NativeBookingApproval (SOID,RequestId,Fingerprint,ApprovalNo,ApproverId,ApproverActorId,
      ApproverEmpId,RequesterId,RequesterActorId,SalesUserId,SelfApproval,PolicyVersion,NativeAuditId)
    VALUES (@SOID,@RequestId,@Fingerprint,@No,@UserId,@ActorId,@EmpId,@RequesterId,@RequesterActorId,
      @SalesUserId,@Self,'O11-AI-INITIAL-UAT2-v1',@AuditId);
    SELECT * FROM wf.NativeBookingApproval WHERE SOID=@SOID;
END
GO
ALTER PROCEDURE wf.usp_AllocateInitialDeliveryEventId @NewId INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 OR wf.fn_IsInitialNativeUatTarget()<>1
 BEGIN RAISERROR('DO_TARGET_NOT_SUPPORTED',16,1); RETURN; END;
 DECLARE @Prefix INT,@MaxData INT,@MaxBook INT,@Next INT,@Guard INT;
 SET @Guard=0;
 SELECT @Prefix=MAX(Prefix) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
 WHERE Name='wssale-app/backend/smevent' AND Type=1;
 WHILE @Guard<20
 BEGIN
  SET @Guard=@Guard+1;
  IF @Prefix IS NULL
  BEGIN
   SELECT @MaxBook=ISNULL(MAX(Prefix),0) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
    WHERE Type=1 AND CHARINDEX('smevent',LOWER(Name))>0;
   SELECT @MaxData=ISNULL(MAX(eventid),0) FROM dbo.SMEvent WITH(UPDLOCK,HOLDLOCK);
   IF @MaxData/1000*1000>@MaxBook SET @MaxBook=@MaxData/1000*1000;
   IF @MaxBook>2147481000 BEGIN RAISERROR('DO_ID_EXHAUSTED',16,1); RETURN; END;
   SET @Prefix=@MaxBook+1000;
   INSERT INTO dbo.SMID(Name,Prefix,Type) VALUES('wssale-app/backend/smevent',@Prefix,1);
  END;
  IF @Prefix%1000<>0 OR @Prefix>2147482000 OR EXISTS(
   SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1
    AND CHARINDEX('smevent',LOWER(Name))>0 AND Prefix=@Prefix AND Name<>'wssale-app/backend/smevent')
  BEGIN RAISERROR('DO_ID_CONFLICT',16,1); RETURN; END;
  SELECT @Next=ISNULL(MAX(eventid)+1,@Prefix) FROM dbo.SMEvent WITH(UPDLOCK,HOLDLOCK)
   WHERE eventid>=@Prefix AND eventid<@Prefix+1000;
  IF @Next<@Prefix+1000 BEGIN SET @NewId=@Next; RETURN; END;
  SET @Prefix=NULL;
 END;
 RAISERROR('DO_ID_EXHAUSTED',16,1);
END
GO
ALTER PROCEDURE wf.usp_AllocateInitialVATId @NewId INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET @NewId=NULL;
 IF @@TRANCOUNT=0 OR wf.fn_IsInitialNativeUatTarget()<>1 BEGIN RAISERROR('DO_TARGET_NOT_SUPPORTED',16,1); RETURN; END;
 DECLARE @P INT,@M INT,@D INT,@N INT,@G INT; SET @G=0;
 SELECT @P=MAX(Prefix) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND Name='wssale-app/backend/vtvat';
 WHILE @G<20 BEGIN
  SET @G=@G+1;
  IF @P IS NULL BEGIN
   SELECT @M=ISNULL(MAX(Prefix),0) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND CHARINDEX('vtvat',LOWER(Name))>0;
   SELECT @D=ISNULL(MAX(VATID),0) FROM dbo.VTVAT WITH(UPDLOCK,HOLDLOCK);
   IF @D/1000*1000>@M SET @M=@D/1000*1000;
   IF @M>2147481000 BEGIN RAISERROR('DO_ID_EXHAUSTED',16,1); RETURN; END;
   SET @P=@M+1000; INSERT INTO dbo.SMID(Name,Prefix,Type) VALUES('wssale-app/backend/vtvat',@P,1);
  END;
  IF @P%1000<>0 OR @P>2147482000 OR EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
   WHERE Type=1 AND Prefix=@P AND CHARINDEX('vtvat',LOWER(Name))>0 AND Name<>'wssale-app/backend/vtvat')
  BEGIN RAISERROR('DO_ID_CONFLICT',16,1); RETURN; END;
  SELECT @N=ISNULL(MAX(VATID)+1,@P) FROM dbo.VTVAT WITH(UPDLOCK,HOLDLOCK) WHERE VATID>=@P AND VATID<@P+1000;
  IF @N<@P+1000 BEGIN SET @NewId=@N; RETURN; END; SET @P=NULL;
 END;
 RAISERROR('DO_ID_EXHAUSTED',16,1);
END
GO
ALTER PROCEDURE wf.usp_AllocateInitialSAT @GlobalFlag INT,@Username NVARCHAR(100),@NewId INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET @NewId=NULL;
 IF @@TRANCOUNT=0 OR wf.fn_IsInitialNativeUatTarget()<>1 OR @GlobalFlag IS NULL OR @GlobalFlag<>202 OR @Username IS NULL
 BEGIN RAISERROR('DO_TARGET_NOT_SUPPORTED',16,1); RETURN; END;
 DECLARE @P INT,@M INT,@D INT,@N INT,@Other INT,@G INT; SET @G=0;
 SELECT @P=MAX(Prefix) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=2 AND Name='wssale-app/backend/SAT';
 WHILE @G<20 BEGIN
  SET @G=@G+1;
  IF @P IS NULL BEGIN
   SELECT @M=ISNULL(MAX(Prefix),0) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=2 AND CHARINDEX('sat',LOWER(Name))>0;
   SELECT @D=ISNULL(MAX(GlobalID),0) FROM dbo.SMReserveSat WITH(UPDLOCK,HOLDLOCK);
   SELECT @Other=ISNULL(MAX(GlobalID),0) FROM dbo.SMSat WITH(UPDLOCK,HOLDLOCK);
   IF @Other>@D SET @D=@Other; IF @D/100000*100000>@M SET @M=@D/100000*100000;
   IF @M>=2147300000 BEGIN RAISERROR('DO_ID_EXHAUSTED',16,1); RETURN; END;
   SET @P=@M+100000; INSERT INTO dbo.SMID(Name,Prefix,Type) VALUES('wssale-app/backend/SAT',@P,2);
  END;
  IF @P%100000<>0 OR @P>2147300000 OR EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
   WHERE Type=2 AND Prefix=@P AND CHARINDEX('sat',LOWER(Name))>0 AND Name<>'wssale-app/backend/SAT')
  BEGIN RAISERROR('DO_ID_CONFLICT',16,1); RETURN; END;
  SELECT @N=ISNULL(MAX(GlobalID)+1,@P) FROM dbo.SMReserveSat WITH(UPDLOCK,HOLDLOCK) WHERE GlobalID>=@P AND GlobalID<@P+100000;
  IF @N<@P+100000 BEGIN
   IF EXISTS(SELECT 1 FROM dbo.SMSat WITH(UPDLOCK,HOLDLOCK) WHERE GlobalID=@N) BEGIN RAISERROR('DO_ID_CONFLICT',16,1); RETURN; END;
   INSERT INTO dbo.SMReserveSat(GlobalID,GlobalFlag,DocuDate,UserName) VALUES(@N,@GlobalFlag,GETDATE(),LEFT(N'wf:'+@Username,255));
   SET @NewId=@N; RETURN;
  END; SET @P=NULL;
 END;
 RAISERROR('DO_ID_EXHAUSTED',16,1);
END
GO
ALTER PROCEDURE wf.usp_CreateCompleteInitialDelivery
 @SOID INT, @Preview BIT, @RequestId VARCHAR(36), @Fingerprint VARCHAR(64),
 @UserId INT, @ActorId INT
AS
BEGIN
 SET NOCOUNT ON;
 SET XACT_ABORT ON;
 SET ARITHABORT ON;
 SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 BEGIN RAISERROR('DO_TRANSACTION_REQUIRED',16,1); RETURN; END;
 IF wf.fn_IsInitialNativeUatTarget()<>1
 BEGIN RAISERROR('DO_TARGET_NOT_SUPPORTED',16,1); RETURN; END;

 DECLARE @Today DATETIME,@DocuNo VARCHAR(30),@AI VARCHAR(30),@Amount DECIMAL(18,4),@Qty DECIMAL(18,4),@Ship DATETIME,@CreditDays INT,@Pack DECIMAL(18,4),@Bags DECIMAL(18,4),@Expn INT,@Period INT,@Book CHAR(1),@Series CHAR(1),@CouponNo VARCHAR(25);
 SET @Today=CONVERT(DATETIME,CONVERT(VARCHAR(10),DATEADD(hour,7,GETUTCDATE()),120),120);
 SELECT @DocuNo=h.DocuNo,@AI=h.AppvDocuNo,@Amount=h.NetAmnt,@Ship=h.ShipDate,@CreditDays=h.CreditDays
 FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK)
 JOIN wf.NativeBookingApproval a WITH(UPDLOCK,HOLDLOCK) ON a.SOID=h.SOID
 JOIN wf.NativeBookingOrigin o WITH(UPDLOCK,HOLDLOCK) ON o.SOID=h.SOID
 JOIN wf.SalesOrderExt e WITH(UPDLOCK,HOLDLOCK) ON e.SOID=CONVERT(VARCHAR(50),h.SOID)
 WHERE h.SOID=@SOID AND h.DocuType=103 AND h.BrchID=1
  AND h.AppvFlag='Y' AND h.AppvDocuNo=a.ApprovalNo AND h.Appvid=a.ApproverEmpId AND h.AppvDate IS NOT NULL
  AND a.PolicyVersion='O11-AI-INITIAL-UAT2-v1' AND o.PolicyVersion=a.PolicyVersion
  AND h.DocuStatus='N' AND h.PkgStatus='N' AND h.OnHold='N' AND h.ClearSO='N'
  AND ISNULL(h.RefSOID,0)=0 AND ISNULL(h.RefNo,'')='' AND ISNULL(h.CouponFlag,'N')='N'
  AND ISNULL(h.VatRate,0)=0 AND ISNULL(h.VATAmnt,0)=0 AND ISNULL(h.BaseDiscAmnt,0)=0
  AND ISNULL(h.BillDiscAmnt,0)=0 AND ISNULL(h.CommissionAmnt,0)=0 AND ISNULL(h.MiscChargAmnt,0)=0
  AND ISNULL(h.ExchRate,1)=1 AND h.NetAmnt>0 AND h.SumGoodAmnt=h.NetAmnt AND h.BillAftrDiscAmnt=h.NetAmnt
  AND h.DocuDate<=@Today AND h.ValidDays>=0 AND DATEADD(day,h.ValidDays,h.DocuDate)>=@Today
  AND e.SourceDraftId=o.SourceDraftId AND e.SalesUserId=o.SalesUserId
  AND ISNULL(e.IsUnlocked,0)=0 AND ISNULL(e.IsLoaded,0)=0 AND e.WeighOutWeight IS NULL;
 IF @DocuNo IS NULL BEGIN RAISERROR('DO_SOURCE_UNAVAILABLE',16,1); RETURN; END;
 SELECT @Qty=GoodQty2 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID AND ListNo=1;
 IF (SELECT COUNT(*) FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID)<>1 OR @Qty IS NULL OR @Qty<=0
  OR EXISTS(SELECT 1 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID AND
   (DocuType<>103 OR ListNo<>1 OR ISNULL(RefSOID,0)<>0 OR ISNULL(Refno,'')<>''
    OR ISNULL(RemaQty,-1)<>GoodQty2 OR ISNULL(GoodQty1,0)<>0 OR ISNULL(GoodStockUnitID,-1)<>ISNULL(GoodUnitID2,-2)
    OR ISNULL(GoodStockRate2,0)<>1 OR ISNULL(GoodStockQty,0)<>GoodQty2
    OR ISNULL(GoodPrice2,0)<=0 OR GoodQty2*GoodPrice2<>@Amount OR ISNULL(GoodAmnt,-1)<>@Amount
    OR ISNULL(GoodRemaQty1,-1)<>GoodQty2 OR ISNULL(StockFlag,0)<>-1
    OR ISNULL(GoodCost,0)<>0 OR ISNULL(SumExcludeAmnt,0)<>0 OR ISNULL(MiscChargAmnt,0)<>0
    OR ISNULL(GoodDiscAmnt,0)<>0 OR ISNULL(FreeFlag,'N')='Y' OR ISNULL(LotFlag,'N')<>'N'
    OR ISNULL(SerialFlag,'N')<>'N' OR ISNULL(ReserveQty,0)<>0 OR ISNULL(PostStock,'N')<>'N'))
  OR EXISTS(SELECT 1 FROM wf.PriceApproval p WITH(UPDLOCK,HOLDLOCK)
    JOIN wf.NativeBookingOrigin o ON p.SoId=o.SourceDraftId WHERE o.SOID=@SOID AND p.Status='PENDING')
  OR EXISTS(SELECT 1 FROM wf.SalesOrderAudit WITH(UPDLOCK,HOLDLOCK) WHERE SoId=CONVERT(VARCHAR(50),@SOID)
    AND Action IN('UPDATED','EDIT_UNLOCKED','WINSPEED_APPROVAL_RESET','PICKING','LOADED','SHIPPED','CANCELLED'))
  OR EXISTS(SELECT 1 FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE RefSOID=@SOID)
  OR EXISTS(SELECT 1 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE RefSOID=@SOID)
  OR EXISTS(SELECT 1 FROM dbo.WFCoupon WITH(UPDLOCK,HOLDLOCK) WHERE DocuID=@SOID)
  OR EXISTS(SELECT 1 FROM dbo.SOPickingDT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID)
  OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID=@SOID)
  OR EXISTS(SELECT 1 FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE RefID=@SOID)
  OR EXISTS(SELECT 1 FROM wf.CouponReservation WITH(UPDLOCK,HOLDLOCK) WHERE CarrierSoId=CONVERT(VARCHAR(50),@SOID))
 BEGIN RAISERROR('DO_CONTRACT_UNSUPPORTED',16,1); RETURN; END;

 -- Only the observed credit-warning fixture is supported. Nonempty debt,
 -- temporary/approved-credit and other deduction modes must not be guessed.
 DECLARE @Cust INT;
 SELECT @Cust=CustID FROM dbo.SOHD WHERE SOID=@SOID;
 IF NOT EXISTS(SELECT 1 FROM dbo.EMCust WITH(UPDLOCK,HOLDLOCK) WHERE CustID=@Cust AND CreditState=1 AND CreditAmnt=0)
  OR NOT EXISTS(SELECT 1 FROM dbo.SOOption WITH(UPDLOCK,HOLDLOCK) WHERE BrchID=1 AND CreditTermSO=2)
  OR EXISTS(SELECT 1 FROM dbo.SOInvHD WITH(UPDLOCK,HOLDLOCK) WHERE ARID=@Cust AND DocuStatus<>'C'
   AND ReplaceFlag='N' AND CouponFlag='N' AND (DocuType IN(107,109,110,202) OR(DocuType=201 AND ISNULL(CkCreditTerm,'N')='Y'))
   AND(RemaAmnt IS NULL OR RemaAmnt<>0))
  OR EXISTS(SELECT 1 FROM dbo.EMCustTempCreditDT d WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.EMCustTempCreditHD h WITH(UPDLOCK,HOLDLOCK) ON h.CreditID=d.CreditID
   WHERE d.CustID=@Cust AND @Today BETWEEN CONVERT(DATETIME,CONVERT(VARCHAR(10),h.CreditStartDate,120),120)
    AND CONVERT(DATETIME,CONVERT(VARCHAR(10),h.CreditEndDate,120),120))
  OR EXISTS(SELECT 1 FROM dbo.SOCreditApprov WITH(UPDLOCK,HOLDLOCK) WHERE CustID=@Cust AND CreditFlag='N'
   AND @Today BETWEEN CONVERT(DATETIME,CONVERT(VARCHAR(10),CreditStartDate,120),120)
    AND CONVERT(DATETIME,CONVERT(VARCHAR(10),CreditEndDate,120),120))
 BEGIN RAISERROR('DO_CREDIT_CONTRACT_UNSUPPORTED',16,1); RETURN; END;


 -- Full single-line, whole-bag, tonne, zero-tax contract only.
 SET @Book=LEFT(@DocuNo,1); SET @Series=CASE @Book WHEN 'I' THEN 'C' WHEN 'K' THEN 'D' END;
 IF @Series IS NULL OR LEN(@DocuNo)<>9 OR @DocuNo NOT LIKE '[IK][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9]'
  OR @Ship IS NULL OR @Ship<@Today OR @CreditDays IS NULL OR @CreditDays<0 OR @CreditDays>3650
 BEGIN RAISERROR('DO_CONTRACT_UNSUPPORTED',16,1); RETURN; END;
 SELECT @Pack=g.GoodWeight,@Expn=g.ExpnID
 FROM dbo.SODT d WITH(UPDLOCK,HOLDLOCK) JOIN dbo.EMGood g WITH(UPDLOCK,HOLDLOCK) ON g.GoodID=d.GoodID
 JOIN dbo.EMGoodUnit u WITH(UPDLOCK,HOLDLOCK) ON u.GoodUnitID=d.GoodUnitID2
 WHERE d.SOID=@SOID AND d.ListNo=1 AND u.GoodUnitCode=N'ตัน' AND d.ShipDate=@Ship;
 IF @Pack IS NULL OR @Pack<=0 OR @Expn IS NULL OR @Qty>99999999
 BEGIN RAISERROR('DO_PACKAGING_UNSUPPORTED',16,1); RETURN; END;
 SET @Bags=CONVERT(DECIMAL(18,4),@Qty*1000.0/@Pack);
 IF @Bags<=0 OR @Bags<>FLOOR(@Bags) OR @Bags*@Pack<>@Qty*1000.0
 BEGIN RAISERROR('DO_PACKAGING_UNSUPPORTED',16,1); RETURN; END;
 IF (SELECT COUNT(*) FROM dbo.EMPeriod WITH(UPDLOCK,HOLDLOCK)
  WHERE PeriodType='N' AND CloseStatus='N' AND @Today>=BeginDate AND @Today<=EndDate)<>1
 BEGIN RAISERROR('DO_PERIOD_UNSUPPORTED',16,1); RETURN; END;
 SELECT @Period=PeriodID FROM dbo.EMPeriod WITH(UPDLOCK,HOLDLOCK)
  WHERE PeriodType='N' AND CloseStatus='N' AND @Today>=BeginDate AND @Today<=EndDate;

 DECLARE @Last VARCHAR(50),@Fmt VARCHAR(50),@Prefix VARCHAR(4),@Max INT,@Next INT,@No VARCHAR(30),
  @BrFmt VARCHAR(50),@BrLast VARCHAR(50),@ChFmt VARCHAR(50),@ChLast VARCHAR(50),@CharCount INT,@CharList INT,@InBr BIT;
 SELECT @BrFmt=RTRIM(RunFormat),@BrLast=RTRIM(LastNo) FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='104' AND BrchID=1;
 SELECT @CharCount=SUM(CASE WHEN LEFT(Prefix,1)=@Book THEN 1 ELSE 0 END),
  @ChFmt=MAX(CASE WHEN LEFT(Prefix,1)=@Book THEN RTRIM(Prefix) END),
  @ChLast=MAX(CASE WHEN LEFT(Prefix,1)=@Book THEN RTRIM(Lastno) END),
  @CharList=MAX(CASE WHEN LEFT(Prefix,1)=@Book THEN ListNo END)
 FROM dbo.EMRunChar WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='104' AND BrchID=1;
 SET @InBr=CASE WHEN LEFT(@BrFmt,1)=@Book THEN 1 ELSE 0 END;
 SET @Fmt=CASE WHEN @InBr=1 THEN @BrFmt ELSE @ChFmt END;
 SET @Last=CASE WHEN @InBr=1 THEN @BrLast ELSE @ChLast END;
 SET @Prefix=@Book+RIGHT(CONVERT(VARCHAR(4),YEAR(@Today)+543),2)+'-';
 IF @BrFmt IS NULL OR @BrFmt NOT IN('Iyy-00000','Kyy-00000') OR ISNULL(@CharCount,0)<>1 OR @Fmt<>@Book+'yy-00000' OR @ChFmt<>@Book+'yy-00000'
  OR @CharList<>CASE @Book WHEN 'I' THEN 1 ELSE 2 END
  OR @Last IS NULL OR LEN(@Last)<>9 OR LEFT(@Last,4)<>@Prefix
  OR SUBSTRING(@Last,5,5) NOT LIKE '[0-9][0-9][0-9][0-9][0-9]'
 BEGIN RAISERROR('DO_COUNTER_UNSUPPORTED',16,1); RETURN; END;
 SELECT @Max=ISNULL(MAX(CONVERT(INT,SUBSTRING(DocuNo,5,5))),0) FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK)
  WHERE DocuType=104 AND BrchID=1 AND DocuNo LIKE @Prefix+'[0-9][0-9][0-9][0-9][0-9]' AND LEN(DocuNo)=9;
 SET @Next=CONVERT(INT,SUBSTRING(@Last,5,5)); IF @Max>@Next SET @Next=@Max; SET @Next=@Next+1;
 IF @Next>99999 BEGIN RAISERROR('DO_NUMBER_EXHAUSTED',16,1); RETURN; END;

 -- Validate both coupon books before invoking145's atomic allocator; never switch the active book.
 DECLARE @CBFmt VARCHAR(50),@CBLast VARCHAR(50),@CCFmt VARCHAR(50),@CCLast VARCHAR(50),@CCCount INT,@CCList INT,@CLast VARCHAR(50),@CFmt VARCHAR(50);
 SELECT @CBFmt=RTRIM(RunFormat),@CBLast=RTRIM(LastNo) FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='couponno' AND BrchID=1;
 SELECT @CCCount=SUM(CASE WHEN LEFT(Prefix,1)=@Series THEN 1 ELSE 0 END),
  @CCFmt=MAX(CASE WHEN LEFT(Prefix,1)=@Series THEN RTRIM(Prefix) END),
  @CCLast=MAX(CASE WHEN LEFT(Prefix,1)=@Series THEN RTRIM(Lastno) END),
  @CCList=MAX(CASE WHEN LEFT(Prefix,1)=@Series THEN ListNo END)
 FROM dbo.EMRunChar WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='couponno' AND BrchID=1;
 SET @CLast=CASE WHEN LEFT(@CBFmt,1)=@Series THEN @CBLast ELSE @CCLast END;
 SET @CFmt=CASE WHEN LEFT(@CBFmt,1)=@Series THEN @CBFmt ELSE @CCFmt END;
 IF @CBFmt IS NULL OR @CBFmt NOT IN('Cyy00000','Dyy00000') OR ISNULL(@CCCount,0)<>1 OR @CFmt<>@Series+'yy00000' OR @CCFmt<>@Series+'yy00000'
  OR @CCList<>CASE @Series WHEN 'C' THEN 1 ELSE 2 END OR @CLast IS NULL OR LEN(@CLast)<>8
  OR LEFT(@CLast,3)<>@Series+RIGHT(CONVERT(VARCHAR(4),YEAR(@Today)+543),2)
  OR SUBSTRING(@CLast,4,5) NOT LIKE '[0-9][0-9][0-9][0-9][0-9]'
 BEGIN RAISERROR('DO_COUPON_COUNTER_UNSUPPORTED',16,1); RETURN; END;
 IF @Preview=1 BEGIN SELECT CONVERT(VARCHAR(40),@Amount) AS Amount,1 AS RequiresCreditApproval,
  @Book AS SourceBook,@Series AS CouponSeries,CONVERT(VARCHAR(40),@Pack) AS PackKg,
  CONVERT(VARCHAR(40),@Bags) AS SackQty,@Period AS PeriodID; RETURN; END;

 DECLARE @Username NVARCHAR(100);
 SELECT @Username=Username FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK)
  WHERE Id=@UserId AND IsActive=1 AND MustChangePassword=0 AND Role IN('SALES','COUNTER_SALES','ACCOUNTING','MANAGER','C_LEVEL','ADMIN');
 IF @Username IS NULL OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@ActorId AND IsActive=1 AND MustChangePassword=0)
 BEGIN RAISERROR('DO_ACTOR_UNAVAILABLE',16,1); RETURN; END;
 IF NOT EXISTS(SELECT 1 FROM wf.NativeDeliveryRequest r WITH(UPDLOCK,HOLDLOCK)
  JOIN wf.AppUser u WITH(UPDLOCK,HOLDLOCK) ON u.Id=r.ApprovedById
  JOIN wf.AppUser a WITH(UPDLOCK,HOLDLOCK) ON a.Id=r.ApproverActorId
  WHERE r.SOID=@SOID AND r.RequestId=@RequestId AND r.Fingerprint=@Fingerprint AND r.Amount=@Amount
   AND r.Status='APPROVED' AND r.ExpiresAt>GETUTCDATE() AND r.PolicyVersion='O25-DO104-COMPLETE-UAT2-v2'
   AND r.RequestedById=@UserId AND r.RequesterActorId=@ActorId
   AND LEN(ISNULL(r.Reason,N''))>=5 AND r.SelfApproval=CASE WHEN r.RequesterActorId=r.ApproverActorId THEN 1 ELSE 0 END
   AND u.Role='ACCOUNTING' AND u.IsActive=1 AND u.MustChangePassword=0 AND a.IsActive=1 AND a.MustChangePassword=0
   AND(a.Id=u.Id OR a.Role IN('ACCOUNTING','MANAGER','C_LEVEL','ADMIN')))
 BEGIN RAISERROR('DO_CREDIT_APPROVAL_REQUIRED',16,1); RETURN; END;
 IF EXISTS(SELECT 1 FROM wf.NativeDeliveryReceipt WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@SOID OR RequestId=@RequestId)
 BEGIN RAISERROR('DO_REQUEST_CONFLICT',16,1); RETURN; END;

 DECLARE @NewId INT,@CouponId INT,@AuditId INT,@EventId INT,@FinanceId INT,@GlobalId INT,@VATId INT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SOHD',@NewId=@NewId OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='WFCoupon',@NewId=@CouponId OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SMAudit',@NewId=@AuditId OUTPUT;
 EXEC wf.usp_AllocateInitialDeliveryEventId @NewId=@EventId OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SOInvHD',@NewId=@FinanceId OUTPUT;
 EXEC wf.usp_AllocateInitialVATId @NewId=@VATId OUTPUT;
 EXEC wf.usp_AllocateInitialSAT @GlobalFlag=202,@Username=@Username,@NewId=@GlobalId OUTPUT;
 EXEC wf.usp_AllocateCouponNo @Series=@Series,@DocuDate=@Today,@BrchID='1',@CouponNo=@CouponNo OUTPUT;
 IF @NewId IS NULL OR @CouponId IS NULL OR @AuditId IS NULL OR @EventId IS NULL OR @FinanceId IS NULL OR @VATId IS NULL OR @GlobalId IS NULL
  OR @CouponNo IS NULL OR LEN(@CouponNo)<>8 OR LEFT(@CouponNo,1)<>@Series
 BEGIN RAISERROR('DO_ID_CONFLICT',16,1); RETURN; END;
 SET @No=@Prefix+RIGHT('00000'+CONVERT(VARCHAR(5),@Next),5);
 -- Native unique document key is Branch + DocuNo + DocuType, not DocuNo alone.
 IF EXISTS(SELECT 1 FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE BrchID=1 AND DocuType=104 AND DocuNo=@No)
  OR EXISTS(SELECT 1 FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@NewId)
  OR EXISTS(SELECT 1 FROM dbo.WFCoupon WITH(UPDLOCK,HOLDLOCK) WHERE CouponID=@CouponId)
  OR EXISTS(SELECT 1 FROM dbo.SMAudit WITH(UPDLOCK,HOLDLOCK) WHERE audit_id=@AuditId)
  OR EXISTS(SELECT 1 FROM dbo.SMEvent WITH(UPDLOCK,HOLDLOCK) WHERE eventid=@EventId)
  OR EXISTS(SELECT 1 FROM dbo.ICStockPack WITH(UPDLOCK,HOLDLOCK) WHERE DocuID=@NewId AND DocuType=104)
  OR EXISTS(SELECT 1 FROM dbo.ICStockSerialDetail WITH(UPDLOCK,HOLDLOCK) WHERE DocuID=@NewId AND DocuType=104)
 BEGIN RAISERROR('DO_ID_CONFLICT',16,1); RETURN; END;

 INSERT INTO dbo.SOHD(SOID,SaleAreaID,EmpID,BrchID,CustID,DocuNo,DocuType,DocuDate,ValidDays,OnHold,
  VatRate,VatType,GoodType,CreditDays,ExchRate,ShipDate,SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,
  BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,TotaExcludeAmnt,TotaBaseAmnt,VATAmnt,NetAmnt,
  DocuStatus,CustPONo,RefNo,RefDate,CommissionAmnt,ClearSO,FromFlag,MiscChargAmnt,MultiCurrency,CustName,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,AppvFlag,PkgStatus,Refeflag,CouponFlag)
 SELECT @NewId,SaleAreaID,EmpID,BrchID,CustID,@No,104,@Today,DATEDIFF(day,@Today,@Ship),OnHold,
  VatRate,VatType,GoodType,CreditDays,ExchRate,ShipDate,SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,
  BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,TotaExcludeAmnt,TotaBaseAmnt,VATAmnt,NetAmnt,
  'Y',ISNULL(CustPONo,''),@AI,AppvDate,CommissionAmnt,ClearSO,103,MiscChargAmnt,MultiCurrency,CustName,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,'W','N',Refeflag,'Y'
 FROM dbo.SOHD WHERE SOID=@SOID;
 INSERT INTO dbo.SODT(DocuType,GoodID,GoodName,InveID,LocaID,GoodPrice1,GoodQty1,GoodUnitID2,
  GoodStockRate1,GoodQty2,GoodPrice2,GoodStockRate2,MiscChargAmnt,SumExcludeAmnt,ShipDate,RefListNo,
  RemaBefoQty,GoodType,GoodStockUnitID,GoodStockQty,GoodCost,VatType,StockFlag,GoodFlag,RemaQty,
  GoodDiscAmnt,LotFlag,SerialFlag,GoodAmnt,ResvAmnt2,ResvAmnt1,ReserveQty,ListNo,SOID,RefSOID,
  GoodRemaQty1,GoodRemaQty2,MarkUpAmnt,CommisAmnt,Refno,POQty,RemaQtyPkg,Expireflag,PostStock,
  AfterMarkupamnt,RemaGoodStockQty,RemaAmnt)
 SELECT 104,GoodID,GoodName,InveID,LocaID,GoodPrice1,GoodQty1,GoodUnitID2,
  1,GoodQty2,GoodPrice2,GoodStockRate2,MiscChargAmnt,SumExcludeAmnt,ShipDate,1,
  0,GoodType,GoodStockUnitID,GoodStockQty,GoodCost,VatType,StockFlag,GoodFlag,GoodQty2,
  GoodDiscAmnt,LotFlag,SerialFlag,GoodAmnt,0,0,ReserveQty,1,@NewId,@SOID,
  GoodRemaQty1,0,0,0,@AI,POQty,RemaQtyPkg,Expireflag,PostStock,
  AfterMarkupamnt,RemaGoodStockQty,RemaAmnt FROM dbo.SODT WHERE SOID=@SOID AND ListNo=1;
 INSERT INTO dbo.SOHDRemark(ListNo,SOID,Remark)
 SELECT 1,@NewId,'' UNION ALL SELECT 2,@NewId,'' UNION ALL SELECT 3,@NewId,''
 UNION ALL SELECT 4,@NewId,'' UNION ALL SELECT 5,@NewId,'';
 INSERT INTO dbo.WFCoupon(CouponID,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,DocuID,RefListNo,
  Docutype,Listno,CouponNo,SONo,ContainQty,GoodQty,SackQty,RemaQty,GoodName)
 SELECT @CouponId,GoodID,InveID,LocaID,GoodUnitID2,GoodPrice2,@NewId,1,104,1,@CouponNo,@No,@Pack,GoodQty2,@Bags,GoodQty2,GoodName
 FROM dbo.SODT WHERE SOID=@SOID AND ListNo=1;
 UPDATE dbo.SODT SET RemaQty=RemaQty-@Qty WHERE SOID=@SOID AND ListNo=1 AND RemaQty=@Qty;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('DO_SOURCE_UNAVAILABLE',16,1); RETURN; END;
 UPDATE dbo.SOHD SET DocuStatus='Y' WHERE SOID=@SOID AND DocuStatus='N';
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('DO_SOURCE_UNAVAILABLE',16,1); RETURN; END;
 IF @InBr=1 UPDATE dbo.EMRunBrch SET LastNo=@No WHERE RunCode='104' AND BrchID=1 AND LastNo=@Last AND RunFormat=@Fmt;
 ELSE UPDATE dbo.EMRunChar SET Lastno=@No WHERE RunCode='104' AND BrchID=1 AND ListNo=@CharList AND Prefix=@Fmt AND Lastno=@Last;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('DO_COUNTER_UNSUPPORTED',16,1); RETURN; END;
 INSERT INTO dbo.Define_104(ID) VALUES(@NewId);

 -- Issuance establishes202 now;107 is a separate coupon/stock document, not another debt.
 IF EXISTS(SELECT 1 FROM dbo.SOInvHD WITH(UPDLOCK,HOLDLOCK) WHERE SOInvID=@FinanceId OR(DocuNo=@No AND BrchID=1 AND Docutype=202))
  OR EXISTS(SELECT 1 FROM dbo.VTVAT WITH(UPDLOCK,HOLDLOCK) WHERE VATID=@VATId)
  OR EXISTS(SELECT 1 FROM dbo.SMSat WITH(UPDLOCK,HOLDLOCK) WHERE GlobalID=@GlobalId)
 BEGIN RAISERROR('DO_ID_CONFLICT',16,1); RETURN; END;
 INSERT INTO dbo.SMSat(GlobalID,GlobalFlag,DocuDate,UserName) VALUES(@GlobalId,202,GETDATE(),LEFT(N'wf:'+@Username,255));
 INSERT INTO dbo.SOInvHD(SaleAreaID,SOInvID,CustID,ARID,BrchID,EmpID,VATGroupID,ExchRate,PostID,DocuDate,DocuNo,
  VATType,VATRate,GoodType,CreditDays,PrintTime,CreditEndDate,SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,
  BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,AdvnAmnt,AftrAdvnAmnt,TotaExcludeAmnt,TotaBaseAmnt,
  VATAmnt,NetAmnt,CommisAmnt,DocuStatus,MiscChargAmnt,PostGL,CustPONo,DueDate,Docutype,InvNo,InvDate,DocuFlag,
  MultiCurrency,RemaAmnt,BillAmnt,StockEffc,LastInvAmnt,CurrentInvAmnt,Sign,ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,
  CutAdvnFlag,SONo,ReplaceFlag,LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,CouponFlag)
 SELECT SaleAreaID,@FinanceId,CustID,CustID,BrchID,EmpID,VATGroupID,1,@GlobalId,@Today,@No,
  VATType,0,GoodType,@CreditDays,0,DATEADD(day,@CreditDays,@Today),0,@Amount,@Amount,
  0,'',0,@Amount,0,@Amount,0,@Amount,0,@Amount,0,'N',0,'N',ISNULL(CustPONo,''),DATEADD(day,@CreditDays,@Today),202,@No,@Today,'N',
  'N',@Amount,0,'N',0,0,1,@Amount,0,0,0,'N',@No,'N',1,CustName,0,0,'Y' FROM dbo.SOHD WHERE SOID=@NewId;
 INSERT INTO dbo.SOInvDT(SOInvID,ListNo,ExpnID,GoodAmnt,VATType,TotaExcludeAmnt,Docutype,RefID,RefListNo)
 VALUES(@FinanceId,1,@Expn,@Amount,'2',@Amount,202,@NewId,1);
 INSERT INTO dbo.VTVAT(InvNo,InvDate,DocuNo,DocuDate,Remark,BaseAmnt,VatType,VatRate,VatAmnt,PercentClm,ClmAmnt,
  PeriodID,TaxType,FromFlag,IsLocked,ListNo,VATID,BrchID,VATGroupID,FromID)
 SELECT @No,@Today,@No,@Today,CustName,@Amount,'2',0,0,0,0,@Period,'1',202,'Y',1,@VATId,1,VATGroupID,@GlobalId
 FROM dbo.SOHD WHERE SOID=@NewId;

 DECLARE @AuditUser NVARCHAR(100),@Note NVARCHAR(255);
 SET @AuditUser=LEFT(N'wf:'+@Username,100);
 SET @Note=N'O25-DO104-COMPLETE-UAT2-v2; source='+@DocuNo+N'; AI='+@AI+N'; request='+@RequestId;
 INSERT INTO dbo.SMAudit(audit_id,audit_system,audit_screen,audit_datetime,audit_username,audit_action,
  audit_docuno,audit_docudate,audit_columnid,brchid,audit_computername,audit_refid,version,audit_query)
 VALUES(@AuditId,3,2098003049,GETDATE(),@AuditUser,'INSERT',@No,@Today,@NewId,1,HOST_NAME(),@AuditId,'WF INITIAL-104 UAT2',@Note);
 INSERT INTO dbo.SMEvent(eventid,docudate,docuno,code,c_v_name,amount,vat,totalamnt,username,objectid,brchid,docuid,c_v_id,systemid)
 SELECT @EventId,@Today,@No,c.CustCode,h.CustName,0,0,@Amount,@AuditUser,2098003049,1,@NewId,h.CustID,3
 FROM dbo.SOHD h JOIN dbo.EMCust c ON c.CustID=h.CustID WHERE h.SOID=@SOID;
 INSERT INTO wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,FromStatus,ToStatus,Note)
 VALUES(CONVERT(VARCHAR(50),@SOID),@UserId,@ActorId,'NATIVE_104_CREATED','CONFIRMED','CONFIRMED',@Note+N';104='+@No);
 UPDATE wf.NativeDeliveryRequest SET Status='CONSUMED' WHERE RequestId=@RequestId AND Status='APPROVED';
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('DO_CREDIT_APPROVAL_REQUIRED',16,1); RETURN; END;
 INSERT INTO wf.NativeDeliveryReceipt(SourceSOID,RequestId,Fingerprint,DeliverySOID,DeliveryNo,CouponID,
  AppliedById,ApplierActorId,NativeAuditId,NativeEventId,PolicyVersion,CouponNo,FinanceSOInvID,FinancePostID,FinanceVATID,ContainQty,SackQty)
 VALUES(@SOID,@RequestId,@Fingerprint,@NewId,@No,@CouponId,@UserId,@ActorId,@AuditId,@EventId,'O25-DO104-COMPLETE-UAT2-v2',@CouponNo,@FinanceId,@GlobalId,@VATId,@Pack,@Bags);
 SELECT * FROM wf.NativeDeliveryReceipt WHERE SourceSOID=@SOID;
END
GO
ALTER PROCEDURE wf.usp_AllocateInitialRedemptionId @NewId int OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET @NewId=NULL;
 IF @@TRANCOUNT=0 OR wf.fn_IsInitialNativeUatTarget()<>1 BEGIN RAISERROR('MR_TARGET_NOT_SUPPORTED',16,1); RETURN; END;
 DECLARE @P int,@M int,@D int,@N int,@G int; SET @G=0;
 SELECT @P=MAX(Prefix) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND Name='wssale-app/backend/wfredemtionhd';
 WHILE @G<20 BEGIN
  SET @G=@G+1;
  IF @P IS NULL BEGIN
   SELECT @M=ISNULL(MAX(Prefix),0) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND CHARINDEX('wfredemtionhd',LOWER(Name))>0;
   SELECT @D=ISNULL(MAX(RedemtionID),0) FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK);
   IF @D/1000*1000>@M SET @M=@D/1000*1000;
   IF @M>2147481000 BEGIN RAISERROR('MR_ID_EXHAUSTED',16,1); RETURN; END;
   SET @P=@M+1000; INSERT INTO dbo.SMID(Name,Prefix,Type) VALUES('wssale-app/backend/wfredemtionhd',@P,1);
  END;
  IF @P%1000<>0 OR @P>2147482000 OR EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
   WHERE Type=1 AND Prefix=@P AND CHARINDEX('wfredemtionhd',LOWER(Name))>0 AND Name<>'wssale-app/backend/wfredemtionhd')
  BEGIN RAISERROR('MR_ID_CONFLICT',16,1); RETURN; END;
  SELECT @N=ISNULL(MAX(RedemtionID)+1,@P) FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID>=@P AND RedemtionID<@P+1000;
  IF @N<@P+1000 BEGIN SET @NewId=@N; RETURN; END; SET @P=NULL;
 END;
 RAISERROR('MR_ID_EXHAUSTED',16,1);
END
GO
ALTER PROCEDURE wf.usp_CreateInitialManualRedemption
 @SOID int,@RequestId varchar(36),@Fingerprint varchar(64),@UserId int,@ActorId int
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; SET ARITHABORT ON; SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 BEGIN RAISERROR('MR_TRANSACTION_REQUIRED',16,1); RETURN; END;
 IF wf.fn_IsInitialNativeUatTarget()<>1 BEGIN RAISERROR('MR_TARGET_NOT_SUPPORTED',16,1); RETURN; END;
 DECLARE @Today datetime,@Delivery int,@Coupon int,@Qty decimal(18,4),@Before varchar(64),@Plate nvarchar(25),@Receiver nvarchar(100),@Username nvarchar(100),@AppvEmp int,@DataHash varchar(64);
 SET @Today=CONVERT(datetime,CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120),120);
 SELECT @Delivery=r.DeliverySOID,@Coupon=r.CouponID,@Before=r.DeliveryAfterHash,@Qty=c.GoodQty
 FROM wf.NativeDeliveryReceipt r WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=r.DeliverySOID AND h.DocuType=104 AND h.BrchID=1 AND h.DocuStatus='Y' AND h.CouponFlag='Y'
 JOIN dbo.SODT d WITH(UPDLOCK,HOLDLOCK) ON d.SOID=h.SOID AND d.ListNo=1 AND d.DocuType=104 AND d.RefSOID=@SOID
 JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=r.CouponID AND c.DocuID=h.SOID AND c.Docutype=104 AND c.RefListno=1 AND c.CouponNo=r.CouponNo
 WHERE r.SourceSOID=@SOID AND r.PolicyVersion='O25-DO104-COMPLETE-UAT2-v2' AND r.SourceAfterHash IS NOT NULL
  AND r.DeliveryAfterHash IS NOT NULL AND c.GoodQty>0 AND c.RemaQty=c.GoodQty AND d.RemaQty=c.GoodQty AND c.GoodQty=d.GoodQty2
  AND h.DocuDate<=@Today AND h.ShipDate>=@Today;
 IF @Delivery IS NULL OR @Before IS NULL
  OR(SELECT COUNT(*) FROM dbo.WFCoupon WITH(UPDLOCK,HOLDLOCK) WHERE DocuID=@Delivery AND Docutype=104)<>1
  OR(SELECT COUNT(*) FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@Delivery)<>1
  OR(SELECT COUNT(*) FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE RefSOID=@SOID)<>1
  OR EXISTS(SELECT 1 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE RefSOID=@Delivery)
  OR EXISTS(SELECT 1 FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE RefID=@Delivery AND Docutype=107)
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE CouponID=@Coupon)
  OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery))
  OR EXISTS(SELECT 1 FROM wf.CouponReservation WITH(UPDLOCK,HOLDLOCK) WHERE CouponId=@Coupon)
  OR EXISTS(SELECT 1 FROM wf.ControlTicketOverlay WITH(UPDLOCK,HOLDLOCK) WHERE DocuId=@Coupon)
 BEGIN RAISERROR('MR_SOURCE_UNAVAILABLE',16,1); RETURN; END;
 SELECT @Username=Username FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK)
  WHERE Id=@UserId AND IsActive=1 AND MustChangePassword=0 AND Role IN('WAREHOUSE','ACCOUNTING');
 IF @Username IS NULL OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@ActorId AND IsActive=1 AND MustChangePassword=0)
 BEGIN RAISERROR('MR_ACTOR_UNAVAILABLE',16,1); RETURN; END;
 SELECT @Plate=r.CarLicense,@Receiver=r.IssueName,@AppvEmp=emp.EmpID,@DataHash=r.ApprovedDataHash
 FROM wf.NativeManualRedemptionRequest r WITH(UPDLOCK,HOLDLOCK)
 JOIN wf.AppUser u WITH(UPDLOCK,HOLDLOCK) ON u.Id=r.ApprovedById AND u.IsActive=1 AND u.MustChangePassword=0
 JOIN wf.AppUser a WITH(UPDLOCK,HOLDLOCK) ON a.Id=r.ApproverActorId AND a.IsActive=1 AND a.MustChangePassword=0
 JOIN dbo.EMEmp emp WITH(UPDLOCK,HOLDLOCK) ON CONVERT(varchar(30),emp.EmpID)=u.EmpId
 WHERE r.SourceSOID=@SOID AND r.RequestId=@RequestId AND r.Fingerprint=@Fingerprint AND r.DeliveryBeforeHash=@Before
  AND r.Status='APPROVED' AND r.ExpiresAt>GETUTCDATE() AND r.PolicyVersion='O25-116-MANUAL-UAT2-v1'
  AND r.RequestedById=@UserId AND r.RequesterActorId=@ActorId
  AND r.EvidenceMode='UAT_SIMULATION' AND LEN(r.Reason)>=10 AND LEN(r.Evidence)>=20 AND LEN(r.ApprovedDataHash)=64
  AND LEN(r.CarLicense)>0 AND LEN(r.IssueName)>0
  AND r.SelfApproval=CASE WHEN r.RequesterActorId=r.ApproverActorId THEN 1 ELSE 0 END
  AND(a.Id=u.Id OR(a.Role IN('COUNTER_SALES','APPROVER','ACCOUNTING','MANAGER','C_LEVEL','ADMIN')
   AND CASE a.Role WHEN 'ADMIN' THEN 7 WHEN 'C_LEVEL' THEN 6 WHEN 'MANAGER' THEN 5 WHEN 'ACCOUNTING' THEN 4 WHEN 'APPROVER' THEN 3 WHEN 'COUNTER_SALES' THEN 2 ELSE 0 END
    >=CASE u.Role WHEN 'ADMIN' THEN 7 WHEN 'C_LEVEL' THEN 6 WHEN 'MANAGER' THEN 5 WHEN 'ACCOUNTING' THEN 4 WHEN 'WAREHOUSE' THEN 2 ELSE 0 END))
  AND(u.Role IN('MANAGER','C_LEVEL','ADMIN') OR(r.RequesterActorId=r.ApproverActorId AND u.Role IN('WAREHOUSE','ACCOUNTING')));
 IF @Plate IS NULL OR @Receiver IS NULL OR @AppvEmp IS NULL BEGIN RAISERROR('MR_APPROVAL_REQUIRED',16,1); RETURN; END;
 IF EXISTS(SELECT 1 FROM wf.NativeManualRedemptionReceipt WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@SOID OR RequestId=@RequestId)
 BEGIN RAISERROR('MR_REQUEST_CONFLICT',16,1); RETURN; END;
 DECLARE @Last varchar(50),@Format varchar(50),@Next int,@No varchar(25),@G int;
 SELECT @Last=RTRIM(LastNo),@Format=RTRIM(RunFormat) FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK) WHERE BrchID=1 AND RunCode='redemption';
 IF @Format IS NULL OR @Format<>'yy010000' OR @Last IS NULL OR LEN(@Last)<>8 OR @Last NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
  OR LEFT(@Last,2)<>RIGHT(CONVERT(varchar(4),YEAR(@Today)+543),2)
 BEGIN RAISERROR('MR_COUNTER_UNSUPPORTED',16,1); RETURN; END;
 SET @Next=CONVERT(int,@Last); SET @G=0;
 WHILE @G<1000 BEGIN
  SET @Next=@Next+1; SET @G=@G+1; SET @No=CONVERT(varchar(25),@Next);
  IF LEN(@No)<>8 OR LEFT(@No,2)<>LEFT(@Last,2) BEGIN RAISERROR('MR_NUMBER_EXHAUSTED',16,1); RETURN; END;
  IF NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@No) BREAK;
 END;
 IF @G>=1000 BEGIN RAISERROR('MR_NUMBER_EXHAUSTED',16,1); RETURN; END;
 DECLARE @New int,@Audit int,@Event int;
 EXEC wf.usp_AllocateInitialRedemptionId @NewId=@New OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SMAudit',@NewId=@Audit OUTPUT;
 EXEC wf.usp_AllocateInitialDeliveryEventId @NewId=@Event OUTPUT;
 IF @New IS NULL OR @Audit IS NULL OR @Event IS NULL BEGIN RAISERROR('MR_ID_CONFLICT',16,1); RETURN; END;
 IF NOT EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Name='wssale-app/backend/smaudit' AND Type=1 AND @Audit>=Prefix AND @Audit<Prefix+1000)
  OR EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND CHARINDEX('smaudit',LOWER(Name))>0 AND Name<>'wssale-app/backend/smaudit' AND @Audit>=Prefix AND @Audit<Prefix+1000)
 BEGIN RAISERROR('MR_ID_CONFLICT',16,1); RETURN; END;
 INSERT INTO dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,AppvEmpID,SumGoodQty,DocuStatus,IsCheckAll)
 VALUES(@New,@No,@Today,116,@Receiver,@Plate,@AppvEmp,@Qty,'N','Y');
 INSERT INTO dbo.WFRedemtionDT(RedemtionID,Listno,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,PostInv,GoodQty,RemaQty,IsCheck)
 SELECT @New,1,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,'N',@Qty,@Qty,'Y' FROM dbo.WFCoupon WHERE CouponID=@Coupon;
 UPDATE dbo.WFCoupon SET RemaQty=RemaQty-@Qty WHERE CouponID=@Coupon AND RemaQty=@Qty;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('MR_SOURCE_UNAVAILABLE',16,1); RETURN; END;
 UPDATE dbo.EMRunBrch SET LastNo=@No WHERE BrchID=1 AND RunCode='redemption' AND LastNo=@Last AND RunFormat=@Format;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('MR_COUNTER_UNSUPPORTED',16,1); RETURN; END;
 DECLARE @Note nvarchar(255);SET @Note=N'O25-116-MANUAL-UAT2-v1; UAT_SIMULATION; request='+@RequestId;
 INSERT INTO dbo.SMAudit(audit_id,audit_system,audit_screen,audit_datetime,audit_username,audit_action,audit_docuno,audit_docudate,audit_columnid,brchid,audit_computername,audit_refid,version,audit_query)
 VALUES(@Audit,3,2098003052,GETDATE(),LEFT(N'wf:'+@Username,100),'INSERT',@No,@Today,@New,1,HOST_NAME(),@Audit,'WF MANUAL-116 UAT2',@Note);
 INSERT INTO dbo.SMEvent(eventid,docudate,docuno,code,c_v_name,amount,vat,totalamnt,username,objectid,brchid,docuid,c_v_id,systemid)
 VALUES(@Event,@Today,@No,'','',0,0,0,LEFT(N'wf:'+@Username,100),2098003052,1,@New,0,3);
 INSERT INTO wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note)
 VALUES(CONVERT(varchar(50),@SOID),@UserId,@ActorId,'NATIVE_116_CREATED',@Note+N';116='+@No);
 UPDATE wf.NativeManualRedemptionRequest SET Status='CONSUMED' WHERE RequestId=@RequestId AND Status='APPROVED';
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('MR_APPROVAL_REQUIRED',16,1); RETURN; END;
 INSERT INTO wf.NativeManualRedemptionReceipt(SourceSOID,RequestId,Fingerprint,DeliverySOID,CouponID,RedemptionID,RedemptionNo,AppliedById,ApplierActorId,DeliveryBeforeHash,NativeAuditId,NativeEventId,ApprovedDataHash,PolicyVersion)
 VALUES(@SOID,@RequestId,@Fingerprint,@Delivery,@Coupon,@New,@No,@UserId,@ActorId,@Before,@Audit,@Event,@DataHash,'O25-116-MANUAL-UAT2-v1');
 SELECT * FROM wf.NativeManualRedemptionReceipt WHERE SourceSOID=@SOID;
END
GO
ALTER PROCEDURE wf.usp_AllocateInitialInvoiceSAT @GlobalFlag INT,@Username NVARCHAR(100),@NewId INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET @NewId=NULL;
 IF @@TRANCOUNT=0 OR wf.fn_IsInitialNativeUatTarget()<>1 OR @GlobalFlag IS NULL OR @GlobalFlag<>107 OR @Username IS NULL
 BEGIN RAISERROR('IP_TARGET_NOT_SUPPORTED',16,1); RETURN; END;
 DECLARE @P INT,@M INT,@D INT,@N INT,@Other INT,@G INT; SET @G=0;
 SELECT @P=MAX(Prefix) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=2 AND Name='wssale-app/backend/SAT';
 WHILE @G<20 BEGIN
  SET @G=@G+1;
  IF @P IS NULL BEGIN
   SELECT @M=ISNULL(MAX(Prefix),0) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=2 AND CHARINDEX('sat',LOWER(Name))>0;
   SELECT @D=ISNULL(MAX(GlobalID),0) FROM dbo.SMReserveSat WITH(UPDLOCK,HOLDLOCK);
   SELECT @Other=ISNULL(MAX(GlobalID),0) FROM dbo.SMSat WITH(UPDLOCK,HOLDLOCK);
   IF @Other>@D SET @D=@Other; IF @D/100000*100000>@M SET @M=@D/100000*100000;
   IF @M>=2147300000 BEGIN RAISERROR('IP_ID_EXHAUSTED',16,1); RETURN; END;
   SET @P=@M+100000; INSERT INTO dbo.SMID(Name,Prefix,Type) VALUES('wssale-app/backend/SAT',@P,2);
  END;
  IF @P%100000<>0 OR @P>2147300000 OR EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
   WHERE Type=2 AND Prefix=@P AND CHARINDEX('sat',LOWER(Name))>0 AND Name<>'wssale-app/backend/SAT')
  BEGIN RAISERROR('IP_ID_CONFLICT',16,1); RETURN; END;
  SELECT @N=ISNULL(MAX(GlobalID)+1,@P) FROM dbo.SMReserveSat WITH(UPDLOCK,HOLDLOCK) WHERE GlobalID>=@P AND GlobalID<@P+100000;
  IF @N<@P+100000 BEGIN
   IF EXISTS(SELECT 1 FROM dbo.SMSat WITH(UPDLOCK,HOLDLOCK) WHERE GlobalID=@N) BEGIN RAISERROR('IP_ID_CONFLICT',16,1); RETURN; END;
   INSERT INTO dbo.SMReserveSat(GlobalID,GlobalFlag,DocuDate,UserName) VALUES(@N,@GlobalFlag,GETDATE(),LEFT(N'wf:'+@Username,255));
   SET @NewId=@N; RETURN;
  END; SET @P=NULL;
 END;
 RAISERROR('IP_ID_EXHAUSTED',16,1);
END
GO
ALTER PROCEDURE wf.usp_PostInitialCouponInvoice
 @SOID int,@Preview bit,@RequestId varchar(36),@Fingerprint varchar(64),@UserId int,@ActorId int,@InvoiceDate datetime=NULL
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 BEGIN RAISERROR('IP_TRANSACTION_REQUIRED',16,1);RETURN;END;
 IF wf.fn_IsInitialNativeUatTarget()<>1 BEGIN RAISERROR('IP_TARGET_NOT_SUPPORTED',16,1);RETURN;END;
 DECLARE @Username nvarchar(100);
 SELECT @Username=Username FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@UserId AND Role='ACCOUNTING' AND IsActive=1 AND MustChangePassword=0;
 IF @Username IS NULL OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@ActorId AND IsActive=1 AND MustChangePassword=0 AND(Id=@UserId OR Role IN('ACCOUNTING','MANAGER','C_LEVEL','ADMIN')))
 BEGIN RAISERROR('IP_ACCOUNT_REQUIRED',16,1);RETURN;END;
 DECLARE @Today datetime,@Delivery int,@Cut int,@Coupon int,@Finance int,@Good int,@Inve int,@Qty money,@Amount money,@DeliveryNo varchar(30),@Series char(1),@Ship datetime,@CutDate datetime,@DeliveryHash varchar(64),@CutHash varchar(64);
 SET @Today=CONVERT(datetime,CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120),120);
 SELECT @Delivery=r.DeliverySOID,@Cut=m.RedemptionID,@Coupon=r.CouponID,@Finance=r.FinanceSOInvID,
  @Good=d.GoodID,@Inve=d.InveID,@Qty=c.GoodQty,@Amount=h.NetAmnt,@DeliveryNo=h.DocuNo,@Ship=h.ShipDate,@CutDate=ch.DocuDate,
  @DeliveryHash=r.DeliveryAfterHash,@CutHash=m.RedemptionAfterHash
 FROM wf.NativeDeliveryReceipt r WITH(UPDLOCK,HOLDLOCK)
 JOIN wf.NativeManualRedemptionReceipt m WITH(UPDLOCK,HOLDLOCK) ON m.SourceSOID=r.SourceSOID AND m.DeliverySOID=r.DeliverySOID AND m.CouponID=r.CouponID
 JOIN wf.NativeManualRedemptionRequest mr WITH(UPDLOCK,HOLDLOCK) ON mr.RequestId=m.RequestId AND mr.Status='CONSUMED' AND mr.EvidenceMode='UAT_SIMULATION' AND mr.ApprovedDataHash=m.ApprovedDataHash
 JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=r.DeliverySOID AND h.DocuType=104 AND h.BrchID=1 AND h.DocuStatus='Y' AND h.CouponFlag='Y'
 JOIN dbo.SODT d WITH(UPDLOCK,HOLDLOCK) ON d.SOID=h.SOID AND d.DocuType=104 AND d.ListNo=1 AND d.RefSOID=@SOID
 JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=r.CouponID AND c.DocuID=h.SOID AND c.Docutype=104 AND c.CouponNo=r.CouponNo AND c.RefListno=1
 JOIN dbo.WFRedemtionHD ch WITH(UPDLOCK,HOLDLOCK) ON ch.RedemtionID=m.RedemptionID AND ch.DocuType=116 AND ch.DocuDate<=@Today AND ch.DocuStatus='N' AND ch.IsCheckAll='Y'
 JOIN dbo.WFRedemtionDT cd WITH(UPDLOCK,HOLDLOCK) ON cd.RedemtionID=ch.RedemtionID AND cd.Listno=1 AND cd.CouponID=c.CouponID AND cd.CouponNo=c.CouponNo
 JOIN dbo.SOInvHD f WITH(UPDLOCK,HOLDLOCK) ON f.SOInvID=r.FinanceSOInvID AND f.Docutype=202 AND f.DocuNo=h.DocuNo AND f.CouponFlag='Y' AND f.StockEffc='N' AND f.PostGL='N'
 WHERE r.SourceSOID=@SOID AND r.PolicyVersion='O25-DO104-COMPLETE-UAT2-v2' AND m.PolicyVersion='O25-116-MANUAL-UAT2-v1'
  AND r.DeliveryAfterHash=m.DeliveryAfterHash AND m.RedemptionAfterHash IS NOT NULL
  AND h.DocuDate<=ch.DocuDate AND f.DocuDate<=ch.DocuDate
  AND c.GoodQty>0 AND c.RemaQty=0 AND d.GoodQty2=c.GoodQty AND d.RemaQty=c.GoodQty AND d.GoodStockQty=c.GoodQty AND d.GoodStockRate2=1
  AND cd.GoodQty=c.GoodQty AND cd.RemaQty=cd.GoodQty AND cd.PostInv='N' AND cd.SOInvID IS NULL AND cd.SOListNo IS NULL AND cd.IsCheck='Y'
  AND cd.GoodID=c.GoodID AND cd.GoodUnitID=c.GoodUnitID AND cd.GoodPrice=c.GoodPrice AND cd.InveID=c.InveID AND cd.LocaID=c.LocaID
  AND h.NetAmnt=d.GoodAmnt AND d.GoodAmnt=c.GoodQty*c.GoodPrice AND f.NetAmnt=h.NetAmnt AND f.RemaAmnt=f.NetAmnt AND f.CreditDays=h.CreditDays
  AND ISNULL(h.VATAmnt,0)=0 AND ISNULL(h.VATRate,0)=0 AND ISNULL(f.VATAmnt,0)=0 AND ISNULL(f.VATRate,0)=0;
 IF @Delivery IS NULL OR @DeliveryHash IS NULL OR @CutHash IS NULL
  OR(SELECT COUNT(*) FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@Delivery)<>1
  OR(SELECT COUNT(*) FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@Cut)<>1
  OR(SELECT COUNT(*) FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE CouponID=@Coupon)<>1
  OR EXISTS(SELECT 1 FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE RefID=@Delivery AND Docutype=107)
  OR EXISTS(SELECT 1 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE RefSOID=@Delivery)
  OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery))
 BEGIN RAISERROR('IP_SOURCE_UNAVAILABLE',16,1);RETURN;END;
 IF @InvoiceDate IS NULL SET @InvoiceDate=@CutDate;
 IF @InvoiceDate<>@CutDate BEGIN RAISERROR('IP_DATE_OVERRIDE_UNVERIFIED',16,1);RETURN;END;
 IF LEN(@DeliveryNo)<>9 OR @DeliveryNo NOT LIKE '[IK][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9]' BEGIN RAISERROR('IP_ACCOUNT_MISMATCH',16,1);RETURN;END;
 SET @Series=CASE LEFT(@DeliveryNo,1) WHEN 'I' THEN 'J' WHEN 'K' THEN 'N' END;
 -- Broad product scope covers all inventory/branch cases of native cost triggers.
 -- Existing cost mutations remain unsupported; never disable those triggers.
 IF EXISTS(SELECT 1 FROM dbo.ICStockDetail WITH(UPDLOCK,HOLDLOCK) WHERE GoodID=@Good AND DocuDate>=@InvoiceDate AND CostFlag='Y')
  OR EXISTS(SELECT 1 FROM dbo.ICCostDetail WITH(UPDLOCK,HOLDLOCK) WHERE GoodID=@Good AND DocuDate>=@InvoiceDate)
  OR(SELECT COUNT(*) FROM dbo.ICStockDetail WITH(UPDLOCK,HOLDLOCK) WHERE GoodID=@Good AND DocuDate>=@InvoiceDate)>1000
 BEGIN RAISERROR('IP_COST_SCOPE_UNSUPPORTED',16,1);RETURN;END;
 IF(SELECT COUNT(*) FROM dbo.EMPeriod WITH(UPDLOCK,HOLDLOCK) WHERE PeriodType='N' AND CloseStatus='N' AND @InvoiceDate BETWEEN BeginDate AND EndDate)<>1 BEGIN RAISERROR('IP_PERIOD_UNSUPPORTED',16,1);RETURN;END;
 DECLARE @BF varchar(50),@BL varchar(50),@CF varchar(50),@CL varchar(50),@Count int,@List int,@Last varchar(50),@Format varchar(50),@InBranch bit,@Prefix varchar(4),@Next int,@Max int,@No varchar(30);
 SELECT @BF=RTRIM(RunFormat),@BL=RTRIM(LastNo) FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='creditsale_docuno' AND BrchID=1;
 SELECT @Count=SUM(CASE WHEN LEFT(Prefix,1)=@Series THEN 1 ELSE 0 END),@CF=MAX(CASE WHEN LEFT(Prefix,1)=@Series THEN RTRIM(Prefix) END),@CL=MAX(CASE WHEN LEFT(Prefix,1)=@Series THEN RTRIM(Lastno) END),@List=MAX(CASE WHEN LEFT(Prefix,1)=@Series THEN ListNo END)
 FROM dbo.EMRunChar WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='creditsale_docuno' AND BrchID=1;
 SET @InBranch=CASE WHEN LEFT(@BF,1)=@Series THEN 1 ELSE 0 END;SET @Last=CASE WHEN @InBranch=1 THEN @BL ELSE @CL END;SET @Format=CASE WHEN @InBranch=1 THEN @BF ELSE @CF END;
 SET @Prefix=@Series+RIGHT(CONVERT(varchar(4),YEAR(@InvoiceDate)+543),2)+'-';
 IF @BF IS NULL OR @BF NOT IN('Jyy-00000','Nyy-00000') OR ISNULL(@Count,0)<>1 OR @CF<>@Series+'yy-00000' OR @Format<>@CF OR @List<>CASE @Series WHEN 'J' THEN 1 ELSE 2 END
  OR @Last IS NULL OR LEN(@Last)<>9 OR LEFT(@Last,4)<>@Prefix OR SUBSTRING(@Last,5,5) NOT LIKE '[0-9][0-9][0-9][0-9][0-9]' BEGIN RAISERROR('IP_COUNTER_UNSUPPORTED',16,1);RETURN;END;
 SELECT @Max=ISNULL(MAX(CONVERT(int,SUBSTRING(DocuNo,5,5))),0) FROM dbo.SOInvHD WITH(UPDLOCK,HOLDLOCK) WHERE Docutype=107 AND BrchID=1 AND LEN(DocuNo)=9 AND DocuNo LIKE @Prefix+'[0-9][0-9][0-9][0-9][0-9]';
 SET @Next=CONVERT(int,SUBSTRING(@Last,5,5));IF @Max>@Next SET @Next=@Max;SET @Next=@Next+1;
 IF @Next>99999 BEGIN RAISERROR('IP_NUMBER_EXHAUSTED',16,1);RETURN;END;
 IF @Preview=1 BEGIN SELECT @Series AS InvoiceSeries,CONVERT(varchar(40),CONVERT(decimal(18,4),@Amount)) AS Amount,CONVERT(varchar(40),CONVERT(decimal(18,4),@Qty)) AS Qty,@Good AS GoodID,@Inve AS InveID,CONVERT(varchar(10),@InvoiceDate,120) AS InvoiceDate;RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.NativeInitialInvoiceReceipt WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@SOID OR RequestId=@RequestId) BEGIN RAISERROR('IP_REQUEST_CONFLICT',16,1);RETURN;END;
 DECLARE @New int,@Global int,@Stock int;
 EXEC wf.usp_AllocateWinspeedId @TableName='SOInvHD',@NewId=@New OUTPUT;
 EXEC wf.usp_AllocateInitialInvoiceSAT @GlobalFlag=107,@Username=@Username,@NewId=@Global OUTPUT;
 SET @No=@Prefix+RIGHT('00000'+CONVERT(varchar(5),@Next),5);
 IF @New IS NULL OR @Global IS NULL OR EXISTS(SELECT 1 FROM dbo.SOInvHD WITH(UPDLOCK,HOLDLOCK) WHERE SOInvID=@New OR(DocuNo=@No AND BrchID=1 AND Docutype=107))
  OR EXISTS(SELECT 1 FROM dbo.ICStockDetail WITH(UPDLOCK,HOLDLOCK) WHERE DocuID=@New AND DocuType=107)
  OR NOT EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND Name='wssale-app/backend/soinvhd' AND @New>=Prefix AND @New<Prefix+1000)
  OR EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND CHARINDEX('soinvhd',LOWER(Name))>0 AND Name<>'wssale-app/backend/soinvhd' AND @New>=Prefix AND @New<Prefix+1000)
 BEGIN RAISERROR('IP_ID_CONFLICT',16,1);RETURN;END;
 INSERT INTO dbo.SMSat(GlobalID,GlobalFlag,DocuDate,UserName) VALUES(@Global,107,GETDATE(),LEFT(N'wf:'+@Username,255));
 INSERT INTO dbo.SOInvHD(SaleAreaID,SOInvID,CustID,ARID,BrchID,EmpID,VATGroupID,ExchRate,PostID,DocuDate,DocuNo,VATType,VATRate,GoodType,CreditDays,PrintTime,CreditEndDate,
  SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,AdvnAmnt,AftrAdvnAmnt,TotaExcludeAmnt,TotaBaseAmnt,VATAmnt,NetAmnt,CommisAmnt,
  DocuStatus,MiscChargAmnt,PostGL,CustPONo,DueDate,Docutype,InvNo,ShipDate,InvDate,DocuFlag,MultiCurrency,RemaAmnt,BillAmnt,StockEffc,LastInvAmnt,CurrentInvAmnt,Sign,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,CutAdvnFlag,SONo,ReplaceFlag,LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,CouponFlag)
 SELECT SaleAreaID,@New,CustID,ARID,BrchID,EmpID,VATGroupID,ExchRate,@Global,@InvoiceDate,@No,VATType,VATRate,GoodType,CreditDays,0,DATEADD(day,CreditDays,@InvoiceDate),
  SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,AdvnAmnt,AftrAdvnAmnt,TotaExcludeAmnt,0,VATAmnt,NetAmnt,CommisAmnt,
  'N',MiscChargAmnt,'N',CustPONo,DATEADD(day,CreditDays,@InvoiceDate),107,@No,@Ship,@InvoiceDate,DocuFlag,MultiCurrency,RemaAmnt,BillAmnt,'Y',LastInvAmnt,CurrentInvAmnt,Sign,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,CutAdvnFlag,SONo,ReplaceFlag,LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,'Y' FROM dbo.SOInvHD WHERE SOInvID=@Finance AND Docutype=202;
 INSERT INTO dbo.SOInvDT(SOInvID,ListNo,LocaID,GoodName,InveID,GoodID,GoodUnitID2,GoodStockRate1,GoodQty2,GoodStockRate2,GoodStockUnitID,GoodStockQty,GoodPrice2,GoodAmnt,VATType,TotaExcludeAmnt,StockFlag,Docutype,RefID,RefListNo,RemaGoodStockQty,CNRemaQty)
 SELECT @New,1,LocaID,GoodName,InveID,GoodID,GoodUnitID2,1,@Qty,1,GoodStockUnitID,@Qty,GoodPrice2,GoodAmnt,'2',GoodAmnt,-1,107,@Delivery,1,@Qty,@Qty FROM dbo.SODT WHERE SOID=@Delivery AND ListNo=1;
 INSERT INTO dbo.ICStockDetail(GoodID,CustID,GoodUnitID2,BrchID,GoodName,InveID,LocaID,GoodStockUnitID,JobFlag,GoodStockRate1,GoodStockRate2,DocuType,DocuTypeCode,GoodQty1,GoodQty2,GoodPrice2,GoodStockQty,
  GoodAddCost,GoodAddFlag,GoodCost,GoodAmnt,RemaQty,DocuDate,DocuNo,ListNo,LotNo,DocuID,FreeFlag,StockFlag,LandedAmnt,VatType,VatRate,VatAmnt,ExpireFlag,AdjustFlag,PostFlag,CostFlag,AdjustCost,SaveTime)
 SELECT d.GoodID,h.CustID,d.GoodUnitID2,1,d.GoodName,d.InveID,d.LocaID,d.GoodStockUnitID,'N',1,1,107,'0',0,@Qty,d.GoodPrice2,@Qty,
  0,'N',0,d.GoodAmnt,-@Qty,@InvoiceDate,@No,1,'',@New,'N',-1,0,h.VatType,0,0,'N','N','N','N',0,CONVERT(varchar(19),GETDATE(),120)
 FROM dbo.SODT d JOIN dbo.SOHD h ON h.SOID=d.SOID WHERE d.SOID=@Delivery AND d.ListNo=1;
 SET @Stock=CONVERT(int,SCOPE_IDENTITY());IF @Stock IS NULL BEGIN RAISERROR('IP_STOCK_ID_UNAVAILABLE',16,1);RETURN;END;
 UPDATE dbo.SODT SET RemaQty=RemaQty-@Qty WHERE SOID=@Delivery AND ListNo=1 AND DocuType=104 AND RemaQty=@Qty;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('IP_SOURCE_UNAVAILABLE',16,1);RETURN;END;
 UPDATE dbo.WFRedemtionDT SET RemaQty=0,PostInv='Y',SOInvID=@New,SOListNo=1 WHERE RedemtionID=@Cut AND Listno=1 AND CouponID=@Coupon AND PostInv='N' AND RemaQty=@Qty;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('IP_SOURCE_UNAVAILABLE',16,1);RETURN;END;
 UPDATE dbo.WFRedemtionHD SET DocuStatus='Y' WHERE RedemtionID=@Cut AND DocuType=116 AND DocuStatus='N';IF @@ROWCOUNT<>1 BEGIN RAISERROR('IP_SOURCE_UNAVAILABLE',16,1);RETURN;END;
 IF @InBranch=1 UPDATE dbo.EMRunBrch SET LastNo=@No WHERE RunCode='creditsale_docuno' AND BrchID=1 AND RunFormat=@Format AND LastNo=@Last;
 ELSE UPDATE dbo.EMRunChar SET Lastno=@No WHERE RunCode='creditsale_docuno' AND BrchID=1 AND ListNo=@List AND Prefix=@Format AND Lastno=@Last;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('IP_COUNTER_UNSUPPORTED',16,1);RETURN;END;
 -- Captured native Post107 inserts no SMAudit/SMEvent. Do not invent a screen.
 INSERT INTO wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note) VALUES(CONVERT(varchar(50),@SOID),@UserId,@ActorId,'NATIVE_107_POSTED',N'O25-INV107-UAT2-v1; UAT_SIMULATION;107='+@No+N';request='+@RequestId);
 INSERT INTO wf.NativeInitialInvoiceReceipt(SourceSOID,RequestId,Fingerprint,DeliverySOID,RedemptionID,InvoiceID,InvoiceNo,InvoiceDate,GlobalID,StockDetailID,AppliedById,ApplierActorId,DeliveryBeforeHash,RedemptionBeforeHash,PolicyVersion)
 VALUES(@SOID,@RequestId,@Fingerprint,@Delivery,@Cut,@New,@No,@InvoiceDate,@Global,@Stock,@UserId,@ActorId,@DeliveryHash,@CutHash,'O25-INV107-UAT2-v1');
 SELECT * FROM wf.NativeInitialInvoiceReceipt WHERE SourceSOID=@SOID;
END
GO
