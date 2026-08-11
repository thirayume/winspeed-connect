-- =============================================================
-- 081_rebate_source_booking_link.sql
--
-- สืบจากเงินที่คืน → ใบส่งของ → **ใบสั่งขายต้นทาง** ได้ครบสาย
--
-- ที่มา
--   migration 076 ทำให้ใบขอเคลียร์ชี้กลับไปที่ "บรรทัดใบส่งของ" ได้แล้ว (SourceSOID/ListNo)
--   แต่หยุดแค่นั้น · ผู้ตรวจ ISO ถามต่อเสมอว่าใบส่งของนั้นมาจากใบสั่งขายฉบับไหน
--
--   ตรวจฐานจริงเมื่อ 11 ส.ค. 2569 พบว่า WINSpeed เก็บสายนี้ไว้ที่ **ระดับบรรทัด**:
--       dbo.SODT.RefSOID + RefListNo  ของบรรทัดใบ 104
--       → ชี้ไปที่บรรทัดของใบสั่งขาย (DocuType 103)
--
--   คุณภาพของลิงก์ (วัดจาก UAT):
--       บรรทัดใบ 104 ทั้งหมด        111,192
--       มี RefSOID                 111,191  (99.999%)
--       ชี้ไป DocuType 103              100%
--       ลูกค้าตรงกับใบสั่งขาย            100%
--
--   ⚠ ห้ามใช้ DocuNo เชื่อมเด็ดขาด — DocuNo unique แค่ระดับ (DocuNo, DocuType)
--     มี 61,319 เลขที่ปรากฏทั้ง 103 และ 104 โดย 52% เป็นคนละลูกค้ากันสิ้นเชิง
--     ดูรายละเอียดใน migration 080
--
-- ไม่แตะ schema dbo — อ่านอย่างเดียวผ่าน view และเพิ่มคอลัมน์ใน wf เท่านั้น
-- =============================================================

-- 1. เก็บใบสั่งขายต้นทางไว้กับบรรทัดใบขอเคลียร์
--
-- เก็บเป็นสแนปช็อตเหมือน Source* ตัวอื่น เพราะเอกสารที่พิมพ์ออกไปแล้ว
-- ต้องอ่านได้เหมือนเดิมแม้เลขที่ต้นทางถูกแก้ภายหลัง
IF COL_LENGTH('wf.RebateClaimLine','SourceRefSOID') IS NULL
    ALTER TABLE wf.RebateClaimLine ADD SourceRefSOID INT NULL;
GO
IF COL_LENGTH('wf.RebateClaimLine','SourceRefListNo') IS NULL
    ALTER TABLE wf.RebateClaimLine ADD SourceRefListNo INT NULL;
GO
IF COL_LENGTH('wf.RebateClaimLine','SourceBookingDocuNo') IS NULL
    ALTER TABLE wf.RebateClaimLine ADD SourceBookingDocuNo NVARCHAR(25) NULL;
GO

-- 2. view ยอดสะสม — เพิ่มใบสั่งขายต้นทางเข้าไปในทุกล็อต
--
-- ใช้ LEFT JOIN เพราะมี 1 บรรทัดใน 111,192 ที่ไม่มี RefSOID
-- ล็อตนั้นยังต้องนับเป็นยอดสะสมตามปกติ แค่สืบกลับไปใบสั่งขายไม่ได้
IF OBJECT_ID('wf.v_RebateAccrualLot', 'V') IS NOT NULL DROP VIEW wf.v_RebateAccrualLot;
GO
CREATE VIEW wf.v_RebateAccrualLot
AS
SELECT
    h.SOID                                    AS SourceSOID,
    d.ListNo                                  AS SourceListNo,
    h.DocuNo                                  AS SourceDocuNo,
    CAST(h.DocuDate AS DATE)                  AS SourceDocuDate,
    h.RefNo                                   AS TaxInvoiceNo,
    -- ใบสั่งขายต้นทางของบรรทัดนี้ (dbo.SODT.RefSOID → dbo.SOHD ของ DocuType 103)
    d.RefSOID                                 AS SourceRefSOID,
    d.RefListNo                               AS SourceRefListNo,
    bk.DocuNo                                 AS SourceBookingDocuNo,
    CAST(bk.DocuDate AS DATE)                 AS SourceBookingDate,
    CAST(h.CustID AS NVARCHAR(20))            AS CustId,
    cu.CustCode,
    ISNULL(cu.CustName, h.CustName)           AS CustName,
    reg.RegionCode,
    h.EmpID                                   AS SalesEmpId,
    emp.EmpName                               AS SalesEmpName,
    cp.CouponID,
    cp.CouponNo,
    d.GoodID,
    g.GoodCode,
    d.GoodName,
    CAST(d.GoodQty2 AS DECIMAL(18,3))         AS QtyTon,
    CAST(d.GoodPrice2 AS DECIMAL(18,2))       AS ListPricePerTon,
    CAST(pl.NetPrice AS DECIMAL(18,2))        AS NetPricePerTon,
    pl.PlanId,
    pl.PlanNo,
    CAST(CASE WHEN pl.NetPrice IS NULL THEN NULL
              ELSE d.GoodPrice2 - pl.NetPrice END AS DECIMAL(18,2))              AS RebatePerTon,
    CAST(CASE WHEN pl.NetPrice IS NULL THEN NULL
              ELSE d.GoodQty2 * (d.GoodPrice2 - pl.NetPrice) END AS DECIMAL(18,2)) AS RebateAmount
