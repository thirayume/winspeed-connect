-- =============================================================
-- 027_operational_stock.sql
-- DG-04 (P2-D) — Operational stock source (wf)
--   แหล่งสต๊อกปฏิบัติการที่ "อนุมัติแล้ว" — ไม่ assume dbo.ICStock
--   (DG-04 เป็น open decision; ตารางนี้เป็นแหล่งกลางให้ป้อน/feed ภายหลัง)
-- =============================================================

IF OBJECT_ID('wf.OperationalStock','U') IS NULL
BEGIN
  CREATE TABLE wf.OperationalStock (
    GoodId      NVARCHAR(20)  NOT NULL,
    WarehouseId NVARCHAR(20)  NOT NULL DEFAULT '-',
    GoodName    NVARCHAR(200) NULL,
    QtyOnHand   DECIMAL(18,2) NOT NULL DEFAULT 0,
    Unit        NVARCHAR(20)  NULL DEFAULT 'ตัน',
    Source      NVARCHAR(40)  NULL,        -- MANUAL | FEED | ...
    AsOf        DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    UpdatedBy   INT           NULL REFERENCES wf.AppUser(Id),
    CONSTRAINT PK_OperationalStock PRIMARY KEY (GoodId, WarehouseId)
  );
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 027 complete (OperationalStock)'
GO
