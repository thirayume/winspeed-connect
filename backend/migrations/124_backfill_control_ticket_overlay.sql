-- @transaction
-- Migration 124: Backfill ControlTicketOverlay legacy rows & create unique filtered index on DocuId
-- Target: dbo / wf schema in WINSpeed DB
-- Depends on: 114_so04_control_ticket_trace_expiry.sql (creates wf.ControlTicketOverlay)

-- 1. Create backup table if not exists, and snapshot current state for down-migration rollback
SET XACT_ABORT ON;
IF OBJECT_ID('wf.ControlTicketOverlay_Pre124Backup', 'U') IS NULL
BEGIN
    SELECT * INTO wf.ControlTicketOverlay_Pre124Backup FROM wf.ControlTicketOverlay;
END
GO

-- 2. Backfill rows where DocuId IS NULL or DocuId = 0
-- Case A: Distinct single match in dbo.WFCoupon
SET XACT_ABORT ON;
UPDATE ov
SET ov.DocuId = c.CouponID,
    ov.UpdatedAt = SYSUTCDATETIME()
FROM wf.ControlTicketOverlay ov
CROSS APPLY (
    SELECT c.CouponID, COUNT(*) OVER() as MatchCount
    FROM dbo.WFCoupon c
    WHERE c.CouponNo = ov.DocuNo
) c
WHERE (ov.DocuId IS NULL OR ov.DocuId = 0)
  AND c.MatchCount = 1;
GO

-- Case B: Multiple matches in dbo.WFCoupon (Duplicate coupon groups)
-- Clone the overlay row for each matching CouponID
SET XACT_ABORT ON;
INSERT INTO wf.ControlTicketOverlay (
    DocuNo, DocuType, DocuId, GoodCode,
    ExpiryDate, ExpiryType, PolicySnapshotId, StrictOverrideFlag,
    ReasonCode, ReasonText, CreatedBy, CreatedAt, UpdatedAt
)
SELECT 
    ov.DocuNo, ov.DocuType, c.CouponID, ov.GoodCode,
    ov.ExpiryDate, ov.ExpiryType, ov.PolicySnapshotId, ov.StrictOverrideFlag,
    ov.ReasonCode, ov.ReasonText, ov.CreatedBy, ov.CreatedAt, SYSUTCDATETIME()
FROM wf.ControlTicketOverlay ov
CROSS APPLY (
    SELECT c.CouponID, COUNT(*) OVER() as MatchCount
    FROM dbo.WFCoupon c
    WHERE c.CouponNo = ov.DocuNo
) c
WHERE (ov.DocuId IS NULL OR ov.DocuId = 0)
  AND c.MatchCount > 1;
GO

-- Now delete the unassigned legacy rows that were cloned into distinct CouponIDs
SET XACT_ABORT ON;
DELETE ov
FROM wf.ControlTicketOverlay ov
WHERE (ov.DocuId IS NULL OR ov.DocuId = 0)
  AND EXISTS (
    SELECT 1 FROM dbo.WFCoupon c
    WHERE c.CouponNo = ov.DocuNo
  );
GO

-- 3. Duplicate Pre-check before index creation (PR-03 Guard)
-- If duplicate positive DocuIds exist, abort immediately with clear reporting
SET XACT_ABORT ON;
IF EXISTS (
    SELECT DocuId 
    FROM wf.ControlTicketOverlay
    WHERE DocuId IS NOT NULL AND DocuId > 0
    GROUP BY DocuId
    HAVING COUNT(*) > 1
)
BEGIN
    DECLARE @dupList NVARCHAR(MAX);
    SELECT @dupList = STRING_AGG(CAST(DocuId AS NVARCHAR(20)) + ' (' + CAST(cnt AS NVARCHAR(10)) + ' rows)', ', ')
    FROM (
        SELECT DocuId, COUNT(*) as cnt
        FROM wf.ControlTicketOverlay
        WHERE DocuId IS NOT NULL AND DocuId > 0
        GROUP BY DocuId
        HAVING COUNT(*) > 1
    ) d;
    RAISERROR('PRE_INDEX_VALIDATION_FAILED: Duplicate DocuId detected in wf.ControlTicketOverlay: %s', 16, 1, @dupList);
END;
GO

-- 4. Create unique filtered index on DocuId > 0
SET XACT_ABORT ON;
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes 
    WHERE name = 'UQ_ControlTicketOverlay_DocuId' AND object_id = OBJECT_ID('wf.ControlTicketOverlay')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UQ_ControlTicketOverlay_DocuId 
    ON wf.ControlTicketOverlay(DocuId) 
    WHERE DocuId IS NOT NULL AND DocuId > 0;
END
GO
