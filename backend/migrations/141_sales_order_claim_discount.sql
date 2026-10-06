-- Migration 141: Sales Order Claim Discount & Applied Rebate Claim Tracking
-- UNAPPLIED: Written for R10 requirements. Do not run automatically.
-- Keeps claim-sourced amount separate from ledger-sourced "เบิก Rebate มาใช้" amount.

-- 1. Add AppliedRebateClaimId and ClaimDiscountAmt to wf.SalesOrder
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.SalesOrder') AND name = 'AppliedRebateClaimId')
BEGIN
    ALTER TABLE wf.SalesOrder ADD AppliedRebateClaimId INT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.SalesOrder') AND name = 'ClaimDiscountAmt')
BEGIN
    ALTER TABLE wf.SalesOrder ADD ClaimDiscountAmt DECIMAL(12,2) NOT NULL CONSTRAINT DF_SalesOrder_ClaimDiscountAmt DEFAULT 0;
END;

-- 2. Add AppliedRebateClaimId and ClaimDiscountAmt to wf.SalesOrderExt (native confirmed orders)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.SalesOrderExt') AND name = 'AppliedRebateClaimId')
BEGIN
    ALTER TABLE wf.SalesOrderExt ADD AppliedRebateClaimId INT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.SalesOrderExt') AND name = 'ClaimDiscountAmt')
BEGIN
    ALTER TABLE wf.SalesOrderExt ADD ClaimDiscountAmt DECIMAL(12,2) NOT NULL CONSTRAINT DF_SalesOrderExt_ClaimDiscountAmt DEFAULT 0;
END;

-- 3. Add AppliedDraftSoId to wf.RebateClaim for tracking draft application lifecycle
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'AppliedDraftSoId')
BEGIN
    ALTER TABLE wf.RebateClaim ADD AppliedDraftSoId INT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'AppliedSoDocuNo')
BEGIN
    ALTER TABLE wf.RebateClaim ADD AppliedSoDocuNo VARCHAR(50) NULL;
END;
