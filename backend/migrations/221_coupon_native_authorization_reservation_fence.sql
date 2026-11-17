-- Candidate only: install DISABLED. This conservative fence blocks every
-- reservation update/delete while any linked authorization remains ACTIVE,
-- including expired authorizations, until explicit close/review. It is NOT
-- a consumption bridge and must not be enabled as a standalone solution.
IF OBJECT_ID('wf.CouponReservation','U') IS NULL OR
   OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NULL OR
   OBJECT_ID('wf.CouponNativeCutAuthorizationLine','U') IS NULL
BEGIN RAISERROR('COUPON_AUTH_FENCE_DEPENDENCIES_MISSING',16,1); RETURN; END;
IF OBJECT_ID('wf.WF_CouponAuthorizationReservationFence','TR') IS NOT NULL AND
  (NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')
    AND parent_id=OBJECT_ID('wf.CouponReservation') AND is_disabled=1) OR
   ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') NOT LIKE '%WF_AUTH_FENCE_221_V2%')
BEGIN RAISERROR('COUPON_AUTH_FENCE_EXISTING_REVIEW_REQUIRED',16,1); RETURN; END;
IF OBJECT_ID('wf.WF_CouponAuthorizationReservationFence','TR') IS NULL
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC(N'CREATE TRIGGER wf.WF_CouponAuthorizationReservationFence ON wf.CouponReservation
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
  DECLARE @authFenceError NVARCHAR(2048);SET @authFenceError=ERROR_MESSAGE();
  RAISERROR(@authFenceError,16,1);RETURN;
 END CATCH;
END;
GO
