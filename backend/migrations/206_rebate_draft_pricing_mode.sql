-- @transaction
-- NULL means an existing or not-yet-classified draft; do not infer a mode.
-- The value belongs to the draft and must be carried into an immutable 103
-- snapshot before wf.sp_ConfirmSalesOrder deletes the draft lines.
IF COL_LENGTH('wf.SalesOrderLine','RebatePricingMode') IS NULL
 ALTER TABLE wf.SalesOrderLine ADD RebatePricingMode varchar(8) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_SalesOrderLine_RebatePricingMode' AND parent_object_id=OBJECT_ID('wf.SalesOrderLine'))
 ALTER TABLE wf.SalesOrderLine WITH CHECK ADD CONSTRAINT CK_SalesOrderLine_RebatePricingMode
 CHECK (RebatePricingMode IS NULL OR RebatePricingMode IN ('POOL','CASH'));
GO
