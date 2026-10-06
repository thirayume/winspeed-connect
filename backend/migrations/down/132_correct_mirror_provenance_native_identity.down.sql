-- Migration 132 Down: Revert legacy fallback adjustments
SET XACT_ABORT ON;

UPDATE m
SET Source = 'UNKNOWN', Status = 'UNKNOWN'
FROM wf.CouponRedemptionMirror m
WHERE m.Source = 'SALE_APP'
  AND NOT EXISTS (
      SELECT 1 FROM wf.CouponReservation r
      WHERE r.CouponId = m.CouponID
        AND r.NativeRedemptionId = m.RedemtionID
        AND r.Status = 'POSTED'
  );
