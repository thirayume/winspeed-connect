-- ==============================================================================
-- WORLD FERT DATA MIGRATION SCRIPT V2 (SINGLE SOURCE OF TRUTH)
-- ==============================================================================
-- สคริปต์นี้ใช้สำหรับสร้างข้อมูลส่วนขยาย (SalesOrderExt) ให้กับบิลใน Winspeed
-- เฉพาะบิลของปี 2025 เป็นต้นไป 
-- ==============================================================================

BEGIN TRANSACTION;

-- ล้างข้อมูลเก่า
DELETE FROM wf.RebateLedger;
DELETE FROM wf.SalesOrderAudit;
DELETE FROM wf.SalesOrderLineExt;
DELETE FROM wf.SalesOrderExt;

-- 1. สร้างข้อมูล Header (wf.SalesOrderExt)
WITH RankedOrders AS (
    SELECT 
        m.SOID,
        m.DocuNo,
        m.DocuDate,
        ROW_NUMBER() OVER (PARTITION BY m.DocuNo ORDER BY m.SOID DESC) as rn
    FROM dbo.SOHD m
    WHERE m.DocuDate >= '2025-01-01'
      AND m.DocuType = 103
)
INSERT INTO wf.SalesOrderExt (
    SOID, 
    WfRef, 
    SoPrefix, 
    SalesUserId,
    DeliveryDate,
    CreatedAt, 
    UpdatedAt
)
SELECT 
    r.SOID,
    LEFT(r.DocuNo, 20) AS WfRef,
    'I' AS SoPrefix,
    1 AS SalesUserId, 
    r.DocuDate AS DeliveryDate,
    GETDATE() AS CreatedAt,
    GETDATE() AS UpdatedAt
FROM RankedOrders r
WHERE r.rn = 1;

-- 2. สร้างข้อมูลรายการ (wf.SalesOrderLineExt)
INSERT INTO wf.SalesOrderLineExt (
    SOID, 
    ListNo, 
    NetPricePerTon, 
    IsGiveaway, 
    RebateBooked, 
    CreatedAt
)
SELECT 
    t.SOID,
    t.ListNo,
    t.GoodPrice2 AS NetPricePerTon, -- ราคาที่หักส่วนลดแล้ว (ถ้ามี)
    0 AS IsGiveaway,
    0 AS RebateBooked,
    GETDATE()
FROM dbo.SODT t 
JOIN dbo.SOHD m ON t.SOID = m.SOID
WHERE m.DocuDate >= '2025-01-01'
  AND m.DocuType = 103;

COMMIT;
