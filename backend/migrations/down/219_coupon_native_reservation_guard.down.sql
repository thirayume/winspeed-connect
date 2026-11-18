-- Do not silently remove an active control. Review and disable separately first.
IF OBJECT_ID('dbo.WF_CouponReservationGuard','TR') IS NOT NULL
BEGIN
  IF ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponReservationGuard')),'') NOT LIKE '%WF_GUARD_219_V2%'
     OR ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponReservationGuard')),'') LIKE '%WF_GUARD_222_V2%'
     OR ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponReservationGuard')),'') LIKE '%WF_GUARD_224_V%'
     OR NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponReservationGuard') AND parent_id=OBJECT_ID('dbo.WFCoupon'))
  BEGIN
    RAISERROR('COUPON_RESERVATION_GUARD_EXISTING_REVIEW_REQUIRED',16,1);
    RETURN;
  END;
  IF EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponReservationGuard') AND is_disabled=0)
  BEGIN
    RAISERROR('COUPON_RESERVATION_GUARD_ACTIVE',16,1);
    RETURN;
  END;
  DROP TRIGGER dbo.WF_CouponReservationGuard;
END;
GO
