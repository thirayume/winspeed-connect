-- =============================================================
-- 019_weigh_ticket.sql
-- WeighTicket (Gross/Tare/Net + weigh-in/out timestamps + scale no.)
-- ข้อมูลที่ WINSpeed ไม่มี — เป็นรากฐานเชื่อม TruckScale (§16)
-- Safe to re-run (idempotent)
-- =============================================================

IF OBJECT_ID('wf.WeighTicket','U') IS NULL
BEGIN
  CREATE TABLE wf.WeighTicket (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    SoId        NVARCHAR(50)  NOT NULL,
    WfRef       NVARCHAR(30)  NULL,
    TruckPlate  NVARCHAR(30)  NULL,
    GrossKg     DECIMAL(10,2) NULL,   -- รถ+สินค้า (ชั่งออก)
    TareKg      DECIMAL(10,2) NULL,   -- รถเปล่า (ชั่งเข้า)
    NetKg       DECIMAL(10,2) NULL,   -- สุทธิ = Gross − Tare
    ScaleNo     INT           NULL,   -- เครื่องชั่ง 1/2
    WeighInAt   DATETIME2     NULL,
    WeighOutAt  DATETIME2     NULL,
    Status      NVARCHAR(20)  NOT NULL DEFAULT 'WEIGH_IN'
      CONSTRAINT chk_WeighTicket_Status CHECK (Status IN ('WEIGH_IN','WEIGH_OUT','DONE')),
    Movebill    NVARCHAR(50)  NULL,   -- เชื่อม TruckScale.tblscale.movebill (ภายหลัง)
    Note        NVARCHAR(300) NULL,
    CreatedBy   INT           NULL REFERENCES wf.AppUser(Id),
    CreatedAt   DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
  CREATE INDEX IX_WeighTicket_So ON wf.WeighTicket(SoId);
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 019 complete (WeighTicket)'
GO
