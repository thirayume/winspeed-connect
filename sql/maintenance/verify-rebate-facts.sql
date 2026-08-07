-- =============================================================
-- verify-rebate-facts.sql   (อ่านอย่างเดียว · ไม่แก้ข้อมูลใด ๆ)
--
-- ตรวจซ้ำตัวเลขทุกตัวที่อ้างไว้ในเอกสาร CHANGES-v1.6.0-TO-v1.6.1
--
-- ตัวเลขในเอกสารนั้นวัดจาก **ฐานสำเนา** บนเครื่องพัฒนาเมื่อ 6 ส.ค. 2569
-- ซึ่งเจ้าของงานแจ้งว่าอาจไม่ครบถ้วน (ใบ RB ในสำเนาหยุดที่ มี.ค. 2569
-- ทั้งที่ใบส่งของมีถึง 2 ก.ค. 2569)
--
-- รันไฟล์นี้บน **ฐานจริง** แล้วเทียบกับคอลัมน์ [ค่าที่คาดไว้]
-- ถ้าตัวไหนไม่ตรง ให้แจ้งกลับพร้อมค่าที่ได้ — ข้อสรุปเชิงออกแบบบางข้อ
-- อ้างอิงตัวเลขเหล่านี้โดยตรง
--
-- ⚠ ไฟล์นี้บันทึกเป็น UTF-8 with BOM — ถ้าเปิดแล้วภาษาไทยเพี้ยน อย่ารัน
-- =============================================================
SET NOCOUNT ON;

PRINT '========================================================';
PRINT ' 1. คูปองกับใบส่งของ — ฐานของ "ยอดสะสมรีเบท"';
PRINT '========================================================';

SELECT N'จำนวนคูปองทั้งหมด' AS [รายการ],
       CAST(COUNT(*) AS NVARCHAR(20)) AS [ค่าที่วัดได้],
       N'111,192' AS [ค่าที่คาดไว้]
FROM dbo.WFCoupon
UNION ALL
SELECT N'ตันรวมของคูปอง',
       CAST(CAST(SUM(GoodQty) AS DECIMAL(18,2)) AS NVARCHAR(20)),
       N'2,037,464.97'
FROM dbo.WFCoupon
UNION ALL
SELECT N'ตันรวมของเอกสาร DocuType 104 (ต้องเท่ากับบรรทัดบน)',
       CAST(CAST(SUM(d.GoodQty2) AS DECIMAL(18,2)) AS NVARCHAR(20)),
       N'2,037,464.97'
FROM dbo.SOHD h JOIN dbo.SODT d ON d.SOID = h.SOID
WHERE h.DocuType = 104 AND d.GoodQty2 > 0
UNION ALL
SELECT N'คูปองที่ยังมียอดคงเหลือ (ใบ)',
       CAST(COUNT(*) AS NVARCHAR(20)), N'10'
FROM dbo.WFCoupon WHERE RemaQty > 0
UNION ALL
SELECT N'ตันคงเหลือรวม',
       CAST(CAST(SUM(RemaQty) AS DECIMAL(18,2)) AS NVARCHAR(20)), N'1,154.10'
FROM dbo.WFCoupon WHERE RemaQty > 0;

-- บรรทัดใบส่งของทุกบรรทัดต้องมีคูปองครบ 1:1 (ตรวจปีปัจจุบัน)
SELECT N'บรรทัดใบ 104 ปี 2569' AS [รายการ],
       COUNT(*) AS [บรรทัดทั้งหมด],
       SUM(CASE WHEN cp.CouponID IS NULL THEN 0 ELSE 1 END) AS [มีคูปอง],
       N'ทั้งสองช่องต้องเท่ากัน (สำเนาเดิมได้ 7,652 / 7,652)' AS [ค่าที่คาดไว้]
FROM dbo.SOHD h
JOIN dbo.SODT d ON d.SOID = h.SOID
LEFT JOIN dbo.WFCoupon cp ON cp.DocuID = h.SOID AND cp.RefListno = d.ListNo
WHERE h.DocuType = 104 AND h.DocuDate >= '2026-01-01' AND d.GoodQty2 > 0;

