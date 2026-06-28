-- =============================================================
-- 022_error_log.sql
-- FR-030 — Observability: เก็บ error log แบบถาวร (เสริม in-memory ring + alert)
-- best-effort: การเขียน log ต้องไม่ทำให้ request ล้ม (route ห่อ try/catch)
-- =============================================================

IF OBJECT_ID('wf.ErrorLog','U') IS NULL
BEGIN
  CREATE TABLE wf.ErrorLog (
    Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    OccurredAt  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    Level       NVARCHAR(10)  NOT NULL DEFAULT 'ERROR',   -- ERROR | WARN
    Source      NVARCHAR(120) NULL,
    Message     NVARCHAR(2000) NULL,
    Detail      NVARCHAR(MAX) NULL,
    ReqMethod   NVARCHAR(10)  NULL,
    ReqPath     NVARCHAR(400) NULL,
    StatusCode  INT           NULL,
    UserId      INT           NULL,
    AppVersion  NVARCHAR(20)  NULL
  );
  CREATE INDEX IX_ErrorLog_OccurredAt ON wf.ErrorLog(OccurredAt DESC);
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 022 complete (ErrorLog)'
GO
