-- Candidate hooks for the observed WinSpeed 116 update sequence. Apply with
-- hooks disabled. Intent rows must be issued by an authenticated approval
-- flow, or by a DBA in the isolated rollback rehearsal.
SET XACT_ABORT ON;
IF OBJECT_ID('wf.WF_CouponNativeEditFinalize','TR') IS NULL OR
   OBJECT_ID('wf.CouponNativeEditIntent','U') IS NOT NULL
BEGIN RAISERROR('COUPON_EDIT_HOOK_DEPENDENCIES_INVALID',16,1);RETURN;END;
BEGIN TRANSACTION;
CREATE TABLE wf.CouponNativeEditIntent (
    EditId UNIQUEIDENTIFIER NOT NULL,
    CouponId INT NOT NULL PRIMARY KEY,
    AuthorizationLineId BIGINT NOT NULL UNIQUE REFERENCES wf.CouponNativeCutEvidence(AuthorizationLineId),
    SettlementId BIGINT NOT NULL UNIQUE REFERENCES wf.CouponReservationSettlement(Id),
    NativeRedemptionId INT NOT NULL,
    QtyBefore DECIMAL(12,4) NOT NULL,
    QtyAfter DECIMAL(12,4) NOT NULL,
    NativeBefore DECIMAL(18,4) NOT NULL,
    Operation CHAR(1) NOT NULL,
    DocuNo VARCHAR(50) NOT NULL,
    DocuDate DATE NOT NULL,
    EffectiveUserId INT NOT NULL,
    ActorUserId INT NOT NULL,
    ExpiresAt DATETIME2 NOT NULL,
    CHECK (CouponId>0 AND NativeRedemptionId>0 AND QtyBefore>0 AND QtyAfter>=0
       AND QtyAfter<=QtyBefore AND NativeBefore>=0 AND EffectiveUserId>0 AND ActorUserId>0
       AND (Operation='E' OR (Operation='C' AND QtyAfter=0)))
);
CREATE INDEX IX_NativeEditIntent_Edit_234 ON wf.CouponNativeEditIntent(EditId,CouponId);
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponNativeEditIntent TO public;
-- Written only by a later, audited release procedure. The table starts
-- empty, so an unfinished or unreviewed edit still holds the coupon.
CREATE TABLE wf.CouponNativeEditRelease (
    EditId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES wf.CouponNativeEditCompletion(EditId),
    AuditEventId BIGINT NOT NULL UNIQUE REFERENCES wf.ChangeEvent(EventId),
    ReleasedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponNativeEditRelease TO public;
GO
CREATE PROCEDURE wf.sp_CouponNativeEditFinish @edit UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_CouponNativeEditFinalize') AND is_disabled=0)
       OR NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_CouponRecoveryFence') AND is_disabled=0)
       OR EXISTS(SELECT 1 FROM wf.CouponNativeEditCompletion WITH (UPDLOCK,HOLDLOCK) WHERE EditId=@edit)
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_WRITER_UNAVAILABLE',16,1);RETURN;END;
    INSERT wf.CouponNativeEditCompletion(EditId) VALUES(@edit);
    -- Detect a misconfigured database that silently skipped nested triggers.
    IF EXISTS(
      SELECT 1 FROM wf.CouponNativeEditHold h
      LEFT JOIN wf.CouponNativeRecovery r ON r.SettlementId=h.PlannedSettlementId
        AND r.RecoveryKey=CONVERT(varchar(36),@edit)+':'+CONVERT(varchar(20),h.PlannedSettlementId)
      WHERE h.EditId=@edit AND h.PlannedAfterQty<h.PlannedBeforeQty AND r.Id IS NULL
    )
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_WRITER_DID_NOT_RUN',16,1);RETURN;END;
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_CouponNativeEditFinish TO public;
GO
CREATE TRIGGER dbo.WF_CouponNativeEditBalanceHook ON dbo.WFCoupon
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(RemaQty) RETURN;
    DECLARE @changed TABLE(CouponId INT PRIMARY KEY, BeforeBalance DECIMAL(18,4), AfterBalance DECIMAL(18,4));
    INSERT @changed
      SELECT i.CouponID,d.RemaQty,i.RemaQty FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID
      WHERE i.RemaQty IS NULL OR d.RemaQty IS NULL OR i.RemaQty<>d.RemaQty;
    DECLARE @candidates TABLE(EditId UNIQUEIDENTIFIER PRIMARY KEY);
    INSERT @candidates
      SELECT p.EditId FROM @changed c JOIN wf.CouponNativeEditIntent p WITH (UPDLOCK,HOLDLOCK) ON p.CouponId=c.CouponId
      WHERE p.ExpiresAt>GETUTCDATE()
        AND NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditRelease x WITH (HOLDLOCK) WHERE x.EditId=p.EditId)
      UNION
      SELECT h.EditId FROM @changed c JOIN wf.CouponNativeEditHold h WITH (UPDLOCK,HOLDLOCK) ON h.CouponId=c.CouponId
      WHERE NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditRelease x WITH (HOLDLOCK) WHERE x.EditId=h.EditId);
    IF NOT EXISTS(SELECT 1 FROM @candidates) RETURN;
    IF (SELECT COUNT(*) FROM @candidates)<>1
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_AMBIGUOUS',16,1);RETURN;END;

    DECLARE @edit UNIQUEIDENTIFIER,@tx BIGINT,@began DATETIME,@resource NVARCHAR(255),@lock INT;
    SELECT @edit=EditId FROM @candidates;
    SET @resource=N'WF_NATIVE_EDIT_'+CONVERT(nvarchar(36),@edit);
    SELECT @tx=c.transaction_id,@began=a.transaction_begin_time
       FROM sys.dm_tran_current_transaction c
       JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
    IF @tx IS NULL OR @began IS NULL
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_ORIGIN_UNAVAILABLE',16,1);RETURN;END;

    IF EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WHERE EditId=@edit)
    BEGIN
        IF ISNULL(APPLOCK_MODE('public',@resource,'Transaction'),'NoLock')<>'Exclusive'
           OR EXISTS(SELECT 1 FROM wf.CouponNativeEditHold h WHERE h.EditId=@edit
                     AND (h.OriginTransactionId<>@tx OR h.OriginTransactionStartedAt<>@began OR h.PlannedOperation<>'E'))
           OR EXISTS(
             SELECT 1 FROM wf.CouponNativeEditHold h LEFT JOIN @changed c ON c.CouponId=h.CouponId
             WHERE h.EditId=@edit AND h.PlannedAfterQty>0 AND
               (c.BeforeBalance IS NULL OR c.AfterBalance IS NULL
               OR c.BeforeBalance<>h.PlannedNativeBefore+h.PlannedBeforeQty
               OR c.AfterBalance<>c.BeforeBalance-h.PlannedAfterQty)
           )
           OR EXISTS(SELECT 1 FROM @changed c WHERE NOT EXISTS(
             SELECT 1 FROM wf.CouponNativeEditHold h WHERE h.EditId=@edit AND h.CouponId=c.CouponId AND h.PlannedAfterQty>0))
        BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_FINAL_BALANCE_INVALID',16,1);RETURN;END;
        EXEC wf.sp_CouponNativeEditFinish @edit;
        RETURN;
    END;

    EXEC @lock=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0,@DbPrincipal='public';
    IF @lock<0 OR EXISTS(SELECT 1 FROM wf.CouponNativeEditCompletion WHERE EditId=@edit)
       OR EXISTS(SELECT 1 FROM @changed c WHERE NOT EXISTS(
         SELECT 1 FROM wf.CouponNativeEditIntent p WHERE p.EditId=@edit AND p.CouponId=c.CouponId))
       OR EXISTS(
          SELECT 1 FROM wf.CouponNativeEditIntent p WITH (UPDLOCK,HOLDLOCK)
          LEFT JOIN @changed c ON c.CouponId=p.CouponId
          LEFT JOIN dbo.WFRedemtionHD h WITH (HOLDLOCK) ON h.RedemtionID=p.NativeRedemptionId
          WHERE p.EditId=@edit AND (p.ExpiresAt<=GETUTCDATE() OR
            c.BeforeBalance IS NULL OR c.AfterBalance IS NULL OR c.BeforeBalance<>p.NativeBefore
            OR c.AfterBalance<>p.NativeBefore+p.QtyBefore OR h.RedemtionID IS NULL OR h.DocuType<>116
            OR ISNULL(LTRIM(RTRIM(h.DocuStatus)),'') NOT IN ('N','Y')
            OR h.DocuNo IS NULL OR RTRIM(h.DocuNo)<>p.DocuNo OR h.DocuDate IS NULL OR CONVERT(date,h.DocuDate)<>p.DocuDate
            OR (SELECT COUNT(*) FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
              WHERE d.RedemtionID=p.NativeRedemptionId AND d.CouponID=p.CouponId)<>1
            OR NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
              WHERE d.RedemtionID=p.NativeRedemptionId AND d.CouponID=p.CouponId AND d.GoodQty=p.QtyBefore))
       )
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_UNWIND_INVALID',16,1);RETURN;END;
    INSERT wf.CouponNativeEditHold(CouponId,AuthorizationLineId,NativeRedemptionId,EditId,
        OriginTransactionId,OriginTransactionStartedAt,PlannedSettlementId,PlannedBeforeQty,PlannedAfterQty,
        PlannedNativeBefore,PlannedOperation,PlannedDocuNo,PlannedDocuDate,PlannedEffectiveUserId,PlannedActorUserId)
    SELECT CouponId,AuthorizationLineId,NativeRedemptionId,EditId,@tx,@began,SettlementId,QtyBefore,QtyAfter,
        NativeBefore,Operation,DocuNo,DocuDate,EffectiveUserId,ActorUserId
    FROM wf.CouponNativeEditIntent WHERE EditId=@edit;
