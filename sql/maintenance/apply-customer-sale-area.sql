-- =============================================================
-- apply-customer-sale-area.sql — เติมเขตขายให้ลูกค้าที่ยังไม่มี
--
-- ⚠ เขียนลง dbo.EMCust ซึ่งเป็น **ข้อมูลหลักของ WINSpeed** ไม่ใช่ตารางของแอปนี้
--   รันเมื่อฝ่ายขายตรวจรายชื่อจาก review-customer-sale-area.sql แล้วเท่านั้น
--
-- ขอบเขตที่แตะ: เฉพาะแถวที่ SaleAreaID เป็น NULL อยู่แล้ว
--   จะไม่เขียนทับเขตที่ใครตั้งไว้แล้วไม่ว่ากรณีใด
--
-- เงื่อนไขการเติม: จังหวัดของลูกค้าตรงกับชื่อเขตขายแบบพอดี **และตรงเพียงเขตเดียว**
--   ถ้าจังหวัดหนึ่งชนกับหลายเขต จะข้ามไปให้คนเลือกเอง ไม่เดาให้
--
-- กู้คืนได้: ขั้นที่ 1 เก็บค่าเดิมลง dbo.WFCustSaleAreaBackup ก่อนเขียนเสมอ
--   ย้อนกลับด้วยขั้นที่ 5 ท้ายไฟล์
--
-- ── วิธีรัน ───────────────────────────────────────────────────
--   sqlcmd -S <server> -d dbwins_worldfert9 -U <user> -i apply-customer-sale-area.sql
--
--   ไฟล์นี้บันทึกเป็น UTF-8 พร้อม BOM เพื่อให้ sqlcmd อ่านภาษาไทยถูกต้องโดยไม่ต้องใส่ -f 65001
--   ถ้าแก้ไฟล์ด้วยเอดิเตอร์อื่น ต้องรักษา BOM ไว้ ไม่งั้นข้อความภาษาไทยจะเพี้ยนทั้งไฟล์
-- =============================================================

SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID('tempdb..#Plan') IS NOT NULL DROP TABLE #Plan;

-- แผนการเติม — คิดให้จบก่อนแตะข้อมูลจริงแม้แต่แถวเดียว
WITH c AS (
  SELECT CustID, Province,
         REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(Province)), N'จ.', N''), N'จังหวัด', N''), N' ', N'') AS P
  FROM dbo.EMCust WHERE SaleAreaID IS NULL
),
a AS (
  SELECT SaleAreaID, SaleAreaCode, SaleAreaName,
         REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(SaleAreaName)), N'จ.', N''), N'จังหวัด', N''), N' ', N'') AS P
  FROM dbo.EMSaleArea
),
OneAreaOnly AS (         -- กันกรณีจังหวัดชนกันหลายเขต
  SELECT P FROM a GROUP BY P HAVING COUNT(*) = 1
)
SELECT c.CustID, c.Province, a.SaleAreaID, a.SaleAreaCode, a.SaleAreaName
INTO #Plan
FROM c
JOIN a ON a.P = c.P
JOIN OneAreaOnly s ON s.P = a.P
WHERE NULLIF(c.P, N'') IS NOT NULL;

SELECT N'จะเติมทั้งหมด' AS [รายการ], COUNT(*) AS [จำนวน] FROM #Plan;
GO

-- ── ขั้นที่ 1 · สำรองค่าเดิมไว้ก่อน ────────────────────────────────

IF OBJECT_ID('dbo.WFCustSaleAreaBackup') IS NULL
BEGIN
    CREATE TABLE dbo.WFCustSaleAreaBackup (
        CustID        NVARCHAR(20)  NOT NULL,
        OldSaleAreaID NVARCHAR(20)  NULL,
        NewSaleAreaID NVARCHAR(20)  NULL,
        Province      NVARCHAR(100) NULL,
        AppliedAt     DATETIME2     NOT NULL CONSTRAINT DF_WFCustSaleAreaBackup_At DEFAULT SYSUTCDATETIME(),
        AppliedBy     NVARCHAR(128) NOT NULL CONSTRAINT DF_WFCustSaleAreaBackup_By DEFAULT SUSER_SNAME()
    );
    PRINT N'สร้างตารางสำรอง dbo.WFCustSaleAreaBackup';
