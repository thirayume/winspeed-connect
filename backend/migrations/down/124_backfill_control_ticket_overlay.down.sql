-- Down-Migration 124: Revert Backfill & Drop Unique Filtered Index
-- Target: dbo / wf schema in WINSpeed DB

-- 1. Drop filtered unique index if exists
SET XACT_ABORT ON;
IF EXISTS (
    SELECT 1 FROM sys.indexes 
    WHERE name = 'UQ_ControlTicketOverlay_DocuId' AND object_id = OBJECT_ID('wf.ControlTicketOverlay')
)
BEGIN
    DROP INDEX UQ_ControlTicketOverlay_DocuId ON wf.ControlTicketOverlay;
END
GO

-- 2. Restore table state from backup if backup table exists
SET XACT_ABORT ON;
IF OBJECT_ID('wf.ControlTicketOverlay_Pre124Backup', 'U') IS NOT NULL
BEGIN
    -- Delete all current rows
    DELETE FROM wf.ControlTicketOverlay;

    -- Re-insert from backup with IDENTITY_INSERT
    SET IDENTITY_INSERT wf.ControlTicketOverlay ON;
    INSERT INTO wf.ControlTicketOverlay (
        Id, DocuNo, DocuType, DocuId, GoodCode,
        ExpiryDate, ExpiryType, PolicySnapshotId, StrictOverrideFlag,
        ReasonCode, ReasonText, CreatedBy, CreatedAt, UpdatedAt
    )
    SELECT 
        Id, DocuNo, DocuType, DocuId, GoodCode,
        ExpiryDate, ExpiryType, PolicySnapshotId, StrictOverrideFlag,
        ReasonCode, ReasonText, CreatedBy, CreatedAt, UpdatedAt
    FROM wf.ControlTicketOverlay_Pre124Backup;
    SET IDENTITY_INSERT wf.ControlTicketOverlay OFF;

    -- Drop backup table
    DROP TABLE wf.ControlTicketOverlay_Pre124Backup;
END
GO

-- 3. Remove ledger entry so runner can re-apply cleanly
SET XACT_ABORT ON;
DELETE FROM wf.SchemaMigration WHERE FileName = '124_backfill_control_ticket_overlay.sql';
GO
