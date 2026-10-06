-- Migration 129 Down: Revert line-level provenance reconciliation
-- @transaction

SET XACT_ABORT ON;

UPDATE m
SET Source = 'UNKNOWN', Status = 'HISTORICAL_ERP'
FROM wf.CouponRedemptionMirror m
WHERE NOT EXISTS (
    SELECT 1 FROM wf.CouponReservation r
    WHERE r.NativeRedemptionId = m.RedemtionID OR r.NativeDocuNo = m.DocuNo
);
