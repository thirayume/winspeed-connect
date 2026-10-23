-- Initial, full-quantity, no-numbered-coupon UAT2 delivery contract only.
-- No dbo DDL, stock movement, 116/107 posting, partials or credit-master changes.
IF OBJECT_ID('wf.NativeDeliveryRequest','U') IS NULL
BEGIN
 CREATE TABLE wf.NativeDeliveryRequest (
  Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  SOID INT NOT NULL, RequestId VARCHAR(36) NOT NULL UNIQUE,
  Fingerprint VARCHAR(64) NOT NULL, Amount DECIMAL(18,4) NOT NULL,
  RequestedById INT NOT NULL, RequesterActorId INT NOT NULL,
  Status VARCHAR(20) NOT NULL, RequestedAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
  ApprovedById INT NULL, ApproverActorId INT NULL, ApprovedAt DATETIME NULL,
  ExpiresAt DATETIME NULL, SelfApproval BIT NULL, Reason NVARCHAR(300) NULL,
  PolicyVersion VARCHAR(40) NOT NULL
 );
 CREATE INDEX IX_NativeDeliveryRequest_SO ON wf.NativeDeliveryRequest(SOID,Id);
END
GO
IF OBJECT_ID('wf.NativeDeliveryReceipt','U') IS NULL
BEGIN
 CREATE TABLE wf.NativeDeliveryReceipt (
  SourceSOID INT NOT NULL PRIMARY KEY, RequestId VARCHAR(36) NOT NULL UNIQUE,
  Fingerprint VARCHAR(64) NOT NULL, DeliverySOID INT NOT NULL UNIQUE,
  DeliveryNo VARCHAR(30) NOT NULL UNIQUE, CouponID INT NOT NULL UNIQUE,
  AppliedById INT NOT NULL, ApplierActorId INT NOT NULL,
  NativeAuditId INT NOT NULL, NativeEventId INT NOT NULL,
  SourceAfterHash VARCHAR(64) NULL, DeliveryAfterHash VARCHAR(64) NULL,
  PolicyVersion VARCHAR(40) NOT NULL, CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
 );
