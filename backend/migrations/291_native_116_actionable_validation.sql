-- @transaction
-- Preserve all 289 admission invariants; identify the failing field and reject
-- duplicate business numbers under the shared native document transaction lock.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
ALTER PROCEDURE wf.sp_CouponNative116Admit @stage uniqueidentifier,@audit int AS
BEGIN
 SET NOCOUNT ON;SET ANSI_WARNINGS ON;SET ANSI_PADDING ON;SET ARITHABORT ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1 OR wf.fn_Native116Eligible()<>1 OR wf.fn_Native116StageOwned(@stage)<>1
  OR NOT EXISTS(SELECT 1 FROM wf.Native116AuditContext WHERE SessionId=@@SPID AND StageId=@stage AND NativeAuditId=@audit)
 BEGIN RAISERROR('NATIVE_116_AUDIT_CONNECTION_REQUIRED',16,1);RETURN;END;
 DECLARE @native int,@number varchar(25),@beforeHead nvarchar(max),@beforeLines nvarchar(max),@stageDate datetime,
  @date datetime,@login varchar(100),@action varchar(10),@auditNo varchar(25),@auditDate datetime,@op char(1),@u int,@emp int,@proof nvarchar(max),
  @head nvarchar(max),@lines nvarchar(max),@receiver nvarchar(255),@plate nvarchar(25),@recorder int,@cust int,@revision int,@lock int;
 EXEC @lock=sp_getapplock @Resource='WF_NATIVE_DOCUMENTS_V3',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
 IF @lock<0 BEGIN RAISERROR('NATIVE_116_BUSY',16,1);RETURN;END;
 SELECT @native=NativeId,@number=DocuNo,@stageDate=DocuDate,@beforeHead=BeforeHead,@beforeLines=BeforeLines
  FROM wf.Native116Stage WITH(UPDLOCK,HOLDLOCK) WHERE StageId=@stage AND State='PENDING' AND BeforeCaptured=1;
 SELECT @login=RTRIM(audit_username),@action=RTRIM(audit_action),@auditNo=RTRIM(audit_docuno),@auditDate=audit_docudate
  FROM dbo.SMAudit WITH(HOLDLOCK) WHERE audit_id=@audit AND audit_screen=2098003052;
 IF @native IS NULL OR @number IS NULL OR @login IS NULL OR @action IS NULL OR @action NOT IN('I','U','D') OR @auditNo IS NULL OR @auditNo<>RTRIM(@number)
  OR EXISTS(SELECT 1 FROM wf.Native116AuditReceipt WITH(UPDLOCK,HOLDLOCK) WHERE NativeAuditId=@audit OR StageId=@stage)
 BEGIN RAISERROR('NATIVE_116_AUDIT_NOT_THIS_SAVE',16,1);RETURN;END;
 EXEC wf.sp_ResolveNative116Operator @login,@u OUTPUT,@emp OUTPUT,@proof OUTPUT;
 IF EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK)
  WHERE DocuType=116 AND DocuNo=@number AND RedemtionID<>@native)
 BEGIN RAISERROR('NATIVE_116_DOCUMENT_NUMBER_ALREADY_USED_GET_NEW_NUMBER',16,1);RETURN;END;
 EXEC wf.sp_CouponBridgePhysical @native,@head OUTPUT,@lines OUTPUT;
 SET @op=CASE WHEN NULLIF(@beforeHead,N'') IS NULL THEN 'C' WHEN NULLIF(@head,N'') IS NULL THEN 'D' ELSE 'E' END;
 IF @action<>CASE @op WHEN 'C' THEN 'I' WHEN 'E' THEN 'U' ELSE 'D' END
 BEGIN RAISERROR('NATIVE_116_AUDIT_ACTION_MISMATCH',16,1);RETURN;END;
 DECLARE @after TABLE(CouponId int PRIMARY KEY,[LineNo] int UNIQUE,Qty decimal(18,4));
 INSERT @after SELECT CouponID,Listno,CONVERT(decimal(18,4),GoodQty) FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native;
 IF @op='D'
 BEGIN
  IF EXISTS(SELECT 1 FROM @after) BEGIN RAISERROR('NATIVE_116_CANCEL_INCOMPLETE',16,1);RETURN;END;
  SET @date=@stageDate;SET @receiver=N'';SET @plate=N'';
  DECLARE @beforeXml xml;SET @beforeXml=CONVERT(xml,@beforeHead);
  SET @recorder=@beforeXml.value('(/head/@SaveEmpID)[1]','int');
 END
 ELSE
 BEGIN
  SELECT @date=DocuDate,@receiver=ISNULL(IssueName,N''),@plate=ISNULL(CarLicense,N''),@recorder=SaveEmpID
   FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK)
   WHERE RedemtionID=@native AND DocuType=116 AND DocuStatus='N' AND DocuNo=@number;
  IF @date IS NULL
  BEGIN RAISERROR('NATIVE_116_HEADER_INCOMPLETE_REOPEN_DOCUMENT',16,1);RETURN;END;
  IF NOT EXISTS(SELECT 1 FROM @after)
  BEGIN RAISERROR('NATIVE_116_LINES_REQUIRED_SELECT_COUPONS',16,1);RETURN;END;
  IF EXISTS(SELECT 1 FROM @after WHERE Qty<=0)
  BEGIN RAISERROR('NATIVE_116_POSITIVE_TRANSPORT_QUANTITY_REQUIRED',16,1);RETURN;END;
  IF EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WHERE RedemtionID=@native AND(IsCheckAll IS NULL OR IsCheckAll<>'Y'))
   OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WHERE RedemtionID=@native AND(IsCheck IS NULL OR IsCheck<>'Y'))
  BEGIN RAISERROR('NATIVE_116_CHECK_ALL_REQUIRED_CHECK_EVERY_LINE',16,1);RETURN;END;
  IF EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WHERE RedemtionID=@native
   AND(PostInv IS NULL OR PostInv<>'N' OR SOInvID IS NOT NULL))
  BEGIN RAISERROR('NATIVE_116_INVOICE_STATE_REVIEW_REQUIRED',16,1);RETURN;END;
  IF EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WHERE RedemtionID=@native AND(RemaQty IS NULL OR RemaQty<>GoodQty))
  BEGIN RAISERROR('NATIVE_116_REMAINING_QUANTITY_MISMATCH_REOPEN_DOCUMENT',16,1);RETURN;END;
  IF EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WHERE RedemtionID=@native
   AND(SumGoodQty IS NULL OR SumGoodQty<>(SELECT SUM(Qty) FROM @after)))
  BEGIN RAISERROR('NATIVE_116_TOTAL_QUANTITY_MISMATCH_RECHECK_TRANSPORT',16,1);RETURN;END;
 END;
 IF @date IS NULL OR @auditDate IS NULL OR CONVERT(date,@date)<>CONVERT(date,@auditDate)
  OR CONVERT(date,@date)>CONVERT(date,DATEADD(hour,7,GETUTCDATE()))
  OR NOT EXISTS(SELECT 1 FROM dbo.EMEmp WITH(HOLDLOCK) WHERE EmpID=@recorder AND EmpStatus='1' AND EmpResignDate IS NULL)
 BEGIN RAISERROR('NATIVE_116_DATE_OR_RECORDER_INVALID',16,1);RETURN;END;
 IF @op='C' AND CONVERT(date,@date)<ISNULL((SELECT CONVERT(date,SettingValue,120) FROM wf.SystemSetting WITH(HOLDLOCK)
  WHERE SettingKey='GLOBAL_DATA_START_DATE'),CONVERT(date,'2026-01-01',120))
 BEGIN RAISERROR('NATIVE_116_NEW_DOCUMENT_BEFORE_START',16,1);RETURN;END;
 SELECT @revision=Revision,@cust=CustId FROM wf.CouponBridgeDocument WITH(UPDLOCK,HOLDLOCK) WHERE NativeId=@native;
 IF @revision IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wf.CouponBridgeDocument WHERE NativeId=@native AND State='ACTIVE'
  AND HeaderProof=@beforeHead AND LineProof=@beforeLines)
 BEGIN RAISERROR('NATIVE_116_BRIDGE_PROOF_CHANGED',16,1);RETURN;END;
 -- A direct native form has no beneficiary ID. New/legacy native documents
 -- retain each coupon's native owner (CustId=0 means multiple/per-line owners),
 -- while an existing reviewed app document retains its explicit beneficiary.
 SET @cust=ISNULL(@cust,0);
 IF EXISTS(SELECT 1 FROM @after a WHERE NOT EXISTS(SELECT 1 FROM wf.Native116StageCoupon WHERE StageId=@stage AND CouponId=a.CouponId))
  OR NOT EXISTS(SELECT 1 FROM wf.Native116StageCoupon WHERE StageId=@stage)
 BEGIN RAISERROR('NATIVE_116_UNOBSERVED_COUPON',16,1);RETURN;END;
 DECLARE @coupon int,@source nvarchar(max),@expected nvarchar(max),@target decimal(18,4),@current decimal(18,4),
  @oldQty decimal(18,4),@newQty decimal(18,4),@credit decimal(18,4),@debit decimal(18,4),@sourceCust int,@owner int,@ownerEmp int;
 DECLARE validate_coupon CURSOR LOCAL FAST_FORWARD FOR SELECT c.CouponId,c.SourceProof,c.NativeBefore+c.BeforeQty-ISNULL(a.Qty,0),
  c.BeforeQty,ISNULL(a.Qty,0),c.CreditQty,c.DebitQty FROM wf.Native116StageCoupon c LEFT JOIN @after a ON a.CouponId=c.CouponId
  WHERE c.StageId=@stage ORDER BY c.CouponId;
 OPEN validate_coupon;FETCH NEXT FROM validate_coupon INTO @coupon,@expected,@target,@oldQty,@newQty,@credit,@debit;
 WHILE @@FETCH_STATUS=0 BEGIN
  EXEC wf.sp_CouponBridgeSource @coupon,0,@source OUTPUT;
  IF NULLIF(@source,N'') IS NULL OR @source<>@expected OR @target<0
  BEGIN RAISERROR('NATIVE_116_SOURCE_OR_QUANTITY_CHANGED',16,1);RETURN;END;
  SELECT @current=c.RemaQty,@sourceCust=h.CustID,@owner=x.SalesUserId,@ownerEmp=h.EmpID
   FROM dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=c.DocuID AND h.DocuType=104
   JOIN dbo.SODT d WITH(HOLDLOCK) ON d.SOID=h.SOID AND d.ListNo=c.RefListno AND d.DocuType=104
   LEFT JOIN wf.SalesOrderExt x WITH(HOLDLOCK) ON x.SOID=CONVERT(varchar(50),h.SOID)
   WHERE c.CouponID=@coupon AND c.DocuType=104 AND h.DocuStatus<>'C' AND h.DocuDate<=@date
    AND c.GoodID=d.GoodID AND c.GoodUnitID=d.GoodUnitID2 AND c.InveID=d.InveID AND ISNULL(c.LocaID,0)=ISNULL(d.LocaID,0)
    AND LEFT(c.CouponNo,1)=CASE LEFT(h.DocuNo,1) WHEN 'I' THEN 'C' WHEN 'K' THEN 'D' END;
  IF @@ROWCOUNT<>1 OR @current IS NULL
   OR(@current<>@target AND NOT EXISTS(SELECT 1 FROM wf.Native116StageCoupon WHERE StageId=@stage AND CouponId=@coupon
     AND CreditQty=0 AND DebitQty=0 AND NativeBefore=@current))
   OR(@credit<>0 AND @credit<>@oldQty) OR(@debit<>0 AND @debit<>@newQty)
  BEGIN RAISERROR('NATIVE_116_BALANCE_OR_SOURCE_INCOMPLETE',16,1);RETURN;END;
  IF @cust>0 AND @sourceCust<>@cust
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM wf.CouponBeneficiary b WITH(UPDLOCK,HOLDLOCK) JOIN dbo.WFCoupon c ON c.CouponID=@coupon
    WHERE b.OwnerCustId=CONVERT(varchar(50),@sourceCust) AND b.BeneficiaryCustId=CONVERT(varchar(50),@cust) AND b.Status='ACTIVE'
     AND(b.Scope='ALL' OR b.Scope=CONVERT(varchar(50),c.GoodID))
     AND(b.EffectiveFrom IS NULL OR(b.EffectiveFrom<=@date AND b.EffectiveFrom<=CONVERT(date,DATEADD(hour,7,GETUTCDATE()))))
     AND(b.EffectiveTo IS NULL OR(b.EffectiveTo>=@date AND b.EffectiveTo>=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))))
   BEGIN RAISERROR('NATIVE_116_BENEFICIARY_NOT_AUTHORIZED',16,1);RETURN;END;
   SELECT @owner=cx.SalespersonUserId,@ownerEmp=c.BillEmp FROM dbo.EMCust c WITH(HOLDLOCK)
    LEFT JOIN wf.CustomerExt cx WITH(HOLDLOCK) ON cx.CustId=c.CustID WHERE c.CustID=@cust;
  END;
  IF wf.fn_UserInOrganizationScope(@u,@owner,@ownerEmp)<>1
  BEGIN RAISERROR('NATIVE_116_OPERATOR_OUTSIDE_ORGANIZATION',16,1);RETURN;END;
  IF EXISTS(SELECT 1 FROM dbo.WFRedemtionDT d JOIN dbo.WFCoupon c ON c.CouponID=d.CouponID WHERE d.RedemtionID=@native AND d.CouponID=@coupon
   AND(d.GoodID IS NULL OR d.CouponNo IS NULL OR d.GoodUnitID IS NULL OR d.InveID IS NULL OR d.GoodPrice IS NULL OR c.GoodPrice IS NULL
    OR d.GoodID<>c.GoodID OR d.CouponNo<>c.CouponNo OR d.GoodUnitID<>c.GoodUnitID OR d.InveID<>c.InveID
    OR ISNULL(d.LocaID,0)<>ISNULL(c.LocaID,0) OR d.GoodPrice<>c.GoodPrice))
  BEGIN RAISERROR('NATIVE_116_DETAIL_SOURCE_MISMATCH',16,1);RETURN;END;
  FETCH NEXT FROM validate_coupon INTO @coupon,@expected,@target,@oldQty,@newQty,@credit,@debit;
 END;CLOSE validate_coupon;DEALLOCATE validate_coupon;
 DECLARE @returns TABLE(SettlementId bigint PRIMARY KEY,ReservationId bigint,CouponId int,Qty decimal(12,4));
 DECLARE @allocated decimal(18,4),@needed decimal(18,4),@settlement bigint,@reservation bigint,@settled decimal(12,4),@return decimal(12,4);
 DECLARE return_coupon CURSOR LOCAL FAST_FORWARD FOR SELECT c.CouponId,c.BeforeQty,ISNULL(a.Qty,0)
  FROM wf.Native116StageCoupon c LEFT JOIN @after a ON a.CouponId=c.CouponId WHERE c.StageId=@stage ORDER BY c.CouponId;
 OPEN return_coupon;FETCH NEXT FROM return_coupon INTO @coupon,@oldQty,@newQty;
 WHILE @@FETCH_STATUS=0 BEGIN
  SELECT @allocated=ISNULL(SUM(SettledQty),0) FROM wf.CouponBridgeEffectiveSettlement WITH(HOLDLOCK)
   WHERE NativeRedemptionId=@native AND CouponId=@coupon;
  IF @allocated>@oldQty BEGIN RAISERROR('NATIVE_116_SETTLEMENT_EXCEEDS_BEFORE',16,1);RETURN;END;
  SET @needed=CASE WHEN @allocated>@newQty THEN @allocated-@newQty ELSE 0 END;
  DECLARE return_settlement CURSOR LOCAL FAST_FORWARD FOR SELECT Id,ReservationId,SettledQty FROM wf.CouponBridgeEffectiveSettlement WITH(HOLDLOCK)
   WHERE NativeRedemptionId=@native AND CouponId=@coupon ORDER BY Id DESC;
  OPEN return_settlement;FETCH NEXT FROM return_settlement INTO @settlement,@reservation,@settled;
  WHILE @@FETCH_STATUS=0 AND @needed>0 BEGIN
   SET @return=CASE WHEN @settled<@needed THEN @settled ELSE @needed END;
   INSERT @returns VALUES(@settlement,@reservation,@coupon,@return);SET @needed=@needed-@return;
   FETCH NEXT FROM return_settlement INTO @settlement,@reservation,@settled;
  END;CLOSE return_settlement;DEALLOCATE return_settlement;
  IF @needed<>0 BEGIN RAISERROR('NATIVE_116_RETURN_COVERAGE_INVALID',16,1);RETURN;END;
  FETCH NEXT FROM return_coupon INTO @coupon,@oldQty,@newQty;
 END;CLOSE return_coupon;DEALLOCATE return_coupon;
 IF EXISTS(SELECT 1 FROM @returns x LEFT JOIN wf.CouponReservation r WITH(UPDLOCK,HOLDLOCK) ON r.Id=x.ReservationId
  WHERE r.Id IS NULL OR r.CouponId<>x.CouponId OR r.Status NOT IN('RESERVED','CONSUMED')
   OR ISNULL(r.ConsumedQty,0)<>(SELECT ISNULL(SUM(SettledQty),0) FROM wf.CouponBridgeEffectiveSettlement WHERE ReservationId=r.Id))
  OR EXISTS(SELECT r.Id FROM @returns x JOIN wf.CouponReservation r ON r.Id=x.ReservationId
   GROUP BY r.Id,r.ConsumedQty HAVING SUM(x.Qty)>r.ConsumedQty)
 BEGIN RAISERROR('NATIVE_116_RESERVATION_LEDGER_CHANGED',16,1);RETURN;END;
 -- Returned allocations become held again. Native creation/increases can
 -- spend free quantity only and never consume another bill's reservation.
 IF EXISTS(SELECT 1 FROM wf.Native116StageCoupon c LEFT JOIN @after a ON a.CouponId=c.CouponId
  OUTER APPLY(SELECT SUM(r.ReservedQty-ISNULL(r.ConsumedQty,0)) Held,
   SUM(CASE WHEN r.ReservedQty<0 OR ISNULL(r.ConsumedQty,0)<0 OR r.ReservedQty<ISNULL(r.ConsumedQty,0) THEN 1 ELSE 0 END) Invalid
   FROM wf.CouponReservation r WITH(UPDLOCK,HOLDLOCK) WHERE r.CouponId=c.CouponId AND r.Status='RESERVED'
    AND(r.ExpiresAt IS NULL OR r.ExpiresAt>GETUTCDATE() OR wf.fn_CouponBridgeReservationHeld(r.Id)=1))h
  OUTER APPLY(SELECT SUM(Qty) Qty FROM @returns WHERE CouponId=c.CouponId)ret
  WHERE c.StageId=@stage AND(ISNULL(h.Invalid,0)>0 OR c.NativeBefore+c.BeforeQty-ISNULL(a.Qty,0)<ISNULL(h.Held,0)+ISNULL(ret.Qty,0)))
 BEGIN RAISERROR('NATIVE_116_RESERVED_BALANCE_BLOCKED',16,1);RETURN;END;
 DECLARE @event bigint,@permit varchar(36);SET @permit=CONVERT(varchar(36),@stage);
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,UserId,ActorUserId,AfterJson)
 VALUES('NATIVE_116',CONVERT(varchar(50),@native),'COMPLETE','NATIVE_PFC_AUDIT',CONVERT(varchar(20),@u),CONVERT(varchar(20),@u),
  N'{"stage":"'+@permit+N'","operation":"'+@op+N'","nativeAuditId":'+CONVERT(nvarchar(20),@audit)
  +N',"operatorEmpId":'+CONVERT(nvarchar(20),@emp)+N',"declaredRecorderEmpId":'+CONVERT(nvarchar(20),@recorder)+N'}');
 SET @event=SCOPE_IDENTITY();
 -- A COMPLETE receipt records an admitted native save. There is deliberately
 -- no APPROVED request, invented approver or positive reservation allocation.
 UPDATE wf.Native116Stage SET NativeAuditId=@audit,OperatorUserId=@u,OperatorEmpId=@emp,AuthorityProof=@proof WHERE StageId=@stage;
 INSERT wf.CouponBridgePermit(PermitId,RequestId,Operation,NativeId,DocuNo,CustId,State,ExpiresAtUtc,StartedAtUtc,CompletedAtUtc,ReleasedAtUtc,
  Marker,BeforeHeader,BeforeLines,ExpectedRevision,DocuDate,Receiver,Plate,RecorderEmpId,UserId,ActorId,PrimaryUserId,PrimaryActorId,ScopeProof,Reason,AuthorityMode,NativeAuditId)
 VALUES(@permit,NULL,@op,@native,@number,@cust,'COMPLETE',GETUTCDATE(),GETUTCDATE(),GETUTCDATE(),GETUTCDATE(),
  N'NATIVE_116_'+@permit,@beforeHead,@beforeLines,@revision,CONVERT(date,@date),@receiver,@plate,@recorder,@u,@u,@u,@u,@proof,
  N'Native WinSpeed save admitted by its connection-bound PFC audit','NATIVE_PFC_AUDIT',@audit);
 INSERT wf.CouponBridgeLine(PermitId,CouponId,[LineNo],BeforeQty,AfterQty,NativeBefore,SourceProof)
 SELECT @permit,c.CouponId,ISNULL(a.[LineNo],0),c.BeforeQty,ISNULL(a.Qty,0),c.NativeBefore,c.SourceProof
  FROM wf.Native116StageCoupon c LEFT JOIN @after a ON a.CouponId=c.CouponId WHERE c.StageId=@stage AND c.BeforeQty+ISNULL(a.Qty,0)>0;
 INSERT wf.CouponBridgeReturn(PermitId,SettlementId,Quantity,AuditId) SELECT @permit,SettlementId,Qty,@event FROM @returns;
 UPDATE r SET ConsumedQty=r.ConsumedQty-x.Qty,Status=CASE WHEN r.ConsumedQty-x.Qty=r.ReservedQty THEN 'CONSUMED' ELSE 'RESERVED' END,
  Revision=Revision+1,UpdatedAt=GETUTCDATE() FROM wf.CouponReservation r JOIN(SELECT ReservationId,SUM(Qty) Qty FROM @returns GROUP BY ReservationId)x ON x.ReservationId=r.Id;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,UserId,ActorUserId,AfterJson)
 SELECT 'COUPON_RESERVATION',CONVERT(varchar(50),ReservationId),'NATIVE_RETURN','NATIVE_PFC_AUDIT',CONVERT(varchar(20),@u),CONVERT(varchar(20),@u),
  N'{"stage":"'+@permit+N'","returned":'+CONVERT(nvarchar(40),SUM(Qty))+N'}' FROM @returns GROUP BY ReservationId;
 INSERT wf.Native116BalanceContext(SessionId,StageId) VALUES(@@SPID,@stage);
 UPDATE balance SET RemaQty=c.NativeBefore+c.BeforeQty-ISNULL(a.Qty,0)
  FROM dbo.WFCoupon balance JOIN wf.Native116StageCoupon c ON c.CouponId=balance.CouponID
  LEFT JOIN @after a ON a.CouponId=c.CouponId
  WHERE c.StageId=@stage AND c.CreditQty=0 AND c.DebitQty=0 AND balance.RemaQty=c.NativeBefore
   AND balance.RemaQty<>c.NativeBefore+c.BeforeQty-ISNULL(a.Qty,0);
 DELETE wf.Native116BalanceContext WHERE SessionId=@@SPID AND StageId=@stage;
 IF EXISTS(SELECT 1 FROM wf.Native116StageCoupon c JOIN dbo.WFCoupon balance ON balance.CouponID=c.CouponId
  LEFT JOIN @after a ON a.CouponId=c.CouponId WHERE c.StageId=@stage AND balance.RemaQty<>c.NativeBefore+c.BeforeQty-ISNULL(a.Qty,0))
 BEGIN RAISERROR('NATIVE_116_FINAL_BALANCE_MISMATCH',16,1);RETURN;END;
 IF @revision IS NULL
  INSERT wf.CouponBridgeDocument(NativeId,DocuNo,CustId,Origin,State,HeaderProof,LineProof,ObservedById,ActorId)
   VALUES(@native,@number,@cust,CASE WHEN @op='C' THEN 'WINSPEED' ELSE 'LEGACY' END,
    CASE WHEN @op='D' THEN 'CANCELLED' ELSE 'ACTIVE' END,@head,@lines,@u,@u);
 ELSE
  UPDATE wf.CouponBridgeDocument SET Revision=Revision+1,State=CASE WHEN @op='D' THEN 'CANCELLED' ELSE 'ACTIVE' END,
   HeaderProof=@head,LineProof=@lines,ObservedById=@u,ActorId=@u,ChangedAtUtc=GETUTCDATE() WHERE NativeId=@native AND Revision=@revision;
 DELETE wf.CouponBridgeDocumentLine WHERE NativeId=@native;
 INSERT wf.CouponBridgeDocumentLine(NativeId,CouponId,[LineNo],Quantity) SELECT @native,CouponId,[LineNo],Qty FROM @after;
 DECLARE @life int,@setting nvarchar(100);SET @life=90;
 SELECT @setting=SettingValue FROM wf.SystemSetting WITH(HOLDLOCK) WHERE SettingKey='TICKET_EXPIRY_DEFAULT_DAYS';
 IF NULLIF(@setting,N'') IS NOT NULL AND @setting NOT LIKE N'%[^0-9]%' AND LEN(@setting)<=4 AND CONVERT(int,@setting)>0 SET @life=CONVERT(int,@setting);
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId,AfterJson)
 SELECT 'COUPON',CONVERT(varchar(50),a.CouponId),'EXPIRED_USE_WARNING','WARN_AND_ALLOW',N'Native direct 116; expired ticket remains usable',
  CONVERT(varchar(20),@u),CONVERT(varchar(20),@u),N'{"stage":"'+@permit+N'"}'
  FROM @after a JOIN wf.Native116StageCoupon c ON c.StageId=@stage AND c.CouponId=a.CouponId
  JOIN dbo.WFCoupon coupon ON coupon.CouponID=a.CouponId JOIN dbo.SOHD hd ON hd.SOID=coupon.DocuID
  LEFT JOIN wf.ControlTicketOverlay o ON o.DocuId=a.CouponId LEFT JOIN wf.CouponExpiry expiry ON expiry.CouponId=a.CouponId
  WHERE a.Qty>c.BeforeQty AND COALESCE(o.ExpiryDate,expiry.ExpiryDate,DATEADD(day,@life,hd.DocuDate))<CONVERT(date,DATEADD(hour,7,GETUTCDATE()));
 IF @op='D' EXEC wf.sp_Native116RetireIdRange @native,@u,@u,N'Native audited cancellation retains ID history; rotate only an exhausted node block';
 INSERT wf.Native116AuditReceipt(NativeAuditId,StageId,PermitId) VALUES(@audit,@stage,@permit);
 EXEC wf.sp_Native116StageStep @stage,'A',@native;
 UPDATE wf.Native116Stage SET State='COMPLETE',CompletedAtUtc=GETUTCDATE(),FinalAuditId=@event WHERE StageId=@stage AND State='PENDING';
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('NATIVE_116_STAGE_CHANGED',16,1);RETURN;END;
END;
GO
