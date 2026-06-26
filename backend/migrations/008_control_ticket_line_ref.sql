-- Migration 008: Add Control Ticket tracking to SalesOrderLine
-- This allows line items to be offset/deducted from an existing Control Ticket (AI).

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID('wf.SalesOrderLine') 
    AND name = 'RefControlTicketNo'
)
BEGIN
    ALTER TABLE wf.SalesOrderLine ADD RefControlTicketNo NVARCHAR(30) NULL;
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID('wf.SalesOrderLine') 
    AND name = 'IsControlTicketDrawn'
)
BEGIN
    ALTER TABLE wf.SalesOrderLine ADD IsControlTicketDrawn BIT NOT NULL DEFAULT 0;
END
GO
