-- @transaction
-- Register App cuts atomically, preserve bridge holds and verify amended/native
-- 116 proofs before invoice. Does not enable or alter WinSpeed hooks.
IF OBJECT_ID('wf.usp_WriteNativeRedemption','P') IS NULL RAISERROR('ND_REDEMPTION_PREREQUISITE_REQUIRED',16,1);
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
ALTER PROCEDURE wf.usp_WriteNativeRedemption @RequestId varchar(36),@UserId int,@ActorId int
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 OR XACT_STATE()<>1 BEGIN RAISERROR('ND_TRANSACTION_REQUIRED',16,1);RETURN;END;
 DECLARE @Plan xml,@Source int,@Emp int,@No varchar(25),@Date datetime,@New int,@Audit int,@Event int,@User nvarchar(100),
  @Receiver nvarchar(100),@Plate nvarchar(25),@Qty decimal(18,4),@Cust int,@Approver int,@ApproverActor int,@ApproverEmp int,@ApprovedAt datetime,@RequesterActor int;
 DECLARE @Validated int;
 EXEC @Validated=wf.usp_ReadNativeDocumentRequest @RequestId,116,@UserId,@ActorId,@Plan OUTPUT,@Source OUTPUT;
 IF @Validated<>0 RETURN;
 SELECT @Emp=e.EmpID,@User=u.Username FROM wf.AppUser u WITH(UPDLOCK,HOLDLOCK) JOIN dbo.EMEmp e WITH(HOLDLOCK) ON CONVERT(varchar(30),e.EmpID)=u.EmpId WHERE u.Id=@UserId;
 IF @Emp IS NULL BEGIN RAISERROR('ND_RECORDER_MAPPING_REQUIRED',16,1);RETURN;END;
 SELECT @Approver=r.ApprovedById,@ApproverActor=r.ApproverActorId,@ApprovedAt=r.ApprovedAtUtc,@RequesterActor=r.ActorUserId,@ApproverEmp=e.EmpID
  FROM wf.NativeDocumentRequest r JOIN wf.AppUser u ON u.Id=r.ApprovedById LEFT JOIN dbo.EMEmp e ON CONVERT(varchar(30),e.EmpID)=u.EmpId WHERE r.RequestId=@RequestId;
 SET @No=@Plan.value('(/plan/@slipNo)[1]','varchar(25)');SET @Receiver=@Plan.value('(/plan/@receiver)[1]','nvarchar(100)');
 SET @Plate=@Plan.value('(/plan/@plate)[1]','nvarchar(25)');SET @Date=@Plan.value('(/plan/@docDate)[1]','datetime');
 SET @Cust=@Plan.value('(/plan/@custId)[1]','int');
 IF NULLIF(LTRIM(RTRIM(@No)),'') IS NULL OR NULLIF(LTRIM(RTRIM(@Receiver)),'') IS NULL OR NULLIF(LTRIM(RTRIM(@Plate)),'') IS NULL
  OR @Date>CONVERT(datetime,CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120),120)
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@No)
 BEGIN RAISERROR('ND_SLIP_INVALID_OR_USED',16,1);RETURN;END;
 DECLARE @Lines TABLE(CouponId int PRIMARY KEY,Qty decimal(18,4),BeforeQty decimal(18,4),DeliveryId int,SourceLineNo int,GoodId int);
 INSERT @Lines SELECT n.value('@couponId','int'),n.value('@quantity','decimal(18,4)'),n.value('@beforeRemaining','decimal(18,4)'),
  n.value('@deliveryId','int'),n.value('@sourceLineNo','int'),n.value('@goodId','int') FROM @Plan.nodes('/plan/line') t(n);
 IF NOT EXISTS(SELECT 1 FROM @Lines) OR EXISTS(SELECT 1 FROM @Lines WHERE Qty<=0 OR Qty>BeforeQty)
 BEGIN RAISERROR('ND_LINES_INVALID',16,1);RETURN;END;
 DECLARE @Reservations TABLE(Id bigint PRIMARY KEY,CouponId int,Qty decimal(12,4),Revision int,BeforeConsumed decimal(12,4));
 INSERT @Reservations SELECT s.value('@reservationId','bigint'),s.value('(../@couponId)[1]','int'),s.value('@quantity','decimal(12,4)'),
  s.value('@revision','int'),s.value('@beforeConsumed','decimal(12,4)') FROM @Plan.nodes('/plan/line/settlement') t(s);
 IF EXISTS(SELECT 1 FROM @Reservations r LEFT JOIN @Lines l ON l.CouponId=r.CouponId WHERE l.CouponId IS NULL OR r.Qty<=0)
  OR EXISTS(SELECT 1 FROM @Reservations r JOIN @Lines l ON l.CouponId=r.CouponId GROUP BY r.CouponId,l.Qty HAVING SUM(r.Qty)>l.Qty)
 BEGIN RAISERROR('ND_RESERVATION_INVALID',16,1);RETURN;END;
 -- Same lock order as Sale-App reservation writers, including unexpired holds.
 DECLARE @Coupon int,@Amount decimal(18,4),@Delivery int,@Line int,@List int,@Held decimal(18,4),@Own decimal(18,4);SET @List=0;
 DECLARE coupon_locks CURSOR LOCAL FAST_FORWARD FOR SELECT CouponId FROM @Lines ORDER BY CouponId;
 OPEN coupon_locks;FETCH NEXT FROM coupon_locks INTO @Coupon;
 WHILE @@FETCH_STATUS=0
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) JOIN @Lines l ON l.CouponId=c.CouponID
   JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=c.DocuID AND h.DocuType=104 AND h.DocuStatus<>'C'
   WHERE c.CouponID=@Coupon AND c.RemaQty=l.BeforeQty AND c.DocuID=l.DeliveryId AND c.RefListno=l.SourceLineNo AND c.GoodID=l.GoodId
    AND @Date>=h.DocuDate AND LEFT(c.CouponNo,1)=CASE LEFT(h.DocuNo,1) WHEN 'I' THEN 'C' WHEN 'K' THEN 'D' END
    AND(h.CustID=@Cust OR EXISTS(SELECT 1 FROM wf.CouponBeneficiary b WITH(UPDLOCK,HOLDLOCK)
      WHERE b.OwnerCustId=CONVERT(varchar(50),h.CustID) AND b.BeneficiaryCustId=CONVERT(varchar(50),@Cust) AND b.Status='ACTIVE'
       AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=@Date) AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=@Date)
       AND(b.Scope='ALL' OR b.Scope=CONVERT(varchar(50),c.GoodID)))))
  BEGIN RAISERROR('ND_COUPON_SOURCE_CHANGED',16,1);RETURN;END;
  IF EXISTS(SELECT 1 FROM @Reservations r LEFT JOIN wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK) ON cr.Id=r.Id
    WHERE r.CouponId=@Coupon AND(cr.Id IS NULL OR cr.CouponId<>@Coupon OR cr.Status<>'RESERVED' OR cr.Revision<>r.Revision
     OR ISNULL(cr.ConsumedQty,0)<>r.BeforeConsumed OR cr.ReservedQty<r.BeforeConsumed+r.Qty
     OR cr.BeneficiaryCustId<>CONVERT(varchar(50),@Cust) OR cr.ExpiresAt<=GETUTCDATE()
     OR wf.fn_CouponBridgeReservationHeld(cr.Id)=1
     OR EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine al WITH(UPDLOCK,HOLDLOCK)
      JOIN wf.CouponNativeCutAuthorization ah WITH(UPDLOCK,HOLDLOCK) ON ah.Id=al.AuthorizationId
      WHERE al.ReservationId=cr.Id AND(ah.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH(UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=al.Id)))))
  BEGIN RAISERROR('ND_RESERVATION_UNAVAILABLE',16,1);RETURN;END;
  SELECT @Held=ISNULL(SUM(cr.ReservedQty-ISNULL(cr.ConsumedQty,0)),0) FROM wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK)
   WHERE cr.CouponId=@Coupon AND cr.Status='RESERVED' AND(cr.ExpiresAt IS NULL OR cr.ExpiresAt>GETUTCDATE() OR wf.fn_CouponBridgeReservationHeld(cr.Id)=1
    OR EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine al WITH(UPDLOCK,HOLDLOCK)
      JOIN wf.CouponNativeCutAuthorization ah WITH(UPDLOCK,HOLDLOCK) ON ah.Id=al.AuthorizationId
      WHERE al.ReservationId=cr.Id AND(ah.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH(UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=al.Id))));
  SELECT @Own=ISNULL(SUM(Qty),0) FROM @Reservations WHERE CouponId=@Coupon;
  IF @Held<0 OR EXISTS(SELECT 1 FROM wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK)
    WHERE cr.CouponId=@Coupon AND cr.Status='RESERVED' AND(cr.ReservedQty IS NULL OR cr.ReservedQty<0 OR ISNULL(cr.ConsumedQty,0)<0 OR cr.ConsumedQty>cr.ReservedQty))
   OR EXISTS(SELECT 1 FROM @Lines WHERE CouponId=@Coupon AND(Qty>BeforeQty-@Held+@Own OR @Own>@Held))
  BEGIN RAISERROR('ND_COUPON_INSUFFICIENT',16,1);RETURN;END;
  FETCH NEXT FROM coupon_locks INTO @Coupon;
 END;
 CLOSE coupon_locks;DEALLOCATE coupon_locks;
 SELECT @Qty=SUM(Qty) FROM @Lines;
 EXEC wf.usp_AllocateNativeRedemptionId @NewId=@New OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SMAudit',@NewId=@Audit OUTPUT;
 EXEC wf.usp_AllocateNativeDocumentEventId @NewId=@Event OUTPUT;
 INSERT dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,SaveEmpID,SumGoodQty,DocuStatus,IsCheckAll)
 VALUES(@New,@No,@Date,116,@Receiver,@Plate,@Emp,@Qty,'N','Y');
 -- Release only this approved request's own hold before native debit.
 -- Both ledger and native changes remain inside the caller transaction. A
 -- trigger/verification failure rolls everything back; no hold is freed at COMMIT.
 INSERT wf.CouponReservationSettlement(ReservationId,CouponId,NativeRedemptionId,NativeDocuNo,SettledQty,SettledBy,Note)
  SELECT Id,CouponId,@New,@No,Qty,@UserId,N'NATIVE-DOCUMENTS-v3; request='+@RequestId FROM @Reservations;
 UPDATE cr SET ConsumedQty=ISNULL(cr.ConsumedQty,0)+r.Qty,
  Status=CASE WHEN ISNULL(cr.ConsumedQty,0)+r.Qty=cr.ReservedQty THEN 'CONSUMED' ELSE 'RESERVED' END,
  Revision=cr.Revision+1,UpdatedAt=GETUTCDATE()
  FROM wf.CouponReservation cr JOIN @Reservations r ON r.Id=cr.Id
  WHERE cr.Status='RESERVED' AND cr.Revision=r.Revision AND ISNULL(cr.ConsumedQty,0)=r.BeforeConsumed AND cr.ReservedQty>=r.BeforeConsumed+r.Qty;
 IF @@ROWCOUNT<>(SELECT COUNT(*) FROM @Reservations) BEGIN RAISERROR('ND_RESERVATION_CHANGED',16,1);RETURN;END;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,BeforeJson,AfterJson,ReasonCode,ReasonText,UserId,ActorUserId,CreatedAt)
  SELECT 'COUPON_RESERVATION',CONVERT(varchar(50),r.Id),'NATIVE_SETTLE',
   N'{"consumedQty":'+CONVERT(nvarchar(40),r.BeforeConsumed)+N'}',
   N'{"settledQty":'+CONVERT(nvarchar(40),r.Qty)+N',"redemptionId":'+CONVERT(nvarchar(20),@New)+N',"requestId":"'+@RequestId+N'"}',
   'NATIVE_DOCUMENT',@No,CONVERT(varchar(50),@UserId),CONVERT(varchar(50),@ActorId),GETUTCDATE() FROM @Reservations r;
 DECLARE coupon_write CURSOR LOCAL FAST_FORWARD FOR SELECT CouponId,Qty,DeliveryId,SourceLineNo FROM @Lines ORDER BY CouponId;
 OPEN coupon_write;FETCH NEXT FROM coupon_write INTO @Coupon,@Amount,@Delivery,@Line;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @List=@List+1;
  INSERT dbo.WFRedemtionDT(RedemtionID,Listno,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,PostInv,GoodQty,RemaQty,IsCheck)
   SELECT @New,@List,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,'N',@Amount,@Amount,'Y' FROM dbo.WFCoupon WHERE CouponID=@Coupon;
  UPDATE dbo.WFCoupon SET RemaQty=RemaQty-@Amount WHERE CouponID=@Coupon AND RemaQty>=@Amount;
  IF @@ROWCOUNT<>1 BEGIN RAISERROR('ND_COUPON_SOURCE_CHANGED',16,1);RETURN;END;
  INSERT #NativeLines(NativeLineNo,SourceId,SourceLineNo,CouponId,CouponNo,Quantity,GrossAmount,DiscountAmount,TaxBase)
   SELECT @List,@Delivery,@Line,@Coupon,CouponNo,@Amount,0,0,0 FROM dbo.WFCoupon WHERE CouponID=@Coupon;
  FETCH NEXT FROM coupon_write INTO @Coupon,@Amount,@Delivery,@Line;
 END;
 CLOSE coupon_write;DEALLOCATE coupon_write;
 INSERT dbo.SMAudit(audit_id,audit_system,audit_screen,audit_datetime,audit_username,audit_action,audit_docuno,audit_docudate,audit_columnid,brchid,audit_computername,audit_refid,version,audit_query)
 VALUES(@Audit,3,2098003052,GETDATE(),LEFT(N'wf:'+@User,100),'INSERT',@No,@Date,@New,1,HOST_NAME(),@Audit,'WF NATIVE v3',@RequestId);
 INSERT dbo.SMEvent(eventid,docudate,docuno,code,c_v_name,amount,vat,totalamnt,username,objectid,brchid,docuid,c_v_id,systemid)
 VALUES(@Event,@Date,@No,'','',0,0,0,LEFT(N'wf:'+@User,100),2098003052,1,@New,@Cust,3);
 -- v3 request + receipt carry the recorder and approver. Do not invent one
 -- SourceSOID in the legacy approval table for a mixed-order/customer cut.
 INSERT #NativeResult(NativeId,NativeNo,FinanceId) VALUES(@New,@No,NULL);
