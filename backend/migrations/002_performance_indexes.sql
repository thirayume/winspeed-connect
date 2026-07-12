-- =============================================================
-- 002_performance_indexes.sql
-- Performance indexes for control-ticket + rebate queries
-- Safe to re-run: uses IF NOT EXISTS guards
-- =============================================================

-- ── dbo.SOHD ─────────────────────────────────────────────────

-- Control-ticket lookup: DocuType=103, DocuStatus='Y', AppvDocuNo LIKE 'AI%'
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.SOHD') AND name = 'IX_SOHD_ControlTicket')
    CREATE NONCLUSTERED INDEX IX_SOHD_ControlTicket
        ON dbo.SOHD (DocuType, DocuStatus, AppvDocuNo)
        INCLUDE (CustID, SOID, DocuDate)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- Delivery-order lookup: DocuType=104, DocuStatus<>'C', RefNo
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.SOHD') AND name = 'IX_SOHD_DeliveryByRefNo')
    CREATE NONCLUSTERED INDEX IX_SOHD_DeliveryByRefNo
        ON dbo.SOHD (DocuType, DocuStatus, RefNo)
        INCLUDE (SOID)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- SQL Server missing index suggestion (Impact 23): RefNo before DocuStatus for LIKE 'AI%' seeks
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.SOHD') AND name = 'IX_SOHD_DeliveryByRefNo2')
    CREATE NONCLUSTERED INDEX IX_SOHD_DeliveryByRefNo2
        ON dbo.SOHD (DocuType, RefNo, DocuStatus)
        INCLUDE (SOID)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ── dbo.SODT ─────────────────────────────────────────────────

-- Aggregate GoodQty2 per SOID (TotalQtyTon / DrawnQtyTon)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.SODT') AND name = 'IX_SODT_SOID_Qty')
    CREATE NONCLUSTERED INDEX IX_SODT_SOID_Qty
        ON dbo.SODT (SOID)
        INCLUDE (GoodQty2, ListNo, GoodID)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ── wf.SalesOrderLine ────────────────────────────────────────

-- JOIN on (SoId, LineNum), lookup RefControlTicketNo
-- RefControlTicketNo is added by a later migration in some restored DBs, so guard the column too.
IF COL_LENGTH('wf.SalesOrderLine', 'RefControlTicketNo') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.SalesOrderLine') AND name = 'IX_SOLine_SoId_LineNum_RefCtrl')
    CREATE NONCLUSTERED INDEX IX_SOLine_SoId_LineNum_RefCtrl
        ON wf.SalesOrderLine (SoId, LineNum)
        INCLUDE (RefControlTicketNo)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- Reverse lookup: find lines by RefControlTicketNo
IF COL_LENGTH('wf.SalesOrderLine', 'RefControlTicketNo') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.SalesOrderLine') AND name = 'IX_SOLine_RefControlTicketNo')
    CREATE NONCLUSTERED INDEX IX_SOLine_RefControlTicketNo
        ON wf.SalesOrderLine (RefControlTicketNo)
        INCLUDE (SoId, LineNum)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ── wf.RebateLedger ──────────────────────────────────────────

-- Rebate balance query: filter by Status + ReversedFlag, group by CustId
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.RebateLedger') AND name = 'IX_RebateLedger_CustBalance')
    CREATE NONCLUSTERED INDEX IX_RebateLedger_CustBalance
        ON wf.RebateLedger (CustId, Status, ReversedFlag)
        INCLUDE (RemainingAmt, CreatedAt, Id)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO
