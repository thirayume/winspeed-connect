-- Candidate only. This INSERT fence is installed DISABLED. It is not a native
-- evidence producer and cannot authorize a cut by itself; it depends on the
-- future bridge creating transaction-owned evidence before this fence runs.
-- Do not enable until trigger ordering, incomplete commits, operator identity,
-- permissions, audit and the full WinSpeed workflow are proven.
-- The trigger requires a verified current transaction ID/start. A database
-- user without rights to read those DMVs is denied; never grant broad server
-- permissions as part of this candidate migration.
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL OR
 OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NULL OR
 OBJECT_ID('wf.CouponNativeCutAuthorizationLine','U') IS NULL OR
 OBJECT_ID('wf.CouponNativeActiveDocument','U') IS NULL OR
 OBJECT_ID('wf.CouponReservation','U') IS NULL OR
 OBJECT_ID('dbo.WFRedemtionHD','U') IS NULL OR OBJECT_ID('dbo.WFRedemtionDT','U') IS NULL
BEGIN RAISERROR('COUPON_EVIDENCE_INSERT_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF COL_LENGTH('wf.CouponNativeCutEvidence','OriginTransactionId') IS NULL OR
 COL_LENGTH('wf.CouponNativeCutEvidence','OriginTransactionStartedAt') IS NULL OR
 NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeCutEvidence')
  AND name='CK_CouponNativeEvidence_Origin_223' AND is_disabled=0 AND is_not_trusted=0)
BEGIN RAISERROR('COUPON_EVIDENCE_INSERT_ORIGIN_SCHEMA_INVALID',16,1);RETURN;END;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponNativeCutEvidence')
 AND name='IX_CouponNativeEvidence_Redemption_223' AND is_disabled=0)
BEGIN RAISERROR('COUPON_EVIDENCE_INSERT_INDEX_MISSING',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_CouponEvidenceInsertFence','TR') IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponEvidenceInsertFence')
   AND parent_id=OBJECT_ID('dbo.WFRedemtionDT') AND is_disabled=1) OR
  ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponEvidenceInsertFence')),'') NOT LIKE '%WF_EVIDENCE_INSERT_227_V4%')
