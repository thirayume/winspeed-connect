-- Rollback of 258: removes the Rebate ticket line flag and the receipt state table. Refuses while a draft ticket line
-- or a receipt state exists (rolling back would lose which tickets a bill holds).
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF COL_LENGTH('wf.SalesOrderLine','IsRebateTicket') IS NOT NULL
 AND EXISTS (SELECT 1 FROM wf.SalesOrderLine WHERE IsRebateTicket=1)
 RAISERROR('ROLLBACK_258_BLOCKED: draft Rebate ticket lines exist',16,1);
GO
IF OBJECT_ID('wf.RebateTicketReceiptState','U') IS NOT NULL
 AND EXISTS (SELECT 1 FROM wf.RebateTicketReceiptState)
 RAISERROR('ROLLBACK_258_BLOCKED: Rebate ticket receipt states exist',16,1);
GO
IF OBJECT_ID('wf.RebateTicketReceiptState','U') IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM wf.RebateTicketReceiptState)
 DROP TABLE wf.RebateTicketReceiptState;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_SalesOrderLine_RebateTicket' AND parent_object_id=OBJECT_ID('wf.SalesOrderLine'))
 AND NOT EXISTS (SELECT 1 FROM wf.SalesOrderLine WHERE IsRebateTicket=1)
 ALTER TABLE wf.SalesOrderLine DROP CONSTRAINT CK_SalesOrderLine_RebateTicket;
GO
IF COL_LENGTH('wf.SalesOrderLine','IsRebateTicket') IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM wf.SalesOrderLine WHERE IsRebateTicket=1)
BEGIN
 ALTER TABLE wf.SalesOrderLine DROP CONSTRAINT DF_SalesOrderLine_IsRebateTicket;
 EXEC sp_executesql N'ALTER TABLE wf.SalesOrderLine DROP COLUMN IsRebateTicket';
END
GO
