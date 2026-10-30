-- @transaction
-- Owner decision, 30 October 2026: native 116 recorder and approver.
-- 1. WFRedemtionHD.SaveEmpID (WinSpeed "ผู้บันทึก") is written from the requester's
--    own employee, as WinSpeed records on its own 116 documents.
-- 2. AppvEmpID is no longer written; native 116 documents leave it empty. The
--    approver's employee is kept in wf.NativeDocumentApproval, one row per document,
--    beside the requester, both app users and both real actors (Access As).
-- 3. wf.NativeApproverEmployee lists employees allowed to approve. It starts with
--    every dbo.EMEmp row; the owner disables entries afterwards from Master Data,
--    and every change is kept in wf.NativeApproverEmployeeHistory.
-- Portable to UAT and Production. The procedure keeps migration 158's target guard,
-- so it still writes only on the verified UAT clones; enabling Production writers
-- remains a separate go-live decision. No dbo structure change. The only
-- migration-time DML is the wf roster seed. Policy version and numbering unchanged.
IF OBJECT_ID('wf.usp_CreateInitialManualRedemption','P') IS NULL
 OR OBJECT_ID('wf.fn_IsInitialNativeUatTarget','FN') IS NULL
 OR OBJECT_ID('wf.NativeManualRedemptionReceipt','U') IS NULL
 RAISERROR('MR_RECORDER_PREREQUISITE_REQUIRED',16,1);
GO
IF OBJECT_ID('wf.NativeApproverEmployee','U') IS NULL
 CREATE TABLE wf.NativeApproverEmployee(
  EmpID int NOT NULL CONSTRAINT PK_NativeApproverEmployee PRIMARY KEY,
  IsEnabled bit NOT NULL CONSTRAINT DF_NativeApproverEmployee_IsEnabled DEFAULT 1,
  Note nvarchar(255) NULL,
  CreatedAt datetime NOT NULL CONSTRAINT DF_NativeApproverEmployee_CreatedAt DEFAULT GETUTCDATE(),
  UpdatedAt datetime NULL,UpdatedById int NULL,UpdatedByActorId int NULL
 );
GO
IF OBJECT_ID('wf.NativeApproverEmployeeHistory','U') IS NULL
 CREATE TABLE wf.NativeApproverEmployeeHistory(
  HistoryId int IDENTITY(1,1) NOT NULL CONSTRAINT PK_NativeApproverEmployeeHistory PRIMARY KEY,
  EmpID int NOT NULL,IsEnabled bit NOT NULL,Note nvarchar(255) NULL,
  ChangedAt datetime NOT NULL CONSTRAINT DF_NativeApproverEmployeeHistory_ChangedAt DEFAULT GETUTCDATE(),
  ChangedById int NOT NULL,ChangedByActorId int NOT NULL
 );
GO
INSERT INTO wf.NativeApproverEmployee(EmpID,Note)
SELECT e.EmpID,N'migration 160 seed' FROM dbo.EMEmp e
WHERE NOT EXISTS(SELECT 1 FROM wf.NativeApproverEmployee a WHERE a.EmpID=e.EmpID);
GO
IF OBJECT_ID('wf.NativeDocumentApproval','U') IS NULL
 CREATE TABLE wf.NativeDocumentApproval(
  DocuType smallint NOT NULL,NativeDocID int NOT NULL,NativeDocNo varchar(25) NOT NULL,
  SourceSOID int NOT NULL,RequestId varchar(36) NOT NULL,
  RecorderUserId int NOT NULL,RecorderActorId int NOT NULL,RecorderEmpID int NOT NULL,
  ApproverUserId int NOT NULL,ApproverActorId int NOT NULL,ApproverEmpID int NOT NULL,
  SelfApproval bit NOT NULL,ApprovedAt datetime NOT NULL,
  RecordedAt datetime NOT NULL CONSTRAINT DF_NativeDocumentApproval_RecordedAt DEFAULT GETUTCDATE(),
  PolicyVersion varchar(40) NOT NULL,
  CONSTRAINT PK_NativeDocumentApproval PRIMARY KEY(DocuType,NativeDocID),
  CONSTRAINT UQ_NativeDocumentApproval_Request UNIQUE(DocuType,RequestId)
 );
GO
ALTER PROCEDURE wf.usp_CreateInitialManualRedemption
 @SOID int,@RequestId varchar(36),@Fingerprint varchar(64),@UserId int,@ActorId int
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; SET ARITHABORT ON; SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 BEGIN RAISERROR('MR_TRANSACTION_REQUIRED',16,1); RETURN; END;
 IF wf.fn_IsInitialNativeUatTarget()<>1 BEGIN RAISERROR('MR_TARGET_NOT_SUPPORTED',16,1); RETURN; END;
 DECLARE @Today datetime,@Delivery int,@Coupon int,@Qty decimal(18,4),@Before varchar(64),@Plate nvarchar(25),@Receiver nvarchar(100),@Username nvarchar(100),@AppvEmp int,@DataHash varchar(64),@SaveEmp int,@ApproverId int,@ApproverActor int,@ApprovedAt datetime,@Self bit;
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
 SELECT @SaveEmp=emp.EmpID FROM wf.AppUser u WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.EMEmp emp WITH(UPDLOCK,HOLDLOCK) ON CONVERT(varchar(30),emp.EmpID)=u.EmpId WHERE u.Id=@UserId;
 IF @SaveEmp IS NULL BEGIN RAISERROR('MR_RECORDER_MAPPING_REQUIRED',16,1); RETURN; END;
 SELECT @Plate=r.CarLicense,@Receiver=r.IssueName,@AppvEmp=emp.EmpID,@DataHash=r.ApprovedDataHash,
  @ApproverId=u.Id,@ApproverActor=a.Id,@ApprovedAt=r.ApprovedAt,@Self=r.SelfApproval
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
 IF @Plate IS NULL OR @Receiver IS NULL OR @AppvEmp IS NULL OR @ApprovedAt IS NULL OR @Self IS NULL BEGIN RAISERROR('MR_APPROVAL_REQUIRED',16,1); RETURN; END;
 IF NOT EXISTS(SELECT 1 FROM wf.NativeApproverEmployee WITH(UPDLOCK,HOLDLOCK) WHERE EmpID=@AppvEmp AND IsEnabled=1)
 BEGIN RAISERROR('MR_APPROVER_NOT_LISTED',16,1); RETURN; END;
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
 INSERT INTO dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,SaveEmpID,SumGoodQty,DocuStatus,IsCheckAll)
 VALUES(@New,@No,@Today,116,@Receiver,@Plate,@SaveEmp,@Qty,'N','Y');
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
 INSERT INTO wf.NativeDocumentApproval(DocuType,NativeDocID,NativeDocNo,SourceSOID,RequestId,RecorderUserId,RecorderActorId,RecorderEmpID,
  ApproverUserId,ApproverActorId,ApproverEmpID,SelfApproval,ApprovedAt,PolicyVersion)
 VALUES(116,@New,@No,@SOID,@RequestId,@UserId,@ActorId,@SaveEmp,@ApproverId,@ApproverActor,@AppvEmp,@Self,@ApprovedAt,'O25-116-MANUAL-UAT2-v1');
 SELECT * FROM wf.NativeManualRedemptionReceipt WHERE SourceSOID=@SOID;
END
GO
