-- Candidate only. Always installed DISABLED and not connected to an issuance
-- route. A durable PREPARED record may commit without a native balance update;
-- incomplete documents need reviewed recovery, not an automatic release.
-- UserId/ActorUserId below identify the authorization issuer/effective user,
-- not the human operating WinSpeed through a shared SQL login.
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL OR OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NULL OR
 OBJECT_ID('wf.CouponNativeCutAuthorizationLine','U') IS NULL OR OBJECT_ID('wf.CouponNativeActiveDocument','U') IS NULL OR
 OBJECT_ID('wf.CouponReservation','U') IS NULL OR OBJECT_ID('wf.CouponReservationSettlement','U') IS NULL OR
 OBJECT_ID('wf.ChangeEvent','U') IS NULL OR COL_LENGTH('wf.ChangeEvent','ActorUserId') IS NULL OR
 OBJECT_ID('wf.ControlTicketOverlay','U') IS NULL OR NOT EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('wf.ControlTicketOverlay') AND name='ExpiryDate' AND system_type_id=40) OR
 OBJECT_ID('dbo.WFCoupon','U') IS NULL OR OBJECT_ID('dbo.WFRedemtionHD','U') IS NULL OR OBJECT_ID('dbo.WFRedemtionDT','U') IS NULL OR
 NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_CouponAuthorizationReservationFence') AND is_disabled=1) OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') NOT LIKE '%WF_AUTH_FENCE_229_V4%' OR
 NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponReservationGuard') AND is_disabled=1) OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponReservationGuard')),'') NOT LIKE '%WF_GUARD_224_V2%' OR
 NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponPrepareEvidence') AND is_disabled=1) OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponPrepareEvidence')),'') NOT LIKE '%WF_PREPARE_EVIDENCE_228_V3%' OR
 NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponEvidenceInsertFence') AND is_disabled=1) OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponEvidenceInsertFence')),'') NOT LIKE '%WF_EVIDENCE_INSERT_227_V4%' OR
 NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponEvidenceHeaderFence') AND is_disabled=1) OR
 NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponEvidenceDetailFence') AND is_disabled=1)
BEGIN RAISERROR('COUPON_NATIVE_CONSUME_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_CouponNativeConsume','TR') IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponNativeConsume')
   AND parent_id=OBJECT_ID('dbo.WFCoupon') AND is_disabled=1) OR
  ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponNativeConsume')),'') NOT LIKE '%WF_NATIVE_CONSUME_230_V4%')
