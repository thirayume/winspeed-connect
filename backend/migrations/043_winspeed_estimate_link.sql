-- 043_winspeed_estimate_link.sql
-- Link app quotations to native WINSpeed Estimate/Quotation documents.
-- Native document rows are written to dbo.SCEstimate, dbo.SCEstimatePart,
-- and dbo.SCEstimateRemark by the quotation API after structure validation.

IF COL_LENGTH('wf.Quotation', 'WinspeedEstimateID') IS NULL
BEGIN
  ALTER TABLE wf.Quotation ADD WinspeedEstimateID INT NULL;
END
GO

IF COL_LENGTH('wf.Quotation', 'WinspeedEstimateNo') IS NULL
BEGIN
  ALTER TABLE wf.Quotation ADD WinspeedEstimateNo NVARCHAR(25) NULL;
END
GO

IF COL_LENGTH('wf.Quotation', 'WinspeedEstimateSyncedAt') IS NULL
BEGIN
  ALTER TABLE wf.Quotation ADD WinspeedEstimateSyncedAt DATETIME2 NULL;
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_Quotation_WinspeedEstimateID'
    AND object_id = OBJECT_ID('wf.Quotation')
)
BEGIN
  CREATE UNIQUE INDEX UX_Quotation_WinspeedEstimateID
    ON wf.Quotation (WinspeedEstimateID)
    WHERE WinspeedEstimateID IS NOT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_Quotation_WinspeedEstimateNo'
    AND object_id = OBJECT_ID('wf.Quotation')
)
BEGIN
  CREATE INDEX IX_Quotation_WinspeedEstimateNo
    ON wf.Quotation (WinspeedEstimateNo)
    WHERE WinspeedEstimateNo IS NOT NULL;
END
GO
