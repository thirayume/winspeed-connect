-- Migration 010: Add LoadSequence back to v_AllSalesOrderLines View

CREATE OR ALTER VIEW wf.v_AllSalesOrderLines AS
-- 1. DRAFT lines
SELECT 
    CAST(sol.SoId AS VARCHAR(50)) AS SoId,
    sol.LineNum,
    sol.GoodId,
    sol.GoodCode,
    sol.GoodName,
    sol.QtyTon,
    sol.QtyBag,
    sol.PricePerTon,
    sol.NetPricePerTon,
    sol.IsGiveaway,
    sol.RebateBooked,
    sol.RefControlTicketNo,
    sol.IsControlTicketDrawn,
    CAST(NULL AS INT) AS LoadSequence,
    sol.CreatedAt
FROM wf.SalesOrderLine sol
JOIN wf.SalesOrder so ON so.Id = sol.SoId
WHERE so.Status = 'DRAFT'

UNION ALL

-- 2. Lines from Winspeed
SELECT
    dt.SOID AS SoId,
    dt.ListNo AS LineNum,
    dt.GoodID AS GoodId,
    g.GoodCode,
    g.GoodName1 AS GoodName,
    dt.GoodQty2 AS QtyTon,
    CAST(dt.GoodQty2 * 20 AS INT) AS QtyBag,
    dt.GoodPrice2 AS PricePerTon,
    ISNULL(ext.NetPricePerTon, dt.GoodPrice2) AS NetPricePerTon,
    ISNULL(ext.IsGiveaway, 0) AS IsGiveaway,
    ISNULL(ext.RebateBooked, 0) AS RebateBooked,
    ext.RefControlTicketNo,
    ISNULL(ext.IsControlTicketDrawn, 0) AS IsControlTicketDrawn,
    ext.LoadSequence,
    hd.DocuDate AS CreatedAt
FROM dbo.SODT dt
JOIN dbo.SOHD hd ON hd.SOID = dt.SOID
JOIN dbo.EMGood g ON g.GoodID = dt.GoodID
LEFT JOIN wf.SalesOrderLineExt ext ON ext.SOID = dt.SOID AND ext.ListNo = dt.ListNo
GO

GO

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

GO