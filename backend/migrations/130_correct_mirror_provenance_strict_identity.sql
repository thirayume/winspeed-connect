-- Migration 130: Correct coupon redemption mirror provenance with strict typed identity
-- Applied Migration 129 remains immutable. Migration 130 enforces:
-- 1. Exact typed identity link: r.CouponId = m.CouponID AND r.NativeRedemptionId = m.RedemtionID AND r.Status = 'POSTED'
-- 2. Legacy fallback on r.NativeRedemptionId IS NULL requires strict, unambiguous 1:1 match by DocuNo without conflicting RedemtionIDs
-- 3. Conflicting or duplicate DocuNo with different RedemtionID cannot claim SALE_APP and remains UNKNOWN
-- @transaction

SET XACT_ABORT ON;

-- 1. Downgrade any SALE_APP row that lacks exact typed identity and lacks unambiguous 1:1 legacy match
UPDATE m
SET Source = 'UNKNOWN', Status = 'UNKNOWN'
FROM wf.CouponRedemptionMirror m
WHERE m.Source = 'SALE_APP'
  AND NOT EXISTS (
      -- Exact typed primary key match: same CouponId and exact NativeRedemptionId
      SELECT 1 FROM wf.CouponReservation r
      WHERE r.CouponId = m.CouponID
        AND r.NativeRedemptionId = m.RedemtionID
        AND r.Status = 'POSTED'
  )
  AND NOT (
      -- Unambiguous legacy fallback ONLY if reservation has NULL NativeRedemptionId
      -- AND exactly one RedemtionID exists under this DocuNo/CouponID in the mirror
      -- AND exactly one POSTED reservation exists under this NativeDocuNo/CouponId
      EXISTS (
          SELECT 1 FROM wf.CouponReservation r
          WHERE r.CouponId = m.CouponID
            AND r.NativeRedemptionId IS NULL
            AND r.NativeDocuNo = m.DocuNo
            AND r.Status = 'POSTED'
      )
      AND (
          SELECT COUNT(DISTINCT m2.RedemtionID)
          FROM wf.CouponRedemptionMirror m2
          WHERE m2.DocuNo = m.DocuNo
            AND m2.CouponID = m.CouponID
      ) = 1
      AND (
          SELECT COUNT(*)
          FROM wf.CouponReservation r2
          WHERE r2.NativeDocuNo = m.DocuNo
            AND r2.CouponId = m.CouponID
            AND r2.Status = 'POSTED'
      ) = 1
  );

-- 2. Authoritatively confirm SALE_APP / POSTED for rows with verified exact typed link or unambiguous legacy 1:1 match
UPDATE m
SET Source = 'SALE_APP', Status = 'POSTED'
FROM wf.CouponRedemptionMirror m
WHERE (
    EXISTS (
        SELECT 1 FROM wf.CouponReservation r
        WHERE r.CouponId = m.CouponID
          AND r.NativeRedemptionId = m.RedemtionID
          AND r.Status = 'POSTED'
    )
    OR (
        EXISTS (
            SELECT 1 FROM wf.CouponReservation r
            WHERE r.CouponId = m.CouponID
              AND r.NativeRedemptionId IS NULL
              AND r.NativeDocuNo = m.DocuNo
              AND r.Status = 'POSTED'
        )
        AND (
            SELECT COUNT(DISTINCT m2.RedemtionID)
            FROM wf.CouponRedemptionMirror m2
            WHERE m2.DocuNo = m.DocuNo
              AND m2.CouponID = m.CouponID
        ) = 1
        AND (
            SELECT COUNT(*)
            FROM wf.CouponReservation r2
            WHERE r2.NativeDocuNo = m.DocuNo
              AND r2.CouponId = m.CouponID
              AND r2.Status = 'POSTED'
        ) = 1
    )
);