PRINT '';
PRINT '========================================================';
PRINT ' 2. เอกสารคืนรีเบท RB — ปลายทางของใบขอเคลียร์';
PRINT '========================================================';

SELECT N'ใบ RB ทั้งหมด (Docutype 106)' AS [รายการ],
       CAST(COUNT(*) AS NVARCHAR(20)) AS [ค่าที่วัดได้],
       N'16,195' AS [ค่าที่คาดไว้]
FROM dbo.SOInvHD WHERE DocuNo LIKE 'RB%' AND Docutype = 106
UNION ALL
SELECT N'ใบ RB ที่ไม่มี EmpID (ต้องเท่ากับบรรทัดบน)',
       CAST(COUNT(*) AS NVARCHAR(20)), N'16,195 — ถ้าน้อยกว่านี้ แปลว่าฐานจริงบันทึกผู้ขอไว้'
FROM dbo.SOInvHD WHERE DocuNo LIKE 'RB%' AND Docutype = 106 AND EmpID IS NULL
UNION ALL
SELECT N'บรรทัดย่อยของใบ 106 ทั้งหมด',
       CAST(COUNT(*) AS NVARCHAR(20)), N'18,677'
FROM dbo.SOInvDT d JOIN dbo.SOInvHD h ON h.SOInvID = d.SOInvID WHERE h.Docutype = 106
UNION ALL
SELECT N'บรรทัดย่อยที่ไม่มี GoodID (ต้องเท่ากับบรรทัดบน)',
       CAST(COUNT(*) AS NVARCHAR(20)), N'18,677 — ถ้าน้อยกว่านี้ แปลว่าฐานจริงมีรายละเอียดสูตร/ตัน'
FROM dbo.SOInvDT d JOIN dbo.SOInvHD h ON h.SOInvID = d.SOInvID
WHERE h.Docutype = 106 AND d.GoodID IS NULL
UNION ALL
SELECT N'บรรทัดย่อยที่อ้างใบกำกับ (RefeNo/RefDocuno)',
       CAST(COUNT(*) AS NVARCHAR(20)), N'0 — ถ้ามากกว่า 0 แปลว่าผูกใบกำกับได้จากของเดิม'
FROM dbo.SOInvDT d JOIN dbo.SOInvHD h ON h.SOInvID = d.SOInvID
WHERE h.Docutype = 106 AND (d.RefeNo IS NOT NULL OR d.RefDocuno IS NOT NULL);

-- ใบตัวอย่างที่ใช้ยืนยันกับกระดาษ
SELECT N'ใบตามกระดาษ RBD68-049' AS [รายการ], h.DocuNo, h.DocuDate, h.CustID,
       c.CustName, h.NetAmnt,
       N'7 พ.ค. 2568 · CustID 23037 · 55,800' AS [ค่าที่คาดไว้]
FROM dbo.SOInvHD h LEFT JOIN dbo.EMCust c ON c.CustID = h.CustID
WHERE h.DocuNo = 'RBD68-049';

-- ใบ RB ล่าสุดของแต่ละชุด — บอกว่าฐานที่รันอยู่ทันสมัยแค่ไหน
SELECT N'ใบล่าสุดของแต่ละชุดอักษร' AS [รายการ],
       SUBSTRING(DocuNo, 3, 1) AS [อักษร],
       MAX(DocuNo) AS [เลขที่ล่าสุด],
       MAX(DocuDate) AS [วันที่ล่าสุด],
       COUNT(*) AS [จำนวนใบ]
FROM dbo.SOInvHD WHERE DocuNo LIKE 'RB%' AND Docutype = 106
GROUP BY SUBSTRING(DocuNo, 3, 1)
ORDER BY [อักษร];

-- ช่วงที่ข้อมูลครอบคลุม — สำเนาเดิมใบ RB หยุดที่ มี.ค. 2569 แต่ใบส่งของถึง ก.ค.
SELECT N'ช่วงข้อมูล' AS [รายการ],
       (SELECT MAX(DocuDate) FROM dbo.SOHD WHERE DocuType = 104)                              AS [ใบส่งของล่าสุด],
       (SELECT MAX(DocuDate) FROM dbo.SOInvHD WHERE DocuNo LIKE 'RB%' AND Docutype = 106)     AS [ใบ RB ล่าสุด],
       N'ถ้าสองช่องห่างกันหลายเดือน แปลว่ายังไม่ได้ทำรีเบท หรือฐานไม่ครบ' AS [ตีความ];

