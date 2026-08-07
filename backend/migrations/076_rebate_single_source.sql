-- =============================================================
-- 076_rebate_single_source.sql
--
-- รีเบท "แหล่งข้อมูลเดียว" — เลิกคัดลอกยอดสะสมมาไว้ในแอป
--
-- เดิมแอปสะสมรีเบทไว้เองที่ wf.RebateLedger (+ wf.CouponMirror) ซึ่งเป็น "สำเนา"
-- ของสิ่งที่ WINSpeed บันทึกอยู่แล้ว · WINSpeed ยังออกคูปองใหม่ทุกวัน (ปี 2569
-- ออกไปแล้ว 7,652 ใบ) สำเนาจึงแยกกันทันทีที่คัดลอกเสร็จ
--
-- ข้อเท็จจริงที่วัดจากฐานจริงเมื่อ 6 ส.ค. 2569:
--   · dbo.WFCoupon มี 111,192 ใบ รวม 2,037,464.97 ตัน
--   · เท่ากับยอดตันของเอกสาร DocuType 104 (ใบส่งของ/ใบกำกับ) ทั้งหมดพอดี
--   · บรรทัดของใบ 104 ปี 2569 ทั้ง 7,652 บรรทัด มีคูปองครบทุกบรรทัด (1:1)
-- แปลว่า "ตันที่ส่งจริง" กับ "ตันที่มีสิทธิ์รีเบท" เป็นชุดเดียวกัน และอยู่ใน dbo แล้ว
--
-- migration นี้จึงไม่ย้ายข้อมูล แต่ทำสองอย่าง:
--   1. ให้ใบขอเคลียร์อ้างถึง "บรรทัดส่งของ" ต้นทางได้ตรงบรรทัด (SourceSOID/SourceListNo)
--      เพื่อให้ตัดสิทธิ์แบบ FIFO ได้จริงและตรวจย้อนกลับได้ตาม ISO
--   2. สร้าง view อ่านยอดสะสม/ยอดคงเหลือจาก dbo โดยตรง ไม่มีสำเนา
-- =============================================================

-- 1. ใบขอเคลียร์ต้องชี้กลับไปที่บรรทัดส่งของต้นทางได้
--
-- เดิมมีแค่ LedgerId ซึ่งชี้ไปที่สำเนา · เมื่อเลิกใช้สำเนาแล้วต้องชี้ไปที่ของจริง
-- เก็บ SourceDocuNo/SourceDocuDate/SourceCouponNo เป็นสแนปช็อตด้วย เพราะเอกสาร
-- ที่พิมพ์ออกไปแล้วต้องอ่านได้เหมือนเดิมแม้เลขที่เอกสารต้นทางถูกแก้ภายหลัง
IF COL_LENGTH('wf.RebateClaimLine','SourceSOID') IS NULL
    ALTER TABLE wf.RebateClaimLine ADD SourceSOID INT NULL;
GO
IF COL_LENGTH('wf.RebateClaimLine','SourceListNo') IS NULL
    ALTER TABLE wf.RebateClaimLine ADD SourceListNo INT NULL;
GO
IF COL_LENGTH('wf.RebateClaimLine','SourceDocuNo') IS NULL
    ALTER TABLE wf.RebateClaimLine ADD SourceDocuNo NVARCHAR(25) NULL;
GO
IF COL_LENGTH('wf.RebateClaimLine','SourceDocuDate') IS NULL
    ALTER TABLE wf.RebateClaimLine ADD SourceDocuDate DATE NULL;
GO
IF COL_LENGTH('wf.RebateClaimLine','SourceCouponNo') IS NULL
    ALTER TABLE wf.RebateClaimLine ADD SourceCouponNo NVARCHAR(25) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RebateClaimLine_Source' AND object_id = OBJECT_ID('wf.RebateClaimLine'))
    CREATE INDEX IX_RebateClaimLine_Source ON wf.RebateClaimLine (SourceSOID, SourceListNo) INCLUDE (QtyTon, LineType);
