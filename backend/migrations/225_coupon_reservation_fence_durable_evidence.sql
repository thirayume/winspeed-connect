-- Candidate only: preserve reservations with durable evidence even if their
-- authorization is closed. Fence stays DISABLED until the 116 bridge is proven.
IF OBJECT_ID('wf.WF_CouponAuthorizationReservationFence','TR') IS NULL OR
 OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL
BEGIN RAISERROR('COUPON_EVIDENCE_FENCE_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')
 AND parent_id=OBJECT_ID('wf.CouponReservation') AND is_disabled=1) OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') NOT LIKE '%WF_AUTH_FENCE_221_V2%'
BEGIN RAISERROR('COUPON_EVIDENCE_FENCE_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
IF ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') NOT LIKE '%WF_AUTH_FENCE_225_V2%'
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC(N'ALTER TRIGGER wf.WF_CouponAuthorizationReservationFence ON wf.CouponReservation
    AFTER UPDATE, DELETE AS -- WF_AUTH_FENCE_221_V2 WF_AUTH_FENCE_225_V2
    BEGIN
      SET NOCOUNT ON;
      IF EXISTS (
        SELECT 1 FROM deleted d
        JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) ON l.ReservationId=d.Id
        JOIN wf.CouponNativeCutAuthorization h WITH (UPDLOCK,HOLDLOCK) ON h.Id=l.AuthorizationId
        WHERE (h.State=''ACTIVE'' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=l.Id))
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
  DECLARE @fenceError NVARCHAR(2048);SET @fenceError=ERROR_MESSAGE();RAISERROR(@fenceError,16,1);RETURN;
 END CATCH;
END;
GO
