-- ============================================================================
-- 143_giveaway_borrow_regions.sql
-- Add RequesterRegion and LenderRegion to wf.GiveawayBorrowRequest
--
-- Background (U-6 / B-6):
-- Budgets are per region: UQ_GBudget (Region, PeriodYear, Brand, ItemName).
-- Requester and lender regions must be tracked separately so that quota can
-- be deducted from the lender's region row and added to the requester's
-- region row atomically.
--
-- SQL 2008 R2 Compatibility:
-- - Uses COL_LENGTH checks before ALTER TABLE ADD.
-- - No ALTER COLUMN on columns with defaults.
-- - wf schema only.
-- ============================================================================

IF COL_LENGTH('wf.GiveawayBorrowRequest', 'RequesterRegion') IS NULL
BEGIN
    ALTER TABLE wf.GiveawayBorrowRequest ADD RequesterRegion NVARCHAR(60) NULL;
END
GO

IF COL_LENGTH('wf.GiveawayBorrowRequest', 'LenderRegion') IS NULL
BEGIN
    ALTER TABLE wf.GiveawayBorrowRequest ADD LenderRegion NVARCHAR(60) NULL;
END
GO
