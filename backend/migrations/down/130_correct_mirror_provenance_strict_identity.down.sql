-- Migration 130 Down: Revert strict typed mirror provenance to Migration 129 rules
-- @transaction

SET XACT_ABORT ON;

-- Revert to Migration 129 reconciliation
UPDATE m
SET Source = 'UNKNOWN', Status = 'UNKNOWN'
FROM wf.CouponRedemptionMirror m
WHERE m.Source = 'SALE_APP'
  AND NOT EXISTS (
      SELECT 1 FROM wf.CouponReservation r
      WHERE r.CouponId = m.CouponID
        AND r.Status = 'POSTED'
        AND (r.NativeRedemptionId = m.RedemtionID OR r.NativeDocuNo = m.DocuNo)
  );

UPDATE m
SET Source = 'SALE_APP', Status = 'POSTED'
FROM wf.CouponRedemptionMirror m
WHERE EXISTS (
    SELECT 1 FROM wf.CouponReservation r
    WHERE r.CouponId = m.CouponID
      AND r.Status = 'POSTED'
      AND (r.NativeRedemptionId = m.RedemtionID OR r.NativeDocuNo = m.DocuNo)
);
