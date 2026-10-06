-- Migration 132: Correct mirror provenance native identity for legacy fallback
-- Applied Migrations 130 and 131 are immutable. Forward migration 132 enforces:
-- For legacy fallback (r.NativeRedemptionId IS NULL), the single distinct RedemtionID in dbo.WFRedemtionHD
-- must identically match m.RedemtionID.
-- If the sole native header has a different RedemtionID (h.RedemtionID <> m.RedemtionID),
-- the mirror row cannot claim SALE_APP and must be downgraded to UNKNOWN/UNKNOWN.
-- @transaction

SET XACT_ABORT ON;

-- 1. Downgrade any legacy SALE_APP row where native dbo.WFRedemtionHD does not have exact matching RedemtionID
UPDATE m
SET Source = 'UNKNOWN', Status = 'UNKNOWN'
FROM wf.CouponRedemptionMirror m
WHERE m.Source = 'SALE_APP'
  -- Does NOT have exact primary key link
  AND NOT EXISTS (
      SELECT 1 FROM wf.CouponReservation r
      WHERE r.CouponId = m.CouponID
        AND r.NativeRedemptionId = m.RedemtionID
        AND r.Status = 'POSTED'
  )
  -- Fails native identity or uniqueness:
  AND (
      -- Ambiguous native RedemtionIDs
      (
          SELECT COUNT(DISTINCT h.RedemtionID)
          FROM dbo.WFRedemtionHD h WITH (NOLOCK)
          WHERE h.DocuNo = m.DocuNo
      ) <> 1
      -- OR the native header has a different RedemtionID (identity mismatch)
      OR NOT EXISTS (
          SELECT 1
          FROM dbo.WFRedemtionHD h WITH (NOLOCK)
          WHERE h.DocuNo = m.DocuNo
            AND h.RedemtionID = m.RedemtionID
      )
  );

-- 2. Authoritatively confirm SALE_APP / POSTED for rows with verified exact link or unambiguous native & mirror legacy 1:1 match
UPDATE m
SET Source = 'SALE_APP', Status = 'POSTED'
FROM wf.CouponRedemptionMirror m
WHERE (
    -- Exact typed primary key match
    EXISTS (
        SELECT 1 FROM wf.CouponReservation r
        WHERE r.CouponId = m.CouponID
          AND r.NativeRedemptionId = m.RedemtionID
          AND r.Status = 'POSTED'
    )
    OR (
        -- Unambiguous legacy fallback
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
        -- Exactly 1 native header RedemtionID
        AND (
            SELECT COUNT(DISTINCT h.RedemtionID)
            FROM dbo.WFRedemtionHD h WITH (NOLOCK)
            WHERE h.DocuNo = m.DocuNo
        ) = 1
        -- AND that native header's RedemtionID matches m.RedemtionID
        AND EXISTS (
            SELECT 1
            FROM dbo.WFRedemtionHD h WITH (NOLOCK)
            WHERE h.DocuNo = m.DocuNo
              AND h.RedemtionID = m.RedemtionID
        )
    )
);
