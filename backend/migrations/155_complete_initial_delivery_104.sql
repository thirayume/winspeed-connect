-- @transaction
--155: pinned UAT2, full single-line whole-bag zero-tax104 + C/D +202 receivable.
-- New contract; immutable153 is retained. No dbo DDL,116/107/GL/physical shipment.
IF OBJECT_ID('wf.NativeDeliveryReceipt','U') IS NULL RAISERROR('DO_PREREQUISITE_REQUIRED',16,1);
GO
IF COL_LENGTH('wf.NativeDeliveryReceipt','CouponNo') IS NULL ALTER TABLE wf.NativeDeliveryReceipt ADD CouponNo VARCHAR(25) NULL;
IF COL_LENGTH('wf.NativeDeliveryReceipt','FinanceSOInvID') IS NULL ALTER TABLE wf.NativeDeliveryReceipt ADD FinanceSOInvID INT NULL;
IF COL_LENGTH('wf.NativeDeliveryReceipt','FinancePostID') IS NULL ALTER TABLE wf.NativeDeliveryReceipt ADD FinancePostID INT NULL;
IF COL_LENGTH('wf.NativeDeliveryReceipt','FinanceVATID') IS NULL ALTER TABLE wf.NativeDeliveryReceipt ADD FinanceVATID INT NULL;
IF COL_LENGTH('wf.NativeDeliveryReceipt','ContainQty') IS NULL ALTER TABLE wf.NativeDeliveryReceipt ADD ContainQty DECIMAL(18,4) NULL;
IF COL_LENGTH('wf.NativeDeliveryReceipt','SackQty') IS NULL ALTER TABLE wf.NativeDeliveryReceipt ADD SackQty DECIMAL(18,4) NULL;
GO
IF OBJECT_ID('wf.usp_AllocateInitialVATId','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_AllocateInitialVATId AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_AllocateInitialVATId @NewId INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET @NewId=NULL;
 IF @@TRANCOUNT=0 OR CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName'))<>N'AMYOU-YOGA7\V2008R2'
  OR DB_NAME()<>N'dbwins_worldfert9_uat2' OR DB_ID()<>10 BEGIN RAISERROR('DO_TARGET_NOT_SUPPORTED',16,1); RETURN; END;
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
IF OBJECT_ID('wf.usp_AllocateInitialSAT','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_AllocateInitialSAT AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_AllocateInitialSAT @GlobalFlag INT,@Username NVARCHAR(100),@NewId INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET @NewId=NULL;
 IF @@TRANCOUNT=0 OR CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName'))<>N'AMYOU-YOGA7\V2008R2'
  OR DB_NAME()<>N'dbwins_worldfert9_uat2' OR DB_ID()<>10 OR @GlobalFlag IS NULL OR @GlobalFlag<>202 OR @Username IS NULL
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
IF OBJECT_ID('wf.usp_CreateCompleteInitialDelivery','P') IS NULL
 EXEC('CREATE PROCEDURE wf.usp_CreateCompleteInitialDelivery AS RETURN 0');
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
 IF CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName'))<>N'AMYOU-YOGA7\V2008R2'
  OR DB_NAME()<>N'dbwins_worldfert9_uat2' OR DB_ID()<>10
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
