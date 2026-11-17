-- Candidate only, always installed DISABLED. This producer writes PREPARED
-- evidence for 116 lines tied to an active authorization. It does not prove a
-- balance cut, consume a reservation, implement recovery, or authorize release.
-- Do not enable until ordering, DMV permissions, identity, native transactions,
-- source changes, audit, and the complete guarded bridge have passed UAT.
-- Primary database only: native SQL has no application target-context mapping.
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL OR
 OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NULL OR
 OBJECT_ID('wf.CouponNativeCutAuthorizationLine','U') IS NULL OR
 OBJECT_ID('wf.CouponNativeActiveDocument','U') IS NULL OR
 OBJECT_ID('wf.CouponReservation','U') IS NULL OR
 OBJECT_ID('dbo.WFRedemtionHD','U') IS NULL OR OBJECT_ID('dbo.WFRedemtionDT','U') IS NULL OR
 NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponEvidenceInsertFence')
  AND parent_id=OBJECT_ID('dbo.WFRedemtionDT') AND is_disabled=1) OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponEvidenceInsertFence')),'') NOT LIKE '%WF_EVIDENCE_INSERT_227_V4%'
BEGIN RAISERROR('COUPON_PREPARE_EVIDENCE_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF COL_LENGTH('wf.CouponNativeCutEvidence','OriginTransactionId') IS NULL OR
 COL_LENGTH('wf.CouponNativeCutEvidence','OriginTransactionStartedAt') IS NULL OR
 NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeCutEvidence')
  AND name='CK_CouponNativeEvidence_Origin_223' AND is_disabled=0 AND is_not_trusted=0)
BEGIN RAISERROR('COUPON_PREPARE_EVIDENCE_SCHEMA_INVALID',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_CouponPrepareEvidence','TR') IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponPrepareEvidence')
   AND parent_id=OBJECT_ID('dbo.WFRedemtionDT') AND is_disabled=1) OR
  ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponPrepareEvidence')),'') NOT LIKE '%WF_PREPARE_EVIDENCE_228_V3%')
