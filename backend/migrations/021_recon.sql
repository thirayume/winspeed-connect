-- =============================================================
-- 021_recon.sql
-- FR-027 — Reconciliation workbench: กระทบยอด ship ↔ WINSpeed / TruckScale
--   - case คำนวณสด (shipped SO vs WeighTicket vs TruckScale vs WINSpeed invoice)
--   - wf.ReconResolution เก็บการตัดสินของคน (resolve/ignore) ต่อ (SoId, CheckType)
-- Safe to re-run (idempotent)
-- =============================================================

IF OBJECT_ID('wf.ReconResolution','U') IS NULL
BEGIN
  CREATE TABLE wf.ReconResolution (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    SoId        NVARCHAR(50)  NOT NULL,
    WfRef       NVARCHAR(30)  NULL,
    CheckType   NVARCHAR(20)  NOT NULL,   -- WEIGH | INVOICE
    Status      NVARCHAR(20)  NOT NULL    -- RESOLVED | IGNORED
      CONSTRAINT chk_Recon_Status CHECK (Status IN ('RESOLVED','IGNORED')),
    Note        NVARCHAR(500) NULL,
    ResolvedBy  INT           NULL REFERENCES wf.AppUser(Id),
    ResolvedAt  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_ReconResolution UNIQUE (SoId, CheckType)
  );
  CREATE INDEX IX_ReconResolution_So ON wf.ReconResolution(SoId);
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 021 complete (ReconResolution)'
GO
