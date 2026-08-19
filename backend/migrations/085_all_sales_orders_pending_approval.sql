-- =============================================================
-- 085_all_sales_orders_pending_approval.sql
--
-- ผู้ใช้ต้องเห็นว่าใบยัง "รออนุมัติใน WINSpeed"
--
-- migration 084 ทำให้ใบที่แอปยืนยันถูกสร้างเป็น AppvFlag='W' เพื่อเข้าคิว
-- ที่หน้าจอ Approve Confirm Order (WF) ตามกลไกจริงของ WINSpeed
--
-- แต่ wf.v_AllSalesOrders ไม่เคยดู AppvFlag เลย ใบเหล่านี้จึงยังแสดงเป็น
-- CONFIRMED = "รอจัดส่ง" ทั้งที่ยังไม่มีใครอนุมัติ · คลังอาจเริ่มจัดของให้
-- ใบที่ผู้มีอำนาจยังไม่เห็นด้วยซ้ำ
--
-- ลำดับใน CASE สำคัญมาก
--   เงื่อนไขใหม่วางไว้ **ท้ายสุด** ถัดจาก IsUnlocked เท่านั้น
--   เพราะใบที่ออกใบกำกับหรือชั่งออกไปแล้วต้องคงสถานะ SHIPPED/LOADED/PICKING
--   ไม่ถอยกลับมาเป็นรออนุมัติ แม้ AppvFlag จะยังค้างเป็น 'W'
--   (เกิดได้จริงกับใบเก่าที่ธงไม่ตรงกับความเป็นจริง)
--
-- ตรวจ AppvDocuNo IS NULL ควบคู่ด้วย เพราะใบที่อนุมัติแล้วจะมีเลข AI เสมอ
-- ถ้ามีเลขแล้วแต่ธงยังเป็น 'W' ถือว่าอนุมัติแล้ว ไม่ใช่รออนุมัติ
--
-- คัดตัว view มาจาก migration 080 ทั้งดุ้น เปลี่ยนเฉพาะ CASE ที่คำนวณ Status
-- ไม่แตะ schema dbo — อ่านอย่างเดียว
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
            -- ยืนยันในแอปแล้ว แต่ยังรออนุมัติในหน้าจอ Approve Confirm Order (WF)
            -- ต้องอยู่ท้ายสุดถัดจาก DRAFT เท่านั้น — ใบที่ชั่งออกหรือออกใบกำกับไปแล้ว
            -- ต้องไม่ถอยกลับมาเป็นรออนุมัติ แม้ธง AppvFlag จะยังเป็น 'W' ก็ตาม
            WHEN hd.AppvFlag = 'W' AND hd.AppvDocuNo IS NULL THEN 'PENDING_APPROVAL'
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