BEGIN RAISERROR('COUPON_EVIDENCE_INSERT_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_CouponEvidenceInsertFence','TR') IS NULL
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC(N'CREATE TRIGGER dbo.WF_CouponEvidenceInsertFence ON dbo.WFRedemtionDT
   AFTER INSERT AS -- WF_EVIDENCE_INSERT_227_V4
   BEGIN SET NOCOUNT ON;
    DECLARE @originId bigint,@originStart datetime;
    IF EXISTS(SELECT 1 FROM inserted i JOIN wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK)
      ON e.NativeRedemptionId=i.RedemtionID)
    BEGIN
     BEGIN TRY
      SELECT @originId=c.transaction_id,@originStart=a.transaction_begin_time
       FROM sys.dm_tran_current_transaction c JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
     END TRY BEGIN CATCH
      ROLLBACK TRANSACTION;RAISERROR(''COUPON_EVIDENCE_INSERT_TX_UNAVAILABLE'',16,1);RETURN;
     END CATCH;
     IF @originId IS NULL OR @originStart IS NULL
     BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_EVIDENCE_INSERT_TX_UNAVAILABLE'',16,1);RETURN;END;
    END;
    IF EXISTS(SELECT 1 FROM inserted i
     WHERE (EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK)
       WHERE e.NativeRedemptionId=i.RedemtionID)
      OR EXISTS(SELECT 1 FROM dbo.WFRedemtionHD initialHeader WITH (UPDLOCK,HOLDLOCK)
       JOIN wf.CouponNativeCutAuthorization initialAuth WITH (UPDLOCK,HOLDLOCK)
        ON initialAuth.DocuNo=LTRIM(RTRIM(initialHeader.DocuNo)) AND initialAuth.State=''ACTIVE''
       WHERE initialHeader.RedemtionID=i.RedemtionID)
      OR EXISTS(SELECT 1 FROM wf.CouponReservation held WITH (UPDLOCK,HOLDLOCK)
       WHERE held.CouponId=i.CouponID AND held.Status=''RESERVED'' AND
        (held.ExpiresAt IS NULL OR held.ExpiresAt>GETUTCDATE() OR EXISTS(
         SELECT 1 FROM wf.CouponNativeCutAuthorizationLine heldLine WITH (UPDLOCK,HOLDLOCK)
          JOIN wf.CouponNativeCutAuthorization heldAuth WITH (UPDLOCK,HOLDLOCK) ON heldAuth.Id=heldLine.AuthorizationId
         WHERE heldLine.ReservationId=held.Id AND (heldAuth.State=''ACTIVE'' OR EXISTS(
          SELECT 1 FROM wf.CouponNativeCutEvidence heldEvidence WITH (UPDLOCK,HOLDLOCK) WHERE heldEvidence.AuthorizationLineId=heldLine.Id))))))
      AND NOT EXISTS(
       SELECT 1 FROM dbo.WFRedemtionHD h WITH (UPDLOCK,HOLDLOCK)
       JOIN wf.CouponNativeActiveDocument ad WITH (UPDLOCK,HOLDLOCK) ON ad.DocuNo=LTRIM(RTRIM(h.DocuNo))
       JOIN wf.CouponNativeCutAuthorization a WITH (UPDLOCK,HOLDLOCK) ON a.Id=ad.AuthorizationId
       JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) ON l.AuthorizationId=a.Id AND l.CouponId=i.CouponID
       JOIN wf.CouponReservation r WITH (UPDLOCK,HOLDLOCK) ON r.Id=l.ReservationId AND r.CouponId=l.CouponId
       WHERE h.RedemtionID=i.RedemtionID AND h.DocuType=116 AND a.State=''ACTIVE'' AND a.ExpiresAt>GETUTCDATE()
        AND r.Status=''RESERVED'' AND (r.ExpiresAt IS NULL OR r.ExpiresAt>GETUTCDATE())
        AND i.GoodQty>0 AND i.GoodQty=l.AuthorizedQty AND r.ReservedQty-ISNULL(r.ConsumedQty,0)>=i.GoodQty
        AND (SELECT COUNT(*) FROM dbo.WFRedemtionDT nativeLine WITH (UPDLOCK,HOLDLOCK)
             WHERE nativeLine.RedemtionID=i.RedemtionID AND nativeLine.CouponID=i.CouponID)=1
        AND EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence ownEvidence WITH (UPDLOCK,HOLDLOCK)
          WHERE ownEvidence.AuthorizationLineId=l.Id AND ownEvidence.NativeRedemptionId=i.RedemtionID
           AND ownEvidence.EvidenceState=''PREPARED'' AND ownEvidence.OriginTransactionId=@originId
           AND ownEvidence.OriginTransactionStartedAt=@originStart
           AND ISNULL(APPLOCK_MODE(''public'',ownEvidence.MarkerResource,''Transaction''),''NoLock'')=''Exclusive'')
        AND NOT EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence prior WITH (UPDLOCK,HOLDLOCK)
          JOIN wf.CouponNativeCutAuthorizationLine priorLine WITH (UPDLOCK,HOLDLOCK) ON priorLine.Id=prior.AuthorizationLineId
          WHERE prior.NativeRedemptionId=i.RedemtionID AND
           (priorLine.AuthorizationId<>a.Id OR prior.EvidenceState NOT IN (''PREPARED'',''APPLIED'') OR
            prior.OriginTransactionId IS NULL OR prior.OriginTransactionStartedAt IS NULL OR
            prior.OriginTransactionId<>@originId OR prior.OriginTransactionStartedAt<>@originStart OR
            ISNULL(APPLOCK_MODE(''public'',prior.MarkerResource,''Transaction''),''NoLock'')<>''Exclusive''))
      ))
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_EVIDENCE_INSERT_HELD'',16,1);RETURN;END;
   END');
  DISABLE TRIGGER dbo.WF_CouponEvidenceInsertFence ON dbo.WFRedemtionDT;
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  DECLARE @fenceError NVARCHAR(2048);SET @fenceError=ERROR_MESSAGE();RAISERROR(@fenceError,16,1);RETURN;
 END CATCH;
END;
GO
