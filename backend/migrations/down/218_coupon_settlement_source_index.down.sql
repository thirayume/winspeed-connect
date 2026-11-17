IF OBJECT_ID('wf.CouponReservationSettlement', 'U') IS NOT NULL
AND EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponReservationSettlement') AND name='IX_CouponSettlement_CouponNative')
BEGIN
  DROP INDEX IX_CouponSettlement_CouponNative ON wf.CouponReservationSettlement;
END
GO
