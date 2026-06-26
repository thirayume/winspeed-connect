-- =============================================================
-- 013_comprehensive_indexes.sql
-- Comprehensive indexes for all tables used by WS-Sale-App
-- Safe to re-run: all wrapped in IF NOT EXISTS
-- =============================================================

-- ══════════════════════════════════════════════════════════════
-- dbo schema (Winspeed READ-ONLY — indexes only, no data writes)
-- ══════════════════════════════════════════════════════════════

-- ── dbo.EMSetPriceDT ─────────────────────────────────────────
-- Price lookup by header (SetPriceID) — most common join
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMSetPriceDT') AND name = 'IX_EMSetPrice_HeaderLookup')
    CREATE NONCLUSTERED INDEX IX_EMSetPrice_HeaderLookup
        ON dbo.EMSetPriceDT (SetPriceID)
        INCLUDE (ListNo, GoodPriceNet, startgoodqty, endgoodqty)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- SQL Server missing index suggestion (Impact 27): GoodPriceNet range scan
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMSetPriceDT') AND name = 'IX_EMSetPrice_GoodPriceNet')
    CREATE NONCLUSTERED INDEX IX_EMSetPrice_GoodPriceNet
        ON dbo.EMSetPriceDT (GoodPriceNet)
        INCLUDE (ListID, startgoodqty, endgoodqty)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ── dbo.EMCust ───────────────────────────────────────────────
-- CustName search (autocomplete / filter)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMCust') AND name = 'IX_EMCust_CustName')
    CREATE NONCLUSTERED INDEX IX_EMCust_CustName
        ON dbo.EMCust (CustName)
        INCLUDE (CustID, Inactive)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ── dbo.SOHD ─────────────────────────────────────────────────
-- CustID + DocuType — list orders by customer
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.SOHD') AND name = 'IX_SOHD_CustId_DocuType')
    CREATE NONCLUSTERED INDEX IX_SOHD_CustId_DocuType
        ON dbo.SOHD (CustID, DocuType, DocuStatus)
        INCLUDE (SOID, DocuDate, AppvDocuNo, RefNo)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- DocuDate range scan (recent orders)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.SOHD') AND name = 'IX_SOHD_DocuDate')
    CREATE NONCLUSTERED INDEX IX_SOHD_DocuDate
        ON dbo.SOHD (DocuDate DESC, DocuType)
        INCLUDE (SOID, CustID, DocuStatus, AppvDocuNo)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ══════════════════════════════════════════════════════════════
-- wf schema (our tables — full control)
-- ══════════════════════════════════════════════════════════════

-- ── wf.AppUser ───────────────────────────────────────────────
-- Role + IsActive filter (list active sales users)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.AppUser') AND name = 'IX_AppUser_Role_Active')
    CREATE NONCLUSTERED INDEX IX_AppUser_Role_Active
        ON wf.AppUser (Role, IsActive)
        INCLUDE (Username, DisplayName, EmpId)
    WITH (ONLINE = OFF, FILLFACTOR = 90);
GO

-- EmpId lookup
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.AppUser') AND name = 'IX_AppUser_EmpId')
    CREATE NONCLUSTERED INDEX IX_AppUser_EmpId
        ON wf.AppUser (EmpId)
        INCLUDE (Username, DisplayName, Role)
    WITH (ONLINE = OFF, FILLFACTOR = 90);
GO

-- ── wf.SalesOrder ────────────────────────────────────────────
-- Date range + status (dashboard / pagination)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.SalesOrder') AND name = 'IX_SO_Status_CreatedAt')
    CREATE NONCLUSTERED INDEX IX_SO_Status_CreatedAt
        ON wf.SalesOrder (Status, CreatedAt DESC)
        INCLUDE (CustId, CustName, SalesUserId, WfRef, DeliveryDate)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ControlTicketNo lookup
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.SalesOrder') AND name = 'IX_SO_ControlTicketNo')
    CREATE NONCLUSTERED INDEX IX_SO_ControlTicketNo
        ON wf.SalesOrder (ControlTicketNo)
        INCLUDE (Id, CustId, Status, WfRef)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- DeliveryDate range (schedule view)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.SalesOrder') AND name = 'IX_SO_DeliveryDate')
    CREATE NONCLUSTERED INDEX IX_SO_DeliveryDate
        ON wf.SalesOrder (DeliveryDate, Status)
        INCLUDE (CustId, CustName, SalesUserId, WfRef)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ── wf.SalesOrderAudit ───────────────────────────────────────
-- Audit trail by SOID
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.SalesOrderAudit') AND name = 'IX_SOAudit_SOID')
    CREATE NONCLUSTERED INDEX IX_SOAudit_SOID
        ON wf.SalesOrderAudit (SOID, CreatedAt DESC)
        INCLUDE (UserId, Action, FromStatus, ToStatus)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ── wf.RebateClaim ───────────────────────────────────────────
-- Claims by pool (rebate management)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'IX_RebateClaim_PoolId')
    CREATE NONCLUSTERED INDEX IX_RebateClaim_PoolId
        ON wf.RebateClaim (PoolId, Status)
        INCLUDE (CustId, ClaimAmt, RemainingAmt, CreatedAt)
    WITH (ONLINE = OFF, FILLFACTOR = 90);
GO

-- Claims by customer
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'IX_RebateClaim_CustId')
    CREATE NONCLUSTERED INDEX IX_RebateClaim_CustId
        ON wf.RebateClaim (CustId, Status)
        INCLUDE (PoolId, ClaimAmt, RemainingAmt)
    WITH (ONLINE = OFF, FILLFACTOR = 90);
GO

-- ── wf.GiveawayBudget ────────────────────────────────────────
-- Lookup by SalesUser (dashboard: show my budget)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.GiveawayBudget') AND name = 'IX_GBudget_SalesUser_Year')
    CREATE NONCLUSTERED INDEX IX_GBudget_SalesUser_Year
        ON wf.GiveawayBudget (SalesUserId, PeriodYear)
        INCLUDE (Region, Brand, ItemName, BudgetQty, EmpCode)
    WITH (ONLINE = OFF, FILLFACTOR = 90);
GO

-- ── wf.GiveawayWithdrawal ────────────────────────────────────
-- Lookup by SalesUser (my withdrawal history)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.GiveawayWithdrawal') AND name = 'IX_GWd_SalesUser_Year')
    CREATE NONCLUSTERED INDEX IX_GWd_SalesUser_Year
        ON wf.GiveawayWithdrawal (SalesUserId, PeriodYear, IssueMonth)
        INCLUDE (Brand, ItemName, Qty, CustId, CreatedAt)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- Lookup by CustId (customer giveaway history)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.GiveawayWithdrawal') AND name = 'IX_GWd_CustId')
    CREATE NONCLUSTERED INDEX IX_GWd_CustId
        ON wf.GiveawayWithdrawal (CustId, PeriodYear)
        INCLUDE (SalesUserId, Brand, ItemName, Qty, CreatedAt)
    WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ── wf.RebatePool ────────────────────────────────────────────
-- Period lookup (current month pool)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.RebatePool') AND name = 'IX_RebatePool_Period')
    CREATE NONCLUSTERED INDEX IX_RebatePool_Period
        ON wf.RebatePool (PeriodYear, PeriodMonth)
        INCLUDE (SalesUserId, AccruedAmt, ClaimedAmt, AllocatedAmt)
    WITH (ONLINE = OFF, FILLFACTOR = 90);
GO
