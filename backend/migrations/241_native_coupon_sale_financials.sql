-- @transaction
-- Validate the amounts already approved on 103/104. Handle one line and
-- either zero VAT or a price before VAT using a configured tax group.
-- This contract does not allocate a header discount across tax categories.
CREATE FUNCTION wf.fn_NativeCouponSaleFinancials(@SOID int)
RETURNS TABLE
AS RETURN
(
 SELECT amounts.Gross,amounts.Discount,amounts.TaxBase,amounts.VatRate,amounts.TaxAmount,
        amounts.NetAmount,h.VATGroupID,h.VatType,
        CASE WHEN amounts.VatRate>0 THEN h.VatType ELSE '2' END AS TaxDetailType
 FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.SODT l WITH(UPDLOCK,HOLDLOCK) ON l.SOID=h.SOID AND l.ListNo=1 AND l.DocuType=h.DocuType
 CROSS APPLY (SELECT CONVERT(decimal(18,4),h.SumGoodAmnt) AS Gross,
   CONVERT(decimal(18,4),ISNULL(h.BillDiscAmnt,0)) AS Discount,
   CONVERT(decimal(18,4),h.BillAftrDiscAmnt) AS TaxBase,
   CONVERT(decimal(8,4),ISNULL(h.VatRate,0)) AS VatRate,
   CONVERT(decimal(18,4),ISNULL(h.VatAmnt,0)) AS TaxAmount,
   CONVERT(decimal(18,4),h.NetAmnt) AS NetAmount) amounts
 WHERE h.SOID=@SOID AND h.DocuType IN(103,104) AND h.BrchID=1
   AND amounts.Gross=CONVERT(decimal(18,4),l.GoodAmnt)
   AND amounts.Gross=CONVERT(decimal(18,4),l.GoodQty2*l.GoodPrice2)
   AND amounts.Gross>0 AND amounts.Discount BETWEEN 0 AND amounts.Gross
   AND (amounts.Discount=0 OR NULLIF(RTRIM(h.BillDiscFormula),'') IS NOT NULL)
   AND amounts.TaxBase=amounts.Gross-amounts.Discount
   AND amounts.NetAmount=amounts.TaxBase+amounts.TaxAmount
   AND ISNULL(h.BaseDiscAmnt,0)=0 AND ISNULL(h.MiscChargAmnt,0)=0 AND ISNULL(l.GoodDiscAmnt,0)=0
   AND (amounts.Discount=0 AND amounts.VatRate=0 OR LEFT(h.DocuNo,1)='K')
   AND (
     (amounts.VatRate=0 AND amounts.TaxAmount=0) OR
     (amounts.VatRate>0 AND amounts.VatRate<=100 AND h.VatType='2'
       AND ISNULL(h.SumIncludeAmnt,0)=0 AND CONVERT(decimal(18,4),h.SumExcludeAmnt)=amounts.Gross
       AND CONVERT(decimal(18,4),h.TotaBaseAmnt)=amounts.TaxBase
       AND amounts.TaxAmount=ROUND(amounts.TaxBase*amounts.VatRate/100.0,2)
       AND EXISTS(SELECT 1 FROM dbo.EMGood g WITH(HOLDLOCK) WHERE g.GoodID=l.GoodID AND g.VatType IN('1','2'))
       AND EXISTS(SELECT 1 FROM dbo.EMVATGroup v WITH(HOLDLOCK) WHERE v.VATGroupID=h.VATGroupID AND v.AccID>0 AND v.VatType=h.VatType
           AND CONVERT(decimal(8,4),v.VatRate)=amounts.VatRate)))
);
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
 DECLARE @Gross decimal(18,4),@Base decimal(18,4),@Discount decimal(18,4),@Tax decimal(18,4),@TaxRate decimal(8,4),@TaxDetailType char(1);
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
  AND ISNULL(h.CommissionAmnt,0)=0 AND ISNULL(h.ExchRate,1)=1
  AND h.DocuDate<=@Today AND h.ValidDays>=0 AND DATEADD(day,h.ValidDays,h.DocuDate)>=@Today
  AND e.SourceDraftId=o.SourceDraftId AND e.SalesUserId=o.SalesUserId
  AND ISNULL(e.IsUnlocked,0)=0 AND ISNULL(e.IsLoaded,0)=0 AND e.WeighOutWeight IS NULL;
 IF @DocuNo IS NULL BEGIN RAISERROR('DO_SOURCE_UNAVAILABLE',16,1); RETURN; END;
 SELECT @Gross=Gross,@Base=TaxBase,@Discount=Discount,@Tax=TaxAmount,@TaxRate=VatRate,@TaxDetailType=TaxDetailType
 FROM wf.fn_NativeCouponSaleFinancials(@SOID);
 IF @Gross IS NULL BEGIN RAISERROR('DO_FINANCIAL_SOURCE_UNSUPPORTED',16,1);RETURN;END;
 SELECT @Qty=GoodQty2 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID AND ListNo=1;
 IF (SELECT COUNT(*) FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID)<>1 OR @Qty IS NULL OR @Qty<=0
  OR EXISTS(SELECT 1 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID AND
   (DocuType<>103 OR ListNo<>1 OR ISNULL(RefSOID,0)<>0 OR ISNULL(Refno,'')<>''
    OR ISNULL(RemaQty,-1)<>GoodQty2 OR ISNULL(GoodQty1,0)<>0 OR ISNULL(GoodStockUnitID,-1)<>ISNULL(GoodUnitID2,-2)
    OR ISNULL(GoodStockRate2,0)<>1 OR ISNULL(GoodStockQty,0)<>GoodQty2
    OR ISNULL(GoodPrice2,0)<=0 OR ISNULL(GoodAmnt,-1)<>@Gross
    OR ISNULL(GoodRemaQty1,-1)<>GoodQty2 OR ISNULL(StockFlag,0)<>-1
    OR ISNULL(GoodCost,0)<>0 OR ISNULL(SumExcludeAmnt,0) NOT IN(0,@Gross) OR ISNULL(MiscChargAmnt,0)<>0
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


 -- Full single-line, whole-bag, tonne contract.
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
  WHERE Id=@UserId AND IsActive=1 AND MustChangePassword=0 AND wf.fn_UserHasPermission(Id,'so.create-native-delivery')=1 AND wf.fn_UserHasPermission(@ActorId,'so.create-native-delivery')=1;
 IF @Username IS NULL OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@ActorId AND IsActive=1 AND MustChangePassword=0)
 BEGIN RAISERROR('DO_ACTOR_UNAVAILABLE',16,1); RETURN; END;
 IF NOT EXISTS(SELECT 1 FROM wf.NativeDeliveryRequest r WITH(UPDLOCK,HOLDLOCK)
  JOIN wf.AppUser u WITH(UPDLOCK,HOLDLOCK) ON u.Id=r.ApprovedById
  JOIN wf.AppUser a WITH(UPDLOCK,HOLDLOCK) ON a.Id=r.ApproverActorId
  WHERE r.SOID=@SOID AND r.RequestId=@RequestId AND r.Fingerprint=@Fingerprint AND r.Amount=@Amount
   AND r.Status='APPROVED' AND r.ExpiresAt>GETUTCDATE() AND r.PolicyVersion='O25-DO104-COMPLETE-UAT2-v2'
   AND r.RequestedById=@UserId AND r.RequesterActorId=@ActorId
   AND LEN(ISNULL(r.Reason,N''))>=5 AND r.SelfApproval=CASE WHEN r.RequesterActorId=r.ApproverActorId THEN 1 ELSE 0 END
   AND wf.fn_UserHasPermission(u.Id,'credit.approve-native')=1 AND wf.fn_UserHasPermission(a.Id,'credit.approve-native')=1 AND u.IsActive=1 AND u.MustChangePassword=0 AND a.IsActive=1 AND a.MustChangePassword=0
   AND(a.Id=u.Id OR wf.fn_UserHasPermission(a.Id,'access-as')=1))
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
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,AppvFlag,PkgStatus,Refeflag,CouponFlag,ContactName)
 SELECT @NewId,SaleAreaID,EmpID,BrchID,CustID,@No,104,@Today,DATEDIFF(day,@Today,@Ship),OnHold,
  VatRate,VatType,GoodType,CreditDays,ExchRate,ShipDate,SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,
  BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,TotaExcludeAmnt,TotaBaseAmnt,VATAmnt,NetAmnt,
  'Y',ISNULL(CustPONo,''),@AI,AppvDate,CommissionAmnt,ClearSO,103,MiscChargAmnt,MultiCurrency,CustName,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,'W','N',Refeflag,'Y',ContactName
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
  CutAdvnFlag,SONo,ReplaceFlag,LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,CouponFlag,ContactName)
 SELECT SaleAreaID,@FinanceId,CustID,CustID,BrchID,EmpID,VATGroupID,1,@GlobalId,@Today,@No,
  VATType,@TaxRate,GoodType,@CreditDays,0,DATEADD(day,@CreditDays,@Today),0,@Gross,@Gross,
  0,ISNULL(BillDiscFormula,''),@Discount,@Base,0,@Base,0,@Base,@Tax,@Amount,0,'N',0,'N',ISNULL(CustPONo,''),DATEADD(day,@CreditDays,@Today),202,@No,@Today,'N',
  'N',@Amount,0,'N',0,0,1,@Amount,0,0,0,'N',@No,'N',1,CustName,0,0,'Y',ContactName FROM dbo.SOHD WHERE SOID=@NewId;
 INSERT INTO dbo.SOInvDT(SOInvID,ListNo,ExpnID,GoodAmnt,VATType,TotaExcludeAmnt,Docutype,RefID,RefListNo)
 VALUES(@FinanceId,1,@Expn,@Base,@TaxDetailType,@Base,202,@NewId,1);
 IF @TaxRate>0 UPDATE f SET VatRate=@TaxRate,VATGroupID=h.VATGroupID
 FROM dbo.SOInvDT f JOIN dbo.SOHD h ON h.SOID=f.RefID WHERE f.SOInvID=@FinanceId AND f.ListNo=1;
 INSERT INTO dbo.VTVAT(InvNo,InvDate,DocuNo,DocuDate,Remark,BaseAmnt,VatType,VatRate,VatAmnt,PercentClm,ClmAmnt,
  PeriodID,TaxType,FromFlag,IsLocked,ListNo,VATID,BrchID,VATGroupID,FromID)
 SELECT @No,@Today,@No,@Today,CustName,@Base,@TaxDetailType,@TaxRate,@Tax,0,0,@Period,'1',202,'Y',1,@VATId,1,VATGroupID,@GlobalId
 FROM dbo.SOHD WHERE SOID=@NewId;

 DECLARE @AuditUser NVARCHAR(100),@Note NVARCHAR(255);
 SET @AuditUser=LEFT(N'wf:'+@Username,100);
 SET @Note=N'O25-DO104-COMPLETE-UAT2-v2; source='+@DocuNo+N'; AI='+@AI+N'; request='+@RequestId;
 INSERT INTO dbo.SMAudit(audit_id,audit_system,audit_screen,audit_datetime,audit_username,audit_action,
  audit_docuno,audit_docudate,audit_columnid,brchid,audit_computername,audit_refid,version,audit_query)
 VALUES(@AuditId,3,2098003049,GETDATE(),@AuditUser,'INSERT',@No,@Today,@NewId,1,HOST_NAME(),@AuditId,'WF INITIAL-104 UAT2',@Note);
 INSERT INTO dbo.SMEvent(eventid,docudate,docuno,code,c_v_name,amount,vat,totalamnt,username,objectid,brchid,docuid,c_v_id,systemid)
 SELECT @EventId,@Today,@No,c.CustCode,h.CustName,0,@Tax,@Amount,@AuditUser,2098003049,1,@NewId,h.CustID,3
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
ALTER PROCEDURE wf.usp_PostInitialCouponInvoice
 @SOID int,@Preview bit,@RequestId varchar(36),@Fingerprint varchar(64),@UserId int,@ActorId int,@InvoiceDate datetime=NULL
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 BEGIN RAISERROR('IP_TRANSACTION_REQUIRED',16,1);RETURN;END;
 IF wf.fn_IsInitialNativeUatTarget()<>1 BEGIN RAISERROR('IP_TARGET_NOT_SUPPORTED',16,1);RETURN;END;
 DECLARE @Username nvarchar(100);
 SELECT @Username=Username FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@UserId AND wf.fn_UserHasPermission(Id,'invoice.post-native')=1 AND IsActive=1 AND MustChangePassword=0;
 IF @Username IS NULL OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@ActorId AND IsActive=1 AND MustChangePassword=0 AND wf.fn_UserHasPermission(Id,'invoice.post-native')=1 AND(Id=@UserId OR wf.fn_UserHasPermission(Id,'access-as')=1))
 BEGIN RAISERROR('IP_ACCOUNT_REQUIRED',16,1);RETURN;END;
 DECLARE @Base decimal(18,4),@Tax decimal(18,4),@TaxRate decimal(8,4),@TaxDetailType char(1),@VATGroup int;
 DECLARE @Today datetime,@Delivery int,@Cut int,@Coupon int,@Finance int,@Good int,@Inve int,@Qty money,@Amount money,@Gross money,@Discount money,@DeliveryNo varchar(30),@Series char(1),@Ship datetime,@CutDate datetime,@DeliveryHash varchar(64),@CutHash varchar(64),@CutNo varchar(25),@SlipSource varchar(20);
 SET @Today=CONVERT(datetime,CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120),120);
 SELECT @Delivery=r.DeliverySOID,@Cut=m.RedemptionID,@Coupon=r.CouponID,@Finance=r.FinanceSOInvID,
  @Good=d.GoodID,@Inve=d.InveID,@Qty=c.GoodQty,@Amount=h.NetAmnt,@Gross=d.GoodAmnt,@Discount=ISNULL(h.BillDiscAmnt,0),@DeliveryNo=h.DocuNo,@Ship=h.ShipDate,@CutDate=ch.DocuDate,
  @DeliveryHash=r.DeliveryAfterHash,@CutHash=m.RedemptionAfterHash,@CutNo=ch.DocuNo,@SlipSource=mr.SlipSource
 FROM wf.NativeDeliveryReceipt r WITH(UPDLOCK,HOLDLOCK)
 JOIN wf.NativeManualRedemptionReceipt m WITH(UPDLOCK,HOLDLOCK) ON m.SourceSOID=r.SourceSOID AND m.DeliverySOID=r.DeliverySOID AND m.CouponID=r.CouponID
 JOIN wf.NativeManualRedemptionRequest mr WITH(UPDLOCK,HOLDLOCK) ON mr.RequestId=m.RequestId AND mr.Status='CONSUMED' AND mr.EvidenceMode='UAT_SIMULATION' AND mr.ApprovedDataHash=m.ApprovedDataHash
 JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=r.DeliverySOID AND h.DocuType=104 AND h.BrchID=1 AND h.DocuStatus='Y' AND h.CouponFlag='Y'
 JOIN dbo.SODT d WITH(UPDLOCK,HOLDLOCK) ON d.SOID=h.SOID AND d.DocuType=104 AND d.ListNo=1 AND d.RefSOID=@SOID
 JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=r.CouponID AND c.DocuID=h.SOID AND c.Docutype=104 AND c.CouponNo=r.CouponNo AND c.RefListno=1
 JOIN dbo.WFRedemtionHD ch WITH(UPDLOCK,HOLDLOCK) ON ch.RedemtionID=m.RedemptionID AND ch.DocuType=116 AND ch.DocuDate<DATEADD(day,1,@Today) AND ch.DocuStatus='N' AND ch.IsCheckAll='Y'
 JOIN dbo.WFRedemtionDT cd WITH(UPDLOCK,HOLDLOCK) ON cd.RedemtionID=ch.RedemtionID AND cd.Listno=1 AND cd.CouponID=c.CouponID AND cd.CouponNo=c.CouponNo
 JOIN dbo.SOInvHD f WITH(UPDLOCK,HOLDLOCK) ON f.SOInvID=r.FinanceSOInvID AND f.Docutype=202 AND f.DocuNo=h.DocuNo AND f.CouponFlag='Y' AND f.StockEffc='N' AND f.PostGL='N'
 WHERE r.SourceSOID=@SOID AND r.PolicyVersion='O25-DO104-COMPLETE-UAT2-v2' AND m.PolicyVersion='O25-116-MANUAL-UAT2-v1'
  AND r.DeliveryAfterHash=m.DeliveryAfterHash AND m.RedemptionAfterHash IS NOT NULL
  AND h.DocuDate<=ch.DocuDate AND f.DocuDate<=ch.DocuDate
  AND c.GoodQty>0 AND c.RemaQty=0 AND d.GoodQty2=c.GoodQty AND d.RemaQty=c.GoodQty AND d.GoodStockQty=c.GoodQty AND d.GoodStockRate2=1
  AND cd.GoodQty=c.GoodQty AND cd.RemaQty=cd.GoodQty AND cd.PostInv='N' AND cd.SOInvID IS NULL AND cd.SOListNo IS NULL AND cd.IsCheck='Y'
  AND cd.GoodID=c.GoodID AND cd.GoodUnitID=c.GoodUnitID AND cd.GoodPrice=c.GoodPrice AND cd.InveID=c.InveID AND cd.LocaID=c.LocaID
  AND d.GoodAmnt=c.GoodQty*c.GoodPrice AND f.CreditDays=h.CreditDays;
 IF @Delivery IS NULL OR @DeliveryHash IS NULL OR @CutHash IS NULL
  OR(SELECT COUNT(*) FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@Delivery)<>1
  OR(SELECT COUNT(*) FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@Cut)<>1
  OR(SELECT COUNT(*) FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE CouponID=@Coupon)<>1
  OR EXISTS(SELECT 1 FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE RefID=@Delivery AND Docutype=107)
  OR EXISTS(SELECT 1 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE RefSOID=@Delivery)
  OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery)
   AND NOT(@SlipSource='SCALE' AND SPID=@SOID AND RTRIM(MoveBill)=@CutNo))
  OR(@SlipSource='SCALE' AND(SELECT COUNT(*) FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery))<>1)
 BEGIN RAISERROR('IP_SOURCE_UNAVAILABLE',16,1);RETURN;END;
 SET @CutDate=CONVERT(datetime,CONVERT(date,@CutDate));
 IF @InvoiceDate IS NULL SET @InvoiceDate=@CutDate;
 IF @InvoiceDate<>@CutDate BEGIN RAISERROR('IP_DATE_OVERRIDE_UNVERIFIED',16,1);RETURN;END;
 IF LEN(@DeliveryNo)<>9 OR @DeliveryNo NOT LIKE '[IK][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9]' BEGIN RAISERROR('IP_ACCOUNT_MISMATCH',16,1);RETURN;END;
 SET @Series=CASE LEFT(@DeliveryNo,1) WHEN 'I' THEN 'J' WHEN 'K' THEN 'N' END;
 -- Reconcile the receivable and its single VAT ledger row before the stock
 -- invoice copies the display amounts. The 107 adds no separate VAT row.
 SELECT @Base=TaxBase,@Tax=TaxAmount,@TaxRate=VatRate,@TaxDetailType=TaxDetailType,@VATGroup=VATGroupID
 FROM wf.fn_NativeCouponSaleFinancials(@Delivery);
 IF @Base IS NULL OR NOT EXISTS(
    SELECT 1 FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK)
    JOIN dbo.SOInvHD f WITH(UPDLOCK,HOLDLOCK) ON f.SOInvID=@Finance AND f.Docutype=202
    JOIN dbo.SOInvDT fd WITH(UPDLOCK,HOLDLOCK) ON fd.SOInvID=f.SOInvID AND fd.ListNo=1 AND fd.Docutype=202 AND fd.RefID=@Delivery AND fd.RefListNo=1
    JOIN dbo.VTVAT v WITH(UPDLOCK,HOLDLOCK) ON v.FromFlag=202 AND v.FromID=f.PostID
    WHERE h.SOID=@Delivery AND h.DocuType=104 AND f.CustID=h.CustID AND f.ARID=h.CustID
      AND f.VatType=h.VatType AND CONVERT(decimal(8,4),ISNULL(f.VatRate,0))=@TaxRate
      AND ISNULL(f.VATAmnt,0)=@Tax AND ISNULL(f.BaseDiscAmnt,0)=0
      AND ISNULL(f.MiscChargAmnt,0)=0 AND ISNULL(f.AdvNAmnt,0)=0
      AND f.SumGoodAmnt=@Gross AND ISNULL(f.BillDiscAmnt,0)=@Discount
      AND (@Discount=0 OR f.BillDiscFormula=h.BillDiscFormula)
      AND f.BillAftrDiscAmnt=@Base AND f.NetAmnt=@Amount AND f.RemaAmnt=@Amount
      AND fd.GoodAmnt=@Base AND v.BaseAmnt=@Base AND v.VatAmnt=@Tax
      AND CONVERT(decimal(8,4),ISNULL(v.VatRate,0))=@TaxRate
      AND (@TaxRate=0 OR (f.VATGroupID=@VATGroup AND fd.VATGroupID=@VATGroup AND v.VATGroupID=@VATGroup
        AND fd.VatType=@TaxDetailType AND v.VatType=@TaxDetailType))
      AND (SELECT COUNT(*) FROM dbo.VTVAT x WITH(UPDLOCK,HOLDLOCK) WHERE x.FromFlag=202 AND x.FromID=f.PostID)=1
      AND (SELECT COUNT(*) FROM dbo.SOInvDT x WITH(UPDLOCK,HOLDLOCK) WHERE x.SOInvID=f.SOInvID AND x.DocuType=202)=1)
 BEGIN RAISERROR('IP_FINANCIAL_SOURCE_MISMATCH',16,1);RETURN;END;
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
 IF @Preview=1 BEGIN SELECT @Series AS InvoiceSeries,CONVERT(varchar(40),CONVERT(decimal(18,4),@Amount)) AS Amount,CONVERT(varchar(40),CONVERT(decimal(18,4),@Discount)) AS Discount,CONVERT(varchar(40),@Base) AS TaxBase,CONVERT(varchar(40),CONVERT(decimal(18,4),@Tax)) AS TaxAmount,CONVERT(varchar(40),CONVERT(decimal(18,4),@Qty)) AS Qty,@Good AS GoodID,@Inve AS InveID,CONVERT(varchar(10),@InvoiceDate,120) AS InvoiceDate;RETURN;END;
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
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,CutAdvnFlag,SONo,ReplaceFlag,LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,CouponFlag,ContactName)
 SELECT SaleAreaID,@New,CustID,ARID,BrchID,EmpID,VATGroupID,ExchRate,@Global,@InvoiceDate,@No,VATType,VATRate,GoodType,CreditDays,0,DATEADD(day,CreditDays,@InvoiceDate),
  SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,AdvnAmnt,AftrAdvnAmnt,TotaExcludeAmnt,CASE WHEN @TaxRate>0 THEN @Base ELSE 0 END,VATAmnt,NetAmnt,CommisAmnt,
  'N',MiscChargAmnt,'N',CustPONo,DATEADD(day,CreditDays,@InvoiceDate),107,@No,@InvoiceDate,@InvoiceDate,DocuFlag,MultiCurrency,RemaAmnt,BillAmnt,'Y',LastInvAmnt,CurrentInvAmnt,Sign,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,CutAdvnFlag,SONo,ReplaceFlag,LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,'Y',ContactName FROM dbo.SOInvHD WHERE SOInvID=@Finance AND Docutype=202;
 INSERT INTO dbo.SOInvDT(SOInvID,ListNo,LocaID,GoodName,InveID,GoodID,GoodUnitID2,GoodStockRate1,GoodQty2,GoodStockRate2,GoodStockUnitID,GoodStockQty,GoodPrice2,GoodAmnt,VATType,TotaExcludeAmnt,StockFlag,Docutype,RefID,RefListNo,RemaGoodStockQty,CNRemaQty)
 SELECT @New,1,LocaID,GoodName,InveID,GoodID,GoodUnitID2,1,@Qty,1,GoodStockUnitID,@Qty,GoodPrice2,GoodAmnt,@TaxDetailType,CASE WHEN @TaxRate=0 THEN GoodAmnt ELSE @Base END,-1,107,@Delivery,1,@Qty,@Qty FROM dbo.SODT WHERE SOID=@Delivery AND ListNo=1;
 IF @TaxRate>0 UPDATE dbo.SOInvDT SET VatRate=@TaxRate,VATGroupID=@VATGroup WHERE SOInvID=@New AND ListNo=1;
 INSERT INTO dbo.ICStockDetail(GoodID,CustID,GoodUnitID2,BrchID,GoodName,InveID,LocaID,GoodStockUnitID,JobFlag,GoodStockRate1,GoodStockRate2,DocuType,DocuTypeCode,GoodQty1,GoodQty2,GoodPrice2,GoodStockQty,
  GoodAddCost,GoodAddFlag,GoodCost,GoodAmnt,RemaQty,DocuDate,DocuNo,ListNo,LotNo,DocuID,FreeFlag,StockFlag,LandedAmnt,VatType,VatRate,VatAmnt,ExpireFlag,AdjustFlag,PostFlag,CostFlag,AdjustCost,SaveTime)
 SELECT d.GoodID,h.CustID,d.GoodUnitID2,1,d.GoodName,d.InveID,d.LocaID,d.GoodStockUnitID,'N',1,1,107,'0',0,@Qty,d.GoodPrice2,@Qty,
  0,'N',0,d.GoodAmnt,-@Qty,@InvoiceDate,@No,1,'',@New,'N',-1,0,h.VatType,@TaxRate,@Tax,'N','N','N','N',0,CONVERT(varchar(19),GETDATE(),120)
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