END
GO
IF OBJECT_ID('wf.usp_AllocateInitialDeliveryEventId','P') IS NULL
 EXEC('CREATE PROCEDURE wf.usp_AllocateInitialDeliveryEventId AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_AllocateInitialDeliveryEventId @NewId INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 OR CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName'))<>N'AMYOU-YOGA7\V2008R2'
  OR DB_NAME()<>N'dbwins_worldfert9_uat2' OR DB_ID()<>10
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
IF OBJECT_ID('wf.usp_CreateInitialDelivery','P') IS NULL
 EXEC('CREATE PROCEDURE wf.usp_CreateInitialDelivery AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_CreateInitialDelivery
 @SOID INT, @Preview BIT, @RequestId VARCHAR(36), @Fingerprint VARCHAR(64),
 @UserId INT, @ActorId INT
AS
BEGIN
 SET NOCOUNT ON;
 SET XACT_ABORT ON;
 SET ARITHABORT ON;
 SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 BEGIN RAISERROR('DO_TRANSACTION_REQUIRED',16,1); RETURN; END;
 IF CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName'))<>N'AMYOU-YOGA7\V2008R2'
  OR DB_NAME()<>N'dbwins_worldfert9_uat2' OR DB_ID()<>10
 BEGIN RAISERROR('DO_TARGET_NOT_SUPPORTED',16,1); RETURN; END;

 DECLARE @Today DATETIME,@DocuNo VARCHAR(30),@AI VARCHAR(30),@Amount DECIMAL(18,4),@Qty DECIMAL(18,4);
 SET @Today=CONVERT(DATETIME,CONVERT(VARCHAR(10),DATEADD(hour,7,GETUTCDATE()),120),120);
 SELECT @DocuNo=h.DocuNo,@AI=h.AppvDocuNo,@Amount=h.NetAmnt
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

 DECLARE @Last VARCHAR(50),@Fmt VARCHAR(50),@Prefix VARCHAR(4),@Max INT,@Next INT,@No VARCHAR(30);
 SELECT @Last=RTRIM(LastNo),@Fmt=RTRIM(RunFormat) FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='104' AND BrchID=1;
 SET @Prefix='K'+RIGHT(CONVERT(VARCHAR(4),YEAR(@Today)+543),2)+'-';
 IF @Last IS NULL OR @Fmt<>'Kyy-00000' OR LEN(@Last)<>9 OR LEFT(@Last,4)<>@Prefix
  OR SUBSTRING(@Last,5,5) NOT LIKE '[0-9][0-9][0-9][0-9][0-9]'
 BEGIN RAISERROR('DO_COUNTER_UNSUPPORTED',16,1); RETURN; END;
 SELECT @Max=ISNULL(MAX(CONVERT(INT,SUBSTRING(DocuNo,5,5))),0) FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK)
  WHERE DocuType=104 AND BrchID=1 AND DocuNo LIKE @Prefix+'[0-9][0-9][0-9][0-9][0-9]' AND LEN(DocuNo)=9;
 SET @Next=CONVERT(INT,SUBSTRING(@Last,5,5)); IF @Max>@Next SET @Next=@Max; SET @Next=@Next+1;
 IF @Next>99999 BEGIN RAISERROR('DO_NUMBER_EXHAUSTED',16,1); RETURN; END;
 IF @Preview=1 BEGIN SELECT CONVERT(VARCHAR(40),@Amount) AS Amount,1 AS RequiresCreditApproval; RETURN; END;

 DECLARE @Username NVARCHAR(100);
 SELECT @Username=Username FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK)
  WHERE Id=@UserId AND IsActive=1 AND MustChangePassword=0 AND Role IN('SALES','COUNTER_SALES','ACCOUNTING','MANAGER','C_LEVEL','ADMIN');
 IF @Username IS NULL OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@ActorId AND IsActive=1 AND MustChangePassword=0)
 BEGIN RAISERROR('DO_ACTOR_UNAVAILABLE',16,1); RETURN; END;
 IF NOT EXISTS(SELECT 1 FROM wf.NativeDeliveryRequest r WITH(UPDLOCK,HOLDLOCK)
  JOIN wf.AppUser u WITH(UPDLOCK,HOLDLOCK) ON u.Id=r.ApprovedById
  JOIN wf.AppUser a WITH(UPDLOCK,HOLDLOCK) ON a.Id=r.ApproverActorId
  WHERE r.SOID=@SOID AND r.RequestId=@RequestId AND r.Fingerprint=@Fingerprint AND r.Amount=@Amount
   AND r.Status='APPROVED' AND r.ExpiresAt>GETUTCDATE() AND r.PolicyVersion='O23-DO104-INITIAL-UAT2-v1'
   AND r.RequestedById=@UserId AND r.RequesterActorId=@ActorId
   AND LEN(ISNULL(r.Reason,N''))>=5 AND r.SelfApproval=CASE WHEN r.RequesterActorId=r.ApproverActorId THEN 1 ELSE 0 END
   AND u.Role='ACCOUNTING' AND u.IsActive=1 AND u.MustChangePassword=0 AND a.IsActive=1 AND a.MustChangePassword=0
   AND(a.Id=u.Id OR a.Role IN('ACCOUNTING','MANAGER','C_LEVEL','ADMIN')))
 BEGIN RAISERROR('DO_CREDIT_APPROVAL_REQUIRED',16,1); RETURN; END;
 IF EXISTS(SELECT 1 FROM wf.NativeDeliveryReceipt WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@SOID OR RequestId=@RequestId)
 BEGIN RAISERROR('DO_REQUEST_CONFLICT',16,1); RETURN; END;

 DECLARE @NewId INT,@CouponId INT,@AuditId INT,@EventId INT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SOHD',@NewId=@NewId OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='WFCoupon',@NewId=@CouponId OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SMAudit',@NewId=@AuditId OUTPUT;
 EXEC wf.usp_AllocateInitialDeliveryEventId @NewId=@EventId OUTPUT;
 IF @NewId IS NULL OR @CouponId IS NULL OR @AuditId IS NULL OR @EventId IS NULL
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
  DocuStatus,RefNo,RefDate,CommissionAmnt,ClearSO,FromFlag,MiscChargAmnt,MultiCurrency,CustName,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,AppvFlag,PkgStatus,Refeflag,CouponFlag)
 SELECT @NewId,SaleAreaID,EmpID,BrchID,CustID,@No,104,@Today,ValidDays,OnHold,
  VatRate,VatType,GoodType,CreditDays,ExchRate,ShipDate,SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,
  BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,TotaExcludeAmnt,TotaBaseAmnt,VATAmnt,NetAmnt,
  'N',@AI,AppvDate,CommissionAmnt,ClearSO,103,MiscChargAmnt,MultiCurrency,CustName,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,'W','N',Refeflag,'N'
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
  Docutype,Listno,SONo,ContainQty,GoodQty,SackQty,RemaQty,GoodName)
 SELECT @CouponId,GoodID,InveID,LocaID,GoodUnitID2,GoodPrice2,@NewId,1,104,1,@No,0,GoodQty2,0,GoodQty2,GoodName
 FROM dbo.SODT WHERE SOID=@SOID AND ListNo=1;
 UPDATE dbo.SODT SET RemaQty=RemaQty-@Qty WHERE SOID=@SOID AND ListNo=1 AND RemaQty=@Qty;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('DO_SOURCE_UNAVAILABLE',16,1); RETURN; END;
 UPDATE dbo.SOHD SET DocuStatus='Y' WHERE SOID=@SOID AND DocuStatus='N';
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('DO_SOURCE_UNAVAILABLE',16,1); RETURN; END;
 UPDATE dbo.EMRunBrch SET LastNo=@No WHERE RunCode='104' AND BrchID=1 AND LastNo=@Last AND RunFormat=@Fmt;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('DO_COUNTER_UNSUPPORTED',16,1); RETURN; END;
 INSERT INTO dbo.Define_104(ID) VALUES(@NewId);
 DECLARE @AuditUser NVARCHAR(100),@Note NVARCHAR(255);
 SET @AuditUser=LEFT(N'wf:'+@Username,100);
 SET @Note=N'O23-DO104-INITIAL-UAT2-v1; source='+@DocuNo+N'; AI='+@AI+N'; request='+@RequestId;
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
  AppliedById,ApplierActorId,NativeAuditId,NativeEventId,PolicyVersion)
 VALUES(@SOID,@RequestId,@Fingerprint,@NewId,@No,@CouponId,@UserId,@ActorId,@AuditId,@EventId,'O23-DO104-INITIAL-UAT2-v1');
 SELECT * FROM wf.NativeDeliveryReceipt WHERE SourceSOID=@SOID;
END
GO
