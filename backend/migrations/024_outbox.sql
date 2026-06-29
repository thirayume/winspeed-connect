-- =============================================================
-- 024_outbox.sql
-- FR-029 (P1-B) — Integration outbox (reliable event)
--   เมื่อ App ทำงานสำคัญ (confirm/ship/claim) → enqueue event ที่นี่
--   worker poll PENDING → ส่ง/ประมวลผล → DONE | retry (idempotencyKey กันซ้ำ)
-- =============================================================

IF OBJECT_ID('wf.OutboxEvent','U') IS NULL
BEGIN
  CREATE TABLE wf.OutboxEvent (
    Id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    EventType      NVARCHAR(60)  NOT NULL,   -- SO_CONFIRMED | SO_SHIPPED | REBATE_CLAIMED | ...
    AggregateId    NVARCHAR(60)  NULL,       -- เช่น SoId
    Payload        NVARCHAR(MAX) NULL,       -- JSON
    IdempotencyKey NVARCHAR(120) NULL,
    Status         NVARCHAR(20)  NOT NULL DEFAULT 'PENDING'  -- PENDING | PROCESSING | DONE | FAILED
      CONSTRAINT chk_Outbox_Status CHECK (Status IN ('PENDING','PROCESSING','DONE','FAILED')),
    RetryCount     INT           NOT NULL DEFAULT 0,
    LastError      NVARCHAR(1000) NULL,
    CreatedAt      DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    ProcessedAt    DATETIME2     NULL
  );
  CREATE UNIQUE INDEX UQ_Outbox_Idem ON wf.OutboxEvent(IdempotencyKey) WHERE IdempotencyKey IS NOT NULL;
  CREATE INDEX IX_Outbox_Status ON wf.OutboxEvent(Status, CreatedAt);
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 024 complete (OutboxEvent)'
GO
