-- @transaction
-- Convert the still-empty prototype shipment ledger to the confirmed Rebate
-- Pool price snapshot contract. Never reinterpret previously written rows.
IF OBJECT_ID('wf.RebateShipmentAccrual','U') IS NULL OR OBJECT_ID('wf.RebateBookingPriceSnapshot','U') IS NULL
BEGIN RAISERROR('Rebate shipment and booking snapshot migrations are required',16,1); RETURN; END;
IF (COL_LENGTH('wf.RebateShipmentAccrual','BookingSOID') IS NULL AND COL_LENGTH('wf.RebateShipmentAccrual','BookingLineNo') IS NOT NULL)
 OR (COL_LENGTH('wf.RebateShipmentAccrual','BookingSOID') IS NOT NULL AND COL_LENGTH('wf.RebateShipmentAccrual','BookingLineNo') IS NULL)
BEGIN RAISERROR('Partial shipment snapshot schema',16,1); RETURN; END;
IF COL_LENGTH('wf.RebateShipmentAccrual','BookingSOID') IS NULL
BEGIN
 IF EXISTS(SELECT 1 FROM wf.RebateShipmentAccrual)
 BEGIN RAISERROR('Existing shipment accrual requires explicit reconciliation',16,1); RETURN; END;
 IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.RebateShipmentAccrual') AND name='CK_RebateShipmentAccrual_Values')
 BEGIN RAISERROR('Original shipment constraint missing',16,1); RETURN; END;
 ALTER TABLE wf.RebateShipmentAccrual DROP CONSTRAINT CK_RebateShipmentAccrual_Values;
 ALTER TABLE wf.RebateShipmentAccrual ALTER COLUMN PlanId int NULL;
 ALTER TABLE wf.RebateShipmentAccrual ADD BookingSOID int NULL, BookingLineNo int NULL;
END;
GO
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.RebateShipmentAccrual') AND name='CK_RebateShipmentAccrual_PoolValues')
 ALTER TABLE wf.RebateShipmentAccrual WITH CHECK ADD CONSTRAINT CK_RebateShipmentAccrual_PoolValues CHECK
   (Generation>0 AND EvidenceId>0 AND SourceSOID>0 AND SourceListNo>0 AND CouponId>0 AND GoodId>0 AND CustId>0
    AND PlanId IS NULL AND BookingSOID IS NOT NULL AND BookingSOID>0 AND BookingLineNo IS NOT NULL AND BookingLineNo>0
    AND QuantityTon>0 AND ListPricePerTon>0 AND NetPricePerTon>=0 AND RebatePerTon>0 AND RebatePerTon<=300
    AND AmountBaht>0 AND AmountBaht=CAST(ROUND(QuantityTon*RebatePerTon,2) AS decimal(18,2)));
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('wf.RebateShipmentAccrual') AND name='FK_RebateShipmentAccrual_BookingSnapshot')
 ALTER TABLE wf.RebateShipmentAccrual WITH CHECK ADD CONSTRAINT FK_RebateShipmentAccrual_BookingSnapshot
 FOREIGN KEY(BookingSOID,BookingLineNo) REFERENCES wf.RebateBookingPriceSnapshot(BookingSOID,[LineNo]);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.RebateShipmentAccrual') AND name='IX_RebateShipmentAccrual_Booking')
 CREATE INDEX IX_RebateShipmentAccrual_Booking ON wf.RebateShipmentAccrual(EnvironmentKind,ResetId,BookingSOID,BookingLineNo)
 INCLUDE(SourceSOID,SourceListNo,QuantityTon);
GO
IF OBJECT_ID('wf.trg_RebateShipmentAccrual_PoolSnapshot','TR') IS NULL
 EXEC('CREATE TRIGGER wf.trg_RebateShipmentAccrual_PoolSnapshot ON wf.RebateShipmentAccrual AFTER INSERT AS BEGIN SET NOCOUNT ON; END');
GO
ALTER TRIGGER wf.trg_RebateShipmentAccrual_PoolSnapshot ON wf.RebateShipmentAccrual AFTER INSERT
AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i
   LEFT JOIN wf.RebateBookingPriceSnapshot s ON s.BookingSOID=i.BookingSOID AND s.[LineNo]=i.BookingLineNo
   LEFT JOIN dbo.SODT d ON d.SOID=i.SourceSOID AND d.ListNo=i.SourceListNo AND d.DocuType=104
   LEFT JOIN dbo.SOHD dh ON dh.SOID=d.SOID AND dh.DocuType=104
   LEFT JOIN dbo.SOHD bh ON bh.SOID=s.BookingSOID AND bh.DocuType=103
   LEFT JOIN dbo.SODT bd ON bd.SOID=bh.SOID AND bd.ListNo=s.[LineNo] AND bd.DocuType=103
   WHERE s.BookingSOID IS NULL OR d.SOID IS NULL OR dh.SOID IS NULL OR bh.SOID IS NULL OR bd.SOID IS NULL
     OR d.RefSOID<>s.BookingSOID OR d.RefSOID IS NULL OR d.RefListNo<>s.[LineNo] OR d.RefListNo IS NULL
     OR d.GoodID IS NULL OR d.GoodID<>s.GoodId OR bd.GoodID IS NULL OR bd.GoodID<>s.GoodId OR i.GoodId<>s.GoodId
     OR dh.CustID IS NULL OR dh.CustID<>i.CustId OR bh.CustID IS NULL OR bh.CustID<>i.CustId
     OR bh.DocuDate IS NULL OR CAST(bh.DocuDate AS date)<>s.SaleDate OR RTRIM(ISNULL(bh.DocuStatus,'')) NOT IN ('N','Y')
     OR i.ListPricePerTon<>s.BasePrice OR i.NetPricePerTon<>s.SellingPrice OR i.RebatePerTon<>s.RebatePerTon
     OR d.GoodPrice2 IS NULL OR d.GoodPrice2<>s.InvoicePrice OR bd.GoodPrice2 IS NULL OR bd.GoodPrice2<>s.InvoicePrice
     OR d.GoodQty2 IS NULL OR bd.GoodQty2 IS NULL OR d.GoodQty2>bd.GoodQty2 OR bd.GoodQty2<>s.QuantityTon
     OR d.GoodUnitID2 IS NULL OR bd.GoodUnitID2 IS NULL OR d.GoodUnitID2<>bd.GoodUnitID2 OR i.QuantityTon>d.GoodQty2)
  RAISERROR('Shipment accrual does not match booking price snapshot',16,1);
END;
GO
