-- Restore the disabled 222 guard only when no active authorization or durable
-- evidence can be weakened by rollback.
IF OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NULL OR OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL OR
   OBJECT_ID('dbo.WF_CouponReservationGuard','TR') IS NULL
BEGIN RAISERROR('COUPON_EVIDENCE_GUARD_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponReservationGuard')
 AND parent_id=OBJECT_ID('dbo.WFCoupon') AND is_disabled=1) OR
 ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponReservationGuard')),'') NOT LIKE '%WF_GUARD_224_V2%'
BEGIN RAISERROR('COUPON_EVIDENCE_GUARD_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
BEGIN TRY
 BEGIN TRANSACTION;
 EXEC(N'IF EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorization WITH (UPDLOCK,HOLDLOCK) WHERE State=''ACTIVE'')
   OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence WITH (UPDLOCK,HOLDLOCK))
   RAISERROR(''COUPON_EVIDENCE_GUARD_IN_USE'',16,1)');
  EXEC(N'ALTER TRIGGER dbo.WF_CouponReservationGuard ON dbo.WFCoupon AFTER UPDATE AS -- WF_GUARD_219_V2 WF_GUARD_222_V2
  BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(RemaQty) RETURN;
    IF EXISTS (
      SELECT 1 FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID
      OUTER APPLY (
        SELECT ISNULL(SUM(CASE WHEN r.ReservedQty IS NOT NULL AND r.ReservedQty>=0
          AND ISNULL(r.ConsumedQty,0)>=0 AND ISNULL(r.ConsumedQty,0)<=r.ReservedQty
          THEN r.ReservedQty-ISNULL(r.ConsumedQty,0) ELSE 0 END),0) HeldQty,
          ISNULL(SUM(CASE WHEN r.ReservedQty IS NULL OR r.ReservedQty<0 OR
            ISNULL(r.ConsumedQty,0)<0 OR ISNULL(r.ConsumedQty,0)>r.ReservedQty
            THEN 1 ELSE 0 END),0) InvalidCount
        FROM wf.CouponReservation r WITH (UPDLOCK,HOLDLOCK)
        WHERE r.CouponId=i.CouponID AND r.Status=''RESERVED'' AND
          (r.ExpiresAt IS NULL OR r.ExpiresAt>GETUTCDATE() OR EXISTS(
            SELECT 1 FROM wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK)
            JOIN wf.CouponNativeCutAuthorization h WITH (UPDLOCK,HOLDLOCK) ON h.Id=l.AuthorizationId
            WHERE l.ReservationId=r.Id AND h.State=''ACTIVE''))
      ) a
      WHERE (i.RemaQty IS NULL OR d.RemaQty IS NULL OR i.RemaQty<d.RemaQty)
        AND (i.RemaQty IS NULL OR d.RemaQty IS NULL OR i.RemaQty<0 OR
             a.InvalidCount>0 OR i.RemaQty<a.HeldQty)
    )
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_RESERVED_BALANCE_BLOCKED'',16,1);RETURN;END;
  END');
 DISABLE TRIGGER dbo.WF_CouponReservationGuard ON dbo.WFCoupon;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 DECLARE @guardDownError NVARCHAR(2048);SET @guardDownError=ERROR_MESSAGE();RAISERROR(@guardDownError,16,1);RETURN;
END CATCH;
GO
