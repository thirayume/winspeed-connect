-- @transaction
-- Partial 107s group one 104 and one transport date. The 202 owns the
-- receivable/VAT; 107 carries the allocated display totals and stock only.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.usp_WriteNativeInvoice','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_WriteNativeInvoice AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_WriteNativeInvoice @RequestId varchar(36),@UserId int,@ActorId int
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 DECLARE @Plan xml,@Source int,@Validated int,@Finance int,@New int,@Global int,@No varchar(30),@Date datetime,@Series char(1),
  @Gross decimal(18,4),@Disc decimal(18,4),@Base decimal(18,4),@Tax decimal(18,4),@Net decimal(18,4),@Rate decimal(8,4),@User nvarchar(100);
 EXEC @Validated=wf.usp_ReadNativeDocumentRequest @RequestId,107,@UserId,@ActorId,@Plan OUTPUT,@Source OUTPUT;
 IF @Validated<>0 RETURN;
 SET @Date=CONVERT(datetime,@Plan.value('(/plan/@docDate)[1]','varchar(10)'),120);
 SET @Gross=@Plan.value('(/plan/@gross)[1]','decimal(18,4)');SET @Disc=@Plan.value('(/plan/@discount)[1]','decimal(18,4)');
 SET @Base=@Plan.value('(/plan/@taxBase)[1]','decimal(18,4)');SET @Tax=@Plan.value('(/plan/@tax)[1]','decimal(18,4)');SET @Net=@Plan.value('(/plan/@net)[1]','decimal(18,4)');
 SELECT @User=Username FROM wf.AppUser WHERE Id=@UserId;
 SELECT @Finance=r.FinanceId,@Series=CASE LEFT(h.DocuNo,1) WHEN 'I' THEN 'J' WHEN 'K' THEN 'N' END,@Rate=ISNULL(h.VatRate,0)
 FROM wf.NativeDocumentReceipt r WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=r.NativeId
 JOIN dbo.SOInvHD f WITH(UPDLOCK,HOLDLOCK) ON f.SOInvID=r.FinanceId
 WHERE r.DocuType=104 AND r.NativeId=@Source AND r.NativeAfterHash IS NOT NULL AND h.DocuType=104 AND h.CouponFlag='Y'
  AND h.BrchID=1 AND h.DocuStatus='Y' AND h.DocuDate<=@Date AND h.OnHold='N' AND h.ClearSO='N'
  AND f.Docutype=202 AND f.DocuNo=h.DocuNo AND f.CustID=h.CustID AND f.ARID=h.CustID AND f.CouponFlag='Y' AND f.StockEffc='N'
  AND f.SumGoodAmnt=h.SumGoodAmnt AND ISNULL(f.BillDiscAmnt,0)=ISNULL(h.BillDiscAmnt,0) AND f.BillAftrDiscAmnt=h.BillAftrDiscAmnt
  AND ISNULL(f.VATAmnt,0)=ISNULL(h.VATAmnt,0) AND f.NetAmnt=h.NetAmnt AND ISNULL(f.VatRate,0)=ISNULL(h.VatRate,0) AND f.VatType=h.VatType
  AND ISNULL(f.MiscChargAmnt,0)=0 AND ISNULL(f.BaseDiscAmnt,0)=0 AND ISNULL(f.AdvnAmnt,0)=0;
 IF @Finance IS NULL OR @Series IS NULL OR @Date>=DATEADD(day,1,CONVERT(date,DATEADD(hour,7,GETUTCDATE())))
  OR @Gross<0 OR @Disc<0 OR @Disc>@Gross OR @Base<>@Gross-@Disc OR @Net<>@Base+@Tax OR @Tax<0
  OR(SELECT COUNT(*) FROM dbo.EMPeriod WITH(UPDLOCK,HOLDLOCK) WHERE PeriodType='N' AND CloseStatus='N' AND @Date BETWEEN BeginDate AND EndDate)<>1
 BEGIN RAISERROR('ND_INVOICE_SOURCE_CHANGED',16,1);RETURN;END;
 DECLARE @Lines TABLE([LineNo] int PRIMARY KEY,Cut int,CutLine int,SourceLine int,Qty decimal(18,4),Gross decimal(18,4),Disc decimal(18,4),Base decimal(18,4),UNIQUE(Cut,CutLine));
 INSERT @Lines SELECT ROW_NUMBER() OVER(ORDER BY n.value('@redemptionId','int'),n.value('@redemptionLineNo','int')),
  n.value('@redemptionId','int'),n.value('@redemptionLineNo','int'),n.value('@sourceLineNo','int'),n.value('@quantity','decimal(18,4)'),
  n.value('@gross','decimal(18,4)'),n.value('@discount','decimal(18,4)'),n.value('@taxBase','decimal(18,4)') FROM @Plan.nodes('/plan/line') t(n);
 IF NOT EXISTS(SELECT 1 FROM @Lines) OR @Gross<>(SELECT SUM(Gross) FROM @Lines) OR @Disc<>(SELECT SUM(Disc) FROM @Lines) OR @Base<>(SELECT SUM(Base) FROM @Lines)
  OR EXISTS(SELECT 1 FROM @Lines p
   LEFT JOIN dbo.WFRedemtionHD h WITH(UPDLOCK,HOLDLOCK) ON h.RedemtionID=p.Cut
   LEFT JOIN dbo.WFRedemtionDT d WITH(UPDLOCK,HOLDLOCK) ON d.RedemtionID=p.Cut AND d.Listno=p.CutLine
   LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=d.CouponID
   LEFT JOIN dbo.SODT s WITH(UPDLOCK,HOLDLOCK) ON s.SOID=@Source AND s.ListNo=p.SourceLine
   LEFT JOIN wf.NativeDocumentReceipt rr WITH(UPDLOCK,HOLDLOCK) ON rr.DocuType=116 AND rr.NativeId=p.Cut
   WHERE h.RedemtionID IS NULL OR rr.RequestId IS NULL OR rr.NativeAfterHash IS NULL OR h.DocuType<>116 OR h.DocuStatus<>'N' OR h.IsCheckAll<>'Y' OR CONVERT(date,h.DocuDate)<>@Date
    OR d.CouponID IS NULL OR d.IsCheck<>'Y' OR d.PostInv<>'N' OR d.SOInvID IS NOT NULL OR d.SOListNo IS NOT NULL OR p.Qty<=0 OR d.GoodQty<>p.Qty OR d.RemaQty<>p.Qty
    OR c.DocuID<>@Source OR c.RefListno<>p.SourceLine OR c.CouponNo<>d.CouponNo OR c.GoodID<>d.GoodID OR c.GoodPrice<>d.GoodPrice OR c.InveID<>d.InveID
    OR ISNULL(c.LocaID,0)<>ISNULL(d.LocaID,0) OR c.GoodUnitID<>d.GoodUnitID OR s.SOID IS NULL OR s.DocuType<>104 OR s.GoodQty2<>c.GoodQty
    OR s.GoodStockRate2<>1 OR s.GoodStockQty<>s.GoodQty2 OR s.GoodID<>c.GoodID OR s.GoodPrice2<>c.GoodPrice OR s.InveID<>c.InveID
    OR p.Disc<0 OR p.Disc>p.Gross OR p.Base<>p.Gross-p.Disc OR EXISTS(SELECT 1 FROM wf.NativeDocumentReceiptLine WHERE DocuType=107 AND SourceId=p.Cut AND SourceLineNo=p.CutLine))
 BEGIN RAISERROR('ND_INVOICE_CUT_CHANGED',16,1);RETURN;END;
 -- Verify cumulative allocations in SQL too; a stored plan is never authority
 -- to invent amounts, or to omit invoices created by another native client.
 IF EXISTS(SELECT 1 FROM @Lines p JOIN dbo.SODT s ON s.SOID=@Source AND s.ListNo=p.SourceLine
  JOIN wf.NativeDocumentReceiptLine origin ON origin.DocuType=104 AND origin.SourceId=s.RefSOID AND origin.SourceLineNo=s.RefListNo
  JOIN wf.NativeDocumentReceipt parent ON parent.RequestId=origin.RequestId AND parent.NativeId=@Source
  OUTER APPLY(SELECT ISNULL(SUM(i.GoodQty2),0) Qty,ISNULL(SUM(i.GoodAmnt),0) Gross FROM dbo.SOInvDT i WITH(UPDLOCK,HOLDLOCK)
   WHERE i.Docutype=107 AND i.RefID=@Source AND i.RefListNo=p.SourceLine) prior
  OUTER APPLY(SELECT ISNULL(SUM(x.Qty),0) Qty FROM @Lines x WHERE x.SourceLine=p.SourceLine AND x.[LineNo]<p.[LineNo]) earlier
  OUTER APPLY(SELECT ISNULL(SUM(x.Quantity),0) Qty,ISNULL(SUM(x.GrossAmount),0) Gross FROM wf.NativeDocumentReceiptLine x WITH(UPDLOCK,HOLDLOCK)
   JOIN wf.NativeDocumentReceipt xr ON xr.RequestId=x.RequestId WHERE x.DocuType=107 AND xr.SourceId=@Source
    AND EXISTS(SELECT 1 FROM dbo.SOInvDT i WHERE i.SOInvID=xr.NativeId AND i.ListNo=x.NativeLineNo AND i.RefListNo=p.SourceLine)) receipts
  WHERE s.RemaQty<s.GoodQty2-prior.Qty OR s.RemaQty<>s.GoodQty2-prior.Qty OR prior.Qty<>receipts.Qty OR prior.Gross<>receipts.Gross
   OR prior.Qty+earlier.Qty+p.Qty>s.GoodQty2
   OR p.Gross<>ROUND(origin.GrossAmount*(prior.Qty+earlier.Qty+p.Qty)/s.GoodQty2,4)-ROUND(origin.GrossAmount*(prior.Qty+earlier.Qty)/s.GoodQty2,4)
   OR p.Disc<>ROUND(origin.DiscountAmount*(prior.Qty+earlier.Qty+p.Qty)/s.GoodQty2,4)-ROUND(origin.DiscountAmount*(prior.Qty+earlier.Qty)/s.GoodQty2,4))
 BEGIN RAISERROR('ND_INVOICE_HISTORY_CHANGED',16,1);RETURN;END;
 DECLARE @PriorBase decimal(18,4),@PriorTax decimal(18,4);
 SELECT @PriorBase=ISNULL(SUM(h.BillAftrDiscAmnt),0),@PriorTax=ISNULL(SUM(h.VATAmnt),0) FROM dbo.SOInvHD h WITH(UPDLOCK,HOLDLOCK)
 WHERE h.Docutype=107 AND h.SOInvID IN(SELECT SOInvID FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE Docutype=107 AND RefID=@Source);
 IF @PriorTax<>ROUND(@PriorBase*@Rate/100.0,2) OR @Tax<>ROUND((@PriorBase+@Base)*@Rate/100.0,2)-@PriorTax
 BEGIN RAISERROR('ND_INVOICE_TAX_CHANGED',16,1);RETURN;END;
 -- Preserve the captured native cost safety boundary until its cost mutation
 -- contract is reviewed. Triggers stay enabled; never silently rewrite costing.
 IF EXISTS(SELECT 1 FROM dbo.ICStockDetail c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SODT d ON d.SOID=@Source AND d.GoodID=c.GoodID
   WHERE c.DocuDate>=@Date AND c.CostFlag='Y')
  OR EXISTS(SELECT 1 FROM dbo.ICCostDetail c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SODT d ON d.SOID=@Source AND d.GoodID=c.GoodID WHERE c.DocuDate>=@Date)
 BEGIN RAISERROR('ND_COST_SCOPE_UNREVIEWED',16,1);RETURN;END;
 EXEC wf.usp_AllocateNativeDocumentNo 'creditsale_docuno',@Series,@Date,@No OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SOInvHD',@NewId=@New OUTPUT;
 EXEC wf.usp_AllocateNativeDocumentSAT @GlobalFlag=107,@Username=@User,@NewId=@Global OUTPUT;
 INSERT dbo.SMSat(GlobalID,GlobalFlag,DocuDate,UserName) VALUES(@Global,107,GETDATE(),LEFT(N'wf:'+@User,255));
 INSERT dbo.SOInvHD(SaleAreaID,SOInvID,CustID,ARID,BrchID,EmpID,VATGroupID,ExchRate,PostID,DocuDate,DocuNo,VATType,VATRate,GoodType,CreditDays,PrintTime,CreditEndDate,
  SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,AdvnAmnt,AftrAdvnAmnt,TotaExcludeAmnt,TotaBaseAmnt,VATAmnt,NetAmnt,CommisAmnt,
  DocuStatus,MiscChargAmnt,PostGL,CustPONo,DueDate,Docutype,InvNo,ShipDate,InvDate,DocuFlag,MultiCurrency,RemaAmnt,BillAmnt,StockEffc,LastInvAmnt,CurrentInvAmnt,Sign,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,CutAdvnFlag,SONo,ReplaceFlag,LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,CouponFlag,ContactName)
 SELECT SaleAreaID,@New,CustID,ARID,BrchID,EmpID,VATGroupID,1,@Global,@Date,@No,VATType,VATRate,GoodType,CreditDays,0,DATEADD(day,CreditDays,@Date),
  0,@Gross,@Gross,0,CONVERT(varchar(40),@Disc),@Disc,@Base,0,@Base,0,CASE WHEN @Rate>0 THEN @Base ELSE 0 END,@Tax,@Net,0,
  'N',0,'N',CustPONo,DATEADD(day,CreditDays,@Date),107,@No,@Date,@Date,DocuFlag,'N',@Net,0,'Y',0,0,1,
  @Net,0,0,0,'N',SONo,'N',1,CustName,0,0,'Y',ContactName FROM dbo.SOInvHD WHERE SOInvID=@Finance;
 INSERT dbo.SOInvDT(SOInvID,ListNo,LocaID,GoodName,InveID,GoodID,GoodUnitID2,GoodStockRate1,GoodQty2,GoodStockRate2,GoodStockUnitID,GoodStockQty,GoodPrice2,GoodAmnt,VATType,TotaExcludeAmnt,StockFlag,Docutype,RefID,RefListNo,RemaGoodStockQty,CNRemaQty)
 SELECT @New,p.[LineNo],s.LocaID,s.GoodName,s.InveID,s.GoodID,s.GoodUnitID2,1,p.Qty,1,s.GoodStockUnitID,p.Qty,s.GoodPrice2,p.Gross,
  CASE WHEN @Rate>0 THEN h.VatType ELSE '2' END,p.Base,-1,107,@Source,p.SourceLine,p.Qty,p.Qty FROM @Lines p JOIN dbo.SODT s ON s.SOID=@Source AND s.ListNo=p.SourceLine JOIN dbo.SOHD h ON h.SOID=@Source;
 IF @Rate>0 UPDATE d SET VatRate=@Rate,VATGroupID=h.VATGroupID FROM dbo.SOInvDT d JOIN dbo.SOHD h ON h.SOID=@Source WHERE d.SOInvID=@New;
 INSERT dbo.ICStockDetail(GoodID,CustID,GoodUnitID2,BrchID,GoodName,InveID,LocaID,GoodStockUnitID,JobFlag,GoodStockRate1,GoodStockRate2,DocuType,DocuTypeCode,GoodQty1,GoodQty2,GoodPrice2,GoodStockQty,
  GoodAddCost,GoodAddFlag,GoodCost,GoodAmnt,RemaQty,DocuDate,DocuNo,ListNo,LotNo,DocuID,FreeFlag,StockFlag,LandedAmnt,VatType,VatRate,VatAmnt,ExpireFlag,AdjustFlag,PostFlag,CostFlag,AdjustCost,SaveTime)
 SELECT d.GoodID,h.CustID,d.GoodUnitID2,1,d.GoodName,d.InveID,d.LocaID,d.GoodStockUnitID,'N',1,1,107,'0',0,p.Qty,d.GoodPrice2,p.Qty,
  0,'N',0,p.Gross,-p.Qty,@Date,@No,p.[LineNo],'',@New,'N',-1,0,h.VatType,@Rate,0,'N','N','N','N',0,CONVERT(varchar(19),GETDATE(),120)
 FROM @Lines p JOIN dbo.SODT d ON d.SOID=@Source AND d.ListNo=p.SourceLine JOIN dbo.SOHD h ON h.SOID=@Source;
 UPDATE s SET RemaQty=s.RemaQty-p.Qty FROM dbo.SODT s JOIN(SELECT SourceLine,SUM(Qty) Qty FROM @Lines GROUP BY SourceLine)p ON p.SourceLine=s.ListNo WHERE s.SOID=@Source AND s.RemaQty>=p.Qty;
 IF @@ROWCOUNT<>(SELECT COUNT(DISTINCT SourceLine) FROM @Lines) BEGIN RAISERROR('ND_INVOICE_SOURCE_CHANGED',16,1);RETURN;END;
 UPDATE d SET RemaQty=0,PostInv='Y',SOInvID=@New,SOListNo=p.[LineNo] FROM dbo.WFRedemtionDT d JOIN @Lines p ON p.Cut=d.RedemtionID AND p.CutLine=d.Listno WHERE d.PostInv='N' AND d.RemaQty=p.Qty AND d.SOInvID IS NULL;
 IF @@ROWCOUNT<>(SELECT COUNT(*) FROM @Lines) BEGIN RAISERROR('ND_INVOICE_CUT_CHANGED',16,1);RETURN;END;
 UPDATE h SET DocuStatus='Y' FROM dbo.WFRedemtionHD h WHERE h.RedemtionID IN(SELECT Cut FROM @Lines) AND h.DocuStatus='N'
  AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT d WITH(UPDLOCK,HOLDLOCK) WHERE d.RedemtionID=h.RedemtionID AND(d.PostInv<>'Y' OR d.RemaQty<>0 OR d.SOInvID IS NULL));
 INSERT #NativeLines(NativeLineNo,SourceId,SourceLineNo,CouponId,CouponNo,Quantity,GrossAmount,DiscountAmount,TaxBase)
 SELECT p.[LineNo],p.Cut,p.CutLine,d.CouponID,d.CouponNo,p.Qty,p.Gross,p.Disc,p.Base FROM @Lines p JOIN dbo.WFRedemtionDT d ON d.RedemtionID=p.Cut AND d.Listno=p.CutLine;
 INSERT #NativeResult(NativeId,NativeNo,FinanceId) VALUES(@New,@No,@Finance);