GO

-- 2. ยอดสะสม — อ่านจาก dbo ตรง ๆ ไม่มีสำเนา
--
-- หนึ่งแถว = หนึ่งบรรทัดของใบส่งของ = หนึ่ง "ล็อต" ที่ตัด FIFO ได้
--
-- ราคาขาย (ListPricePerTon) มาจากใบส่งของจริง ไม่ใช่ตัวเลขที่พิมพ์เอง
-- ราคาสุทธิ (NetPricePerTon) มาจากแบบขออนุมัติรายการส่งเสริมการขายที่อนุมัติแล้ว
-- คืนรีเบท/ตัน = ราคาขาย − ราคาสุทธิ  ตรงตามแบบฟอร์มกระดาษ
-- ถ้ายังไม่มีแผนครอบคลุม จะเป็น NULL (เว้นว่าง) ไม่ใช่ 0 — เพราะ 0 แปลว่า "ไม่ได้คืน"
-- ส่วน NULL แปลว่า "ยังระบุไม่ได้" ซึ่งคนละความหมายและต้องแยกให้ออกตอนตรวจ
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
    -- คืนรีเบท/ตัน และมูลค่าเป็นบาท — คำนวณให้ทั้งคู่ ผู้ใช้เลือกทำงานด้วยหน่วยไหนก็ได้
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

-- 3. ยอดคงเหลือ — ล็อตลบด้วยตันที่ถูกขอเคลียร์ไปแล้ว
--
-- แยกโควตาสองชนิดตามแบบฟอร์ม: ตันชุดเดียวกันขอได้ทั้ง "คืนรีเบท" และ "คืนส่วนต่าง"
-- (สองตารางบนกระดาษคนละหัวตาราง) จึงนับแยกกัน ไม่หักรวมกัน
--
-- ใบที่ถูกปฏิเสธ/ยกเลิกไม่นับ — ตันต้องกลับมาใช้ได้ทันทีที่ใบตกไป
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

-- 4. ปลดแผน LEGACY-WS-COUPON ที่ migration 075 หว่านไว้
--
-- 075 เตรียมไว้สำหรับการ "ย้ายยอดเดิมเข้ามาในแอป" ซึ่งถูกยกเลิกไปแล้ว
-- (เจ้าของงานยืนยันเมื่อ 6 ส.ค. 2569 ว่าใช้แหล่งเดียวคือ WINSpeed ไม่ย้ายข้อมูล)
--
-- ไม่ลบทิ้งถ้ามีเอกสารอ้างถึงอยู่ — หลักฐานที่ออกไปแล้วต้องอ่านได้เสมอ
-- 075 เองไม่ย้อนกลับ (schema ledger เป็นบันทึกที่แก้ย้อนหลังไม่ได้) และส่วนที่
-- 075 ทำกับ schema (SoId เป็น NULL ได้) ยังจำเป็นอยู่ จึงคงไว้
IF EXISTS (SELECT 1 FROM wf.RebatePlan WHERE PlanNo = 'LEGACY-WS-COUPON')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wf.RebateLedger    WHERE PlanId IN (SELECT PlanId FROM wf.RebatePlan WHERE PlanNo = 'LEGACY-WS-COUPON'))
   AND NOT EXISTS (SELECT 1 FROM wf.RebateClaimLine WHERE PlanId IN (SELECT PlanId FROM wf.RebatePlan WHERE PlanNo = 'LEGACY-WS-COUPON'))
        DELETE FROM wf.RebatePlan WHERE PlanNo = 'LEGACY-WS-COUPON';
    ELSE
        UPDATE wf.RebatePlan SET Status = 'CLOSED', UpdatedAt = GETUTCDATE() WHERE PlanNo = 'LEGACY-WS-COUPON';
END
GO

PRINT '✓ WF migration 076 complete (rebate single source: claim-line source columns + accrual views)'
GO
