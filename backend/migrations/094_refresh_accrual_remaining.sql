-- =============================================================
-- 094_refresh_accrual_remaining.sql
--
-- แก้ wf.v_RebateAccrualRemaining ที่ใช้งานไม่ได้ — **FIFO พังอยู่ทั้ง local และ production**
--
-- อาการ
--   SELECT * FROM wf.v_RebateAccrualRemaining
--   → "View or function 'wf.v_RebateAccrualRemaining' has more column names
--      specified than columns defined."
--
-- สาเหตุ
--   view นี้เขียนว่า SELECT l.*, ... FROM wf.v_RebateAccrualLot l
--   SQL Server จำ "จำนวนคอลัมน์" ของ view ไว้ตอนสร้าง ไม่ได้คำนวณใหม่ตอนเรียก
--   migration 092 ใช้ CREATE OR ALTER เขียน wf.v_RebateAccrualLot ใหม่แล้วคอลัมน์ลดลง
--   แต่ view ลูกที่อ้าง l.* ไม่ถูก refresh ตาม metadata จึงค้างอยู่ที่จำนวนเดิม
--
--   วัดจริง 22/08/2569 (ทั้ง local และ remote ตรงกัน)
--     v_RebateAccrualLot        คอลัมน์จริง  23
--     v_RebateAccrualRemaining  metadata ค้าง 31   (ที่ถูกต้องคือ 23 + 4 = 27)
--
-- ผลกระทบ
--   routes/rebate.js ดึงล็อตสำหรับตัด FIFO จาก view นี้โดยตรง
--   (POST /api/rebate/claims → "ตัดสิทธิ์แบบ FIFO จากใบส่งของจริงใน WINSpeed")
--   แปลว่า **การยื่นใบขอเคลียร์รีเบทจะพังทันทีที่มีคนกดใช้**
--   ที่ยังไม่มีใครเจอเพราะ wf.RebatePlan ว่างมาตลอด — ไม่เคยมีล็อตให้ตัดเลย
--
-- วิธีแก้
--   เขียน view ใหม่ด้วยข้อความเดิมทุกบรรทัด (CREATE OR ALTER) เพื่อให้ SQL Server
--   คำนวณ metadata ใหม่ · เลือกวิธีนี้แทน sp_refreshview เพราะนิยามถูกเก็บใน
--   migration ไปด้วย ตรวจย้อนได้ว่า ณ เวลานั้น view หน้าตาอย่างไร
--
-- กันเกิดซ้ำ
--   ถ้าแก้ wf.v_RebateAccrualLot เมื่อไร **ต้องเขียน view นี้ใหม่ด้วยเสมอ**
--   เพราะ l.* ผูก metadata ไว้กับ view แม่
-- =============================================================

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
    -- ตันที่ถูกเคลมไปแล้วของล็อตนี้ แยกตามชนิดตาราง (คืนรีเบท / คืนส่วนต่าง)
    -- ใบที่ถูกปฏิเสธหรือยกเลิกไม่นับ — สิทธิ์ต้องคืนกลับให้ล็อตเดิม
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
