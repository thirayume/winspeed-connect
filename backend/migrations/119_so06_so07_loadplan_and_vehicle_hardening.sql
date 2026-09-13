-- Migration 119: Load Plan State Machine, Revision Tracking, Acknowledgements, and Authoritative Vehicle Linkage
-- Addresses SO-06/07 Corrections: Transactional Load Plan command, Sale Confirmation & Warehouse Acknowledgement

-- 1. Add Load Plan and Vehicle Linkage Columns to wf.SalesTrip
IF COL_LENGTH('wf.SalesTrip', 'LoadPlanStatus') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD LoadPlanStatus VARCHAR(30) NOT NULL CONSTRAINT DF_SalesTrip_LoadPlanStatus_119 DEFAULT 'DRAFT';
END
GO

IF COL_LENGTH('wf.SalesTrip', 'LoadPlanRevision') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD LoadPlanRevision INT NOT NULL CONSTRAINT DF_SalesTrip_LoadPlanRevision_119 DEFAULT 1;
END
GO

IF COL_LENGTH('wf.SalesTrip', 'SaleConfirmedAt') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD SaleConfirmedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('wf.SalesTrip', 'SaleConfirmedBy') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD SaleConfirmedBy INT NULL;
END
GO

IF COL_LENGTH('wf.SalesTrip', 'WarehouseAckAt') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD WarehouseAckAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('wf.SalesTrip', 'WarehouseAckBy') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD WarehouseAckBy INT NULL;
END
GO

IF COL_LENGTH('wf.SalesTrip', 'LoadPlanSnapshot') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD LoadPlanSnapshot NVARCHAR(MAX) NULL;
END
GO

IF COL_LENGTH('wf.SalesTrip', 'TruckTypeId') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD TruckTypeId NVARCHAR(50) NULL;
END
GO

-- 2. Ensure LoadSequence, MasterQty, ChildQty in wf.SalesOrderLine (for draft SOs)
IF COL_LENGTH('wf.SalesOrderLine', 'LoadSequence') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrderLine ADD LoadSequence INT NULL;
END
GO

IF COL_LENGTH('wf.SalesOrderLine', 'MasterQty') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrderLine ADD MasterQty DECIMAL(12,3) NULL;
END
GO

IF COL_LENGTH('wf.SalesOrderLine', 'ChildQty') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrderLine ADD ChildQty DECIMAL(12,3) NULL;
END
GO

-- 3. Ensure LoadSequence, MasterQty, ChildQty in wf.SalesOrderLineExt (for confirmed SOs)
IF COL_LENGTH('wf.SalesOrderLineExt', 'LoadSequence') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrderLineExt ADD LoadSequence INT NULL;
END
GO

IF COL_LENGTH('wf.SalesOrderLineExt', 'MasterQty') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrderLineExt ADD MasterQty DECIMAL(12,3) NULL;
END
GO

IF COL_LENGTH('wf.SalesOrderLineExt', 'ChildQty') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrderLineExt ADD ChildQty DECIMAL(12,3) NULL;
END
GO
