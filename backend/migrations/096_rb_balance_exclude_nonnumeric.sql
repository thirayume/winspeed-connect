-- =============================================================
-- 096_rb_balance_exclude_nonnumeric.sql
--
-- ตัดเอกสารที่ส่วนท้ายไม่ใช่ตัวเลขออกจาก wf.v_RbBalance
--
-- อาการ
--   SELECT * FROM wf.v_RbBalance WHERE RbDocuNo LIKE '%TEST%'
--   → RBT69-TEST · อนุมัติ 200 · เบิกแล้ว 72 · 'เบิกบางส่วน'
--
--   เอกสารทดสอบของเจ้าของระบบ (ลว. 02/07/2569 สร้างไว้เพื่อตามรอยเอกสารให้ครบทุกขั้น)
--   ถูกนับเป็นวงเงินรีเบทจริง ปนอยู่ในมุมมองที่ใช้ดูยอดคงเหลือของลูกค้า
--
-- ทำไมแก้ที่ view ไม่ลบข้อมูล
--   เจ้าของระบบยืนยัน 23/08/2569 ว่า "ข้อมูลทดสอบ ลบหรือมองข้ามได้"
--   การลบแถวออกจากตารางบัญชีของ WINSpeed (ARReceHD + GL) ย้อนกลับไม่ได้
--   และกระทบเลขเอกสารที่เดินต่อจากนั้น จึงเลือกทางที่ปลอดภัยกว่า:
--   ให้ระบบมองข้ามเอง ส่วนตัวเอกสารยังอยู่ครบให้ตรวจย้อนได้
--   ถ้าต้องการล้างจริง ให้ยกเลิกผ่านหน้าจอ WINSpeed (DocuStatus = 'C') ซึ่งเก็บร่องรอยไว้
--
-- ใช้เกณฑ์เดียวกับ wf.v_RbNumberIntegrity ที่กรองถูกอยู่แล้ว
--   เลข RB จริงมีรูป RB{ตัวอักษรผู้แทนขาย}{ปี 2 หลัก}-{ลำดับตัวเลข}
--   ส่วนท้ายที่แปลงเป็นตัวเลขไม่ได้ = ไม่ใช่เอกสารที่เดินเลขในชุด
--   (เหตุผลเดียวกับที่ /next-rb-no ต้องเรียงด้วย TRY_CAST ไม่ใช่เรียงข้อความ
--    ไม่งั้น 'RBT69-TEST' ชนะทุกใบ แล้วระบบเสนอเลข RBT69-001 แทน RBT69-054)
--
-- คอลัมน์และคีย์เท่าเดิมทุกประการ — เปลี่ยนเฉพาะเงื่อนไข WHERE
-- =============================================================

CREATE OR ALTER VIEW wf.v_RbBalance
AS
SELECT
    RTRIM(h.DocuNo)                          AS RbDocuNo,
    CAST(h.DocuDate AS DATE)                 AS RbDate,
    SUBSTRING(RTRIM(h.DocuNo), 3, 1)         AS SeriesLetter,
    RTRIM(h.CustID)                          AS CustId,
    RTRIM(cu.CustCode)                       AS CustCode,
    RTRIM(cu.CustName)                       AS CustName,
    h.ReceAmnt                               AS ApprovedAmount,
    ISNULL(d.DrawnAmount, 0)                 AS DrawnAmount,
    h.ReceAmnt - ISNULL(d.DrawnAmount, 0)    AS RemainingAmount,
    ISNULL(d.DrawCount, 0)                   AS DrawCount,
    d.LastDrawDate,
    CASE WHEN d.DrawnAmount IS NULL              THEN N'ยังไม่เบิก'
         WHEN d.DrawnAmount >= h.ReceAmnt - 0.01 THEN N'เบิกครบ'
         ELSE N'เบิกบางส่วน' END              AS DrawStatus
FROM dbo.ARReceHD h
LEFT JOIN dbo.EMCust cu ON cu.CustID = h.CustID
OUTER APPLY (
    SELECT SUM(al.CutAdvnAmnt) AS DrawnAmount,
           COUNT(*)            AS DrawCount,
           MAX(CAST(r.DocuDate AS DATE)) AS LastDrawDate
    FROM   dbo.SOAdvnList al
    JOIN   dbo.ARReceHD r ON r.ARReceID = al.ARReceID
    WHERE  RTRIM(al.AdvnNo) = RTRIM(h.DocuNo)
) d
WHERE RTRIM(h.DocuNo) LIKE 'RB%'
  AND h.DocuType = '106'
  -- ส่วนท้ายหลังขีดต้องเป็นตัวเลขล้วน — กันเอกสารทดสอบ/เลขผิดรูปเข้ามาเป็นวงเงินจริง
  AND CHARINDEX('-', RTRIM(h.DocuNo)) > 0
  AND TRY_CAST(SUBSTRING(RTRIM(h.DocuNo),
                         CHARINDEX('-', RTRIM(h.DocuNo)) + 1,
                         10) AS INT) IS NOT NULL;
GO
