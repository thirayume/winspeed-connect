IF OBJECT_ID('wf.CustomerRequest', 'U') IS NULL
BEGIN
  CREATE TABLE wf.CustomerRequest (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CustName NVARCHAR(255) NOT NULL,
    ContactName NVARCHAR(255) NULL,
    Tel NVARCHAR(50) NULL,
    Mobile NVARCHAR(50) NULL,
    TaxId NVARCHAR(50) NULL,
    Address NVARCHAR(500) NULL,
    Note NVARCHAR(500) NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CustomerRequest_Status DEFAULT ('PENDING'),
    WinspeedCustId NVARCHAR(20) NULL,
    RequestedBy INT NULL,
    ReviewedBy INT NULL,
    ReviewedAt DATETIME2 NULL,
    ReviewNote NVARCHAR(500) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CustomerRequest_CreatedAt DEFAULT (GETUTCDATE()),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_CustomerRequest_UpdatedAt DEFAULT (GETUTCDATE())
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.CustomerRequest') AND name = 'IX_CustomerRequest_StatusCreated')
  CREATE INDEX IX_CustomerRequest_StatusCreated ON wf.CustomerRequest(Status, CreatedAt DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.CustomerRequest') AND name = 'IX_CustomerRequest_RequestedBy')
  CREATE INDEX IX_CustomerRequest_RequestedBy ON wf.CustomerRequest(RequestedBy, CreatedAt DESC);
