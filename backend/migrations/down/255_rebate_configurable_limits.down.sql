-- Rollback of 255: restore the fixed 200/300 constraints of migrations 205 and 207 and drop the stored limits.
-- Refused when a stored booking price was judged by other limits or an accrual is above 300 baht/ton,
-- because the old constraints could not hold those rows.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
-- Dynamic SQL: once the columns are gone a rerun must still compile.
IF COL_LENGTH('wf.RebateBookingPriceSnapshot', 'StandardLimitPerTon') IS NOT NULL
    EXEC sp_executesql N'IF EXISTS (SELECT 1 FROM wf.RebateBookingPriceSnapshot WHERE StandardLimitPerTon<>200 OR MaxLimitPerTon<>300)
    RAISERROR(''RCL_ROLLBACK_REFUSED: booking prices judged by limits other than 200/300 exist'', 16, 1);';
IF EXISTS (SELECT 1 FROM wf.RebateShipmentAccrual WHERE RebatePerTon>300)
    RAISERROR('RCL_ROLLBACK_REFUSED: accruals above 300 baht/ton exist', 16, 1);
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('wf.RebateShipmentAccrual')
           AND name = 'CK_RebateShipmentAccrual_PoolValues' AND definition LIKE '%<=(1500)%')
    ALTER TABLE wf.RebateShipmentAccrual DROP CONSTRAINT CK_RebateShipmentAccrual_PoolValues;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('wf.RebateShipmentAccrual')
               AND name = 'CK_RebateShipmentAccrual_PoolValues')
    ALTER TABLE wf.RebateShipmentAccrual WITH CHECK ADD CONSTRAINT CK_RebateShipmentAccrual_PoolValues CHECK
   (Generation>0 AND EvidenceId>0 AND SourceSOID>0 AND SourceListNo>0 AND CouponId>0 AND GoodId>0 AND CustId>0
    AND PlanId IS NULL AND BookingSOID IS NOT NULL AND BookingSOID>0 AND BookingLineNo IS NOT NULL AND BookingLineNo>0
    AND QuantityTon>0 AND ListPricePerTon>0 AND NetPricePerTon>=0 AND RebatePerTon>0 AND RebatePerTon<=300
    AND AmountBaht>0 AND AmountBaht=CAST(ROUND(QuantityTon*RebatePerTon,2) AS decimal(18,2)));
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('wf.RebateBookingPriceSnapshot')
           AND name = 'CK_RebateBookingPriceSnapshot_LimitValues')
    ALTER TABLE wf.RebateBookingPriceSnapshot DROP CONSTRAINT CK_RebateBookingPriceSnapshot_LimitValues;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('wf.RebateBookingPriceSnapshot')
               AND name = 'CK_RebateBookingPriceSnapshot_Values')
    ALTER TABLE wf.RebateBookingPriceSnapshot WITH CHECK ADD CONSTRAINT CK_RebateBookingPriceSnapshot_Values CHECK
   (BookingSOID>0 AND [LineNo]>0 AND DraftId>0 AND DocumentRevision>0 AND GoodId>0
    AND SetPriceId>0 AND SetPriceListNo>0 AND BasePrice>0 AND SellingPrice>=0 AND InvoicePrice>=0
    AND QuantityTon>0 AND RebatePerTon>=0 AND TotalRebate>=0 AND PriceBegin<=SaleDate
    AND (PriceEnd IS NULL OR PriceEnd>=SaleDate)
    AND TotalRebate=CAST(ROUND(QuantityTon*RebatePerTon,2) AS decimal(18,2))
    AND ((SellingPrice<BasePrice AND IsCashDiscount=1 AND InvoicePrice=SellingPrice AND RebatePerTon=0 AND RequiresManagerApproval=0)
      OR (SellingPrice<BasePrice AND IsCashDiscount=0 AND InvoicePrice=BasePrice AND RebatePerTon=BasePrice-SellingPrice
        AND RebatePerTon<=300 AND ((RebatePerTon<=200 AND RequiresManagerApproval=0) OR (RebatePerTon>200 AND RequiresManagerApproval=1)))
      OR (SellingPrice>=BasePrice AND InvoicePrice=SellingPrice AND RequiresManagerApproval=0
        AND RebatePerTon=CASE WHEN SellingPrice-BasePrice>200 THEN 200 ELSE SellingPrice-BasePrice END))
    AND ((RequiresManagerApproval=1 AND ApprovalEvidenceId IS NOT NULL) OR
         (RequiresManagerApproval=0 AND ApprovalEvidenceId IS NULL)));
GO
IF COL_LENGTH('wf.RebateBookingPriceSnapshot', 'MaxLimitPerTon') IS NOT NULL
    ALTER TABLE wf.RebateBookingPriceSnapshot DROP COLUMN MaxLimitPerTon;
IF COL_LENGTH('wf.RebateBookingPriceSnapshot', 'StandardLimitPerTon') IS NOT NULL
    ALTER TABLE wf.RebateBookingPriceSnapshot DROP COLUMN StandardLimitPerTon;
GO
