-- @transaction
-- Own reservation accounting must precede native balance debit so the shared
-- WinSpeed reservation floor sees the remaining holds, not already-used ones.
-- Does not enable or change any native trigger or alter prior receipts.
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
     OR EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine al WITH(UPDLOCK,HOLDLOCK)
      JOIN wf.CouponNativeCutAuthorization ah WITH(UPDLOCK,HOLDLOCK) ON ah.Id=al.AuthorizationId
      WHERE al.ReservationId=cr.Id AND(ah.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH(UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=al.Id)))))
  BEGIN RAISERROR('ND_RESERVATION_UNAVAILABLE',16,1);RETURN;END;
  SELECT @Held=ISNULL(SUM(cr.ReservedQty-ISNULL(cr.ConsumedQty,0)),0) FROM wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK)
   WHERE cr.CouponId=@Coupon AND cr.Status='RESERVED' AND(cr.ExpiresAt IS NULL OR cr.ExpiresAt>GETUTCDATE()
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
