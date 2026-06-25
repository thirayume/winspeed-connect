-- ==============================================================================
-- WORLD FERT DATA MIGRATION SCRIPT (LEGACY TO WEB PORTAL)
-- ==============================================================================
-- สคริปต์นี้ใช้สำหรับดึงข้อมูลใบสั่งขาย (Sales Order) จากระบบ WINSpeed เดิม
-- ตั้งแต่วันที่ 2025-01-01 ถึงปัจจุบัน เข้ามาสู่ตารางของ Web Portal (wf.SalesOrder)
-- 
-- คำเตือน: กรุณาตรวจสอบชื่อตารางและชื่อคอลัมน์ของ WINSpeed (dbo.SOHD, dbo.SODT)
-- ให้ตรงกับระบบของคุณก่อนกด Execute เสมอ (ใช้ SELECT TOP 1 ดูก่อนได้ครับ)
-- ==============================================================================

BEGIN TRANSACTION;

-- 0. ล้างข้อมูลเก่าในตาราง wf ก่อน (Clear Data)
-- เพื่อให้การรันสคริปต์กี่ครั้งก็ได้ผลลัพธ์เหมือนเดิม (Idempotent)
UPDATE wf.Quotation SET ConvertedSoId = NULL; -- ปลดล็อค FK จากใบเสนอราคาก่อน
DELETE FROM wf.RebateLedger; -- ลบประวัติ Rebate ออกก่อนเพราะติด FK กับ SalesOrder
DELETE FROM wf.SalesOrderAudit; -- ลบประวัติ Audit ก่อนเพราะติด Foreign Key
DELETE FROM wf.SalesOrderLine;
DELETE FROM wf.SalesOrder;

-- รีเซ็ตค่า Identity (Auto Increment) ให้กลับไปเริ่มที่ 1 (ถ้ามี)
DBCC CHECKIDENT ('wf.SalesOrder', RESEED, 0);
DBCC CHECKIDENT ('wf.SalesOrderLine', RESEED, 0);

-- 1. โอนย้ายข้อมูล Header (wf.SalesOrder)
-- ใช้ CTE กรองเอาเฉพาะบิลที่เป็น Sales Order (DocuType=103) 
-- และใช้ ROW_NUMBER() เพื่อป้องกันปัญหาเลขที่บิล (DocuNo) ซ้ำกันในระบบเดิม
WITH RankedOrders AS (
    SELECT 
        m.SOID,
        m.DocuNo,
        m.CustID,
        m.TransRegistration,
        m.DocuDate,
        m.Remark,
        ROW_NUMBER() OVER (PARTITION BY m.DocuNo ORDER BY m.SOID DESC) as rn
    FROM dbo.SOHD m
    WHERE m.DocuDate >= '2025-01-01'
      AND m.DocuType = 103 -- กรองเฉพาะใบสั่งขาย
)
INSERT INTO wf.SalesOrder (
    WfRef, 
    SoPrefix, 
    CustId, 
    CustName, 
    TruckPlate, 
    ControlTicketNo, 
    DeliveryDate, 
    Remark, 
    Status, 
    SalesUserId, 
    ImportFilePath, 
    ImportedDocuNo, 
    ImportedAt, 
    CreatedAt, 
    UpdatedAt
)
SELECT 
    LEFT(r.DocuNo, 20) AS WfRef, -- จำกัดความยาวและรับประกันว่าไม่ซ้ำ
    'I' AS SoPrefix,
    r.CustID AS CustId,
    LEFT(c.CustName, 100) AS CustName, -- จำกัดความยาว
    LEFT(r.TransRegistration, 20) AS TruckPlate, -- จำกัดความยาว
    NULL AS ControlTicketNo,
    r.DocuDate AS DeliveryDate,
    LEFT(r.Remark, 100) AS Remark, -- จำกัดความยาว
    'SHIPPED' AS Status, 
    1 AS SalesUserId, 
    NULL AS ImportFilePath,
    CAST(r.SOID AS VARCHAR(50)) AS ImportedDocuNo, -- เก็บ SOID เพื่อใช้เชื่อมโยงกับ SODT
    GETDATE() AS ImportedAt,
    r.DocuDate AS CreatedAt,
    GETDATE() AS UpdatedAt
FROM RankedOrders r
JOIN dbo.EMCust c ON r.CustID = c.CustID
WHERE r.rn = 1;

-- 2. โอนย้ายข้อมูลรายการสินค้า (wf.SalesOrderLine)
INSERT INTO wf.SalesOrderLine (
    SoId, 
    LineNum, 
    GoodId, 
    GoodCode, 
    GoodName, 
    QtyTon, 
    QtyBag, 
    PricePerTon, 
    NetPricePerTon, 
    IsGiveaway, 
    RebateBooked, 
    CreatedAt
)
SELECT 
    so.Id AS SoId,
    t.ListNo AS LineNum,
    t.GoodID AS GoodId,
    LEFT(g.GoodCode, 50) AS GoodCode,
    LEFT(g.GoodName1, 255) AS GoodName,
    t.GoodQty2 AS QtyTon, -- ใช้ GoodQty2 เป็นจำนวนตัน
    (t.GoodQty2 * 20) AS QtyBag, -- สมมติว่า 1 ตันมี 20 กระสอบ (ปรับให้ตรงความจริง)
    t.GoodPrice2 AS PricePerTon,
    t.GoodPrice2 AS NetPricePerTon,
    0 AS IsGiveaway,
    0 AS RebateBooked,
    so.CreatedAt
FROM dbo.SODT t 
JOIN dbo.SOHD m ON t.SOID = m.SOID -- ใช้ SOID ในการ Join
JOIN wf.SalesOrder so ON so.ImportedDocuNo = CAST(m.SOID AS VARCHAR(50)) -- เชื่อมต่อด้วย SOID ที่แท้จริง
JOIN dbo.EMGood g ON t.GoodID = g.GoodID
WHERE m.DocuDate >= '2025-01-01'
  AND m.DocuType = 103;

COMMIT;
-- ROLLBACK; -- หากรันแล้วเจอ Error ข้อมูลผิดพลาด สามารถใช้ ROLLBACK แทน COMMIT ได้ครับ
