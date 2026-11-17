-- Never silently remove an active or unrecognized safety control.
IF OBJECT_ID('wf.WF_CouponAuthorizationReservationFence','TR') IS NOT NULL
BEGIN
 IF ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') NOT LIKE '%WF_AUTH_FENCE_221_V2%'
    OR ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')),'') LIKE '%WF_AUTH_FENCE_225_V%'
    OR NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')
       AND parent_id=OBJECT_ID('wf.CouponReservation'))
 BEGIN RAISERROR('COUPON_AUTH_FENCE_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_CouponAuthorizationReservationFence') AND is_disabled=0)
 BEGIN RAISERROR('COUPON_AUTH_FENCE_ACTIVE',16,1);RETURN;END;
 DROP TRIGGER wf.WF_CouponAuthorizationReservationFence;
END;
GO