BEGIN RAISERROR('COUPON_NATIVE_CONSUME_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_CouponNativeConsume','TR') IS NULL
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC(N'CREATE TRIGGER dbo.WF_CouponNativeConsume ON dbo.WFCoupon AFTER UPDATE AS -- WF_NATIVE_CONSUME_230_V4
   BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(RemaQty) RETURN;
    -- Only coupons with a live/evidenced RESERVED hold are in scope. A past
    -- settlement on an already-consumed reservation is not a permanent hold.
    IF NOT EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID
     JOIN wf.CouponReservation r WITH (UPDLOCK,HOLDLOCK) ON r.CouponId=i.CouponID
     JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) ON l.ReservationId=r.Id
     JOIN wf.CouponNativeCutAuthorization a WITH (UPDLOCK,HOLDLOCK) ON a.Id=l.AuthorizationId
     WHERE (i.RemaQty IS NULL OR d.RemaQty IS NULL OR i.RemaQty<d.RemaQty)
      AND ((r.Status=''RESERVED'' AND (a.State=''ACTIVE'' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=l.Id)))
       OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence applied WITH (UPDLOCK,HOLDLOCK) WHERE applied.AuthorizationLineId=l.Id
        AND applied.EvidenceState=''APPLIED'' AND ISNULL(APPLOCK_MODE(''public'',applied.MarkerResource,''Transaction''),''NoLock'')=''Exclusive''))) RETURN;
    IF ISNULL(OBJECTPROPERTY(OBJECT_ID(''dbo.WF_CouponNativeConsume''),''ExecIsFirstUpdateTrigger''),0)<>1 OR
     NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(''wf.WF_CouponAuthorizationReservationFence'') AND is_disabled=0) OR
     ISNULL(OBJECT_DEFINITION(OBJECT_ID(''wf.WF_CouponAuthorizationReservationFence'')),'''') NOT LIKE ''%WF_AUTH_FENCE_229_V4%'' OR
     NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(''dbo.WF_CouponReservationGuard'') AND is_disabled=0) OR
     ISNULL(OBJECT_DEFINITION(OBJECT_ID(''dbo.WF_CouponReservationGuard'')),'''') NOT LIKE ''%WF_GUARD_224_V2%'' OR
     NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(''dbo.WF_CouponPrepareEvidence'') AND is_disabled=0) OR
     ISNULL(OBJECT_DEFINITION(OBJECT_ID(''dbo.WF_CouponPrepareEvidence'')),'''') NOT LIKE ''%WF_PREPARE_EVIDENCE_228_V3%'' OR
     NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(''dbo.WF_CouponEvidenceInsertFence'') AND is_disabled=0) OR
     ISNULL(OBJECT_DEFINITION(OBJECT_ID(''dbo.WF_CouponEvidenceInsertFence'')),'''') NOT LIKE ''%WF_EVIDENCE_INSERT_227_V4%'' OR
     NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(''dbo.WF_CouponEvidenceHeaderFence'') AND is_disabled=0) OR
     ISNULL(OBJECT_DEFINITION(OBJECT_ID(''dbo.WF_CouponEvidenceHeaderFence'')),'''') NOT LIKE ''%WF_EVIDENCE_HEADER_226_V4%'' OR
     NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(''dbo.WF_CouponEvidenceDetailFence'') AND is_disabled=0) OR
     ISNULL(OBJECT_DEFINITION(OBJECT_ID(''dbo.WF_CouponEvidenceDetailFence'')),'''') NOT LIKE ''%WF_EVIDENCE_DETAIL_226_V4%''
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_GUARD_UNAVAILABLE'',16,1);RETURN;END;
    DECLARE @originId bigint,@originStart datetime,@expected int,@changed int;
    BEGIN TRY
     SELECT @originId=c.transaction_id,@originStart=a.transaction_begin_time
      FROM sys.dm_tran_current_transaction c JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
    END TRY BEGIN CATCH
     ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_TX_UNAVAILABLE'',16,1);RETURN;
    END CATCH;
    IF @originId IS NULL OR @originStart IS NULL
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_TX_UNAVAILABLE'',16,1);RETURN;END;
    IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID
      JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) ON l.CouponId=i.CouponID
      JOIN wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) ON e.AuthorizationLineId=l.Id
      WHERE (i.RemaQty IS NULL OR d.RemaQty IS NULL OR i.RemaQty<d.RemaQty) AND e.EvidenceState=''APPLIED''
       AND e.OriginTransactionId=@originId AND e.OriginTransactionStartedAt=@originStart
       AND ISNULL(APPLOCK_MODE(''public'',e.MarkerResource,''Transaction''),''NoLock'')=''Exclusive'')
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_DUPLICATE'',16,1);RETURN;END;
    DECLARE @cuts TABLE(LineId bigint NOT NULL PRIMARY KEY,AuthorizationId bigint NOT NULL,ReservationId int NOT NULL UNIQUE,
     CouponId int NOT NULL UNIQUE,RedemptionId int NOT NULL,Qty decimal(12,4) NOT NULL,
     BalanceBefore decimal(18,4) NOT NULL,BalanceAfter decimal(18,4) NOT NULL,
     EffectiveUserId int NOT NULL,ActorUserId int NOT NULL,DocuNo varchar(50) NOT NULL);
    INSERT @cuts(LineId,AuthorizationId,ReservationId,CouponId,RedemptionId,Qty,BalanceBefore,BalanceAfter,EffectiveUserId,ActorUserId,DocuNo)
     SELECT l.Id,a.Id,r.Id,i.CouponID,h.RedemtionID,l.AuthorizedQty,d.RemaQty,i.RemaQty,a.EffectiveUserId,a.ActorUserId,LTRIM(RTRIM(h.DocuNo))
      FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID
      JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) ON l.CouponId=i.CouponID
      JOIN wf.CouponNativeCutAuthorization a WITH (UPDLOCK,HOLDLOCK) ON a.Id=l.AuthorizationId
      JOIN wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) ON e.AuthorizationLineId=l.Id
      JOIN wf.CouponReservation r WITH (UPDLOCK,HOLDLOCK) ON r.Id=l.ReservationId AND r.CouponId=l.CouponId
      JOIN dbo.WFRedemtionHD h WITH (UPDLOCK,HOLDLOCK) ON h.RedemtionID=e.NativeRedemptionId
     WHERE i.RemaQty IS NOT NULL AND d.RemaQty IS NOT NULL AND i.RemaQty>=0 AND i.RemaQty<d.RemaQty
      AND a.State=''ACTIVE'' AND a.ExpiresAt>GETUTCDATE() AND r.Status=''RESERVED''
      AND (r.ExpiresAt IS NULL OR r.ExpiresAt>GETUTCDATE()) AND r.ReservedQty>0 AND r.ConsumedQty>=0
      AND r.ConsumedQty+l.AuthorizedQty<=r.ReservedQty AND d.RemaQty-i.RemaQty=l.AuthorizedQty
      AND e.EvidenceState=''PREPARED'' AND e.OriginTransactionId=@originId AND e.OriginTransactionStartedAt=@originStart
      AND ISNULL(APPLOCK_MODE(''public'',e.MarkerResource,''Transaction''),''NoLock'')=''Exclusive''
      AND h.DocuType=116 AND ISNULL(LTRIM(RTRIM(h.DocuStatus)),'''') IN (''N'',''Y'') AND LTRIM(RTRIM(h.DocuNo))=a.DocuNo
      AND (SELECT COUNT(*) FROM dbo.WFRedemtionDT nd WITH (UPDLOCK,HOLDLOCK)
           WHERE nd.RedemtionID=h.RedemtionID AND nd.CouponID=l.CouponId)=1
      AND EXISTS(SELECT 1 FROM dbo.WFRedemtionDT nd WITH (UPDLOCK,HOLDLOCK)
           WHERE nd.RedemtionID=h.RedemtionID AND nd.CouponID=l.CouponId AND nd.GoodQty=l.AuthorizedQty);
    IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID
      JOIN wf.CouponReservation r WITH (UPDLOCK,HOLDLOCK) ON r.CouponId=i.CouponID AND r.Status=''RESERVED''
      JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) ON l.ReservationId=r.Id
      JOIN wf.CouponNativeCutAuthorization a WITH (UPDLOCK,HOLDLOCK) ON a.Id=l.AuthorizationId
      WHERE (i.RemaQty IS NULL OR d.RemaQty IS NULL OR i.RemaQty<d.RemaQty)
       AND (a.State=''ACTIVE'' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=l.Id))
       AND NOT EXISTS(SELECT 1 FROM @cuts x WHERE x.CouponId=i.CouponID AND x.ReservationId=r.Id))
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_PROOF_INVALID'',16,1);RETURN;END;
    SELECT @expected=COUNT(*) FROM @cuts;
    IF @expected=0 RETURN;
    -- Explicit Control Ticket expiry is authoritative and blocks after the
    -- expiry date; the calculated 180-day reminder never blocks. Lock the
    -- overlay (including absent rows) through this transaction.
    IF EXISTS(SELECT 1 FROM @cuts x OUTER APPLY(
      SELECT COUNT(*) AS RowsFound,MIN(o.ExpiryDate) AS ExpiryDate FROM wf.ControlTicketOverlay o WITH (UPDLOCK,HOLDLOCK) WHERE o.DocuId=x.CouponId
     ) ov WHERE ov.RowsFound>1 OR (ov.ExpiryDate IS NOT NULL AND ov.ExpiryDate<CONVERT(date,DATEADD(hour,7,GETUTCDATE()))))
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_EXPIRY_BLOCKED'',16,1);RETURN;END;
    -- All lines of each authorization must also have native evidence in the
    -- current transaction before the complete balance batch can be consumed.
    IF EXISTS(SELECT 1 FROM @cuts x JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) ON l.AuthorizationId=x.AuthorizationId
      LEFT JOIN wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) ON e.AuthorizationLineId=l.Id
      WHERE e.AuthorizationLineId IS NULL OR e.NativeRedemptionId<>x.RedemptionId OR e.EvidenceState NOT IN (''PREPARED'',''APPLIED'') OR
       e.OriginTransactionId IS NULL OR e.OriginTransactionId<>@originId OR e.OriginTransactionStartedAt IS NULL OR e.OriginTransactionStartedAt<>@originStart OR
       ISNULL(APPLOCK_MODE(''public'',e.MarkerResource,''Transaction''),''NoLock'')<>''Exclusive'' OR
       (SELECT COUNT(*) FROM dbo.WFRedemtionDT nd WITH (UPDLOCK,HOLDLOCK) WHERE nd.RedemtionID=x.RedemptionId AND nd.CouponID=l.CouponId)<>1 OR
       NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT nd WITH (UPDLOCK,HOLDLOCK) WHERE nd.RedemtionID=x.RedemptionId AND nd.CouponID=l.CouponId AND nd.GoodQty=l.AuthorizedQty))
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_LINES_INCOMPLETE'',16,1);RETURN;END;
    -- A SQL trigger cannot force the native client to issue another UPDATE
    -- before COMMIT. Refuse the first balance change unless this statement
    -- contains every authorized coupon for each affected document.
    IF EXISTS(SELECT 1 FROM @cuts x WHERE
       (SELECT COUNT(*) FROM wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) WHERE l.AuthorizationId=x.AuthorizationId)<>
       (SELECT COUNT(*) FROM @cuts complete WHERE complete.AuthorizationId=x.AuthorizationId))
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_BATCH_INCOMPLETE'',16,1);RETURN;END;
    IF EXISTS(SELECT 1 FROM @cuts x JOIN wf.CouponReservationSettlement s WITH (UPDLOCK,HOLDLOCK)
      ON s.ReservationId=x.ReservationId AND s.CouponId=x.CouponId AND s.NativeRedemptionId=x.RedemptionId)
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_ALREADY_SETTLED'',16,1);RETURN;END;
    UPDATE e SET EvidenceState=''APPLIED'',AppliedAt=GETUTCDATE(),BalanceBefore=x.BalanceBefore,BalanceAfter=x.BalanceAfter
     FROM wf.CouponNativeCutEvidence e JOIN @cuts x ON x.LineId=e.AuthorizationLineId WHERE e.EvidenceState=''PREPARED'';
    SET @changed=@@ROWCOUNT;IF @changed<>@expected BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_EVIDENCE_CHANGED'',16,1);RETURN;END;
    UPDATE r SET ConsumedQty=r.ConsumedQty+x.Qty,
     Status=CASE WHEN r.ConsumedQty+x.Qty=r.ReservedQty THEN ''CONSUMED'' ELSE ''RESERVED'' END,UpdatedAt=GETUTCDATE()
     FROM wf.CouponReservation r JOIN @cuts x ON x.ReservationId=r.Id WHERE r.Status=''RESERVED'';
    SET @changed=@@ROWCOUNT;IF @changed<>@expected BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_RESERVATION_CHANGED'',16,1);RETURN;END;
    INSERT wf.CouponReservationSettlement(ReservationId,CouponId,NativeRedemptionId,NativeDocuNo,SettledQty,SettledBy,Note)
     SELECT ReservationId,CouponId,RedemptionId,DocuNo,Qty,EffectiveUserId,N''Native 116 authorization'' FROM @cuts;
    SET @changed=@@ROWCOUNT;IF @changed<>@expected BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_SETTLEMENT_FAILED'',16,1);RETURN;END;
    INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,UserId,ActorUserId,AfterJson)
     SELECT ''COUPON_RESERVATION'',CONVERT(varchar(100),ReservationId),''NATIVE_SETTLE'',''NATIVE_AUTH_ISSUER'',
      CONVERT(varchar(50),EffectiveUserId),CONVERT(varchar(50),ActorUserId),
      N''{"authorizationId":''+CONVERT(nvarchar(30),AuthorizationId)+N'',"redemptionId":''+CONVERT(nvarchar(30),RedemptionId)+
      N'',"couponId":''+CONVERT(nvarchar(30),CouponId)+N'',"qty":''+CONVERT(nvarchar(40),Qty)+N''}'' FROM @cuts;
    SET @changed=@@ROWCOUNT;IF @changed<>@expected BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_CONSUME_AUDIT_FAILED'',16,1);RETURN;END;
    UPDATE a SET State=''USED'' FROM wf.CouponNativeCutAuthorization a
     WHERE a.State=''ACTIVE'' AND EXISTS(SELECT 1 FROM @cuts x WHERE x.AuthorizationId=a.Id)
      AND NOT EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK)
       LEFT JOIN wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) ON e.AuthorizationLineId=l.Id
       WHERE l.AuthorizationId=a.Id AND (e.EvidenceState IS NULL OR e.EvidenceState<>''APPLIED'' OR
        e.OriginTransactionId IS NULL OR e.OriginTransactionId<>@originId OR e.OriginTransactionStartedAt IS NULL OR e.OriginTransactionStartedAt<>@originStart OR
        ISNULL(APPLOCK_MODE(''public'',e.MarkerResource,''Transaction''),''NoLock'')<>''Exclusive''));
    DELETE ad FROM wf.CouponNativeActiveDocument ad JOIN wf.CouponNativeCutAuthorization a ON a.Id=ad.AuthorizationId
     WHERE a.State=''USED'' AND EXISTS(SELECT 1 FROM @cuts x WHERE x.AuthorizationId=a.Id);
   END');
  DISABLE TRIGGER dbo.WF_CouponNativeConsume ON dbo.WFCoupon;
  COMMIT TRANSACTION;
 END TRY BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  DECLARE @err nvarchar(2048);SET @err=ERROR_MESSAGE();RAISERROR(@err,16,1);RETURN;
 END CATCH;
END;
GO
