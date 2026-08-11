-- =============================================================
-- 080_fix_all_sales_orders_dedupe.sql
--
-- wf.v_AllSalesOrders ซ่อนใบสั่งขายจริงไป 31,932 ใบ
--
-- ปัญหา
--   migration 040 ตัดใบซ้ำด้วย ROW_NUMBER() OVER (PARTITION BY hd.DocuNo ...)
--   ตั้งอยู่บนสมมติฐานว่า "ใบ 103 กับ 104 ที่เลขที่เดียวกัน คือใบเดียวกันคนละขั้นตอน"
--
--   สมมติฐานนี้ผิด · วัดจากฐานจริง (UAT) เมื่อ 11 ส.ค. 2569:
--     DocuNo ที่ปรากฏทั้ง 103 และ 104   61,319 คู่
--       ลูกค้าตรงกัน                     29,387 (48%)
--       **ลูกค้าคนละราย                  31,932 (52%)**
--       พนักงานขายคนละคน                 27,239
--       ใบ 104 ลงวันที่เก่ากว่าใบ 103        155  (เป็นไปไม่ได้ถ้าเป็นใบเดียวกัน)
--
--   ตัวอย่าง I69-01854 — เลขเดียวกัน แต่คนละเอกสารสิ้นเชิง:
--     103 SOID 271287 · 19 พ.ค. · ลูกค้า 1011 (กรุงเทพฯ) · 50,000,000 บาท
--     104 SOID 272023 · 30 พ.ค. · ลูกค้า 1198 (กระบี่)   ·    364,500 บาท
--
--   ผลคือ view แสดง 63,861 จาก 125,180 ใบ · หายไป 61,319 ใบ
--   และใน 61,319 นั้น **31,932 ใบเป็นลูกค้าคนละรายกับใบที่ถูกเก็บไว้**
--   = ใบสั่งขายจริงที่ไม่เคยปรากฏบนหน้าจอเลย
--
--   ตัวเชื่อมที่ถูกต้องระหว่างใบส่งของกับใบสั่งขายคือ dbo.SODT.RefSOID + RefListNo
--   (111,191 จาก 111,192 บรรทัดของใบ 104 · ชี้ไป 103 ครบ 100% · ลูกค้าตรงกันครบ 100%)
--   ไม่ใช่ DocuNo ซึ่ง unique แค่ระดับ (DocuNo, DocuType)
--
-- วิธีแก้
--   เปลี่ยน PARTITION เป็น (DocuNo, DocuType) — ตรวจแล้วไม่มีกลุ่มไหนซ้ำเลย
--   จึงไม่มีเอกสารจริงถูกซ่อนอีก และยังกันซ้ำในอนาคตไว้เหมือนเดิม
--
--   คัดลอกตัว view มาจาก 040 ทั้งดุ้น เปลี่ยนเฉพาะบรรทัด ROW_NUMBER
--   ไม่แก้ไฟล์ 040 เพราะ migration ที่รันไปแล้วห้ามแก้ย้อนหลัง
--   **ไม่แตะ schema dbo แม้แต่คอลัมน์เดียว** — สร้าง view ทับของเดิมเท่านั้น
-- =============================================================

GO
CREATE OR ALTER VIEW wf.v_AllSalesOrders AS
-- 1. DRAFT from Web App
SELECT
    CAST(so.Id AS VARCHAR(50)) AS Id,
    so.WfRef,
    so.SoPrefix,
    so.CustId,
    so.CustName,
    so.TruckPlate,
    so.ControlTicketNo,
    so.DeliveryDate,
    so.RequestedAt,
    so.IsOwnTruck,
    so.NoTruckRequired,
    so.PSling,
    so.Remark,
    so.Status,
    so.SalesUserId,
    so.ImportFilePath,
    so.ImportedDocuNo,
    so.ImportedAt,
    so.CreatedAt,
    so.UpdatedAt,
    ISNULL(so.RebateDiscountAmt, 0) AS RebateDiscountAmt,
    CAST(0 AS BIT) AS IsLoaded,
    CAST(NULL AS DECIMAL(10,2)) AS WeighOutWeight,
    so.CreditDays,
    so.TruckRemark,
    so.BillRemark,
    so.TranspId