BEGIN RAISERROR('COUPON_PREPARE_EVIDENCE_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_CouponPrepareEvidence','TR') IS NULL
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC(N'CREATE TRIGGER dbo.WF_CouponPrepareEvidence ON dbo.WFRedemtionDT
   AFTER INSERT AS -- WF_PREPARE_EVIDENCE_228_V3
   BEGIN SET NOCOUNT ON;
    DECLARE @originId bigint,@originStart datetime,@line bigint,@red int,@resource nvarchar(255),@lock int,
      @rawWindow nvarchar(200),@windowDigits varchar(8),@window datetime,@windowCount int;
    IF NOT EXISTS(SELECT 1 FROM inserted i JOIN dbo.WFRedemtionHD h WITH (UPDLOCK,HOLDLOCK)
      ON h.RedemtionID=i.RedemtionID JOIN wf.CouponNativeActiveDocument ad WITH (UPDLOCK,HOLDLOCK)
      ON ad.DocuNo=LTRIM(RTRIM(h.DocuNo))) RETURN;
    -- The user setting is authoritative on the environment primary database.
    -- Lock it through the native transaction so a concurrent change cannot
    -- invalidate a check, and never treat malformed data as an empty setting.
    SELECT @windowCount=COUNT(*),@rawWindow=MAX(SettingValue)
      FROM wf.SystemSetting WITH (UPDLOCK,HOLDLOCK) WHERE SettingKey=''GLOBAL_DATA_START_DATE'';
    IF @windowCount>1 BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_PREPARE_WINDOW_UNAVAILABLE'',16,1);RETURN;END;
    IF @windowCount=0 OR @rawWindow IS NULL OR DATALENGTH(@rawWindow)=0 SET @rawWindow=N''2026-01-01'';
    ELSE SET @rawWindow=LTRIM(RTRIM(@rawWindow));
    IF LEN(@rawWindow)<>10 OR @rawWindow NOT LIKE ''[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]''
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_PREPARE_WINDOW_UNAVAILABLE'',16,1);RETURN;END;
    SET @windowDigits=REPLACE(@rawWindow,''-'','''');
    IF ISDATE(@windowDigits)<>1 OR LEFT(@windowDigits,4)<''1753''
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_PREPARE_WINDOW_UNAVAILABLE'',16,1);RETURN;END;
    SET @window=CONVERT(datetime,@windowDigits,112);
    IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.WFRedemtionHD h WITH (UPDLOCK,HOLDLOCK)
      ON h.RedemtionID=i.RedemtionID JOIN wf.CouponNativeActiveDocument ad WITH (UPDLOCK,HOLDLOCK)
      ON ad.DocuNo=LTRIM(RTRIM(h.DocuNo)) WHERE h.DocuDate IS NULL OR h.DocuDate<@window)
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_PREPARE_SOURCE_OUTSIDE_WINDOW'',16,1);RETURN;END;
    IF NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(''dbo.WF_CouponEvidenceInsertFence'')
      AND parent_id=OBJECT_ID(''dbo.WFRedemtionDT'') AND is_disabled=0) OR
      ISNULL(OBJECT_DEFINITION(OBJECT_ID(''dbo.WF_CouponEvidenceInsertFence'')),'''') NOT LIKE ''%WF_EVIDENCE_INSERT_227_V4%''
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_PREPARE_EVIDENCE_FENCE_UNAVAILABLE'',16,1);RETURN;END;
    BEGIN TRY
     SELECT @originId=c.transaction_id,@originStart=a.transaction_begin_time
      FROM sys.dm_tran_current_transaction c JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
    END TRY BEGIN CATCH
     ROLLBACK TRANSACTION;RAISERROR(''COUPON_PREPARE_EVIDENCE_TX_UNAVAILABLE'',16,1);RETURN;
    END CATCH;
    IF @originId IS NULL OR @originStart IS NULL
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_PREPARE_EVIDENCE_TX_UNAVAILABLE'',16,1);RETURN;END;
    IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.WFRedemtionHD h WITH (UPDLOCK,HOLDLOCK)
      ON h.RedemtionID=i.RedemtionID JOIN wf.CouponNativeActiveDocument ad WITH (UPDLOCK,HOLDLOCK)
      ON ad.DocuNo=LTRIM(RTRIM(h.DocuNo))
      LEFT JOIN wf.CouponNativeCutAuthorization a WITH (UPDLOCK,HOLDLOCK) ON a.Id=ad.AuthorizationId
      LEFT JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) ON l.AuthorizationId=a.Id AND l.CouponId=i.CouponID
      LEFT JOIN wf.CouponReservation r WITH (UPDLOCK,HOLDLOCK) ON r.Id=l.ReservationId AND r.CouponId=l.CouponId
      WHERE ISNULL(h.DocuType,0)<>116 OR a.Id IS NULL OR a.State<>''ACTIVE'' OR a.ExpiresAt<=GETUTCDATE()
       OR l.Id IS NULL OR r.Id IS NULL OR r.Status<>''RESERVED'' OR (r.ExpiresAt IS NOT NULL AND r.ExpiresAt<=GETUTCDATE())
       OR i.GoodQty IS NULL OR i.GoodQty<=0 OR i.GoodQty<>l.AuthorizedQty
       OR r.ReservedQty-ISNULL(r.ConsumedQty,0)<i.GoodQty
       OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=l.Id)
       OR (SELECT COUNT(*) FROM dbo.WFRedemtionDT d WITH (UPDLOCK,HOLDLOCK)
           WHERE d.RedemtionID=i.RedemtionID AND d.CouponID=i.CouponID)<>1)
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_PREPARE_EVIDENCE_INVALID'',16,1);RETURN;END;
    DECLARE native_lines CURSOR LOCAL FAST_FORWARD FOR
     SELECT l.Id,i.RedemtionID FROM inserted i
      JOIN dbo.WFRedemtionHD h ON h.RedemtionID=i.RedemtionID
      JOIN wf.CouponNativeActiveDocument ad ON ad.DocuNo=LTRIM(RTRIM(h.DocuNo))
      JOIN wf.CouponNativeCutAuthorization a ON a.Id=ad.AuthorizationId
      JOIN wf.CouponNativeCutAuthorizationLine l ON l.AuthorizationId=a.Id AND l.CouponId=i.CouponID
      ORDER BY l.CouponId,l.ReservationId;
    OPEN native_lines;FETCH NEXT FROM native_lines INTO @line,@red;
    WHILE @@FETCH_STATUS=0 BEGIN
     SET @resource=N''WF_NATIVE_228_''+CONVERT(nvarchar(36),NEWID());
     EXEC @lock=sys.sp_getapplock @Resource=@resource,@LockMode=''Exclusive'',@LockOwner=''Transaction'',@LockTimeout=0,@DbPrincipal=''public'';
     IF @lock<0 BEGIN CLOSE native_lines;DEALLOCATE native_lines;ROLLBACK TRANSACTION;RAISERROR(''COUPON_PREPARE_EVIDENCE_LOCK_FAILED'',16,1);RETURN;END;
     INSERT wf.CouponNativeCutEvidence(AuthorizationLineId,NativeRedemptionId,MarkerResource,EvidenceState,OriginTransactionId,OriginTransactionStartedAt)
      VALUES(@line,@red,@resource,''PREPARED'',@originId,@originStart);
     FETCH NEXT FROM native_lines INTO @line,@red;
    END;
    CLOSE native_lines;DEALLOCATE native_lines;
   END');
  DISABLE TRIGGER dbo.WF_CouponPrepareEvidence ON dbo.WFRedemtionDT;
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  DECLARE @producerError nvarchar(2048);SET @producerError=ERROR_MESSAGE();RAISERROR(@producerError,16,1);RETURN;
 END CATCH;
END;
GO