END;
GO
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
   LEFT JOIN wf.CouponBridgeDocument bd WITH(UPDLOCK,HOLDLOCK) ON bd.NativeId=p.Cut AND bd.State='ACTIVE'
   WHERE h.RedemtionID IS NULL OR((rr.RequestId IS NULL OR rr.NativeAfterHash IS NULL) AND bd.NativeId IS NULL) OR h.DocuType<>116 OR h.DocuStatus<>'N' OR h.IsCheckAll<>'Y' OR CONVERT(date,h.DocuDate)<>@Date
    OR d.CouponID IS NULL OR d.IsCheck<>'Y' OR d.PostInv<>'N' OR d.SOInvID IS NOT NULL OR d.SOListNo IS NOT NULL OR p.Qty<=0 OR d.GoodQty<>p.Qty OR d.RemaQty<>p.Qty
    OR c.DocuID<>@Source OR c.RefListno<>p.SourceLine OR c.CouponNo<>d.CouponNo OR c.GoodID<>d.GoodID OR c.GoodPrice<>d.GoodPrice OR c.InveID<>d.InveID
    OR ISNULL(c.LocaID,0)<>ISNULL(d.LocaID,0) OR c.GoodUnitID<>d.GoodUnitID OR s.SOID IS NULL OR s.DocuType<>104 OR s.GoodQty2<>c.GoodQty
    OR s.GoodStockRate2<>1 OR s.GoodStockQty<>s.GoodQty2 OR s.GoodID<>c.GoodID OR s.GoodPrice2<>c.GoodPrice OR s.InveID<>c.InveID
    OR p.Disc<0 OR p.Disc>p.Gross OR p.Base<>p.Gross-p.Disc OR EXISTS(SELECT 1 FROM wf.NativeDocumentReceiptLine WHERE DocuType=107 AND SourceId=p.Cut AND SourceLineNo=p.CutLine))
 BEGIN RAISERROR('ND_INVOICE_CUT_CHANGED',16,1);RETURN;END;
 -- Verify cumulative allocations in SQL too; a stored plan is never authority
 -- to invent amounts, or to omit invoices created by another native client.
 DECLARE @BridgeCut int;
 DECLARE bridge_proofs CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT p.Cut FROM @Lines p JOIN wf.CouponBridgeDocument b ON b.NativeId=p.Cut;
 OPEN bridge_proofs;FETCH NEXT FROM bridge_proofs INTO @BridgeCut;
 WHILE @@FETCH_STATUS=0 BEGIN
  EXEC wf.sp_CouponBridgeAssertDocument @BridgeCut;FETCH NEXT FROM bridge_proofs INTO @BridgeCut;
 END;CLOSE bridge_proofs;DEALLOCATE bridge_proofs;
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

