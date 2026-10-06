-- Migration 128: Reconcile unverified coupon mirror provenance
-- Relationally marks any row lacking verified wf.CouponReservation as UNKNOWN / HISTORICAL_ERP
-- @transaction
SET XACT_ABORT ON;

UPDATE m
SET m.Source = 'UNKNOWN',
    m.Status = 'HISTORICAL_ERP'
FROM wf.CouponRedemptionMirror m
WHERE NOT EXISTS (
  SELECT 1 FROM wf.CouponReservation r
  WHERE r.NativeRedemptionId = m.RedemtionID
     OR (r.NativeDocuNo IS NOT NULL AND r.NativeDocuNo = m.DocuNo)
);
