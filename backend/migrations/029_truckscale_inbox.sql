-- =============================================================
-- 029_truckscale_inbox.sql
-- FR-024/025/026 + integration — ดึงข้อมูลชั่งกลับจาก TruckScale (pull/polling)
--   wf.WeighInbox     : durable inbox ของรายการชั่งที่ดึงเข้ามา + จับคู่ SO
--   wf.TruckScaleSync : watermark (s_id ล่าสุด) + สถิติ
-- TruckScale = READ-ONLY (ไม่แตะ) · เขียนเฉพาะ wf
-- =============================================================

IF OBJECT_ID('wf.WeighInbox','U') IS NULL
BEGIN
  CREATE TABLE wf.WeighInbox (
    Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    Sequence    NVARCHAR(50)  NOT NULL,            -- tblscale.sequence (natural key)
    Sid         BIGINT        NULL,                -- tblscale.s_id (watermark)
    Movebill    NVARCHAR(50)  NULL,
    Plate       NVARCHAR(50)  NULL,
    CustName    NVARCHAR(200) NULL,
    WeightIn    DECIMAL(18,2) NULL,
    WeightOut   DECIMAL(18,2) NULL,
    WeightNet   DECIMAL(18,2) NULL,
    DateIn      NVARCHAR(30)  NULL,
    DateOut     NVARCHAR(30)  NULL,
    ScaleNo     NVARCHAR(20)  NULL,
    Status      NVARCHAR(20)  NOT NULL DEFAULT 'OPEN',   -- OPEN (ยังไม่ชั่งออก) | COMPLETED
    MatchedSoId NVARCHAR(50)  NULL,                -- SO ที่จับคู่ได้ (ด้วยทะเบียน)
    MatchStatus NVARCHAR(20)  NULL,                -- MATCHED | MULTI | UNMATCHED
    IngestedAt  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt   DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_WeighInbox_Seq UNIQUE (Sequence)
  );
  CREATE INDEX IX_WeighInbox_Status ON wf.WeighInbox(Status, UpdatedAt);
  CREATE INDEX IX_WeighInbox_Matched ON wf.WeighInbox(MatchedSoId);
END
GO

IF OBJECT_ID('wf.TruckScaleSync','U') IS NULL
BEGIN
  CREATE TABLE wf.TruckScaleSync (
    Id            INT NOT NULL PRIMARY KEY CHECK (Id = 1),
    LastSid       BIGINT      NOT NULL DEFAULT 0,
    LastSyncAt    DATETIME2   NULL,
    TotalIngested INT         NOT NULL DEFAULT 0,
    LastError     NVARCHAR(1000) NULL
  );
  INSERT INTO wf.TruckScaleSync (Id, LastSid) VALUES (1, 0);
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 029 complete (WeighInbox + TruckScaleSync)'
GO
