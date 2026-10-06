-- Migration 129: Correct coupon redemption mirror provenance at line level
-- Reconciles Source and Status based on strict typed line-level POSTED reservation match
-- Uncertain origins remain UNKNOWN, rather than asserting ERP origin
-- @transaction

SET XACT_ABORT ON;

-- 1. Reconcile uncertain origins where Status was previously set to HISTORICAL_ERP
-- Absence of reservation does not prove ERP origin (e.g. direct adapter writes); keep Status = 'UNKNOWN'
UPDATE wf.CouponRedemptionMirror
SET Status = 'UNKNOWN'
WHERE Status = 'HISTORICAL_ERP';

-- 2. Downgrade SALE_APP rows that lack line-level POSTED reservation evidence
-- Must match exact CouponID and reservation Status = 'POSTED'
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

-- 3. Confirm SALE_APP for rows having verified line-level POSTED reservation
UPDATE m
SET Source = 'SALE_APP', Status = 'POSTED'
FROM wf.CouponRedemptionMirror m
WHERE EXISTS (
    SELECT 1 FROM wf.CouponReservation r
    WHERE r.CouponId = m.CouponID
      AND r.Status = 'POSTED'
      AND (r.NativeRedemptionId = m.RedemtionID OR r.NativeDocuNo = m.DocuNo)
);
