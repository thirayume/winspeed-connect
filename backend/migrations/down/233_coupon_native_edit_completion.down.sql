-- Keep any recorded completion or prepared edit. The normal down path is
-- available only before the bridge has produced any business evidence.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @used BIT;
SET @used=0;
EXEC sys.sp_executesql
 N'IF EXISTS (SELECT 1 FROM wf.CouponNativeEditCompletion WITH (TABLOCKX,HOLDLOCK))
    OR EXISTS (SELECT 1 FROM wf.CouponNativeEditHold WITH (TABLOCKX,HOLDLOCK) WHERE PlannedOperation IS NOT NULL)
    OR EXISTS (SELECT 1 FROM wf.CouponNativeRecovery WITH (TABLOCKX,HOLDLOCK))
   SET @found=1;',
 N'@found BIT OUTPUT', @found=@used OUTPUT;
IF @used=1
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR('COUPON_NATIVE_EDIT_COMPLETION_HAS_EVIDENCE',16,1);
    RETURN;
END;
EXEC(N'ALTER TRIGGER wf.WF_CouponRecoveryFence ON wf.CouponNativeRecovery
       AFTER INSERT,UPDATE,DELETE AS -- WF_RECOVERY_FENCE_231_V1
       BEGIN SET NOCOUNT ON;
       IF EXISTS(SELECT 1 FROM inserted) OR EXISTS(SELECT 1 FROM deleted)
       BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_RECOVERY_WRITER_UNAVAILABLE'',16,1);RETURN;END;
       END');
DROP TABLE wf.CouponNativeEditCompletion;
ALTER TABLE wf.CouponNativeEditHold DROP COLUMN PlannedSettlementId,PlannedBeforeQty,PlannedAfterQty,
    PlannedNativeBefore,PlannedOperation,PlannedDocuNo,PlannedDocuDate,PlannedEffectiveUserId,PlannedActorUserId;
COMMIT TRANSACTION;
GO
