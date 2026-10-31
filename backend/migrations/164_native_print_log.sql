-- Sale-App print log (owner item, 1 November 2026). WinSpeed writes one SMAudit row (action P,
-- form name) each time a form is printed; prints of the WinSpeed 104/116/107 from Sale-App left
-- no trace. One row per press of the print button: document, who, when (UTC).
-- wf only; no dbo change. SQL Server 2008 compatible; idempotent.
IF OBJECT_ID(N'wf.NativePrintLog', N'U') IS NULL
BEGIN
    CREATE TABLE wf.NativePrintLog (
        Id         INT IDENTITY(1,1) NOT NULL,
        DocType    SMALLINT    NOT NULL,
        DocId      INT         NOT NULL,
        DocuNo     VARCHAR(25) NOT NULL,
        PrintedBy  INT         NOT NULL,
        PrintedAt  DATETIME2   NOT NULL CONSTRAINT DF_NativePrintLog_PrintedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_NativePrintLog PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_NativePrintLog_DocType CHECK (DocType IN (104, 116, 107))
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_NativePrintLog_Doc' AND object_id = OBJECT_ID(N'wf.NativePrintLog'))
    CREATE INDEX IX_NativePrintLog_Doc ON wf.NativePrintLog (DocType, DocId) INCLUDE (PrintedAt);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_NativePrintLog_PrintedAt' AND object_id = OBJECT_ID(N'wf.NativePrintLog'))
    CREATE INDEX IX_NativePrintLog_PrintedAt ON wf.NativePrintLog (PrintedAt);
GO
