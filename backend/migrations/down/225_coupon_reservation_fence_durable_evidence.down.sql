-- Restore disabled 221 only when no authorization or evidence would be weakened.
IF OBJECT_ID('wf.WF_CouponAuthorizationReservationFence','TR') IS NULL OR
 OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NULL OR OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL
BEGIN RAISERROR('COUPON_EVIDENCE_FENCE_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') LIKE '%WF_AUTH_FENCE_229_V%'
BEGIN RAISERROR('COUPON_EVIDENCE_FENCE_DOWN_OUT_OF_ORDER',16,1);RETURN;END;
IF NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')
 AND parent_id=OBJECT_ID('wf.CouponReservation') AND is_disabled=1) OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') NOT LIKE '%WF_AUTH_FENCE_225_V2%'
BEGIN RAISERROR('COUPON_EVIDENCE_FENCE_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
BEGIN TRY
 BEGIN TRANSACTION;
 EXEC(N'IF EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorization WITH (UPDLOCK,HOLDLOCK) WHERE State=''ACTIVE'')
  OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence WITH (UPDLOCK,HOLDLOCK))
  RAISERROR(''COUPON_EVIDENCE_FENCE_IN_USE'',16,1)');
  EXEC(N'ALTER TRIGGER wf.WF_CouponAuthorizationReservationFence ON wf.CouponReservation
    AFTER UPDATE, DELETE AS -- WF_AUTH_FENCE_221_V2
    BEGIN
      SET NOCOUNT ON;
      IF EXISTS (
        SELECT 1 FROM deleted d
        JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) ON l.ReservationId=d.Id
        JOIN wf.CouponNativeCutAuthorization h WITH (UPDLOCK,HOLDLOCK) ON h.Id=l.AuthorizationId
        WHERE h.State=''ACTIVE''
      )
      BEGIN
        ROLLBACK TRANSACTION;
        RAISERROR(''COUPON_NATIVE_AUTH_RESERVATION_HELD'',16,1);
        RETURN;
      END;
    END');
 DISABLE TRIGGER wf.WF_CouponAuthorizationReservationFence ON wf.CouponReservation;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 DECLARE @fenceDownError NVARCHAR(2048);SET @fenceDownError=ERROR_MESSAGE();RAISERROR(@fenceDownError,16,1);RETURN;
END CATCH;
GO
