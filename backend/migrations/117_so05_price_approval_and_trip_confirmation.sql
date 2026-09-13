-- Migration 117: Price Approval Table, SalesOrder Price Approval Columns, and SalesTrip Residual Split Columns
-- Enables SO-05 Atomic Trip Selection/Confirmation and Authoritative Below-Announced Price Approvals

-- 1. Create wf.PriceApproval Table
IF OBJECT_ID('wf.PriceApproval', 'U') IS NULL
BEGIN
    CREATE TABLE wf.PriceApproval (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        SoId INT NOT NULL,
        WfRef NVARCHAR(30) NULL,
        DocuNo NVARCHAR(50) NULL,
        CustId NVARCHAR(20) NOT NULL,
        CustName NVARCHAR(200) NULL,
        GoodId NVARCHAR(50) NOT NULL,
        GoodCode NVARCHAR(50) NOT NULL,
        GoodName NVARCHAR(200) NULL,
        QtyTon DECIMAL(12,3) NOT NULL,
        AnnouncedPrice DECIMAL(12,2) NOT NULL,
        RequestedPrice DECIMAL(12,2) NOT NULL,
        PriceDeviationPerTon DECIMAL(12,2) NOT NULL,
        TotalDeviationAmt DECIMAL(14,2) NOT NULL,
        PriceSource VARCHAR(50) NOT NULL DEFAULT 'EMSetPrice',
        DocumentRevision INT NOT NULL DEFAULT 1,
        Status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, SUPERSEDED
        RequestedBy INT NOT NULL,
        ReasonText NVARCHAR(500) NULL,
        ApprovedBy INT NULL,
        ApprovedAt DATETIME2 NULL,
        ApprovalNote NVARCHAR(500) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_wf_PriceApproval_SoId ON wf.PriceApproval(SoId);
    CREATE INDEX IX_wf_PriceApproval_Status ON wf.PriceApproval(Status);
    CREATE INDEX IX_wf_PriceApproval_CustId ON wf.PriceApproval(CustId);
END
GO

-- 2. Add Price Approval Columns to wf.SalesOrder
IF COL_LENGTH('wf.SalesOrder', 'RequiresPriceApproval') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrder ADD RequiresPriceApproval BIT NOT NULL DEFAULT 0;
END
GO

IF COL_LENGTH('wf.SalesOrder', 'PriceApprovalStatus') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrder ADD PriceApprovalStatus VARCHAR(20) NOT NULL DEFAULT 'NONE';
END
GO

-- 3. Add Residual Split and Idempotency Columns to wf.SalesTrip
IF COL_LENGTH('wf.SalesTrip', 'ParentTripId') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD ParentTripId INT NULL;
END
GO

IF COL_LENGTH('wf.SalesTrip', 'IsResidual') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD IsResidual BIT NOT NULL DEFAULT 0;
END
GO

IF COL_LENGTH('wf.SalesTrip', 'ConfirmedAt') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD ConfirmedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('wf.SalesTrip', 'IdempotencyKey') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD IdempotencyKey VARCHAR(100) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wf_SalesTrip_IdempotencyKey' AND object_id = OBJECT_ID('wf.SalesTrip'))
BEGIN
    CREATE INDEX IX_wf_SalesTrip_IdempotencyKey ON wf.SalesTrip(IdempotencyKey) WHERE IdempotencyKey IS NOT NULL;
END
GO
