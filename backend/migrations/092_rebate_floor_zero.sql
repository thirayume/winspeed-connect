-- =============================================================
-- 092_rebate_floor_zero.sql
--
-- ปัดพื้นรีเบทที่ 0 ต่อบรรทัด — ขายต่ำกว่าราคาสุทธิ = ไม่ได้รีเบท (ไม่ติดลบ)
--
-- ที่มา
--   wf.v_RebateAccrualLot (migration 076) คำนวณ รีเบท/ตัน = ราคาขาย − ราคาสุทธิ ตรง ๆ
--   บรรทัดที่ขายต่ำกว่าราคาสุทธิจึงได้ค่า "ติดลบ" และไหลลงยอดคงเหลือ/การเบิกโดยไม่ปัดพื้น
--
--   วัดจริง 20/08/2569 (สินค้า 18-8-8 ตรารถเกษตร ก่อน มี.ค.69 · ราคาสุทธิสมมติ 14,500):
--     ถ้าปัดพื้น 0 ต่อบรรทัด   รีเบทรวม 2,755,400
--     ถ้าปล่อยติดลบมาหักยอดบวก รีเบทรวม 2,602,650   (ต่างกัน 152,750 เฉพาะสินค้าเดียว ช่วงเดียว)
--     บรรทัดที่ขายต่ำกว่าราคาสุทธิ 57 บรรทัด / 266 ตัน
--
--   เจ้าของระบบตัดสิน 20/08/2569: **ปัดพื้น 0 ต่อบรรทัด**
--   ตรงตามแบบฟอร์มกระดาษ (ราคาขาย − ราคาสุทธิ) และหลักปฏิบัติ —
--   การขายต่ำกว่าราคาที่รับประกันไม่ควรทำให้รีเบทติดลบ ควรได้ 0 บนตันเหล่านั้น
--
-- ขอบเขต
--   เปลี่ยนเฉพาะสองนิพจน์ RebatePerTon / RebateAmount ให้ปัดพื้น 0
--   คอลัมน์และคีย์เหมือนเดิมทุกอย่าง จึงใช้ CREATE OR ALTER ได้
--   ไม่ต้อง drop และ view ที่ต่อยอด (wf.v_RebateAccrualRemaining) ยังใช้ได้ทันที
--
--   ยังคงหลักการเดิม: ไม่มีแผนครอบคลุม = NULL (เว้นว่าง) ไม่ใช่ 0
--   เพราะ NULL แปลว่า "ยังระบุราคาสุทธิไม่ได้" ต่างจาก 0 ที่แปลว่า "ขายไม่ถึงราคาสุทธิ จึงไม่ได้คืน"
-- =============================================================

CREATE OR ALTER VIEW wf.v_RebateAccrualLot
AS
SELECT
    h.SOID                                    AS SourceSOID,
    d.ListNo                                  AS SourceListNo,
    h.DocuNo                                  AS SourceDocuNo,
    CAST(h.DocuDate AS DATE)                  AS SourceDocuDate,
    h.RefNo                                   AS TaxInvoiceNo,
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
    -- คืนรีเบท/ตัน และมูลค่าเป็นบาท — ปัดพื้น 0 เมื่อขายไม่ถึงราคาสุทธิ (ไม่ติดลบ)
    -- ไม่มีแผน = NULL · ขายต่ำกว่าหรือเท่าราคาสุทธิ = 0 · เกินราคาสุทธิ = ส่วนต่าง
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