PRINT '';
PRINT '========================================================';
PRINT ' 3. รหัสผู้ขอ — อักษรชุดใดเป็นของใคร';
PRINT '========================================================';

-- เกณฑ์: ใบแต่ละใบออกให้ลูกค้าของพนักงานขายคนไหน
-- หนึ่งลูกค้าไม่ได้มีพนักงานขายคนเดียวเสมอไป จึงใช้คนที่ออกใบส่งของให้บ่อยที่สุด
WITH CustEmp AS (
    SELECT CustID, EmpID,
           ROW_NUMBER() OVER (PARTITION BY CustID ORDER BY COUNT(*) DESC, EmpID) AS rn
    FROM dbo.SOHD WHERE DocuType = 104 AND EmpID IS NOT NULL
    GROUP BY CustID, EmpID
), Tally AS (
    SELECT SUBSTRING(h.DocuNo, 3, 1) AS Series, e.EmpCode, e.EmpName, COUNT(*) AS Docs
    FROM dbo.SOInvHD h
    JOIN CustEmp ce ON ce.CustID = h.CustID AND ce.rn = 1
    JOIN dbo.EMEmp e ON e.EmpID = ce.EmpID
    WHERE h.DocuNo LIKE 'RB%' AND h.Docutype = 106
    GROUP BY SUBSTRING(h.DocuNo, 3, 1), e.EmpCode, e.EmpName
)
SELECT Series AS [อักษร], EmpCode AS [รหัสพนักงาน], EmpName AS [ชื่อ], Docs AS [จำนวนใบ],
       ROW_NUMBER() OVER (PARTITION BY EmpCode ORDER BY Docs DESC) AS [ลำดับของคนนี้],
       ROW_NUMBER() OVER (PARTITION BY Series  ORDER BY Docs DESC) AS [ลำดับในอักษรนี้]
FROM Tally WHERE Docs >= 20
ORDER BY [อักษร], Docs DESC;

-- ค่าที่คาดไว้จากสำเนาเดิม (ชุดหลักของแต่ละคน = แถวที่ [ลำดับของคนนี้] = 1):
--   (อ้างด้วยรหัสพนักงาน ไม่ใส่ชื่อ เพราะที่เก็บซอร์สนี้เป็นสาธารณะ
--    ชื่อจะปรากฏในผลลัพธ์ตอนรันจากฐานข้อมูลเอง)
--   A→EMP-00027 1,679 · B→EMP-00035 3,066 · O→EMP-00021 104 · P→EMP-00033 1,941
--   T→EMP-00042 652 · V→EMP-00030 1,192 · Y→EMP-00036 1,074
--   D→EMP-00037 855 และ EMP-00034 609  (ใช้ร่วมกันจริง)
--   S→EMP-00041 1,069 (EMP-00036 EMP-00030 EMP-00042 โผล่ในชุด S ด้วย
--                      แต่ชุดหลักของแต่ละคนอยู่ที่อื่น)

PRINT '';
PRINT '========================================================';
PRINT ' 4. ลูกค้าหนึ่งรายมีพนักงานขายกี่คน (ตรวจสมมติฐาน)';
PRINT '========================================================';

SELECT EmpCount AS [จำนวนพนักงานขายต่อลูกค้า], COUNT(*) AS [จำนวนลูกค้า],
       N'สำเนาเดิม: 1 คน 305 ราย · 2 คน 112 ราย · 3 คน 88 ราย' AS [ค่าที่คาดไว้]
FROM (
    SELECT CustID, COUNT(DISTINCT EmpID) AS EmpCount
    FROM dbo.SOHD WHERE DocuType = 104 AND EmpID IS NOT NULL
    GROUP BY CustID
) t
GROUP BY EmpCount
ORDER BY EmpCount;
