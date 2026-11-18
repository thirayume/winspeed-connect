-- Candidate only. Upgrade the disabled 225 fence; keep it disabled. The
-- consumer referenced here is NOT implemented by this migration. Until a
-- reviewed consumer and ordering/identity/recovery are accepted, this fence
-- deliberately holds all protected reservation changes.
IF OBJECT_ID('wf.WF_CouponAuthorizationReservationFence','TR') IS NULL OR
 OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL OR OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NULL OR
 OBJECT_ID('wf.CouponNativeCutAuthorizationLine','U') IS NULL OR OBJECT_ID('wf.CouponReservation','U') IS NULL OR
 OBJECT_ID('dbo.WFCoupon','U') IS NULL OR OBJECT_ID('dbo.WFRedemtionHD','U') IS NULL OR OBJECT_ID('dbo.WFRedemtionDT','U') IS NULL OR
 COL_LENGTH('wf.CouponReservation','ConsumedQty') IS NULL OR COL_LENGTH('wf.CouponReservation','Status') IS NULL OR
 COL_LENGTH('wf.CouponReservation','UpdatedAt') IS NULL OR COL_LENGTH('wf.CouponNativeCutEvidence','OriginTransactionId') IS NULL OR
 COL_LENGTH('wf.CouponNativeCutEvidence','OriginTransactionStartedAt') IS NULL
BEGIN RAISERROR('COUPON_NATIVE_FENCE229_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')
 AND parent_id=OBJECT_ID('wf.CouponReservation') AND is_disabled=1) OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') NOT LIKE '%WF_AUTH_FENCE_225_V2%'
