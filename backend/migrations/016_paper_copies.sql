-- =============================================================
-- 016_paper_copies.sql
-- Paper Trail v2 — เอกสาร 4 สี + QR + scan tracking (FR-004 / FR-012 / FR-013)
-- SoId = v_AllSalesOrders.Id (wf draft id หรือ dbo SOID) → ใช้ NVARCHAR(50) ไม่ผูก FK
-- Safe to re-run (idempotent)
-- =============================================================

IF OBJECT_ID('wf.PaperCopy','U') IS NULL
BEGIN
  CREATE TABLE wf.PaperCopy (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    SoId        NVARCHAR(50)  NOT NULL,
    WfRef       NVARCHAR(30)  NULL,
    DocType     NVARCHAR(20)  NOT NULL DEFAULT 'ISSUE',  -- ISSUE (ใบจ่ายของ) / RECEIVE (ใบรับ)
    CopyColor   NVARCHAR(20)  NOT NULL,                  -- WHITE/BLUE/PINK/YELLOW/GREEN
    CopyLabel   NVARCHAR(80)  NULL,                      -- ต้นฉบับ/สำเนาเก็บ/ลูกค้า/รปภ.
    QrNonce     NVARCHAR(64)  NOT NULL UNIQUE,
    Status      NVARCHAR(20)  NOT NULL DEFAULT 'PRINTED' -- PRINTED/IN_TRANSIT/SIGNED/FILED/LOST
      CONSTRAINT chk_PaperCopy_Status CHECK (Status IN ('PRINTED','IN_TRANSIT','SIGNED','FILED','LOST')),
    HolderUserId INT          NULL REFERENCES wf.AppUser(Id),
    PrintedAt   DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
  CREATE INDEX IX_PaperCopy_So     ON wf.PaperCopy(SoId);
  CREATE INDEX IX_PaperCopy_Status ON wf.PaperCopy(Status);
END
GO

IF OBJECT_ID('wf.PaperScan','U') IS NULL
BEGIN
  CREATE TABLE wf.PaperScan (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    PaperCopyId  INT           NOT NULL REFERENCES wf.PaperCopy(Id),
    Action       NVARCHAR(30)  NOT NULL,   -- PRINT/TRANSIT/SIGN/FILE/LOST/FOUND
    FromStatus   NVARCHAR(20)  NULL,
    ToStatus     NVARCHAR(20)  NULL,
    ScannerUserId INT          NULL REFERENCES wf.AppUser(Id),
    Location     NVARCHAR(100) NULL,
    Note         NVARCHAR(300) NULL,
    ScannedAt    DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
  CREATE INDEX IX_PaperScan_Copy ON wf.PaperScan(PaperCopyId);
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 016 complete (PaperCopy + PaperScan)'
GO