END;
GO
-- Header-first deletion was observed for the edit. These two listeners permit
-- either deletion order for an explicitly planned cancellation. The writer
-- requires both the head and all lines to be absent and verifies native balance.
CREATE PROCEDURE wf.sp_CouponNativeEditCheckSource @doc INT,@hasInserted BIT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @edit UNIQUEIDENTIFIER,@operation CHAR(1),@tx BIGINT,@began DATETIME,@resource NVARCHAR(255);
    SELECT @tx=c.transaction_id,@began=a.transaction_begin_time
      FROM sys.dm_tran_current_transaction c
      JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
    SELECT TOP 1 @edit=EditId,@operation=PlannedOperation
      FROM wf.CouponNativeEditHold WITH (UPDLOCK,HOLDLOCK) WHERE NativeRedemptionId=@doc ORDER BY CouponId;
    SET @resource=N'WF_NATIVE_EDIT_'+CONVERT(nvarchar(36),@edit);
    IF @operation='C' AND @hasInserted=1
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_CANCEL_SOURCE_WRITE',16,1);RETURN;END;
    IF @edit IS NULL OR @tx IS NULL OR @began IS NULL
       OR @operation IS NULL OR @operation NOT IN ('E','C')
       OR ISNULL(APPLOCK_MODE('public',@resource,'Transaction'),'NoLock')<>'Exclusive'
       OR EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WHERE NativeRedemptionId=@doc AND
                 (EditId<>@edit OR OriginTransactionId<>@tx OR OriginTransactionStartedAt<>@began
                   OR PlannedOperation IS NULL OR PlannedOperation<>@operation))
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_SOURCE_HELD',16,1);RETURN;END;
    IF EXISTS(SELECT 1 FROM wf.CouponNativeEditCompletion WHERE EditId=@edit)
    BEGIN
        -- Cascading deletes can notify both source triggers after the same
        -- cancellation has completed. Validate the original transaction above
        -- and accept only a repeat delete notification for an absent source.
        IF @operation='C' AND @hasInserted=0
           AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH (HOLDLOCK) WHERE RedemtionID=@doc)
           AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH (HOLDLOCK) WHERE RedemtionID=@doc) RETURN;
        ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_SOURCE_ALREADY_FINAL',16,1);RETURN;
    END;
    IF @operation='C' AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH (HOLDLOCK) WHERE RedemtionID=@doc)
       AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH (HOLDLOCK) WHERE RedemtionID=@doc)
        EXEC wf.sp_CouponNativeEditFinish @edit;
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_CouponNativeEditCheckSource TO public;
GO
CREATE TRIGGER dbo.WF_CouponNativeEditHeadHook ON dbo.WFRedemtionHD AFTER INSERT,UPDATE,DELETE AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @doc INT,@hasInserted BIT;
    SELECT @doc=MIN(s.RedemtionID) FROM (SELECT RedemtionID FROM inserted UNION SELECT RedemtionID FROM deleted) s
      JOIN wf.CouponNativeCutEvidence e WITH (HOLDLOCK) ON e.NativeRedemptionId=s.RedemtionID AND e.EvidenceState='APPLIED';
    IF @doc IS NULL RETURN;
    IF EXISTS(SELECT 1 FROM deleted WHERE RedemtionID<>@doc) OR EXISTS(SELECT 1 FROM inserted WHERE RedemtionID<>@doc)
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_AMBIGUOUS',16,1);RETURN;END;
    SET @hasInserted=CASE WHEN EXISTS(SELECT 1 FROM inserted) THEN 1 ELSE 0 END;
    EXEC wf.sp_CouponNativeEditCheckSource @doc,@hasInserted;