END
GO

-- ── ขั้นที่ 2 · เขียนจริง อยู่ในทรานแซกชันเดียว ─────────────────────

BEGIN TRANSACTION;

INSERT INTO dbo.WFCustSaleAreaBackup (CustID, OldSaleAreaID, NewSaleAreaID, Province)
SELECT c.CustID, c.SaleAreaID, p.SaleAreaID, p.Province
FROM dbo.EMCust c JOIN #Plan p ON p.CustID = c.CustID
WHERE c.SaleAreaID IS NULL;          -- ย้ำเงื่อนไขอีกครั้งตรงจุดที่เขียน

UPDATE c
SET c.SaleAreaID = p.SaleAreaID
FROM dbo.EMCust c
JOIN #Plan p ON p.CustID = c.CustID
WHERE c.SaleAreaID IS NULL;

DECLARE @rowsWritten INT = @@ROWCOUNT;
DECLARE @rowsPlanned  INT = (SELECT COUNT(*) FROM #Plan);

IF @rowsWritten <> @rowsPlanned
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR(N'จำนวนแถวที่เขียนจริง (%d) ไม่เท่ากับแผน (%d) - ยกเลิกทั้งหมด', 16, 1, @rowsWritten, @rowsPlanned);
END
ELSE
BEGIN
    COMMIT TRANSACTION;
    PRINT N'เติมเขตขายสำเร็จ ' + CAST(@rowsWritten AS NVARCHAR(10)) + N' ราย';
END
GO

-- ── ขั้นที่ 3 · ตรวจผล ────────────────────────────────────────────

SELECT N'ลูกค้าที่ยังไม่มีเขตขาย (เหลือ)' AS [ตรวจสอบ], COUNT(*) AS [จำนวน]
FROM dbo.EMCust WHERE SaleAreaID IS NULL;

SELECT LEFT(a.SaleAreaCode, 2) AS [ภาค], COUNT(*) AS [ลูกค้า]
FROM dbo.EMCust c
LEFT JOIN dbo.EMSaleArea a ON a.SaleAreaID = c.SaleAreaID
GROUP BY LEFT(a.SaleAreaCode, 2)
ORDER BY [ภาค];
GO

DROP TABLE #Plan;
GO

-- ── ขั้นที่ 4 · จังหวัดที่สะกดต่างกันจนจับคู่ไม่ได้ ───────────────────────
--
-- เติมด้วยมือได้ถ้าฝ่ายขายยืนยัน — ตัวอย่างชุดที่พบจริงเมื่อ 5 ส.ค. 2569
-- (กรุงเทพฯ · กรุงเทพ · BANGKOK รวม 9 ราย) ให้เอาคอมเมนต์ออกเมื่อได้รับการยืนยัน
--
-- บึงกาฬ ยังไม่มีเขตขายในระบบเลย ต้องเพิ่มแถวใน dbo.EMSaleArea ก่อน
-- ส่วนลูกค้ากัมพูชาเป็นงานส่งออก ควรให้ฝ่ายต่างประเทศระบุเขตเอง

/*
UPDATE c
SET c.SaleAreaID = (SELECT SaleAreaID FROM dbo.EMSaleArea WHERE SaleAreaName = N'กรุงเทพมหานคร')
FROM dbo.EMCust c
WHERE c.SaleAreaID IS NULL
  AND REPLACE(LTRIM(RTRIM(c.Province)), N' ', N'') IN (N'กรุงเทพฯ', N'กรุงเทพ', N'BANGKOK');
*/
GO

-- ── ขั้นที่ 5 · ย้อนกลับทั้งหมด ─────────────────────────────────────
--
-- คืนค่าเฉพาะแถวที่สคริปต์นี้เขียนไว้ และเฉพาะที่ยังไม่มีใครแก้ต่อ

/*
BEGIN TRANSACTION;
UPDATE c SET c.SaleAreaID = b.OldSaleAreaID
FROM dbo.EMCust c
JOIN dbo.WFCustSaleAreaBackup b ON b.CustID = c.CustID
WHERE c.SaleAreaID = b.NewSaleAreaID;
PRINT N'คืนค่าเดิม ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + N' ราย';
COMMIT TRANSACTION;
*/
GO
