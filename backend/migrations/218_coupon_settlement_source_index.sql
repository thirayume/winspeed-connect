-- Read-side support for verifying the native source before reusing a coupon.
-- This migration does not alter balances or release reservations.
IF OBJECT_ID('wf.CouponReservationSettlement', 'U') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponReservationSettlement') AND name='IX_CouponSettlement_CouponNative')
BEGIN
  CREATE INDEX IX_CouponSettlement_CouponNative ON wf.CouponReservationSettlement(CouponId,NativeRedemptionId)
    INCLUDE (SettledQty,NativeDocuNo);
END
GO
