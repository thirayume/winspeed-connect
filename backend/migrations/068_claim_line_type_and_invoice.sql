-- =============================================================
-- 068_claim_line_type_and_invoice.sql
--
-- ใบขอเคลียร์ของจริง (RBD68-019) มีสองตาราง ไม่ใช่ตารางเดียว
--
--   ตาราง 1 "คืนรีเบท"      เทียบ ราคาขาย กับ ราคาสุทธิตามโปรโมชั่น
--   ตาราง 2 "คืนส่วนต่าง"   เทียบ ราคาขาย กับ ราคาขายใน Pricelist
--
-- ทั้งสองใช้รูปคำนวณเดียวกัน (ราคาขาย − ราคาที่ใช้เทียบ) × ตัน ต่างกันแค่
-- "ราคาที่ใช้เทียบ" จึงเก็บในตารางเดียวแล้วแยกด้วย LineType ไม่ต้องสร้างตารางที่สอง
-- CHECK และคอลัมน์คำนวณเดิมยังใช้ได้กับทั้งสองชนิดโดยไม่ต้องแก้
--
--   ⚠ ความหมายของ NetPricePerTon ขึ้นกับ LineType
--        REBATE → ราคาสุทธิที่โปรโมชั่นกำหนด
--        DIFF   → ราคาขายใน Pricelist ของเดือนนั้น
--     หน้าจอและแบบพิมพ์ต้องแสดงหัวคอลัมน์ตามชนิด ไม่ใช้คำว่า "ราคาสุทธิ" กับทั้งสอง
--
-- และคอลัมน์แรกของทั้งสองตารางคือ "ที่/เลขที่ INV" — ใบกำกับผูก "รายบรรทัด"
-- ไม่ใช่ระดับหัวบิลอย่างที่ออกแบบไว้ตอนแรก (wf.RebateClaimInvoice ยังคงไว้
-- สำหรับใบกำกับที่ตัดเคลียร์ร่วมทั้งใบ ซึ่งเป็นคนละความหมาย)
--
-- Safe to re-run (idempotent)
-- =============================================================

IF COL_LENGTH('wf.RebateClaimLine', 'LineType') IS NULL
  ALTER TABLE wf.RebateClaimLine ADD LineType NVARCHAR(10) NOT NULL
    CONSTRAINT df_RebateClaimLine_LineType DEFAULT 'REBATE';
GO

IF COL_LENGTH('wf.RebateClaimLine', 'InvoiceNo') IS NULL
  ALTER TABLE wf.RebateClaimLine ADD InvoiceNo NVARCHAR(50) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_RebateClaimLine_LineType')
  ALTER TABLE wf.RebateClaimLine WITH CHECK ADD CONSTRAINT chk_RebateClaimLine_LineType
    CHECK (LineType IN ('REBATE', 'DIFF'));
GO

-- ค้นบรรทัดตามใบกำกับได้เร็ว ใช้ตอนกระทบยอดกับ D/O
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_RebateClaimLine_InvoiceNo')
  CREATE INDEX ix_RebateClaimLine_InvoiceNo ON wf.RebateClaimLine (InvoiceNo)
    WHERE InvoiceNo IS NOT NULL;
GO

-- แยกยอดสองชนิดให้อ่านได้ทันทีโดยไม่ต้องรวมเองทุกครั้ง
-- ไม่เก็บเป็นคอลัมน์ในหัวบิลเพราะจะซ้ำกับผลรวมของบรรทัดแล้วมีโอกาสไม่ตรงกัน
IF OBJECT_ID('wf.v_RebateClaimTotals', 'V') IS NOT NULL DROP VIEW wf.v_RebateClaimTotals;
GO
CREATE VIEW wf.v_RebateClaimTotals AS
SELECT c.Id AS ClaimId,
       c.ClaimAmt,
       ISNULL(SUM(CASE WHEN l.LineType = 'REBATE' THEN l.LineAmount END), 0) AS RebateAmt,
       ISNULL(SUM(CASE WHEN l.LineType = 'DIFF'   THEN l.LineAmount END), 0) AS DiffAmt,
       ISNULL(SUM(CASE WHEN l.LineType = 'REBATE' THEN l.QtyTon END), 0)     AS RebateTon,
       ISNULL(SUM(CASE WHEN l.LineType = 'DIFF'   THEN l.QtyTon END), 0)     AS DiffTon,
       COUNT(l.LineId) AS LineCount
FROM wf.RebateClaim c
LEFT JOIN wf.RebateClaimLine l ON l.ClaimId = c.Id
GROUP BY c.Id, c.ClaimAmt;
GO