FROM wf.SalesOrder so

UNION ALL

-- 2. Documents already visible in WINSpeed (deduplicated by DocuNo)
SELECT
    Id,
    WfRef,
    SoPrefix,
    CustId,
    CustName,
    TruckPlate,
    ControlTicketNo,
    DeliveryDate,
    RequestedAt,
    IsOwnTruck,
    NoTruckRequired,
    PSling,
    Remark,
    Status,
    SalesUserId,
    ImportFilePath,
    ImportedDocuNo,
    ImportedAt,
    CreatedAt,
    UpdatedAt,
    RebateDiscountAmt,
    IsLoaded,
    WeighOutWeight,
    CreditDays,
    TruckRemark,
    BillRemark,
    TranspId
FROM (
    SELECT
        CAST(hd.SOID AS VARCHAR(50)) AS Id,
        ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
        ISNULL(ext.SoPrefix, CASE WHEN LEFT(hd.DocuNo, 2) = 'AI' THEN 'AI' WHEN LEFT(hd.DocuNo, 1) IN ('I', 'K') THEN LEFT(hd.DocuNo, 1) ELSE 'W' END) AS SoPrefix,
        hd.CustID AS CustId,
        hd.CustName,
        hd.TransRegistration AS TruckPlate,
        ext.ControlTicketNo,
        ext.DeliveryDate,
        ext.RequestedAt,
        ISNULL(ext.IsOwnTruck, 0) AS IsOwnTruck,
        ISNULL(ext.NoTruckRequired, 0) AS NoTruckRequired,
        ISNULL(ext.PSling, 0) AS PSling,
        hd.Remark,
        CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN EXISTS (
                SELECT 1
                FROM dbo.SOInvDT invdt WITH (NOLOCK)
                JOIN dbo.SOInvHD invhd WITH (NOLOCK) ON invhd.SOInvID = invdt.SOInvID
                WHERE invhd.DocuType IN (107, 202)
                  AND (CONVERT(VARCHAR(50), invdt.RefID) = CONVERT(VARCHAR(50), hd.SOID)
                       OR RTRIM(invhd.SONo) = RTRIM(hd.DocuNo))
            ) THEN 'SHIPPED'
            WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
            ELSE 'CONFIRMED'
        END AS Status,
        ext.SalesUserId,
        ext.ImportFilePath,
        hd.DocuNo AS ImportedDocuNo,
        ext.ImportedAt,
        ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt,
        ext.UpdatedAt,
        ISNULL(ext.RebateDiscountAmt, 0) AS RebateDiscountAmt,
        ISNULL(ext.IsLoaded, 0) AS IsLoaded,
        ext.WeighOutWeight,
        ISNULL(ext.CreditDays, hd.CreditDays) AS CreditDays,
        ISNULL(ext.TruckRemark, hd.Desc1) AS TruckRemark,
        ISNULL(ext.BillRemark, hd.Desc2) AS BillRemark,
        ISNULL(ext.TranspId, hd.TranspID) AS TranspId,
        -- เดิม PARTITION BY hd.DocuNo อย่างเดียว → ใบคนละใบที่เลขชนกันถูกซ่อน
        -- (DocuNo, DocuType) ตรวจแล้วไม่ซ้ำเลยสักกลุ่ม จึงไม่มีเอกสารจริงถูกซ่อนอีก
        ROW_NUMBER() OVER(PARTITION BY hd.DocuNo, hd.DocuType ORDER BY hd.SOID DESC) as rn
    FROM dbo.SOHD hd
    LEFT JOIN wf.SalesOrderExt ext ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
    WHERE hd.DocuType IN (103, 104)
) Dedup
WHERE rn = 1;
GO
