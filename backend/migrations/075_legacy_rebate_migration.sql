-- =============================================================
-- 075_legacy_rebate_migration.sql
-- Allow SoId in wf.RebateLedger to be NULL to support legacy 
-- coupons from WINSpeed which don't have an App SalesOrder.
-- Seed a baseline wf.RebatePlan for legacy coupons.
-- =============================================================

-- 1. Drop FK constraint on SoId (if it exists)
DECLARE @fk_name NVARCHAR(200);
SELECT @fk_name = obj.name
FROM sys.foreign_key_columns fkc
JOIN sys.objects obj ON obj.object_id = fkc.constraint_object_id
JOIN sys.columns col ON col.object_id = fkc.parent_object_id AND col.column_id = fkc.parent_column_id
WHERE fkc.parent_object_id = OBJECT_ID('wf.RebateLedger') AND col.name = 'SoId';

IF @fk_name IS NOT NULL
BEGIN
    EXEC('ALTER TABLE wf.RebateLedger DROP CONSTRAINT ' + @fk_name);
END
GO

-- 2. Drop index on SoId (if it exists)
IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RebateLedger_SoId' AND object_id = OBJECT_ID('wf.RebateLedger'))
BEGIN
    DROP INDEX IX_RebateLedger_SoId ON wf.RebateLedger;
END
GO

-- 3. Alter column to allow NULL
IF COL_LENGTH('wf.RebateLedger','SoId') IS NOT NULL
BEGIN
    ALTER TABLE wf.RebateLedger ALTER COLUMN SoId INT NULL;
END
GO

-- 4. Recreate FK constraint on SoId (if it doesn't exist)
IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('wf.RebateLedger') AND name = 'FK_RebateLedger_SalesOrder')
BEGIN
    ALTER TABLE wf.RebateLedger ADD CONSTRAINT FK_RebateLedger_SalesOrder FOREIGN KEY (SoId) REFERENCES wf.SalesOrder(Id);
END
GO

-- 5. Recreate Index on SoId
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RebateLedger_SoId' AND object_id = OBJECT_ID('wf.RebateLedger'))
BEGIN
    CREATE INDEX IX_RebateLedger_SoId ON wf.RebateLedger(SoId);
END
GO

-- 6. Create a baseline wf.RebatePlan for LEGACY-WS-COUPON
IF NOT EXISTS (SELECT 1 FROM wf.RebatePlan WHERE PlanNo = 'LEGACY-WS-COUPON')
BEGIN
    INSERT INTO wf.RebatePlan (PlanNo, Title, Region, ReturnType, Priority, Status, CreatedAt)
    VALUES ('LEGACY-WS-COUPON', N'ยอดสะสมจากระบบ WINSpeed เดิม', 'ALL', 'REBATE', 1, 'ACTIVE', GETUTCDATE());
END
GO

PRINT '✓ WF migration 075 complete (Legacy Rebate Plan & Ledger Schema Update)'
GO