BEGIN RAISERROR('COUPON_NATIVE_FENCE229_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
IF ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') LIKE '%WF_AUTH_FENCE_229_V1%' OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') LIKE '%WF_AUTH_FENCE_229_V2%' OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') LIKE '%WF_AUTH_FENCE_229_V3%'
BEGIN RAISERROR('COUPON_NATIVE_FENCE229_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
IF ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') NOT LIKE '%WF_AUTH_FENCE_229_V4%'
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC(N'ALTER TRIGGER wf.WF_CouponAuthorizationReservationFence ON wf.CouponReservation
   AFTER UPDATE,DELETE AS -- WF_AUTH_FENCE_221_V2 WF_AUTH_FENCE_225_V2 WF_AUTH_FENCE_229_V4
   BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM deleted d JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK)
     ON l.ReservationId=d.Id JOIN wf.CouponNativeCutAuthorization a WITH (UPDLOCK,HOLDLOCK) ON a.Id=l.AuthorizationId
     WHERE a.State=''ACTIVE'' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=l.Id)) RETURN;
    DECLARE @bridge int,@originId bigint,@originStart datetime,@updated varbinary(128);
    SET @bridge=OBJECT_ID(''dbo.WF_CouponNativeConsume'');
    IF @bridge IS NULL OR TRIGGER_NESTLEVEL(@bridge,''AFTER'',''DML'')<1 OR
      NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=@bridge AND parent_id=OBJECT_ID(''dbo.WFCoupon'') AND is_disabled=0) OR
      ISNULL(OBJECT_DEFINITION(@bridge),'''') NOT LIKE ''%WF_NATIVE_CONSUME_230_V4%''
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_AUTH_RESERVATION_HELD'',16,1);RETURN;END;
    SET @updated=COLUMNS_UPDATED();
    IF @updated IS NULL OR EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id=OBJECT_ID(''wf.CouponReservation'')
      AND c.name NOT IN (''ConsumedQty'',''Status'',''UpdatedAt'')
      AND (CONVERT(int,SUBSTRING(@updated,((c.column_id-1)/8)+1,1)) & CONVERT(int,POWER(2,(c.column_id-1)%8)))<>0)
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_FENCE229_COLUMNS_INVALID'',16,1);RETURN;END;
    BEGIN TRY
     SELECT @originId=c.transaction_id,@originStart=a.transaction_begin_time
      FROM sys.dm_tran_current_transaction c JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
    END TRY BEGIN CATCH
     ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_FENCE229_TX_UNAVAILABLE'',16,1);RETURN;
    END CATCH;
    IF @originId IS NULL OR @originStart IS NULL
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_FENCE229_TX_UNAVAILABLE'',16,1);RETURN;END;
    IF EXISTS(SELECT 1 FROM deleted d LEFT JOIN inserted i ON i.Id=d.Id
     WHERE i.Id IS NULL OR NOT EXISTS(
      SELECT 1 FROM wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK)
       JOIN wf.CouponNativeCutAuthorization a WITH (UPDLOCK,HOLDLOCK) ON a.Id=l.AuthorizationId
       JOIN wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) ON e.AuthorizationLineId=l.Id
       JOIN dbo.WFCoupon c WITH (UPDLOCK,HOLDLOCK) ON c.CouponID=l.CouponId
       JOIN dbo.WFRedemtionHD h WITH (UPDLOCK,HOLDLOCK) ON h.RedemtionID=e.NativeRedemptionId
      WHERE l.ReservationId=d.Id AND l.CouponId=d.CouponId AND a.State=''ACTIVE'' AND a.ExpiresAt>GETUTCDATE()
       AND d.Status=''RESERVED'' AND (d.ExpiresAt IS NULL OR d.ExpiresAt>GETUTCDATE())
       AND d.ReservedQty>0 AND d.ConsumedQty IS NOT NULL AND d.ConsumedQty>=0 AND l.AuthorizedQty>0
       AND ISNULL(d.ConsumedQty,0)+l.AuthorizedQty<=d.ReservedQty
       AND i.ConsumedQty=ISNULL(d.ConsumedQty,0)+l.AuthorizedQty
       AND i.Status=CASE WHEN i.ConsumedQty=d.ReservedQty THEN ''CONSUMED'' ELSE ''RESERVED'' END
       AND e.EvidenceState=''APPLIED'' AND e.OriginTransactionId=@originId AND e.OriginTransactionStartedAt=@originStart
       AND e.BalanceBefore-e.BalanceAfter=l.AuthorizedQty AND c.RemaQty=e.BalanceAfter
       AND ISNULL(APPLOCK_MODE(''public'',e.MarkerResource,''Transaction''),''NoLock'')=''Exclusive''
       AND h.DocuType=116 AND LTRIM(RTRIM(h.DocuNo))=a.DocuNo
       AND (SELECT COUNT(*) FROM dbo.WFRedemtionDT nd WITH (UPDLOCK,HOLDLOCK)
            WHERE nd.RedemtionID=h.RedemtionID AND nd.CouponID=l.CouponId)=1
       AND (SELECT COUNT(*) FROM dbo.WFRedemtionDT nd WITH (UPDLOCK,HOLDLOCK)
            WHERE nd.RedemtionID=h.RedemtionID AND nd.CouponID=l.CouponId AND nd.GoodQty=l.AuthorizedQty)=1
       AND (SELECT COUNT(*) FROM wf.CouponNativeCutAuthorizationLine heldLine WITH (UPDLOCK,HOLDLOCK)
            JOIN wf.CouponNativeCutAuthorization heldAuth WITH (UPDLOCK,HOLDLOCK) ON heldAuth.Id=heldLine.AuthorizationId
            WHERE heldLine.ReservationId=d.Id AND (heldAuth.State=''ACTIVE'' OR EXISTS(
             SELECT 1 FROM wf.CouponNativeCutEvidence heldEvidence WITH (UPDLOCK,HOLDLOCK) WHERE heldEvidence.AuthorizationLineId=heldLine.Id)))=1))
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_NATIVE_FENCE229_PROOF_INVALID'',16,1);RETURN;END;
   END');
  DISABLE TRIGGER wf.WF_CouponAuthorizationReservationFence ON wf.CouponReservation;
  COMMIT TRANSACTION;
 END TRY BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  DECLARE @err nvarchar(2048);SET @err=ERROR_MESSAGE();RAISERROR(@err,16,1);RETURN;
 END CATCH;
END;
GO
