-- Migration 131: Verify WinSpeed native dbo.WFRedemtionHD uniqueness for legacy fallback
-- Applied Migration 130 is immutable. Forward migration 131 enforces:
-- For legacy fallback on r.NativeRedemptionId IS NULL, dbo.WFRedemtionHD must also have exactly 1 distinct RedemtionID for the DocuNo.
-- If WinSpeed native tables have duplicate or conflicting RedemtionIDs for the DocuNo, the mirror row cannot claim SALE_APP and remains UNKNOWN.
-- @transaction

SET XACT_ABORT ON;

-- 1. Downgrade any legacy SALE_APP row where native dbo.WFRedemtionHD has duplicate or conflicting RedemtionIDs
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
  -- Has ambiguous native WinSpeed redemptions
  AND (
      SELECT COUNT(DISTINCT h.RedemtionID)
      FROM dbo.WFRedemtionHD h WITH (NOLOCK)
      WHERE h.DocuNo = m.DocuNo
  ) <> 1;

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
        AND (
            SELECT COUNT(DISTINCT h.RedemtionID)
            FROM dbo.WFRedemtionHD h WITH (NOLOCK)
            WHERE h.DocuNo = m.DocuNo
        ) = 1
    )
);
