-- 044_winspeed_native_quotation_link.sql
-- Link app quotations to the actual WINSpeed Sale Quotation flow:
--   dbo.SOHD/SODT DocuType=102 = Quotation (QU...)
--   dbo.SOHD/SODT DocuType=113 = Confirm Quotation (QC...) referencing QU by RefNo.
-- Migration 043 is retained as legacy because some restored DBs may already have it.

IF COL_LENGTH('wf.Quotation', 'WinspeedQuoteSOID') IS NULL
BEGIN
  ALTER TABLE wf.Quotation ADD WinspeedQuoteSOID INT NULL;
END
GO

IF COL_LENGTH('wf.Quotation', 'WinspeedQuoteNo') IS NULL
BEGIN
  ALTER TABLE wf.Quotation ADD WinspeedQuoteNo NVARCHAR(30) NULL;
END
GO

IF COL_LENGTH('wf.Quotation', 'WinspeedQuoteSyncedAt') IS NULL
BEGIN
  ALTER TABLE wf.Quotation ADD WinspeedQuoteSyncedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('wf.Quotation', 'WinspeedConfirmSOID') IS NULL
BEGIN
  ALTER TABLE wf.Quotation ADD WinspeedConfirmSOID INT NULL;
END
GO

IF COL_LENGTH('wf.Quotation', 'WinspeedConfirmNo') IS NULL
BEGIN
  ALTER TABLE wf.Quotation ADD WinspeedConfirmNo NVARCHAR(30) NULL;
END
GO

IF COL_LENGTH('wf.Quotation', 'WinspeedConfirmSyncedAt') IS NULL
BEGIN
  ALTER TABLE wf.Quotation ADD WinspeedConfirmSyncedAt DATETIME2 NULL;
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_Quotation_WinspeedQuoteSOID'
    AND object_id = OBJECT_ID('wf.Quotation')
)
BEGIN
  CREATE UNIQUE INDEX UX_Quotation_WinspeedQuoteSOID
    ON wf.Quotation (WinspeedQuoteSOID)
    WHERE WinspeedQuoteSOID IS NOT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_Quotation_WinspeedConfirmSOID'
    AND object_id = OBJECT_ID('wf.Quotation')
)
BEGIN
  CREATE UNIQUE INDEX UX_Quotation_WinspeedConfirmSOID
    ON wf.Quotation (WinspeedConfirmSOID)
    WHERE WinspeedConfirmSOID IS NOT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_Quotation_WinspeedQuoteNo'
    AND object_id = OBJECT_ID('wf.Quotation')
)
BEGIN
  CREATE INDEX IX_Quotation_WinspeedQuoteNo
    ON wf.Quotation (WinspeedQuoteNo)
    WHERE WinspeedQuoteNo IS NOT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_Quotation_WinspeedConfirmNo'
    AND object_id = OBJECT_ID('wf.Quotation')
)
BEGIN
  CREATE INDEX IX_Quotation_WinspeedConfirmNo
    ON wf.Quotation (WinspeedConfirmNo)
    WHERE WinspeedConfirmNo IS NOT NULL;
END
GO

IF OBJECT_ID('dbo.SOHD', 'U') IS NOT NULL
AND NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_SOHD_Quotation_DocuNo'
    AND object_id = OBJECT_ID('dbo.SOHD')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_SOHD_Quotation_DocuNo
    ON dbo.SOHD (DocuType, DocuNo)
    INCLUDE (SOID, DocuDate, CustID, AppvFlag, DocuStatus, RefNo, FromFlag);
END
GO

IF OBJECT_ID('dbo.SOHD', 'U') IS NOT NULL
AND NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_SOHD_ConfirmQuotation_RefNo'
    AND object_id = OBJECT_ID('dbo.SOHD')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_SOHD_ConfirmQuotation_RefNo
    ON dbo.SOHD (DocuType, RefNo)
    INCLUDE (SOID, DocuNo, DocuDate, AppvFlag, DocuStatus, FromFlag);
END
GO
