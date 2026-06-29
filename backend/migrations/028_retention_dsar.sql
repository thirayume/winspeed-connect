-- =============================================================
-- 028_retention_dsar.sql
-- FR-032 (P2-C) — PDPA retention policy + DSAR log
--   RetentionPolicy: นโยบายเก็บข้อมูลต่อ data class (วัน)
--   DsarLog: บันทึกคำขอเข้าถึง/ลบข้อมูลส่วนบุคคล (audit)
-- =============================================================

IF OBJECT_ID('wf.RetentionPolicy','U') IS NULL
BEGIN
  CREATE TABLE wf.RetentionPolicy (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    DataClass     NVARCHAR(60)  NOT NULL UNIQUE,   -- ERROR_LOG | OUTBOX_DONE | AUDIT | ...
    RetentionDays INT           NOT NULL,
    Note          NVARCHAR(300) NULL,
    UpdatedAt     DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
  INSERT INTO wf.RetentionPolicy (DataClass, RetentionDays, Note) VALUES
    ('ERROR_LOG',   90,  'เก็บ error log 90 วัน'),
    ('OUTBOX_DONE', 30,  'ลบ outbox ที่ DONE หลัง 30 วัน'),
    ('AUDIT',       2555,'audit เก็บ 7 ปี (ISO/บัญชี)');
END
GO

IF OBJECT_ID('wf.DsarLog','U') IS NULL
BEGIN
  CREATE TABLE wf.DsarLog (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    SubjectType NVARCHAR(20)  NOT NULL,    -- CUSTOMER | USER
    SubjectId   NVARCHAR(40)  NOT NULL,
    Action      NVARCHAR(20)  NOT NULL,    -- EXPORT | ERASE
    Status      NVARCHAR(20)  NOT NULL DEFAULT 'DONE',
    RequestedBy INT           NULL REFERENCES wf.AppUser(Id),
    RequestedAt DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    Note        NVARCHAR(400) NULL
  );
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 028 complete (RetentionPolicy + DsarLog)'
GO
