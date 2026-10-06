-- Migration 127: Reconcile historical provenance in wf.CouponRedemptionMirror
-- Pre-Slice2 or unverified rows must not be claimed as SALE_APP
SET XACT_ABORT ON;

UPDATE wf.CouponRedemptionMirror
SET Source = 'UNKNOWN'
WHERE Source = 'SALE_APP' 
  AND (RedeemedAt IS NULL OR RedeemedAt < '2026-09-24T00:00:00Z');
