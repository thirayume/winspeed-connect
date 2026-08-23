-- =============================================================
-- 095_restore_accrual_booking_columns.sql
--
-- กู้คืน 4 คอลัมน์ที่ migration 092 ทำหายไปจาก wf.v_RebateAccrualLot
-- **การยื่นใบขอเคลียร์รีเบทพังอยู่ทั้ง local และ production เพราะเรื่องนี้**
--
-- อาการ
--   POST /api/rebate/claims  →  500  "Invalid column name 'SourceBookingDocuNo'."
--
-- ที่มา (เป็นความผิดพลาดที่เกิดจาก migration 092 ซึ่งเขียนขึ้นเพื่อปัดพื้นรีเบทที่ 0)
--   migration 081 เพิ่ม 4 คอลัมน์เข้า view เพื่อให้สืบกลับไปใบสั่งจองต้นทางได้
--       SourceRefSOID · SourceRefListNo · SourceBookingDocuNo · SourceBookingDate
--   migration 092 ใช้ CREATE OR ALTER เขียน view ใหม่ทั้งตัวเพื่อแก้แค่ 2 นิพจน์
--   แต่คัดลอกรายการคอลัมน์มาจากฉบับ 076 (ก่อนมี 081) → 4 คอลัมน์นั้นหายไปเงียบ ๆ
--   view ยัง SELECT ได้ปกติ จึงไม่มีอะไรฟ้อง จนกระทั่งมีคนกดยื่นใบเคลมจริง
--
--   routes/rebate.js อ่านคอลัมน์เหล่านี้ตอนตัด FIFO
--   (บล็อก "ตัดสิทธิ์แบบ FIFO จากใบส่งของจริงใน WINSpeed")
--   ที่ไม่มีใครเจอมาก่อนเพราะ wf.RebatePlan ว่างมาตลอด — ไม่เคยมีล็อตให้ตัด
--
-- บทเรียน
--   ห้ามเขียน view ใหม่ทั้งตัวโดยคัดลอกจาก migration เก่า
--   ให้ดึงนิยามที่ใช้งานจริงด้วย OBJECT_DEFINITION() มาแก้เฉพาะจุดเสมอ
--
-- ฉบับนี้ = คอลัมน์ครบตาม 081 + ตรรกะปัดพื้น 0 ตาม 092
-- =============================================================

CREATE OR ALTER VIEW wf.v_RebateAccrualLot
AS
SELECT
    h.SOID                                    AS SourceSOID,
    d.ListNo                                  AS SourceListNo,
    h.DocuNo                                  AS SourceDocuNo,
    CAST(h.DocuDate AS DATE)                  AS SourceDocuDate,
    h.RefNo                                   AS TaxInvoiceNo,
    -- ใบสั่งจองต้นทางของบรรทัดนี้ (dbo.SODT.RefSOID → dbo.SOHD DocuType 103)
    -- 4 คอลัมน์นี้คือชุดที่ 092 ทำหาย — ต้องมีเสมอ ไม่งั้นการตัด FIFO พัง
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
    -- ปัดพื้น 0 ต่อบรรทัด — ขายต่ำกว่าราคาสุทธิ = ไม่ได้รีเบท (ไม่ติดลบ)
    -- เจ้าของระบบตัดสิน 20/08/2569 · เหตุผลเต็มอยู่หัวไฟล์ 092
    -- ไม่มีแผน = NULL (ต่างจาก 0 ที่แปลว่าขายไม่ถึงราคาสุทธิ)
    CAST(CASE WHEN pl.NetPrice IS NULL          THEN NULL
              WHEN d.GoodPrice2 <= pl.NetPrice  THEN 0
              ELSE d.GoodPrice2 - pl.NetPrice END AS DECIMAL(18,2))              AS RebatePerTon,
    CAST(CASE WHEN pl.NetPrice IS NULL          THEN NULL
              WHEN d.GoodPrice2 <= pl.NetPrice  THEN 0
              ELSE d.GoodQty2 * (d.GoodPrice2 - pl.NetPrice) END AS DECIMAL(18,2)) AS RebateAmount
FROM dbo.SOHD h
JOIN dbo.SODT d          ON d.SOID   = h.SOID
JOIN dbo.EMGood g        ON g.GoodID = d.GoodID
LEFT JOIN dbo.EMCust cu  ON cu.CustID = h.CustID
LEFT JOIN dbo.EMEmp emp  ON emp.EmpID = h.EmpID
LEFT JOIN dbo.WFCoupon cp ON cp.DocuID = h.SOID AND cp.RefListno = d.ListNo
-- ใบสั่งจองต้นทาง — บังคับ DocuType 103 กันไม่ให้ไปจับใบที่เลขชนกันโดยบังเอิญ
-- (DocuNo ไม่ unique ข้าม DocuType — ดู winspeed-doc-linkage-rules)
LEFT JOIN dbo.SOHD bk    ON bk.SOID = d.RefSOID AND bk.DocuType = 103
OUTER APPLY (
    -- ภาคของลูกค้า = 2 หลักแรกของรหัสเขตขาย (ตรงกับ getCustomerRegion ใน rebate.js)
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
    -- แผนที่เจาะจงกว่า (Priority สูงกว่า) ชนะ · เท่ากันให้ฉบับล่าสุดชนะ
    ORDER BY p.Priority DESC, p.PlanId DESC
) pl
WHERE h.DocuType = 104          -- ใบส่งของ/ใบกำกับ = หลักฐานว่าขนจริงแล้ว
  AND d.GoodQty2 > 0;
GO

-- view ลูกอ้าง l.* จึงต้องเขียนใหม่ทุกครั้งที่ view แม่เปลี่ยน — เหตุผลเต็มอยู่หัวไฟล์ 094
CREATE OR ALTER VIEW wf.v_RebateAccrualRemaining
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
