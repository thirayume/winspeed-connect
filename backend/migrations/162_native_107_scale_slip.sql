-- @transaction
-- Follow-up to migration 161 (owner decision, 31 October 2026): a 116 numbered from the
-- booking's scale record must still reach the ACCOUNTING-only Invoice 107. The 107 writer
-- keeps refusing every other scale record. It accepts exactly one: the booking's single
-- scale record whose MoveBill is the 116 number, for a 116 created from that scale record.
-- A typed-slip 116, or one from before migration 161, still requires no scale record.
-- Body = migration 158's procedure plus three pinned edits. The UAT target guard, policy
-- versions, numbering and posting are unchanged. Portable; no dbo structure change.
IF COL_LENGTH('wf.NativeManualRedemptionRequest','SlipSource') IS NULL
 OR OBJECT_ID('wf.usp_PostInitialCouponInvoice','P') IS NULL
 RAISERROR('IP_SLIP_PREREQUISITE_REQUIRED',16,1);
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
 DECLARE @Today datetime,@Delivery int,@Cut int,@Coupon int,@Finance int,@Good int,@Inve int,@Qty money,@Amount money,@DeliveryNo varchar(30),@Series char(1),@Ship datetime,@CutDate datetime,@DeliveryHash varchar(64),@CutHash varchar(64),@CutNo varchar(25),@SlipSource varchar(20);
 SET @Today=CONVERT(datetime,CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120),120);
 SELECT @Delivery=r.DeliverySOID,@Cut=m.RedemptionID,@Coupon=r.CouponID,@Finance=r.FinanceSOInvID,
  @Good=d.GoodID,@Inve=d.InveID,@Qty=c.GoodQty,@Amount=h.NetAmnt,@DeliveryNo=h.DocuNo,@Ship=h.ShipDate,@CutDate=ch.DocuDate,
  @DeliveryHash=r.DeliveryAfterHash,@CutHash=m.RedemptionAfterHash,@CutNo=ch.DocuNo,@SlipSource=mr.SlipSource
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
  OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery)
   AND NOT(@SlipSource='SCALE' AND SPID=@SOID AND RTRIM(MoveBill)=@CutNo))
  OR(@SlipSource='SCALE' AND(SELECT COUNT(*) FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery))<>1)
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