END;
GO
IF OBJECT_ID('wf.usp_ApplyNativeDocument','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_ApplyNativeDocument AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_ApplyNativeDocument @RequestId varchar(36),@UserId int,@ActorId int,@PrimaryUserId int,@PrimaryActorId int
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 OR wf.fn_IsNativeDocumentTarget()<>1 BEGIN RAISERROR('ND_TARGET_NOT_READY',16,1);RETURN;END;
 DECLARE @Type int,@Revision int;
 SELECT @Type=DocuType,@Revision=Revision FROM wf.NativeDocumentRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@RequestId;
 IF @Type IS NULL BEGIN RAISERROR('ND_REQUEST_NOT_FOUND',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@RequestId)
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt WHERE RequestId=@RequestId AND UserId=@UserId AND ActorUserId=@ActorId
    AND PrimaryUserId=@PrimaryUserId AND PrimaryActorId=@PrimaryActorId AND NativeAfterHash IS NOT NULL)
   BEGIN RAISERROR('ND_REQUEST_CONFLICT',16,1);RETURN;END;
  SELECT * FROM wf.NativeDocumentReceipt WHERE RequestId=@RequestId;RETURN;
 END;
 CREATE TABLE #NativeResult(NativeId int NOT NULL,NativeNo varchar(30) NOT NULL,FinanceId int NULL);
 CREATE TABLE #NativeLines(NativeLineNo int PRIMARY KEY,SourceId int NOT NULL,SourceLineNo int NOT NULL,CouponId int NULL,CouponNo varchar(25) NULL,
  Quantity decimal(18,4) NOT NULL,GrossAmount decimal(18,4) NOT NULL,DiscountAmount decimal(18,4) NOT NULL,TaxBase decimal(18,4) NOT NULL);
 BEGIN TRY
  IF @Type=119 EXEC wf.usp_WriteNativeBookingApproval @RequestId,@UserId,@ActorId;
  ELSE IF @Type=104 EXEC wf.usp_WriteNativeDelivery @RequestId,@UserId,@ActorId;
  ELSE IF @Type=116 EXEC wf.usp_WriteNativeRedemption @RequestId,@UserId,@ActorId;
  ELSE IF @Type=107 EXEC wf.usp_WriteNativeInvoice @RequestId,@UserId,@ActorId;
  IF(SELECT COUNT(*) FROM #NativeResult)<>1 OR(@Type<>119 AND NOT EXISTS(SELECT 1 FROM #NativeLines))
   BEGIN RAISERROR('ND_WRITER_INCOMPLETE',16,1);RETURN;END;
  INSERT wf.NativeDocumentReceipt(RequestId,PolicyVersion,DocuType,OperationKey,SourceId,SourceKind,NativeId,NativeNo,FinanceId,
   UserId,ActorUserId,PrimaryUserId,PrimaryActorId,SourceBeforeHash)
  SELECT r.RequestId,r.PolicyVersion,r.DocuType,r.OperationKey,r.SourceId,r.SourceKind,n.NativeId,n.NativeNo,n.FinanceId,
   @UserId,@ActorId,@PrimaryUserId,@PrimaryActorId,r.SourceHash FROM wf.NativeDocumentRequest r CROSS JOIN #NativeResult n WHERE r.RequestId=@RequestId AND r.Status='APPROVED' AND r.ExpiresAtUtc>GETUTCDATE();
  IF @@ROWCOUNT<>1 BEGIN RAISERROR('ND_REQUEST_STALE',16,1);RETURN;END;
  INSERT wf.NativeDocumentReceiptLine(RequestId,NativeLineNo,DocuType,SourceId,SourceLineNo,CouponId,CouponNo,Quantity,GrossAmount,DiscountAmount,TaxBase)
   SELECT @RequestId,NativeLineNo,@Type,SourceId,SourceLineNo,CouponId,CouponNo,Quantity,GrossAmount,DiscountAmount,TaxBase FROM #NativeLines;
  UPDATE wf.NativeDocumentRequest SET Status='CONSUMED',Revision=Revision+1 WHERE RequestId=@RequestId AND Status='APPROVED' AND Revision=@Revision;
  IF @@ROWCOUNT<>1 BEGIN RAISERROR('ND_REQUEST_STALE',16,1);RETURN;END;
  INSERT wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note) SELECT CONVERT(varchar(50),SourceId),@UserId,@ActorId,'NATIVE_DOCUMENT_APPLIED',
   N'v3;type='+CONVERT(nvarchar(4),@Type)+N';request='+@RequestId+N';primary='+CONVERT(nvarchar(12),@PrimaryUserId)+N';actorPrimary='+CONVERT(nvarchar(12),@PrimaryActorId) FROM wf.NativeDocumentRequest WHERE RequestId=@RequestId;
  SELECT * FROM wf.NativeDocumentReceipt WHERE RequestId=@RequestId;
 END TRY
 BEGIN CATCH
  DECLARE @Message nvarchar(2048);SET @Message=ERROR_MESSAGE();RAISERROR('%s',16,1,@Message);
 END CATCH;
END;
GO
