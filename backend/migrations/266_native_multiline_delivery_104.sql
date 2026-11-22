-- @transaction
-- Full multi-line 103 -> 104/coupons/202. Source financials are copied exactly;
-- only the expense detail allocation divides the existing header discount.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.usp_WriteNativeDelivery','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_WriteNativeDelivery AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_WriteNativeDelivery @RequestId varchar(36),@UserId int,@ActorId int
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 DECLARE @Plan xml,@SOID int,@Validated int,@Date datetime,@New int,@Finance int,@Global int,@VatId int,@Period int,@Audit int,@Event int,
  @No varchar(30),@CouponNo varchar(25),@Coupon int,@Book varchar(2),@Series char(1),@User nvarchar(100),@AI varchar(30),
  @Gross decimal(18,4),@Discount decimal(18,4),@Base decimal(18,4),@Tax decimal(18,4),@Rate decimal(8,4),@Net decimal(18,4);
 EXEC @Validated=wf.usp_ReadNativeDocumentRequest @RequestId,104,@UserId,@ActorId,@Plan OUTPUT,@SOID OUTPUT;
 IF @Validated<>0 RETURN;
 SET @Date=CONVERT(datetime,CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120),120);
 SET @Book=@Plan.value('(/plan/@book)[1]','varchar(2)');SET @Series=CASE @Book WHEN 'I' THEN 'C' WHEN 'K' THEN 'D' END;
 SET @Gross=@Plan.value('(/plan/@gross)[1]','decimal(18,4)');SET @Discount=@Plan.value('(/plan/@discount)[1]','decimal(18,4)');
 SET @Base=@Plan.value('(/plan/@taxBase)[1]','decimal(18,4)');SET @Tax=@Plan.value('(/plan/@tax)[1]','decimal(18,4)');
 SET @Rate=@Plan.value('(/plan/@vatRate)[1]','decimal(8,4)');SET @Net=@Plan.value('(/plan/@net)[1]','decimal(18,4)');
 SELECT @User=Username FROM wf.AppUser WHERE Id=@UserId;
 SELECT @AI=h.AppvDocuNo FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK)
 JOIN wf.SalesOrderExt e WITH(UPDLOCK,HOLDLOCK) ON e.SOID=CONVERT(varchar(50),h.SOID)
 JOIN wf.NativeBookingOrigin o WITH(UPDLOCK,HOLDLOCK) ON o.SOID=h.SOID AND o.SourceDraftId=e.SourceDraftId AND o.SalesUserId=e.SalesUserId
 WHERE h.SOID=@SOID AND h.DocuType=103 AND h.BrchID=1 AND h.AppvFlag='Y' AND h.Appvid IS NOT NULL AND h.AppvDate IS NOT NULL
  AND h.DocuStatus='N' AND h.OnHold='N' AND h.ClearSO='N' AND ISNULL(e.IsUnlocked,0)=0
  AND h.DocuDate<=@Date AND DATEADD(day,h.ValidDays,h.DocuDate)>=@Date AND LEFT(h.DocuNo,1)=@Book
  AND h.SumGoodAmnt=@Gross AND ISNULL(h.BillDiscAmnt,0)=@Discount AND h.BillAftrDiscAmnt=@Base AND ISNULL(h.VatAmnt,0)=@Tax AND h.NetAmnt=@Net
  AND ISNULL(h.VatRate,0)=@Rate AND ISNULL(h.ExchRate,1)=1 AND ISNULL(h.MiscChargAmnt,0)=0 AND ISNULL(h.CommissionAmnt,0)=0 AND ISNULL(h.BaseDiscAmnt,0)=0
  AND NOT EXISTS(SELECT 1 FROM wf.PriceApproval p WITH(UPDLOCK,HOLDLOCK) WHERE p.SoId=e.SourceDraftId AND p.Status='PENDING');
 IF @Series IS NULL OR NULLIF(@AI,'') IS NULL OR @Gross<0 OR @Discount<0 OR @Discount>@Gross OR @Base<>@Gross-@Discount
  OR @Net<>@Base+@Tax OR @Tax<>ROUND(@Base*@Rate/100.0,2)
  OR EXISTS(SELECT 1 FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE RefSOID=@SOID)
  OR EXISTS(SELECT 1 FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE RefSOID=@SOID)
 BEGIN RAISERROR('ND_DELIVERY_SOURCE_CHANGED',16,1);RETURN;END;
 DECLARE @Lines TABLE([LineNo] int PRIMARY KEY,GoodId int,Qty decimal(18,4),Price decimal(18,4),Gross decimal(18,4),
  Discount decimal(18,4),TaxBase decimal(18,4),Pack decimal(18,4),Sacks int);
 INSERT @Lines SELECT n.value('@lineNo','int'),n.value('@goodId','int'),n.value('@quantity','decimal(18,4)'),n.value('@price','decimal(18,4)'),
  n.value('@gross','decimal(18,4)'),n.value('@discount','decimal(18,4)'),n.value('@taxBase','decimal(18,4)'),n.value('@packKg','decimal(18,4)'),n.value('@sacks','int') FROM @Plan.nodes('/plan/line') t(n);
 IF NOT EXISTS(SELECT 1 FROM @Lines) OR(SELECT COUNT(*) FROM @Lines)<>(SELECT COUNT(*) FROM dbo.SODT WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@SOID)
  OR @Gross<>(SELECT SUM(Gross) FROM @Lines) OR @Discount<>(SELECT SUM(Discount) FROM @Lines) OR @Base<>(SELECT SUM(TaxBase) FROM @Lines)
  OR EXISTS(SELECT 1 FROM @Lines p LEFT JOIN dbo.SODT l WITH(UPDLOCK,HOLDLOCK) ON l.SOID=@SOID AND l.ListNo=p.[LineNo]
   LEFT JOIN dbo.EMGood g WITH(HOLDLOCK) ON g.GoodID=l.GoodID LEFT JOIN dbo.EMGoodUnit u WITH(HOLDLOCK) ON u.GoodUnitID=l.GoodUnitID2
   WHERE l.SOID IS NULL OR l.DocuType<>103 OR p.Qty<=0 OR p.Pack<=0 OR p.Sacks<=0 OR p.Qty*1000<>p.Pack*p.Sacks
    OR l.GoodID<>p.GoodId OR l.GoodQty2<>p.Qty OR l.RemaQty<>p.Qty OR l.GoodPrice2<>p.Price OR l.GoodAmnt<>p.Gross OR p.Gross<>CONVERT(decimal(18,4),p.Qty*p.Price)
    OR p.Discount<0 OR p.Discount>p.Gross OR p.TaxBase<>p.Gross-p.Discount OR g.GoodWeight<>p.Pack OR g.ExpnID IS NULL
    OR u.GoodUnitCode<>N'ตัน' OR ISNULL(l.GoodStockRate2,0)<>1 OR l.GoodStockQty<>p.Qty OR ISNULL(l.LotFlag,'N')<>'N' OR ISNULL(l.SerialFlag,'N')<>'N'
    OR ISNULL(l.GoodDiscAmnt,0)<>0 OR ISNULL(l.RefSOID,0)<>0 OR ISNULL(l.FreeFlag,'N')='Y'
    OR(p.Price=0 AND NOT EXISTS(SELECT 1 FROM wf.RebateTicketRedemptionReceipt tr WITH(UPDLOCK,HOLDLOCK)
      JOIN wf.RebateTicketReceiptState ts WITH(UPDLOCK,HOLDLOCK) ON ts.ReceiptId=tr.Id AND ts.Status='RESERVED'
      WHERE tr.BookingSOID=@SOID AND tr.BookingLineNo=p.[LineNo] AND tr.Treatment='ZERO')))
 BEGIN RAISERROR('ND_DELIVERY_LINES_CHANGED',16,1);RETURN;END;
 IF(SELECT COUNT(*) FROM dbo.EMPeriod WITH(UPDLOCK,HOLDLOCK) WHERE PeriodType='N' AND CloseStatus='N' AND @Date BETWEEN BeginDate AND EndDate)<>1
 BEGIN RAISERROR('ND_PERIOD_UNAVAILABLE',16,1);RETURN;END;
 SELECT @Period=PeriodID FROM dbo.EMPeriod WHERE PeriodType='N' AND CloseStatus='N' AND @Date BETWEEN BeginDate AND EndDate;
 EXEC wf.usp_AllocateNativeDocumentNo '104',@Book,@Date,@No OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SOHD',@NewId=@New OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SOInvHD',@NewId=@Finance OUTPUT;
 EXEC wf.usp_AllocateNativeDocumentSAT @GlobalFlag=202,@Username=@User,@NewId=@Global OUTPUT;
 EXEC wf.usp_AllocateNativeDocumentVAT @NewId=@VatId OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SMAudit',@NewId=@Audit OUTPUT;
 EXEC wf.usp_AllocateNativeDocumentEventId @NewId=@Event OUTPUT;
 INSERT dbo.SOHD(SOID,SaleAreaID,EmpID,BrchID,CustID,DocuNo,DocuType,DocuDate,ValidDays,OnHold,
  VatRate,VatType,GoodType,CreditDays,ExchRate,ShipDate,SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,
  BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,TotaExcludeAmnt,TotaBaseAmnt,VATAmnt,NetAmnt,
  DocuStatus,CustPONo,RefNo,RefDate,CommissionAmnt,ClearSO,FromFlag,MiscChargAmnt,MultiCurrency,CustName,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,AppvFlag,PkgStatus,Refeflag,CouponFlag,ContactName)
 SELECT @New,SaleAreaID,EmpID,BrchID,CustID,@No,104,@Date,ValidDays,OnHold,
  VatRate,VatType,GoodType,CreditDays,ExchRate,ShipDate,SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,
  BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,TotaExcludeAmnt,TotaBaseAmnt,VATAmnt,NetAmnt,
  'Y',ISNULL(CustPONo,''),@AI,AppvDate,CommissionAmnt,ClearSO,103,MiscChargAmnt,MultiCurrency,CustName,
  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,'W','N',Refeflag,'Y',ContactName FROM dbo.SOHD WHERE SOID=@SOID;
 INSERT dbo.SODT(DocuType,GoodID,GoodName,InveID,LocaID,GoodPrice1,GoodQty1,GoodUnitID2,
  GoodStockRate1,GoodQty2,GoodPrice2,GoodStockRate2,MiscChargAmnt,SumExcludeAmnt,ShipDate,RefListNo,
  RemaBefoQty,GoodType,GoodStockUnitID,GoodStockQty,GoodCost,VatType,StockFlag,GoodFlag,RemaQty,
  GoodDiscAmnt,LotFlag,SerialFlag,GoodAmnt,ResvAmnt2,ResvAmnt1,ReserveQty,ListNo,SOID,RefSOID,
  GoodRemaQty1,GoodRemaQty2,MarkUpAmnt,CommisAmnt,Refno,POQty,RemaQtyPkg,Expireflag,PostStock,AfterMarkupamnt,RemaGoodStockQty,RemaAmnt)
 SELECT 104,GoodID,GoodName,InveID,LocaID,GoodPrice1,GoodQty1,GoodUnitID2,1,GoodQty2,GoodPrice2,GoodStockRate2,MiscChargAmnt,SumExcludeAmnt,ShipDate,ListNo,
  0,GoodType,GoodStockUnitID,GoodStockQty,GoodCost,VatType,StockFlag,GoodFlag,GoodQty2,GoodDiscAmnt,LotFlag,SerialFlag,GoodAmnt,0,0,ReserveQty,ListNo,@New,@SOID,
  GoodRemaQty1,0,0,0,@AI,POQty,RemaQtyPkg,Expireflag,PostStock,AfterMarkupamnt,RemaGoodStockQty,RemaAmnt FROM dbo.SODT WHERE SOID=@SOID;
 INSERT dbo.SOHDRemark(ListNo,SOID,Remark) SELECT ListNo,@New,Remark FROM dbo.SOHDRemark WHERE SOID=@SOID;
 DECLARE @Line int,@Pack decimal(18,4),@Sacks int,@Qty decimal(18,4);
 DECLARE coupons CURSOR LOCAL FAST_FORWARD FOR SELECT [LineNo],Pack,Sacks,Qty FROM @Lines ORDER BY [LineNo];
 OPEN coupons;FETCH NEXT FROM coupons INTO @Line,@Pack,@Sacks,@Qty;
 WHILE @@FETCH_STATUS=0
 BEGIN
  EXEC wf.usp_AllocateWinspeedId @TableName='WFCoupon',@NewId=@Coupon OUTPUT;
  EXEC wf.usp_AllocateCouponNo @Series=@Series,@DocuDate=@Date,@BrchID='1',@CouponNo=@CouponNo OUTPUT;
  INSERT dbo.WFCoupon(CouponID,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,DocuID,RefListNo,Docutype,Listno,CouponNo,SONo,ContainQty,GoodQty,SackQty,RemaQty,GoodName)
   SELECT @Coupon,GoodID,InveID,LocaID,GoodUnitID2,GoodPrice2,@New,ListNo,104,1,@CouponNo,@No,@Pack,GoodQty2,@Sacks,GoodQty2,GoodName
   FROM dbo.SODT WHERE SOID=@SOID AND ListNo=@Line;
  INSERT #NativeLines(NativeLineNo,SourceId,SourceLineNo,CouponId,CouponNo,Quantity,GrossAmount,DiscountAmount,TaxBase)
   SELECT @Line,@SOID,@Line,@Coupon,@CouponNo,Qty,Gross,Discount,TaxBase FROM @Lines WHERE [LineNo]=@Line;
  FETCH NEXT FROM coupons INTO @Line,@Pack,@Sacks,@Qty;
 END;
 CLOSE coupons;DEALLOCATE coupons;
 UPDATE d SET RemaQty=0 FROM dbo.SODT d JOIN @Lines l ON l.[LineNo]=d.ListNo WHERE d.SOID=@SOID AND d.RemaQty=l.Qty;
 IF @@ROWCOUNT<>(SELECT COUNT(*) FROM @Lines) BEGIN RAISERROR('ND_DELIVERY_SOURCE_CHANGED',16,1);RETURN;END;
 UPDATE dbo.SOHD SET DocuStatus='Y' WHERE SOID=@SOID AND DocuStatus='N';
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('ND_DELIVERY_SOURCE_CHANGED',16,1);RETURN;END;
 INSERT dbo.Define_104(ID) VALUES(@New);
 INSERT dbo.SMSat(GlobalID,GlobalFlag,DocuDate,UserName) VALUES(@Global,202,GETDATE(),LEFT(N'wf:'+@User,255));
 INSERT dbo.SOInvHD(SaleAreaID,SOInvID,CustID,ARID,BrchID,EmpID,VATGroupID,ExchRate,PostID,DocuDate,DocuNo,
  VATType,VATRate,GoodType,CreditDays,PrintTime,CreditEndDate,SumIncludeAmnt,SumExcludeAmnt,SumGoodAmnt,
  BaseDiscAmnt,BillDiscFormula,BillDiscAmnt,BillAftrDiscAmnt,AdvnAmnt,AftrAdvnAmnt,TotaExcludeAmnt,TotaBaseAmnt,
  VATAmnt,NetAmnt,CommisAmnt,DocuStatus,MiscChargAmnt,PostGL,CustPONo,DueDate,Docutype,InvNo,InvDate,DocuFlag,
  MultiCurrency,RemaAmnt,BillAmnt,StockEffc,LastInvAmnt,CurrentInvAmnt,Sign,ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,
  CutAdvnFlag,SONo,ReplaceFlag,LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,CouponFlag,ContactName)
 SELECT SaleAreaID,@Finance,CustID,CustID,BrchID,EmpID,VATGroupID,1,@Global,@Date,@No,VATType,@Rate,GoodType,CreditDays,0,DATEADD(day,CreditDays,@Date),
  0,@Gross,@Gross,0,ISNULL(BillDiscFormula,''),@Discount,@Base,0,@Base,0,@Base,@Tax,@Net,0,'N',0,'N',ISNULL(CustPONo,''),DATEADD(day,CreditDays,@Date),202,@No,@Date,'N',
  'N',@Net,0,'N',0,0,1,@Net,0,0,0,'N',@No,'N',1,CustName,0,0,'Y',ContactName FROM dbo.SOHD WHERE SOID=@New;
 INSERT dbo.SOInvDT(SOInvID,ListNo,ExpnID,GoodAmnt,VATType,TotaExcludeAmnt,Docutype,RefID,RefListNo)
  SELECT @Finance,l.[LineNo],g.ExpnID,l.TaxBase,CASE WHEN @Rate>0 THEN h.VatType ELSE '2' END,l.TaxBase,202,@New,l.[LineNo]
  FROM @Lines l JOIN dbo.EMGood g ON g.GoodID=l.GoodId JOIN dbo.SOHD h ON h.SOID=@New;
 IF @Rate>0 UPDATE f SET VatRate=@Rate,VATGroupID=h.VATGroupID FROM dbo.SOInvDT f JOIN dbo.SOHD h ON h.SOID=@New WHERE f.SOInvID=@Finance;
 INSERT dbo.VTVAT(InvNo,InvDate,DocuNo,DocuDate,Remark,BaseAmnt,VatType,VatRate,VatAmnt,PercentClm,ClmAmnt,PeriodID,TaxType,FromFlag,IsLocked,ListNo,VATID,BrchID,VATGroupID,FromID)
  SELECT @No,@Date,@No,@Date,CustName,@Base,CASE WHEN @Rate>0 THEN VatType ELSE '2' END,@Rate,@Tax,0,0,@Period,'1',202,'Y',1,@VatId,1,VATGroupID,@Global FROM dbo.SOHD WHERE SOID=@New;
 INSERT dbo.SMAudit(audit_id,audit_system,audit_screen,audit_datetime,audit_username,audit_action,audit_docuno,audit_docudate,audit_columnid,brchid,audit_computername,audit_refid,version,audit_query)
 VALUES(@Audit,3,2098003049,GETDATE(),LEFT(N'wf:'+@User,100),'INSERT',@No,@Date,@New,1,HOST_NAME(),@Audit,'WF NATIVE v3',@RequestId);
 INSERT dbo.SMEvent(eventid,docudate,docuno,code,c_v_name,amount,vat,totalamnt,username,objectid,brchid,docuid,c_v_id,systemid)
  SELECT @Event,@Date,@No,c.CustCode,h.CustName,0,@Tax,@Net,LEFT(N'wf:'+@User,100),2098003049,1,@New,h.CustID,3
  FROM dbo.SOHD h JOIN dbo.EMCust c ON c.CustID=h.CustID WHERE h.SOID=@SOID;
 INSERT #NativeResult(NativeId,NativeNo,FinanceId) VALUES(@New,@No,@Finance);
END;
GO
