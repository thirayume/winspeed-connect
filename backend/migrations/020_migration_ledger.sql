-- =============================================================
-- 020_migration_ledger.sql
-- FR-031 — Migration ledger: บันทึกว่า migration ไฟล์ใดถูก apply แล้ว (checksum)
-- runner จะข้ามไฟล์ที่ checksum ไม่เปลี่ยน (ลด noise + กันรันซ้ำ)
-- หมายเหตุ: runner bootstrap ตารางนี้เองด้วย (idempotent) จึงทำงานได้ตั้งแต่ไฟล์แรก
-- =============================================================

IF OBJECT_ID('wf.SchemaMigration','U') IS NULL
BEGIN
  CREATE TABLE wf.SchemaMigration (
    FileName   NVARCHAR(255) NOT NULL PRIMARY KEY,
    Checksum   CHAR(64)      NOT NULL,
    BatchCount INT           NULL,
    AppliedAt  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    AppliedBy  NVARCHAR(128) NULL DEFAULT SUSER_SNAME()
  );
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 020 complete (SchemaMigration ledger)'
GO
