-- ============================================================================
-- 177_customer_salesperson_and_regions.sql
-- Customer salesperson mapping (SalespersonUserId, SalespersonName, RegionCode)
-- Sale region schema extensions (IsActive, Description)
--
-- SQL 2008 R2 compatible, fully idempotent, wf schema additions only.
-- ============================================================================

-- ── 1. Enhance wf.CustomerExt with salesperson and area/region fields ───────
IF COL_LENGTH('wf.CustomerExt', 'SalespersonUserId') IS NULL
    ALTER TABLE wf.CustomerExt ADD SalespersonUserId INT NULL;
GO

IF COL_LENGTH('wf.CustomerExt', 'SalespersonName') IS NULL
    ALTER TABLE wf.CustomerExt ADD SalespersonName NVARCHAR(100) NULL;
GO

IF COL_LENGTH('wf.CustomerExt', 'RegionCode') IS NULL
    ALTER TABLE wf.CustomerExt ADD RegionCode NVARCHAR(10) NULL;
GO

IF COL_LENGTH('wf.CustomerExt', 'SaleAreaId') IS NULL
    ALTER TABLE wf.CustomerExt ADD SaleAreaId VARCHAR(20) NULL;
GO

IF COL_LENGTH('wf.CustomerExt', 'CustGroupId') IS NULL
    ALTER TABLE wf.CustomerExt ADD CustGroupId VARCHAR(20) NULL;
GO

-- ── 2. Enhance wf.SaleRegion with IsActive and Description ───────────────────
IF COL_LENGTH('wf.SaleRegion', 'IsActive') IS NULL
    ALTER TABLE wf.SaleRegion ADD IsActive BIT NOT NULL CONSTRAINT DF_SaleRegion_IsActive DEFAULT 1;
GO

IF COL_LENGTH('wf.SaleRegion', 'Description') IS NULL
    ALTER TABLE wf.SaleRegion ADD Description NVARCHAR(255) NULL;
GO

-- ── 3. Index on wf.CustomerExt for salesperson and region queries ───────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CustomerExt_Salesperson' AND object_id = OBJECT_ID('wf.CustomerExt'))
    CREATE NONCLUSTERED INDEX IX_CustomerExt_Salesperson ON wf.CustomerExt (SalespersonUserId, RegionCode);
GO

PRINT '✓ WF migration 177 complete (Customer salesperson mapping & SaleRegion extensions)';
GO
