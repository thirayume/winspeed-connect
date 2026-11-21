-- @transaction
-- ============================================================================
-- 255_rebate_configurable_limits.sql
-- Owner, 21 Nov 2026: the discount limits are App Settings (REBATE_STANDARD_LIMIT_PER_TON,
-- REBATE_MAX_LIMIT_PER_TON) and must be changeable without a deploy. The bill's price check already
-- reads them, but the Rebate booking price (migration 205) and the shipment accrual (migration 207)
-- held 200 and 300 in their CHECK constraints, so a changed setting would let a bill pass its price
-- check and then fail when the 103 is confirmed.
-- Each booking price now stores the limits it was judged by (StandardLimitPerTon, MaxLimitPerTon), and
-- its CHECK uses those columns, so a later change of the settings never alters a booking already priced.
-- Rows that exist before this migration were judged by 200/300 and receive exactly those values.
-- The accrual's ceiling becomes 1500, the highest maximum App Settings allows; the accrual is still
-- bound to its booking price by the existing trigger.
-- wf only; no dbo object. Rollback: down/ restores the 200/300 constraints and drops the columns
-- (refused if a stored price was judged by other limits).
-- SQL Server 2008 R2, compatibility 80.
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF OBJECT_ID('wf.RebateBookingPriceSnapshot', 'U') IS NULL OR OBJECT_ID('wf.RebateShipmentAccrual', 'U') IS NULL
    RAISERROR('RCL_PREREQUISITE_REQUIRED: migrations 205 and 207', 16, 1);
GO
IF COL_LENGTH('wf.RebateBookingPriceSnapshot', 'StandardLimitPerTon') IS NULL
    ALTER TABLE wf.RebateBookingPriceSnapshot ADD
        StandardLimitPerTon decimal(18,2) NOT NULL CONSTRAINT DF_RebateBookingPriceSnapshot_StdLimit DEFAULT 200,
        MaxLimitPerTon decimal(18,2) NOT NULL CONSTRAINT DF_RebateBookingPriceSnapshot_MaxLimit DEFAULT 300;
GO
-- The defaults only filled rows priced before this migration; every new price must state its limits.
IF OBJECT_ID('wf.DF_RebateBookingPriceSnapshot_StdLimit', 'D') IS NOT NULL
    ALTER TABLE wf.RebateBookingPriceSnapshot DROP CONSTRAINT DF_RebateBookingPriceSnapshot_StdLimit;
IF OBJECT_ID('wf.DF_RebateBookingPriceSnapshot_MaxLimit', 'D') IS NOT NULL
    ALTER TABLE wf.RebateBookingPriceSnapshot DROP CONSTRAINT DF_RebateBookingPriceSnapshot_MaxLimit;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('wf.RebateBookingPriceSnapshot')
           AND name = 'CK_RebateBookingPriceSnapshot_Values')
    ALTER TABLE wf.RebateBookingPriceSnapshot DROP CONSTRAINT CK_RebateBookingPriceSnapshot_Values;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('wf.RebateBookingPriceSnapshot')
               AND name = 'CK_RebateBookingPriceSnapshot_LimitValues')
    ALTER TABLE wf.RebateBookingPriceSnapshot WITH CHECK ADD CONSTRAINT CK_RebateBookingPriceSnapshot_LimitValues CHECK
   (BookingSOID>0 AND [LineNo]>0 AND DraftId>0 AND DocumentRevision>0 AND GoodId>0
    AND SetPriceId>0 AND SetPriceListNo>0 AND BasePrice>0 AND SellingPrice>=0 AND InvoicePrice>=0
    AND QuantityTon>0 AND RebatePerTon>=0 AND TotalRebate>=0 AND PriceBegin<=SaleDate
    AND (PriceEnd IS NULL OR PriceEnd>=SaleDate)
    AND StandardLimitPerTon>=0 AND StandardLimitPerTon<=1000 AND MaxLimitPerTon>=StandardLimitPerTon AND MaxLimitPerTon<=1500
    AND StandardLimitPerTon=ROUND(StandardLimitPerTon,0) AND MaxLimitPerTon=ROUND(MaxLimitPerTon,0)
    AND TotalRebate=CAST(ROUND(QuantityTon*RebatePerTon,2) AS decimal(18,2))
    AND ((SellingPrice<BasePrice AND IsCashDiscount=1 AND InvoicePrice=SellingPrice AND RebatePerTon=0 AND RequiresManagerApproval=0)
      OR (SellingPrice<BasePrice AND IsCashDiscount=0 AND InvoicePrice=BasePrice AND RebatePerTon=BasePrice-SellingPrice
        AND RebatePerTon<=MaxLimitPerTon
        AND ((RebatePerTon<=StandardLimitPerTon AND RequiresManagerApproval=0) OR (RebatePerTon>StandardLimitPerTon AND RequiresManagerApproval=1)))
      OR (SellingPrice>=BasePrice AND InvoicePrice=SellingPrice AND RequiresManagerApproval=0
        AND RebatePerTon=CASE WHEN SellingPrice-BasePrice>StandardLimitPerTon THEN StandardLimitPerTon ELSE SellingPrice-BasePrice END))
    AND ((RequiresManagerApproval=1 AND ApprovalEvidenceId IS NOT NULL) OR
         (RequiresManagerApproval=0 AND ApprovalEvidenceId IS NULL)));
GO
-- Accrual: lift only the fixed 300 ceiling; every other condition is the one migration 207 wrote.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('wf.RebateShipmentAccrual')
           AND name = 'CK_RebateShipmentAccrual_PoolValues' AND definition LIKE '%<=(300)%')
    ALTER TABLE wf.RebateShipmentAccrual DROP CONSTRAINT CK_RebateShipmentAccrual_PoolValues;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('wf.RebateShipmentAccrual')
               AND name = 'CK_RebateShipmentAccrual_PoolValues')
    ALTER TABLE wf.RebateShipmentAccrual WITH CHECK ADD CONSTRAINT CK_RebateShipmentAccrual_PoolValues CHECK
   (Generation>0 AND EvidenceId>0 AND SourceSOID>0 AND SourceListNo>0 AND CouponId>0 AND GoodId>0 AND CustId>0
    AND PlanId IS NULL AND BookingSOID IS NOT NULL AND BookingSOID>0 AND BookingLineNo IS NOT NULL AND BookingLineNo>0
    AND QuantityTon>0 AND ListPricePerTon>0 AND NetPricePerTon>=0 AND RebatePerTon>0 AND RebatePerTon<=1500
    AND AmountBaht>0 AND AmountBaht=CAST(ROUND(QuantityTon*RebatePerTon,2) AS decimal(18,2)));
GO
