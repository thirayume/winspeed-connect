-- Existing settlement rows remain immutable. All balance readers use the
-- effective quantity after a reviewed release. A zero line stays in the
-- ledger but is absent from this balance view.
CREATE VIEW wf.CouponEffectiveSettlement
AS
SELECT s.Id,s.ReservationId,s.CouponId,s.NativeRedemptionId,s.NativeDocuNo,
       CONVERT(decimal(12,4),s.SettledQty-ISNULL(recovered.ReturnedQty,0)) AS SettledQty
FROM wf.CouponReservationSettlement s
OUTER APPLY(
    SELECT CONVERT(decimal(18,4),SUM(r.RestoredQty)) AS ReturnedQty
    FROM wf.CouponNativeRecovery r
    JOIN wf.CouponNativeEditHold h ON h.AuthorizationLineId=r.AuthorizationLineId AND h.PlannedSettlementId=r.SettlementId
    JOIN wf.CouponNativeEditRelease x ON x.EditId=h.EditId
    WHERE r.SettlementId=s.Id AND r.RecoveryKey=CONVERT(varchar(36),h.EditId)+':'+CONVERT(varchar(20),s.Id)
) recovered
WHERE s.SettledQty-ISNULL(recovered.ReturnedQty,0)<>0;
GO

CREATE PROCEDURE wf.sp_ReleaseCouponNativeEdit
    @EditId UNIQUEIDENTIFIER,@EffectiveUserId INT,@ActorUserId INT,@Reason NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    IF @@TRANCOUNT<1 OR XACT_STATE()<>1
    BEGIN RAISERROR('COUPON_RECOVERY_RELEASE_TRANSACTION_REQUIRED',16,1);RETURN;END;
    IF LEN(ISNULL(@Reason,''))<10
       OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH (HOLDLOCK) WHERE Id=@EffectiveUserId AND IsActive=1)
       OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH (HOLDLOCK) WHERE Id=@ActorUserId AND IsActive=1)
    BEGIN RAISERROR('COUPON_RECOVERY_RELEASE_USER_INVALID',16,1);RETURN;END;
    IF NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditCompletion WITH (UPDLOCK,HOLDLOCK) WHERE EditId=@EditId)
       OR NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WITH (HOLDLOCK) WHERE EditId=@EditId)
       OR EXISTS(SELECT 1 FROM wf.CouponNativeEditRelease WITH (UPDLOCK,HOLDLOCK) WHERE EditId=@EditId)
    BEGIN RAISERROR('COUPON_RECOVERY_RELEASE_RECEIPT_INVALID',16,1);RETURN;END;

    IF EXISTS (
        SELECT 1 FROM wf.CouponNativeEditHold h WITH (HOLDLOCK)
        LEFT JOIN wf.CouponReservationSettlement s WITH (HOLDLOCK) ON s.Id=h.PlannedSettlementId
        LEFT JOIN wf.CouponReservation q WITH (HOLDLOCK) ON q.Id=s.ReservationId
        LEFT JOIN dbo.WFCoupon c WITH (HOLDLOCK) ON c.CouponID=h.CouponId
        LEFT JOIN dbo.WFRedemtionHD hd WITH (HOLDLOCK) ON hd.RedemtionID=h.NativeRedemptionId
        LEFT JOIN wf.CouponNativeRecovery r WITH (HOLDLOCK)
          ON r.AuthorizationLineId=h.AuthorizationLineId AND r.SettlementId=h.PlannedSettlementId
          AND r.RecoveryKey=CONVERT(varchar(36),@EditId)+':'+CONVERT(varchar(20),s.Id)
        LEFT JOIN wf.ChangeEvent a WITH (HOLDLOCK) ON a.EventId=r.AuditEventId
        OUTER APPLY (
            SELECT CONVERT(decimal(18,4),SUM(eff.SettledQty)) AS TotalMatched
            FROM wf.CouponEffectiveSettlement eff WITH (HOLDLOCK) WHERE eff.ReservationId=q.Id
        ) reservationMatching
        WHERE h.EditId=@EditId AND (
            s.Id IS NULL OR s.CouponId<>h.CouponId OR s.NativeRedemptionId<>h.NativeRedemptionId
            OR c.CouponID IS NULL OR c.RemaQty IS NULL OR h.PlannedNativeBefore IS NULL
            OR q.Id IS NULL OR q.CouponId<>h.CouponId OR q.ConsumedQty IS NULL
            OR q.ReservedQty IS NULL OR q.ConsumedQty<0 OR q.ConsumedQty>q.ReservedQty
            OR h.PlannedBeforeQty IS NULL OR h.PlannedAfterQty IS NULL
            OR s.SettledQty<>h.PlannedBeforeQty OR h.PlannedAfterQty<0 OR h.PlannedAfterQty>h.PlannedBeforeQty
            OR c.RemaQty<>h.PlannedNativeBefore+h.PlannedBeforeQty-h.PlannedAfterQty
            OR q.ConsumedQty<>ISNULL(reservationMatching.TotalMatched,0)-(h.PlannedBeforeQty-h.PlannedAfterQty)
            OR ISNULL(q.Status,'')<>CASE WHEN q.ConsumedQty=q.ReservedQty THEN 'CONSUMED' ELSE 'RESERVED' END
            OR (h.PlannedAfterQty<h.PlannedBeforeQty AND (
                r.Id IS NULL OR a.EventId IS NULL OR a.Action<>'NATIVE_RECOVERY'
                OR a.EntityType<>'COUPON_RESERVATION' OR a.EntityId<>CONVERT(varchar(20),q.Id)
                OR r.SettledBefore<>h.PlannedBeforeQty OR r.SettledAfter<>h.PlannedAfterQty
                OR r.RestoredQty<>h.PlannedBeforeQty-h.PlannedAfterQty
                OR r.NativeBefore<>h.PlannedNativeBefore OR r.NativeAfter<>c.RemaQty
                OR a.UserId<>CONVERT(varchar(20),h.PlannedEffectiveUserId)
                OR ISNULL(a.ActorUserId,'')<>CONVERT(varchar(20),h.PlannedActorUserId)))
            OR (h.PlannedAfterQty=h.PlannedBeforeQty AND r.Id IS NOT NULL)
            OR ISNULL(h.PlannedOperation,'') NOT IN ('E','C')
            OR (h.PlannedOperation='E' AND (hd.RedemtionID IS NULL OR hd.DocuType<>116
                OR h.PlannedDocuDate IS NULL OR hd.DocuDate IS NULL OR CONVERT(date,hd.DocuDate)<>h.PlannedDocuDate
                OR ISNULL(RTRIM(hd.DocuNo),'')<>h.PlannedDocuNo OR ISNULL(LTRIM(RTRIM(hd.DocuStatus)),'') NOT IN ('N','Y')))
            OR (h.PlannedOperation='C' AND (hd.RedemtionID IS NOT NULL OR h.PlannedAfterQty<>0))
            OR (SELECT COUNT(*) FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
                WHERE d.RedemtionID=h.NativeRedemptionId AND d.CouponID=h.CouponId)
                <>CASE WHEN h.PlannedAfterQty>0 THEN 1 ELSE 0 END
            OR (h.PlannedAfterQty>0 AND NOT EXISTS(
                SELECT 1 FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
                WHERE d.RedemtionID=h.NativeRedemptionId AND d.CouponID=h.CouponId AND d.GoodQty=h.PlannedAfterQty))
        )
    )
    BEGIN RAISERROR('COUPON_RECOVERY_RELEASE_PROOF_INVALID',16,1);RETURN;END;

    -- Verify the entire document, including lines not otherwise covered.
    IF EXISTS (
        SELECT 1 FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
        WHERE EXISTS(SELECT 1 FROM wf.CouponNativeEditHold h WHERE h.EditId=@EditId AND h.NativeRedemptionId=d.RedemtionID)
          AND NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditHold h WHERE h.EditId=@EditId
              AND h.NativeRedemptionId=d.RedemtionID AND h.CouponId=d.CouponID AND h.PlannedAfterQty>0)
    )
    BEGIN RAISERROR('COUPON_RECOVERY_RELEASE_SOURCE_CHANGED',16,1);RETURN;END;

    DECLARE @audit BIGINT;
    INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId)
      VALUES('COUPON_NATIVE_EDIT',CONVERT(varchar(36),@EditId),'RELEASE','NATIVE_116_RELEASE',@Reason,
             CONVERT(varchar(20),@EffectiveUserId),CONVERT(varchar(20),@ActorUserId));
    SET @audit=SCOPE_IDENTITY();
    INSERT wf.CouponNativeEditRelease(EditId,AuditEventId) VALUES(@EditId,@audit);
END;
GO
