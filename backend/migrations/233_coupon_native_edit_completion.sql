-- Internal terminal writer for the native 116 bridge. The source guard must
-- first record an immutable, explicitly approved before/after plan in the
-- hold. The completion receipt is inserted by a database-owned native hook.
-- Applying the migration does not install or enable a WinSpeed hook.
SET XACT_ABORT ON;
IF OBJECT_ID('wf.CouponNativeEditHold','U') IS NULL
   OR OBJECT_ID('wf.CouponNativeRecovery','U') IS NULL
   OR COL_LENGTH('wf.ChangeEvent','ActorUserId') IS NULL
   OR ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponRecoveryFence')),'')
      NOT LIKE '%WF_RECOVERY_FENCE_231_V1%'
BEGIN RAISERROR('COUPON_EDIT_COMPLETION_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF OBJECT_ID('wf.CouponNativeEditCompletion','U') IS NOT NULL
BEGIN RAISERROR('COUPON_EDIT_COMPLETION_ALREADY_PRESENT',16,1);RETURN;END;
BEGIN TRANSACTION;
ALTER TABLE wf.CouponNativeEditHold ADD
    PlannedSettlementId BIGINT NULL,
    PlannedBeforeQty DECIMAL(12,4) NULL,
    PlannedAfterQty DECIMAL(12,4) NULL,
    PlannedNativeBefore DECIMAL(18,4) NULL,
    PlannedOperation CHAR(1) NULL,
    PlannedDocuNo VARCHAR(50) NULL,
    PlannedDocuDate DATE NULL,
    PlannedEffectiveUserId INT NULL,
    PlannedActorUserId INT NULL;
CREATE TABLE wf.CouponNativeEditCompletion (
    EditId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    CompletedAt DATETIME2 NOT NULL CONSTRAINT DF_CouponEditCompletion_233 DEFAULT GETUTCDATE()
);
DENY INSERT, UPDATE, DELETE ON OBJECT::wf.CouponNativeEditCompletion TO public;
GO
CREATE TRIGGER wf.WF_CouponNativeEditFinalize ON wf.CouponNativeEditCompletion
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    -- Each receipt is one full document, owned by the original transaction.
    IF EXISTS (SELECT 1 FROM deleted) OR (SELECT COUNT(*) FROM inserted)<>1
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_RECEIPT_INVALID',16,1);RETURN;END;

    DECLARE @edit UNIQUEIDENTIFIER,@tx BIGINT,@began DATETIME,@resource NVARCHAR(255);
    DECLARE @doc INT,@operation CHAR(1),@number VARCHAR(50),@date DATE,@effective INT,@actor INT;
    SELECT @edit=EditId FROM inserted;
    SET @resource=N'WF_NATIVE_EDIT_'+CONVERT(nvarchar(36),@edit);
    SELECT @tx=c.transaction_id,@began=a.transaction_begin_time
      FROM sys.dm_tran_current_transaction c
      JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
    IF @tx IS NULL OR @began IS NULL
       OR ISNULL(APPLOCK_MODE('public',@resource,'Transaction'),'NoLock')<>'Exclusive'
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_ORIGIN',16,1);RETURN;END;

    SELECT TOP 1 @doc=NativeRedemptionId,@operation=PlannedOperation,@number=PlannedDocuNo,
        @date=PlannedDocuDate,@effective=PlannedEffectiveUserId,@actor=PlannedActorUserId
    FROM wf.CouponNativeEditHold WITH (UPDLOCK,HOLDLOCK) WHERE EditId=@edit ORDER BY CouponId;
    IF @doc IS NULL OR @operation IS NULL OR @operation NOT IN ('E','C')
       OR NULLIF(RTRIM(@number),'') IS NULL OR @date IS NULL
       OR ISNULL(@effective,0)<=0 OR ISNULL(@actor,0)<=0
       OR EXISTS(
          SELECT 1 FROM wf.CouponNativeEditHold h WITH (UPDLOCK,HOLDLOCK)
          WHERE h.EditId=@edit AND (
              h.OriginTransactionId<>@tx OR h.OriginTransactionStartedAt<>@began
              OR h.NativeRedemptionId<>@doc OR ISNULL(h.PlannedOperation,'')<>@operation
              OR ISNULL(h.PlannedDocuNo,'')<>@number OR h.PlannedDocuDate IS NULL OR h.PlannedDocuDate<>@date
              OR ISNULL(h.PlannedEffectiveUserId,0)<>@effective OR ISNULL(h.PlannedActorUserId,0)<>@actor
              OR h.PlannedSettlementId IS NULL OR ISNULL(h.PlannedBeforeQty,0)<=0
              OR h.PlannedAfterQty IS NULL OR h.PlannedAfterQty<0 OR h.PlannedAfterQty>h.PlannedBeforeQty
              OR h.PlannedNativeBefore IS NULL OR h.PlannedNativeBefore<0
              OR (@operation='C' AND h.PlannedAfterQty<>0)
          )
       )
       OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH (HOLDLOCK) WHERE Id=@effective AND IsActive=1)
       OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH (HOLDLOCK) WHERE Id=@actor AND IsActive=1)
       OR NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WHERE EditId=@edit AND PlannedAfterQty<PlannedBeforeQty)
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_PLAN_INVALID',16,1);RETURN;END;

    -- Do not infer "cancel" from temporary absence during WinSpeed's edit.
    IF (@operation='C' AND (
        EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH (HOLDLOCK) WHERE RedemtionID=@doc)
        OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH (HOLDLOCK) WHERE RedemtionID=@doc)
    )) OR (@operation='E' AND (
        (SELECT COUNT(*) FROM dbo.WFRedemtionHD WITH (HOLDLOCK) WHERE RedemtionID=@doc
          AND DocuType=116 AND RTRIM(DocuNo)=@number AND CONVERT(date,DocuDate)=@date
          AND LTRIM(RTRIM(DocuStatus)) IN ('N','Y'))<>1
        OR NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WHERE EditId=@edit AND PlannedAfterQty>0)
        OR (SELECT COUNT(*) FROM dbo.WFRedemtionDT WITH (HOLDLOCK) WHERE RedemtionID=@doc)<>
           (SELECT COUNT(*) FROM wf.CouponNativeEditHold WHERE EditId=@edit AND PlannedAfterQty>0)
    ))
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_SOURCE_INCOMPLETE',16,1);RETURN;END;

    -- Version one handles the first recovery only, and all original 116
    -- settlements must be covered. History is checked across the cutoff.
    IF EXISTS(
        SELECT 1 FROM wf.CouponReservationSettlement s WITH (HOLDLOCK)
        WHERE s.NativeRedemptionId=@doc AND NOT EXISTS (
            SELECT 1 FROM wf.CouponNativeEditHold h WHERE h.EditId=@edit AND h.PlannedSettlementId=s.Id
        )
    ) OR EXISTS(
        SELECT 1 FROM wf.CouponNativeEditHold h WITH (HOLDLOCK)
        LEFT JOIN dbo.WFCoupon c WITH (UPDLOCK,HOLDLOCK) ON c.CouponID=h.CouponId
        LEFT JOIN wf.CouponNativeCutAuthorizationLine al WITH (HOLDLOCK) ON al.Id=h.AuthorizationLineId
        LEFT JOIN wf.CouponNativeCutEvidence e WITH (HOLDLOCK) ON e.AuthorizationLineId=al.Id
        LEFT JOIN wf.CouponReservationSettlement s WITH (UPDLOCK,HOLDLOCK) ON s.Id=h.PlannedSettlementId
        LEFT JOIN wf.CouponReservation r WITH (UPDLOCK,HOLDLOCK) ON r.Id=s.ReservationId
        WHERE h.EditId=@edit AND (
            c.RemaQty IS NULL OR c.RemaQty<>h.PlannedNativeBefore+h.PlannedBeforeQty-h.PlannedAfterQty
            OR al.Id IS NULL OR al.CouponId<>h.CouponId OR al.AuthorizedQty<>h.PlannedBeforeQty
            OR e.AuthorizationLineId IS NULL OR e.EvidenceState<>'APPLIED' OR e.NativeRedemptionId<>@doc
            OR e.BalanceBefore-e.BalanceAfter<>h.PlannedBeforeQty
            OR s.Id IS NULL OR s.ReservationId<>al.ReservationId OR s.CouponId<>h.CouponId
            OR s.NativeRedemptionId<>@doc OR ISNULL(RTRIM(s.NativeDocuNo),'')<>@number OR s.SettledQty<>h.PlannedBeforeQty
            OR r.Id IS NULL OR r.CouponId<>h.CouponId OR r.ConsumedQty IS NULL
            OR r.ReservedQty IS NULL OR r.ConsumedQty<h.PlannedBeforeQty OR r.ConsumedQty>r.ReservedQty
            OR ISNULL(r.Status,'')<>CASE WHEN r.ConsumedQty=r.ReservedQty THEN 'CONSUMED' ELSE 'RESERVED' END
            OR EXISTS(SELECT 1 FROM wf.CouponNativeRecovery prior WITH (HOLDLOCK)
                       WHERE prior.SettlementId=s.Id OR prior.AuthorizationLineId=al.Id)
            OR (SELECT COUNT(*) FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
                 WHERE d.RedemtionID=@doc AND d.CouponID=h.CouponId)<>
                 CASE WHEN h.PlannedAfterQty>0 THEN 1 ELSE 0 END
            OR (h.PlannedAfterQty>0 AND NOT EXISTS(
                SELECT 1 FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
                WHERE d.RedemtionID=@doc AND d.CouponID=h.CouponId AND d.GoodQty=h.PlannedAfterQty
            ))
        )
    )
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_PROOF_INVALID',16,1);RETURN;END;

    DECLARE @line BIGINT,@sid BIGINT,@reservation INT,@audit BIGINT;
    DECLARE @before DECIMAL(12,4),@after DECIMAL(12,4),@returned DECIMAL(12,4);
    DECLARE @nativeBefore DECIMAL(18,4),@nativeAfter DECIMAL(18,4),@json NVARCHAR(MAX);
    DECLARE changes CURSOR LOCAL FAST_FORWARD FOR
       SELECT h.AuthorizationLineId,h.PlannedSettlementId,s.ReservationId,
              h.PlannedBeforeQty,h.PlannedAfterQty,h.PlannedNativeBefore
       FROM wf.CouponNativeEditHold h
       JOIN wf.CouponReservationSettlement s ON s.Id=h.PlannedSettlementId
       WHERE h.EditId=@edit AND h.PlannedAfterQty<h.PlannedBeforeQty ORDER BY h.CouponId;
    OPEN changes;
    FETCH NEXT FROM changes INTO @line,@sid,@reservation,@before,@after,@nativeBefore;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @returned=@before-@after;
        SET @nativeAfter=@nativeBefore+@returned;
        SET @json=N'{"authorizationLineId":"'+CONVERT(nvarchar(20),@line)+N'","settlementId":"'+CONVERT(nvarchar(20),@sid)+
          N'","settledBefore":"'+CONVERT(nvarchar(32),@before)+N'","settledAfter":"'+CONVERT(nvarchar(32),@after)+
          N'","restoredQty":"'+CONVERT(nvarchar(32),@returned)+N'","nativeBefore":"'+CONVERT(nvarchar(32),@nativeBefore)+
          N'","nativeAfter":"'+CONVERT(nvarchar(32),@nativeAfter)+N'"}';
        INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,UserId,ActorUserId,AfterJson)
          VALUES('COUPON_RESERVATION',CONVERT(varchar(100),@reservation),'NATIVE_RECOVERY','NATIVE_116_RECOVERY',
                 CONVERT(varchar(20),@effective),CONVERT(varchar(20),@actor),@json);
        SET @audit=SCOPE_IDENTITY();
        INSERT wf.CouponNativeRecovery(AuthorizationLineId,SettlementId,RecoveryKey,SettledBefore,SettledAfter,
            RestoredQty,NativeBefore,NativeAfter,AuditEventId,EffectiveUserId,ActorUserId)
          VALUES(@line,@sid,CONVERT(varchar(36),@edit)+':'+CONVERT(varchar(20),@sid),
            @before,@after,@returned,@nativeBefore,@nativeAfter,@audit,@effective,@actor);
        UPDATE wf.CouponReservation
          SET ConsumedQty=ConsumedQty-@returned,Status='RESERVED',UpdatedAt=GETUTCDATE()
          WHERE Id=@reservation AND ConsumedQty>=@returned;
        IF @@ROWCOUNT<>1
        BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_RESERVATION_CHANGED',16,1);RETURN;END;
        FETCH NEXT FROM changes INTO @line,@sid,@reservation,@before,@after,@nativeBefore;
    END;
    CLOSE changes;
    DEALLOCATE changes;
    -- Retain the hold until readers support reversals and verified release.
END;
GO
ALTER TRIGGER wf.WF_CouponRecoveryFence ON wf.CouponNativeRecovery
AFTER INSERT, UPDATE, DELETE
AS -- WF_RECOVERY_FENCE_233_V1
BEGIN
    SET NOCOUNT ON;
    IF EXISTS(SELECT 1 FROM deleted)
       OR (EXISTS(SELECT 1 FROM inserted) AND
           ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('wf.WF_CouponNativeEditFinalize'),'AFTER','DML'),0)<>1)
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_RECOVERY_WRITER_UNAVAILABLE',16,1);RETURN;END;
END;
GO
COMMIT TRANSACTION;
GO