IF OBJECT_ID('wf.usp_ApplyNativeDocument','P') IS NULL RAISERROR('ND_DISPATCH_PREREQUISITE_REQUIRED',16,1);
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
ALTER PROCEDURE wf.usp_ApplyNativeDocument @RequestId varchar(36),@UserId int,@ActorId int,@PrimaryUserId int,@PrimaryActorId int
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 OR wf.fn_IsNativeDocumentTarget()<>1 BEGIN RAISERROR('ND_TARGET_NOT_READY',16,1);RETURN;END;
 DECLARE @Type int,@Revision int;
 SELECT @Type=DocuType,@Revision=Revision FROM wf.NativeDocumentRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@RequestId;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@RequestId AND State<>'CANCELLED' AND ReleasedAtUtc IS NULL)
  BEGIN RAISERROR('BRIDGE_REQUEST_OWNED_BY_WINSPEED',16,1);RETURN;END;
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
  -- SourceId means a customer for 116 and a delivery for 107. Resolve each
  -- affected booking explicitly; never treat either identifier as a booking.
  INSERT wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note)
  SELECT CONVERT(varchar(50),roots.SOID),@UserId,@ActorId,'NATIVE_DOCUMENT_APPLIED',
   N'v3;type='+CONVERT(nvarchar(4),@Type)+N';request='+@RequestId+N';primary='+CONVERT(nvarchar(12),@PrimaryUserId)+N';actorPrimary='+CONVERT(nvarchar(12),@PrimaryActorId)
  FROM(
   SELECT r.SourceId AS SOID FROM wf.NativeDocumentRequest r WHERE r.RequestId=@RequestId AND @Type IN(119,104)
   UNION
   SELECT COALESCE(NULLIF(d.RefSOID,0),c.DocuID) FROM #NativeLines l
    JOIN dbo.WFCoupon c WITH(HOLDLOCK) ON c.CouponID=l.CouponId
    JOIN dbo.SODT d WITH(HOLDLOCK) ON d.SOID=c.DocuID AND d.ListNo=c.RefListno AND d.DocuType=104
    WHERE @Type IN(116,107)
  )roots;
  IF @Type=116 BEGIN
   DECLARE @CutId int;SELECT @CutId=NativeId FROM #NativeResult;EXEC wf.sp_CouponBridgeRegister @RequestId,@CutId;
  END;
  SELECT * FROM wf.NativeDocumentReceipt WHERE RequestId=@RequestId;
 END TRY
 BEGIN CATCH
  DECLARE @Message nvarchar(2048);SET @Message=ERROR_MESSAGE();RAISERROR('%s',16,1,@Message);
 END CATCH;
END;
GO
