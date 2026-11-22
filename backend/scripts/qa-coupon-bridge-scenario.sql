-- Isolated QA only; caller installs this procedure inside an outer transaction
-- and always rolls it back. Runs as the actual Windows DBA connection to model
-- WinSpeed's SQL login. No impersonation or runtime privilege widening.
CREATE PROCEDURE wf.usp_QaCouponBridgeScenario @module char(64),@case varchar(30)='positive' AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF DB_NAME()<>'dbwins_worldfert9_uat_v3' OR @@TRANCOUNT<>1 OR IS_SRVROLEMEMBER('sysadmin')<>1
  BEGIN RAISERROR('QA_BRIDGE_SCENARIO_TARGET',16,1);RETURN;END;
 DECLARE @fixture TABLE(SOID int,DraftId int,UserId int,CustId int,SlipBase int,Today varchar(10));
 INSERT @fixture EXEC wf.usp_QaNativeV3Fixture;
 DECLARE @so int,@draft int,@u int,@cust int,@date date,@number varchar(25),@request varchar(36),@plan xml,@delivery int,@emp int;
 SELECT @so=SOID,@draft=DraftId,@u=UserId,@cust=CustId,@date=Today,@number=CONVERT(varchar(25),SlipBase) FROM @fixture;
 SELECT @emp=CONVERT(int,EmpId) FROM wf.AppUser WHERE Id=@u;
 INSERT wf.NativeBookingOrigin(SOID,SourceDraftId,SalesUserId,ConfirmedById,ConfirmedActorId,Fingerprint,PolicyVersion)
 VALUES(@so,@draft,@u,@u,@u,REPLICATE('0',64),'NATIVE-DOCUMENTS-v3');
 SET @request=CONVERT(varchar(36),NEWID());
 SET @plan=(SELECT 'NATIVE-DOCUMENTS-v3' AS [@version],119 AS [@type],@so AS [@sourceId] FOR XML PATH('plan'),TYPE);
 INSERT wf.NativeDocumentRequest(RequestId,PolicyVersion,DocuType,OperationKey,SourceId,SourceKind,SourceHash,InputHash,PlanXml,InputJson,
  UserId,ActorUserId,PrimaryUserId,PrimaryActorId,Status,Reason,ExpiresAtUtc,ApprovedById,ApproverActorId,ApprovedAtUtc)
 VALUES(@request,'NATIVE-DOCUMENTS-v3',119,@request,@so,'SO',REPLICATE('0',64),REPLICATE('0',64),@plan,'{}',@u,@u,@u,@u,'APPROVED',
  'QA SQL bridge rollback',DATEADD(hour,1,GETUTCDATE()),@u,@u,GETUTCDATE());
 EXEC wf.usp_ApplyNativeDocument @request,@u,@u,@u,@u;
 SET @request=CONVERT(varchar(36),NEWID());
 SET @plan=(SELECT 'NATIVE-DOCUMENTS-v3' AS [@version],104 AS [@type],@so AS [@sourceId],'I' AS [@book],
   18000 AS [@gross],123.45 AS [@discount],17876.55 AS [@taxBase],0 AS [@tax],0 AS [@vatRate],17876.55 AS [@net],
   (SELECT ListNo AS [@lineNo],GoodID AS [@goodId],GoodQty2 AS [@quantity],GoodPrice2 AS [@price],GoodAmnt AS [@gross],
    CASE ListNo WHEN 1 THEN 41.15 ELSE 82.30 END AS [@discount],GoodAmnt-CASE ListNo WHEN 1 THEN 41.15 ELSE 82.30 END AS [@taxBase],
    50 AS [@packKg],12 AS [@sacks] FROM dbo.SODT WHERE SOID=@so ORDER BY ListNo FOR XML PATH('line'),TYPE)
   FOR XML PATH('plan'),TYPE);
 INSERT wf.NativeDocumentRequest(RequestId,PolicyVersion,DocuType,OperationKey,SourceId,SourceKind,SourceHash,InputHash,PlanXml,InputJson,
  UserId,ActorUserId,PrimaryUserId,PrimaryActorId,Status,Reason,ExpiresAtUtc,ApprovedById,ApproverActorId,ApprovedAtUtc)
 VALUES(@request,'NATIVE-DOCUMENTS-v3',104,@request,@so,'SO',REPLICATE('0',64),REPLICATE('0',64),@plan,'{}',@u,@u,@u,@u,'APPROVED',
  'QA SQL bridge rollback',DATEADD(hour,1,GETUTCDATE()),@u,@u,GETUTCDATE());
 EXEC wf.usp_ApplyNativeDocument @request,@u,@u,@u,@u;
 SELECT @delivery=NativeId FROM wf.NativeDocumentReceipt WHERE RequestId=@request;
 UPDATE wf.CouponBridgeContract SET Enabled=1,ModulesHash=@module,ApprovedById=@u,ActorId=@u,
  Evidence='QA outer rollback native bridge scenario',ApprovedAtUtc=GETUTCDATE() WHERE Version='116-BRIDGE-v1';
 DECLARE @coupons TABLE(CouponId int PRIMARY KEY,[LineNo] int,ReservationId bigint,SettlementId bigint);
 INSERT @coupons SELECT CouponID,RefListno,NULL,NULL FROM dbo.WFCoupon WHERE DocuID=@delivery;
 IF(SELECT COUNT(*) FROM @coupons)<>2 BEGIN RAISERROR('QA_BRIDGE_TWO_COUPONS_REQUIRED',16,1);RETURN;END;
 IF @case='legacy'
 BEGIN
  DECLARE @legacy int,@lh nvarchar(max),@ld nvarchar(max),@lp varchar(36),@ll xml,@la xml;
  SET @la=CONVERT(xml,'<allocations/>');
  EXEC wf.usp_AllocateNativeRedemptionId @NewId=@legacy OUTPUT;
  UPDATE wf.CouponBridgeContract SET Enabled=0 WHERE Version='116-BRIDGE-v1';
  -- Existing WinSpeed slip: physical debit exists, no v3 receipt or settlement.
  INSERT dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,SaveEmpID,SumGoodQty,DocuStatus,IsCheckAll)
  VALUES(@legacy,@number,@date,116,'QA legacy recipient','QA-LEGACY',@emp,0.4,'N','Y');
  INSERT dbo.WFRedemtionDT(RedemtionID,Listno,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,PostInv,GoodQty,RemaQty,IsCheck)
  SELECT @legacy,l.[LineNo],c.GoodID,c.InveID,c.LocaID,c.GoodUnitID,c.GoodPrice,c.CouponID,c.CouponNo,'N',0.2,0.2,'Y'
   FROM @coupons l JOIN dbo.WFCoupon c ON c.CouponID=l.CouponId;
  UPDATE c SET RemaQty=RemaQty-0.2 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID;
  UPDATE wf.CouponBridgeContract SET Enabled=1 WHERE Version='116-BRIDGE-v1';
  EXEC wf.sp_CouponBridgePhysical @legacy,@lh OUTPUT,@ld OUTPUT;
  EXEC wf.sp_CouponBridgeAdopt @legacy,@cust,@u,@u,@lh,@ld,'QA legacy current facts, no invented consumption';
  SET @lp=CONVERT(varchar(36),NEWID());
  SET @ll=(SELECT CouponId AS [@couponId],[LineNo] AS [@lineNo],0.2 AS [@before],0.1 AS [@after],0.4 AS [@nativeBefore]
   FROM @coupons FOR XML PATH('line'),ROOT('lines'),TYPE);
  EXEC wf.sp_CouponBridgePublish @lp,NULL,'E',@legacy,@number,@cust,@date,'QA legacy recipient','QA-LEGACY',@emp,@u,@u,@u,@u,
   1,'QA reviewed legacy edit without historical allocation',@ll,@la;
  UPDATE c SET RemaQty=RemaQty+0.2 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID;
  DELETE dbo.WFRedemtionHD WHERE RedemtionID=@legacy;
  DELETE dbo.WFRedemtionDT WHERE RedemtionID=@legacy;
  EXEC wf.sp_CouponBridgePhysical @legacy,@lh OUTPUT,@ld OUTPUT;
  EXEC wf.sp_CouponBridgeResume @lp,@u,@u,@u,@u,'QA recover legacy current plan without historical inference',@lh,@ld;
  EXEC wf.sp_CouponBridgeRelease @lp,@u,@u,'QA reviewed legacy edit exact proof release';
  SET @lp=CONVERT(varchar(36),NEWID());
  SET @ll=(SELECT CouponId AS [@couponId],[LineNo] AS [@lineNo],0.1 AS [@before],0 AS [@after],0.5 AS [@nativeBefore]
   FROM @coupons FOR XML PATH('line'),ROOT('lines'),TYPE);
  EXEC wf.sp_CouponBridgePublish @lp,NULL,'D',@legacy,@number,@cust,@date,'QA legacy recipient','QA-LEGACY',@emp,@u,@u,@u,@u,
   2,'QA reviewed legacy cancellation without historical allocation',@ll,@la;
  UPDATE c SET RemaQty=RemaQty+0.1 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID;
  DELETE dbo.WFRedemtionHD WHERE RedemtionID=@legacy;
  DELETE dbo.WFRedemtionDT WHERE RedemtionID=@legacy;
  EXEC wf.sp_CouponBridgeRelease @lp,@u,@u,'QA reviewed legacy cancellation exact proof release';
  IF EXISTS(SELECT 1 FROM wf.CouponReservationSettlement WHERE NativeRedemptionId=@legacy)
   OR EXISTS(SELECT 1 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID WHERE c.RemaQty<>0.6)
   OR NOT EXISTS(SELECT 1 FROM wf.CouponBridgeDocument WHERE NativeId=@legacy AND State='CANCELLED' AND Origin='LEGACY')
   BEGIN RAISERROR('QA_LEGACY_CONSERVATION_OR_HISTORY_INVALID',16,1);RETURN;END;
  PRINT 'QA_LEGACY_ADOPT_EDIT_RECOVER_CANCEL_NO_INVENTED_SETTLEMENT=PASS';RETURN;
 END;
 INSERT wf.CouponReservation(CouponId,CouponNo,GoodId,CarrierSoId,BeneficiaryCustId,OwnerCustId,ReservedQty,CreatedBy,IdempotencyKey,ExpiresAt)
 SELECT c.CouponID,c.CouponNo,c.GoodID,CONVERT(varchar(50),@so),CONVERT(varchar(50),@cust),CONVERT(varchar(50),@cust),0.6,@u,
  CONVERT(varchar(36),NEWID()),DATEADD(hour,1,GETUTCDATE()) FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID;
 UPDATE l SET ReservationId=r.Id FROM @coupons l JOIN wf.CouponReservation r ON r.CouponId=l.CouponId AND r.CreatedBy=@u;
 SET @request=CONVERT(varchar(36),NEWID());
 SET @plan=(SELECT 'NATIVE-DOCUMENTS-v3' AS [@version],116 AS [@type],@cust AS [@sourceId],@cust AS [@custId],@number AS [@slipNo],
   @date AS [@docDate],'QA bridge recipient' AS [@receiver],'QA-BRIDGE' AS [@plate],1 AS [@exception],
   (SELECT l.CouponId AS [@couponId],0.2 AS [@quantity],0.6 AS [@beforeRemaining],
     (SELECT l.ReservationId AS [@reservationId],0.2 AS [@quantity],0 AS [@beforeConsumed],1 AS [@revision] FOR XML PATH('settlement'),TYPE)
    FROM @coupons l FOR XML PATH('line'),TYPE) FOR XML PATH('plan'),TYPE);
 INSERT wf.NativeDocumentRequest(RequestId,PolicyVersion,DocuType,OperationKey,SourceId,SourceKind,SourceHash,InputHash,PlanXml,InputJson,
  UserId,ActorUserId,PrimaryUserId,PrimaryActorId,Status,Reason,ExpiresAtUtc,ApprovedById,ApproverActorId,ApprovedAtUtc)
 VALUES(@request,'NATIVE-DOCUMENTS-v3',116,@request,@cust,'CUSTOMER',REPLICATE('0',64),REPLICATE('0',64),@plan,'{}',@u,@u,@u,@u,'APPROVED',
  'QA SQL bridge rollback',DATEADD(hour,1,GETUTCDATE()),@u,@u,GETUTCDATE());
 DECLARE @permit varchar(36),@lines xml,@alloc xml,@native int,@h nvarchar(max),@d nvarchar(max),@c1 int;
 SET @permit=CONVERT(varchar(36),NEWID());
 SET @lines=(SELECT CouponId AS [@couponId],[LineNo] AS [@lineNo],0 AS [@before],0.2 AS [@after],0.6 AS [@nativeBefore]
  FROM @coupons FOR XML PATH('line'),ROOT('lines'),TYPE);
 SET @alloc=(SELECT CouponId AS [@couponId],ReservationId AS [@reservationId],0 AS [@settlementId],0.2 AS [@delta],0 AS [@beforeConsumed],1 AS [@revision]
  FROM @coupons FOR XML PATH('allocation'),ROOT('allocations'),TYPE);
 EXEC wf.sp_CouponBridgePublish @permit,@request,'C',NULL,@number,@cust,@date,'QA bridge recipient','QA-BRIDGE',@emp,@u,@u,@u,@u,
  NULL,'QA authorized two-line creation',@lines,@alloc;
 IF @case='expired-permit' UPDATE wf.CouponBridgePermit SET ExpiresAtUtc=DATEADD(second,-1,GETUTCDATE()) WHERE PermitId=@permit;
 IF @case='held-reservation'
  UPDATE wf.CouponReservation SET ExpiresAt=DATEADD(second,-1,GETUTCDATE()) WHERE Id=(SELECT ReservationId FROM @coupons WHERE [LineNo]=1);
 EXEC wf.usp_AllocateNativeRedemptionId @NewId=@native OUTPUT;
 INSERT dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,SaveEmpID,SumGoodQty,DocuStatus,IsCheckAll)
 VALUES(@native,@number,@date,116,'QA bridge recipient','QA-BRIDGE',@emp,0.4,'N','Y');
 INSERT dbo.WFRedemtionDT(RedemtionID,Listno,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,PostInv,GoodQty,RemaQty,IsCheck)
 SELECT @native,l.[LineNo],c.GoodID,c.InveID,c.LocaID,c.GoodUnitID,c.GoodPrice,c.CouponID,c.CouponNo,'N',0.2,0.2,'Y'
  FROM @coupons l JOIN dbo.WFCoupon c ON c.CouponID=l.CouponId;
 IF @case='changed-source' UPDATE c SET GoodPrice=GoodPrice+1 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID;
 IF @case='partial-batch'
  UPDATE c SET RemaQty=RemaQty-0.2 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID WHERE l.[LineNo]=1;
 ELSE UPDATE c SET RemaQty=RemaQty-0.2 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID;
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgePermit WHERE PermitId=@permit AND State='COMPLETE' AND ReleasedAtUtc IS NOT NULL)
  OR EXISTS(SELECT 1 FROM wf.CouponReservation WHERE CreatedBy=@u AND ConsumedQty<>0.2)
 BEGIN RAISERROR('QA_BRIDGE_CREATE_NOT_ATOMIC',16,1);RETURN;END;
 IF @case='duplicate'
 BEGIN
  UPDATE c SET RemaQty=RemaQty-0.0001 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID;
  RAISERROR('QA_DUPLICATE_SHOULD_HAVE_FAILED',16,1);RETURN;
 END;
 IF @case='unpermitted-edit'
 BEGIN
  UPDATE dbo.WFRedemtionHD SET IssueName='QA unauthorized changed recipient' WHERE RedemtionID=@native;
  RAISERROR('QA_UNPERMITTED_EDIT_SHOULD_HAVE_FAILED',16,1);RETURN;
 END;
 UPDATE l SET SettlementId=s.Id FROM @coupons l JOIN wf.CouponReservationSettlement s ON s.ReservationId=l.ReservationId;
 SELECT @c1=CouponId FROM @coupons WHERE [LineNo]=1;
 SET @permit=CONVERT(varchar(36),NEWID());
 SET @lines=(SELECT l.CouponId AS [@couponId],l.[LineNo] AS [@lineNo],0.2 AS [@before],
  CASE WHEN l.[LineNo]=1 THEN 0.1 ELSE 0.2 END AS [@after],c.RemaQty AS [@nativeBefore]
  FROM @coupons l JOIN dbo.WFCoupon c ON c.CouponID=l.CouponId FOR XML PATH('line'),ROOT('lines'),TYPE);
 SET @alloc=(SELECT l.CouponId AS [@couponId],l.ReservationId AS [@reservationId],l.SettlementId AS [@settlementId],-0.1 AS [@delta],
  r.ConsumedQty AS [@beforeConsumed],r.Revision AS [@revision] FROM @coupons l JOIN wf.CouponReservation r ON r.Id=l.ReservationId
  WHERE l.[LineNo]=1 FOR XML PATH('allocation'),ROOT('allocations'),TYPE);
 EXEC wf.sp_CouponBridgePublish @permit,NULL,'E',@native,@number,@cust,@date,'QA bridge recipient','QA-BRIDGE',@emp,@u,@u,@u,@u,
  1,'QA reviewed reduction with additive return',@lines,@alloc;
 -- The observed WinSpeed edit order: one unwind batch, delete header/details,
 -- recreate header, insert lines, then one final balance batch.
 IF @case NOT IN('header-first','header-net','header-recovery')
  UPDATE c SET RemaQty=RemaQty+0.2 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID;
 DELETE dbo.WFRedemtionHD WHERE RedemtionID=@native;
 DELETE dbo.WFRedemtionDT WHERE RedemtionID=@native;
 IF @case='header-first'
  UPDATE c SET RemaQty=RemaQty+0.2 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID;
 IF @case IN('recovery','header-recovery')
 BEGIN
  EXEC wf.sp_CouponBridgePhysical @native,@h OUTPUT,@d OUTPUT;
  EXEC wf.sp_CouponBridgeResume @permit,@u,@u,@u,@u,'QA recovery of observed unwound save',@h,@d;
 END
 ELSE
 BEGIN
  INSERT dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,SaveEmpID,SumGoodQty,DocuStatus,IsCheckAll)
  VALUES(@native,@number,@date,116,'QA bridge recipient','QA-BRIDGE',@emp,0.3,'N','Y');
  INSERT dbo.WFRedemtionDT(RedemtionID,Listno,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,PostInv,GoodQty,RemaQty,IsCheck)
  SELECT @native,l.[LineNo],c.GoodID,c.InveID,c.LocaID,c.GoodUnitID,c.GoodPrice,c.CouponID,c.CouponNo,'N',
   CASE l.[LineNo] WHEN 1 THEN 0.1 ELSE 0.2 END,CASE l.[LineNo] WHEN 1 THEN 0.1 ELSE 0.2 END,'Y'
   FROM @coupons l JOIN dbo.WFCoupon c ON c.CouponID=l.CouponId;
  UPDATE c SET RemaQty=RemaQty+CASE WHEN @case='header-net' THEN 0.2 ELSE 0 END-CASE l.[LineNo] WHEN 1 THEN 0.1 ELSE 0.2 END
   FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID;
 END;
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgePermit WHERE PermitId=@permit AND State='COMPLETE' AND ReleasedAtUtc IS NULL)
  OR NOT EXISTS(SELECT 1 FROM wf.CouponReservation WHERE CouponId=@c1 AND ConsumedQty=0.1)
  OR(SELECT SUM(SettledQty) FROM wf.CouponReservationSettlement WHERE CouponId=@c1)<>0.2
 BEGIN RAISERROR('QA_BRIDGE_EDIT_RETURN_NOT_ATOMIC',16,1);RETURN;END;
 EXEC wf.sp_CouponBridgeRelease @permit,@u,@u,'QA exact proof release after reduction';
 IF(SELECT SUM(SettledQty) FROM wf.CouponBridgeEffectiveSettlement WHERE CouponId=@c1)<>0.1
 BEGIN RAISERROR('QA_BRIDGE_EFFECTIVE_RETURN_INVALID',16,1);RETURN;END;
 -- A second recovery returns only the remaining quantity. Original settlement
 -- rows are unchanged across repeated edit and cancellation.
 SET @permit=CONVERT(varchar(36),NEWID());
 SET @lines=(SELECT l.CouponId AS [@couponId],l.[LineNo] AS [@lineNo],d.GoodQty AS [@before],0 AS [@after],c.RemaQty AS [@nativeBefore]
  FROM @coupons l JOIN dbo.WFCoupon c ON c.CouponID=l.CouponId JOIN dbo.WFRedemtionDT d ON d.RedemtionID=@native AND d.CouponID=l.CouponId
  FOR XML PATH('line'),ROOT('lines'),TYPE);
 SET @alloc=(SELECT l.CouponId AS [@couponId],l.ReservationId AS [@reservationId],l.SettlementId AS [@settlementId],-r.ConsumedQty AS [@delta],
  r.ConsumedQty AS [@beforeConsumed],r.Revision AS [@revision] FROM @coupons l JOIN wf.CouponReservation r ON r.Id=l.ReservationId
  FOR XML PATH('allocation'),ROOT('allocations'),TYPE);
 EXEC wf.sp_CouponBridgePublish @permit,NULL,'D',@native,@number,@cust,@date,'QA bridge recipient','QA-BRIDGE',@emp,@u,@u,@u,@u,
  2,'QA reviewed cancellation with additive return',@lines,@alloc;
 IF @case NOT IN('header-first','header-net','header-recovery')
  UPDATE c SET RemaQty=c.RemaQty+d.GoodQty FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID
   JOIN dbo.WFRedemtionDT d ON d.RedemtionID=@native AND d.CouponID=l.CouponId;
 DELETE dbo.WFRedemtionHD WHERE RedemtionID=@native;
 DELETE dbo.WFRedemtionDT WHERE RedemtionID=@native;
 IF @case IN('header-first','header-net','header-recovery')
  UPDATE c SET RemaQty=c.RemaQty+b.BeforeQty FROM dbo.WFCoupon c JOIN wf.CouponBridgeLine b ON b.CouponId=c.CouponID WHERE b.PermitId=@permit;
 EXEC wf.sp_CouponBridgeRelease @permit,@u,@u,'QA complete cancellation exact proof release';
 IF EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WHERE RedemtionID=@native)
  OR EXISTS(SELECT 1 FROM wf.CouponBridgeEffectiveSettlement WHERE NativeRedemptionId=@native)
  OR EXISTS(SELECT 1 FROM wf.CouponReservation WHERE CreatedBy=@u AND(ConsumedQty<>0 OR Status<>'RESERVED'))
  OR EXISTS(SELECT 1 FROM dbo.WFCoupon c JOIN @coupons l ON l.CouponId=c.CouponID WHERE c.RemaQty<>0.6)
  OR(SELECT COUNT(*) FROM wf.CouponReservationSettlement s JOIN @coupons l ON l.CouponId=s.CouponId)<>2
  OR(SELECT COUNT(*) FROM wf.CouponBridgeReturn b JOIN @coupons l ON l.SettlementId=b.SettlementId)<>3
 BEGIN RAISERROR('QA_BRIDGE_CANCELLATION_CONSERVATION_INVALID',16,1);RETURN;END;
 PRINT 'QA_BRIDGE_CREATE_EDIT_REPEAT_RETURN_CANCEL_CONSERVATION=PASS';
END;
