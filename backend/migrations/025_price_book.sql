-- =============================================================
-- 025_price_book.sql
-- FR-023 (P1-C) — Price Book workflow (version/approve/activate + audit)
--   ชั้นกำกับราคา: DRAFT → APPROVED → ACTIVE → ARCHIVED (มี audit)
--   เป็น governance layer เหนือราคา (ราคาจริงยังอยู่ dbo.EMSetPriceDT)
-- =============================================================

IF OBJECT_ID('wf.PriceBook','U') IS NULL
BEGIN
  CREATE TABLE wf.PriceBook (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    Name           NVARCHAR(120) NOT NULL,
    EffectiveMonth CHAR(7)       NOT NULL,   -- 'YYYY-MM'
    Status         NVARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
      CONSTRAINT chk_PriceBook_Status CHECK (Status IN ('DRAFT','APPROVED','ACTIVE','ARCHIVED')),
    Note           NVARCHAR(300) NULL,
    CreatedBy      INT NULL REFERENCES wf.AppUser(Id),
    CreatedAt      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    ApprovedBy     INT NULL REFERENCES wf.AppUser(Id),
    ApprovedAt     DATETIME2 NULL,
    ActivatedBy    INT NULL REFERENCES wf.AppUser(Id),
    ActivatedAt    DATETIME2 NULL
  );
  CREATE INDEX IX_PriceBook_Status ON wf.PriceBook(Status, EffectiveMonth);
END
GO

IF OBJECT_ID('wf.PriceBookLine','U') IS NULL
BEGIN
  CREATE TABLE wf.PriceBookLine (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    PriceBookId INT NOT NULL REFERENCES wf.PriceBook(Id),
    GoodId      NVARCHAR(20)  NOT NULL,
    GoodName    NVARCHAR(200) NULL,
    Unit        NVARCHAR(20)  NULL,
    Price       DECIMAL(18,2) NOT NULL,
    CreatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE()
  );
  CREATE INDEX IX_PriceBookLine_Book ON wf.PriceBookLine(PriceBookId);
END
GO

IF OBJECT_ID('wf.PriceBookAudit','U') IS NULL
BEGIN
  CREATE TABLE wf.PriceBookAudit (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    PriceBookId INT NOT NULL,
    Action      NVARCHAR(40) NOT NULL,   -- CREATE | ADD_LINES | APPROVE | ACTIVATE | ARCHIVE
    FromStatus  NVARCHAR(20) NULL,
    ToStatus    NVARCHAR(20) NULL,
    ByUser      INT NULL,
    Note        NVARCHAR(300) NULL,
    At          DATETIME2 NOT NULL DEFAULT GETUTCDATE()
  );
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 025 complete (PriceBook + Line + Audit)'
GO
