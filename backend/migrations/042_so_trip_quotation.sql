-- 042_so_trip_quotation.sql
-- Link one quotation to one or more draft SOs from a Sale Trip.
-- SO stays in wf.SalesOrder as DRAFT until the quotation is accepted.
-- Do not FK SoId to wf.SalesOrder: wf.sp_ConfirmSalesOrder moves the
-- draft to WINSpeed dbo.SOHD/SODT and deletes the wf draft row.

IF OBJECT_ID('wf.QuotationSourceSO', 'U') IS NULL
BEGIN
  CREATE TABLE wf.QuotationSourceSO (
    Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QuotationSourceSO PRIMARY KEY,
    QuoteId INT NOT NULL,
    SoId INT NOT NULL,
    SourceWfRef NVARCHAR(30) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_QuotationSourceSO_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_QuotationSourceSO_Quotation FOREIGN KEY (QuoteId) REFERENCES wf.Quotation(Id),
    CONSTRAINT UQ_QuotationSourceSO UNIQUE (QuoteId, SoId)
  );
END
GO

IF OBJECT_ID('wf.FK_QuotationSourceSO_SalesOrder', 'F') IS NOT NULL
BEGIN
  ALTER TABLE wf.QuotationSourceSO DROP CONSTRAINT FK_QuotationSourceSO_SalesOrder;
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_QuotationSourceSO_SoId'
    AND object_id = OBJECT_ID('wf.QuotationSourceSO')
)
BEGIN
  CREATE INDEX IX_QuotationSourceSO_SoId ON wf.QuotationSourceSO (SoId, QuoteId);
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_QuotationSourceSO_QuoteId'
    AND object_id = OBJECT_ID('wf.QuotationSourceSO')
)
BEGIN
  CREATE INDEX IX_QuotationSourceSO_QuoteId ON wf.QuotationSourceSO (QuoteId, SoId);
END
GO
