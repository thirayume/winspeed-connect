-- 101_salestrip_and_rebate_ratio.sql
-- Create wf.SalesTrip table for grouping SalesOrders
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[SalesTrip]') AND type in (N'U'))
BEGIN
    CREATE TABLE [wf].[SalesTrip] (
        [TripId] INT IDENTITY(1,1) NOT NULL,
        [TripCode] VARCHAR(50) NOT NULL,
        [TransRegistration] VARCHAR(50) NULL,
        [DriverName] VARCHAR(100) NULL,
        [TruckCapacityTon] DECIMAL(18,2) NULL,
        [Status] VARCHAR(50) NOT NULL DEFAULT 'DRAFT', -- DRAFT, ACTIVE, SHIPPED, CLOSED
        [CreatedAt] DATETIME NOT NULL DEFAULT GETDATE(),
        [CreatedBy] INT NOT NULL,
        CONSTRAINT [PK_SalesTrip] PRIMARY KEY CLUSTERED ([TripId] ASC)
    );
END
GO

-- Add TripId to wf.SalesOrder
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[SalesOrder]') AND name = 'TripId')
BEGIN
    ALTER TABLE [wf].[SalesOrder] ADD [TripId] INT NULL;
    ALTER TABLE [wf].[SalesOrder] ADD CONSTRAINT [FK_SalesOrder_SalesTrip] FOREIGN KEY ([TripId]) REFERENCES [wf].[SalesTrip]([TripId]);
END
GO

-- Add Rebate Ratio Fields to wf.RebateClaim
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[RebateClaim]') AND name = 'CustomerRatio')
BEGIN
    ALTER TABLE [wf].[RebateClaim] ADD [CustomerRatio] DECIMAL(5,2) NULL DEFAULT 100.00;
    ALTER TABLE [wf].[RebateClaim] ADD [CompanyRatio] DECIMAL(5,2) NULL DEFAULT 0.00;
    ALTER TABLE [wf].[RebateClaim] ADD [CustomerAmount] DECIMAL(18,2) NULL;
    ALTER TABLE [wf].[RebateClaim] ADD [RetainedAmount] DECIMAL(18,2) NULL;
    ALTER TABLE [wf].[RebateClaim] ADD [IsSelfClaim] BIT NOT NULL DEFAULT 0;
END
GO
