-- ==========================================
-- 010_rebate_usage.sql
-- Create tracking table for Rebate Withdrawal and update SalesOrderExt
-- ==========================================

BEGIN TRANSACTION;

-- 1. Create wf.RebateUsage table to track FIFO deductions
IF OBJECT_ID('wf.RebateUsage', 'U') IS NULL
BEGIN
    CREATE TABLE wf.RebateUsage (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        LedgerId        INT           NOT NULL REFERENCES wf.RebateLedger(Id),
        AppliedSOID     NVARCHAR(50)  NOT NULL,
        DeductedAmt     DECIMAL(12,2) NOT NULL,
        CreatedAt       DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );

    CREATE INDEX IX_RebateUsage_LedgerId ON wf.RebateUsage(LedgerId);
    CREATE INDEX IX_RebateUsage_AppliedSOID ON wf.RebateUsage(AppliedSOID);
END

-- 2. Add RebateDiscountAmt to wf.SalesOrderExt if it doesn't exist
IF COL_LENGTH('wf.SalesOrderExt', 'RebateDiscountAmt') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrderExt
    ADD RebateDiscountAmt DECIMAL(12,2) NOT NULL DEFAULT 0;
END

-- 3. Add RebateDiscountAmt to wf.SalesOrder (draft table) if it doesn't exist
IF COL_LENGTH('wf.SalesOrder', 'RebateDiscountAmt') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrder
    ADD RebateDiscountAmt DECIMAL(12,2) NOT NULL DEFAULT 0;
END

COMMIT;
