-- Initial-only UAT2 AI contract. No dbo DDL, reapproval, deletion, line/quantity
-- changes, stock posting, credit override, 104 creation or invoice posting.
-- Deliberately restricted to the separately observed UAT2 target and branch.
-- SQL Server 2008 R2 / compatibility 80: CREATE stub + ALTER, RAISERROR, DATETIME.
IF OBJECT_ID('wf.NativeBookingOrigin','U') IS NULL
BEGIN
    CREATE TABLE wf.NativeBookingOrigin (
        SOID INT NOT NULL PRIMARY KEY,
        SourceDraftId INT NOT NULL,
        SalesUserId INT NOT NULL,
        ConfirmedById INT NOT NULL,
        ConfirmedActorId INT NOT NULL,
        Fingerprint VARCHAR(64) NOT NULL,
        PolicyVersion VARCHAR(40) NOT NULL,
        CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
    );
END
GO
IF OBJECT_ID('wf.NativeBookingApproval','U') IS NULL
BEGIN
    CREATE TABLE wf.NativeBookingApproval (
        SOID INT NOT NULL PRIMARY KEY,
        RequestId VARCHAR(36) NOT NULL UNIQUE,
        Fingerprint VARCHAR(64) NOT NULL,
        ApprovalNo VARCHAR(30) NOT NULL UNIQUE,
        ApproverId INT NOT NULL,
        ApproverActorId INT NOT NULL,
        ApproverEmpId INT NOT NULL,
        RequesterId INT NOT NULL,
        RequesterActorId INT NOT NULL,
        SalesUserId INT NOT NULL,
        SelfApproval BIT NOT NULL,
        PolicyVersion VARCHAR(40) NOT NULL,
        ApprovedAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
        NativeAuditId INT NOT NULL
    );
END
GO
IF OBJECT_ID('wf.usp_ApproveInitialBooking','P') IS NULL
    EXEC('CREATE PROCEDURE wf.usp_ApproveInitialBooking AS RETURN 0');
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
    IF CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName'))<>N'AMYOU-YOGA7\V2008R2'
       OR DB_NAME()<>N'dbwins_worldfert9_uat2' OR DB_ID()<>10
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
