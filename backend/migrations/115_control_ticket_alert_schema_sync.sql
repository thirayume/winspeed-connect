-- Migration 115: Sync ControlTicketAlert schema with SO-04 deduplication lifecycle
-- Adds DocuNo, AlertType, LeadDays, AlertDate, ExpiryDate, Status, DedupHash, CreatedAt, ResolvedAt to existing wf.ControlTicketAlert

IF COL_LENGTH('wf.ControlTicketAlert', 'DocuNo') IS NULL
BEGIN
    ALTER TABLE wf.ControlTicketAlert ADD
        DocuNo NVARCHAR(50) NULL,
        AlertType VARCHAR(30) NULL,
        LeadDays INT NOT NULL DEFAULT 0,
        AlertDate DATE NULL,
        ExpiryDate DATE NULL,
        Status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        DedupHash VARCHAR(64) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        ResolvedAt DATETIME2 NULL;
END
GO

-- Backfill from legacy columns if present
UPDATE wf.ControlTicketAlert
SET DocuNo = ISNULL(DocuNo, CouponNo),
    AlertType = ISNULL(AlertType, AlertKind),
    AlertDate = ISNULL(AlertDate, CAST(AlertedAt AS DATE))
WHERE DocuNo IS NULL AND CouponNo IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wf_ControlTicketAlert_DocuNo' AND object_id = OBJECT_ID('wf.ControlTicketAlert'))
BEGIN
    CREATE INDEX IX_wf_ControlTicketAlert_DocuNo ON wf.ControlTicketAlert(DocuNo);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wf_ControlTicketAlert_Status' AND object_id = OBJECT_ID('wf.ControlTicketAlert'))
BEGIN
    CREATE INDEX IX_wf_ControlTicketAlert_Status ON wf.ControlTicketAlert(Status, AlertType);
END
GO