END;
GO
CREATE TRIGGER dbo.WF_CouponNativeEditDetailHook ON dbo.WFRedemtionDT AFTER INSERT,UPDATE,DELETE AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @doc INT,@hasInserted BIT;
    SELECT @doc=MIN(s.RedemtionID) FROM (SELECT RedemtionID FROM inserted UNION SELECT RedemtionID FROM deleted) s
      JOIN wf.CouponNativeCutEvidence e WITH (HOLDLOCK) ON e.NativeRedemptionId=s.RedemtionID AND e.EvidenceState='APPLIED';
    IF @doc IS NULL RETURN;
    IF EXISTS(SELECT 1 FROM deleted WHERE RedemtionID<>@doc) OR EXISTS(SELECT 1 FROM inserted WHERE RedemtionID<>@doc)
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_AMBIGUOUS',16,1);RETURN;END;
    SET @hasInserted=CASE WHEN EXISTS(SELECT 1 FROM inserted) THEN 1 ELSE 0 END;
    EXEC wf.sp_CouponNativeEditCheckSource @doc,@hasInserted;
END;
GO
DISABLE TRIGGER dbo.WF_CouponNativeEditBalanceHook ON dbo.WFCoupon;
DISABLE TRIGGER dbo.WF_CouponNativeEditHeadHook ON dbo.WFRedemtionHD;
DISABLE TRIGGER dbo.WF_CouponNativeEditDetailHook ON dbo.WFRedemtionDT;
COMMIT TRANSACTION;
GO