FROM dbo.SOHD h
JOIN dbo.SODT d          ON d.SOID   = h.SOID
JOIN dbo.EMGood g        ON g.GoodID = d.GoodID
LEFT JOIN dbo.EMCust cu  ON cu.CustID = h.CustID
LEFT JOIN dbo.EMEmp emp  ON emp.EmpID = h.EmpID
LEFT JOIN dbo.WFCoupon cp ON cp.DocuID = h.SOID AND cp.RefListno = d.ListNo
-- ใบสั่งขายต้นทาง — บังคับ DocuType 103 กันไม่ให้ไปจับใบที่เลขชนกันโดยบังเอิญ
LEFT JOIN dbo.SOHD bk    ON bk.SOID = d.RefSOID AND bk.DocuType = 103
OUTER APPLY (
    SELECT CASE WHEN LEFT(sa.SaleAreaCode, 2) IN ('01','02','03','04','05','06')
                THEN LEFT(sa.SaleAreaCode, 2) ELSE '99' END AS RegionCode
    FROM dbo.EMSaleArea sa WHERE sa.SaleAreaID = cu.SaleAreaID
) reg
OUTER APPLY (
    SELECT TOP 1 p.PlanId, p.PlanNo, p.NetPrice
    FROM wf.RebatePlan p
    WHERE p.Status IN ('ACTIVE', 'APPROVED')
      AND p.NetPrice IS NOT NULL
      AND (p.Region = 'ALL' OR p.Region = reg.RegionCode)
      AND (p.GoodCodePattern IS NULL OR g.GoodCode LIKE p.GoodCodePattern)
      AND (p.ValidFrom IS NULL OR CAST(h.DocuDate AS DATE) >= p.ValidFrom)
      AND (p.ValidTo   IS NULL OR CAST(h.DocuDate AS DATE) <= p.ValidTo)
    ORDER BY p.Priority DESC, p.PlanId DESC
) pl
WHERE h.DocuType = 104          -- ใบส่งของ/ใบกำกับ = หลักฐานว่าขนจริงแล้ว
  AND d.GoodQty2 > 0;
GO

-- v_RebateAccrualRemaining สร้างจาก l.* จึงได้คอลัมน์ใหม่ตามไปเอง
-- แต่ต้องสร้างใหม่เพราะ SQL Server ผูกรายชื่อคอลัมน์ไว้ตอนคอมไพล์
IF OBJECT_ID('wf.v_RebateAccrualRemaining', 'V') IS NOT NULL DROP VIEW wf.v_RebateAccrualRemaining;
GO
CREATE VIEW wf.v_RebateAccrualRemaining
AS
SELECT
    l.*,
    ISNULL(u.ClaimedTonRebate, 0)                                         AS ClaimedTonRebate,
    ISNULL(u.ClaimedTonDiff, 0)                                           AS ClaimedTonDiff,
    CAST(l.QtyTon - ISNULL(u.ClaimedTonRebate, 0) AS DECIMAL(18,3))       AS RemainingTonRebate,
    CAST(l.QtyTon - ISNULL(u.ClaimedTonDiff, 0)   AS DECIMAL(18,3))       AS RemainingTonDiff
FROM wf.v_RebateAccrualLot l
OUTER APPLY (
    SELECT
        SUM(CASE WHEN cl.LineType = 'DIFF' THEN 0 ELSE cl.QtyTon END) AS ClaimedTonRebate,
        SUM(CASE WHEN cl.LineType = 'DIFF' THEN cl.QtyTon ELSE 0 END) AS ClaimedTonDiff
    FROM wf.RebateClaimLine cl
    JOIN wf.RebateClaim c ON c.Id = cl.ClaimId
    WHERE cl.SourceSOID = l.SourceSOID
      AND cl.SourceListNo = l.SourceListNo
      AND c.Status NOT IN ('REJECTED', 'CANCELLED')
) u;
GO

PRINT '✓ WF migration 081 complete (rebate lines now trace back to the originating sales order)'
GO
