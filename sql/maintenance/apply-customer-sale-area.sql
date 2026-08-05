-- =============================================================
-- apply-customer-sale-area.sql — เติมเขตขายให้ลูกค้าที่ยังไม่มี
--
-- ⚠ เขียนลง dbo.EMCust และ dbo.EMSaleArea ซึ่งเป็น **ข้อมูลหลักของ WINSpeed**
--   ไม่ใช่ตารางของแอปนี้ · รันเมื่อฝ่ายขายตรวจรายชื่อจาก review-customer-sale-area.sql แล้วเท่านั้น
--
-- ขอบเขตที่แตะ:
--   • เพิ่มเขตขาย "บึงกาฬ" หนึ่งแถว ถ้ายังไม่มี (ขั้นที่ 0)
--   • ตั้ง SaleAreaID ให้ลูกค้าเฉพาะแถวที่เป็น NULL อยู่แล้ว — ไม่เขียนทับของใครไม่ว่ากรณีใด
--
-- เงื่อนไขการเติม: จังหวัดของลูกค้าตรงกับชื่อเขตขายแบบพอดี **และตรงเพียงเขตเดียว**
--   ถ้าจังหวัดหนึ่งชนกับหลายเขต จะข้ามไปให้คนเลือกเอง ไม่เดาให้
--   ชื่อที่สะกดต่างกันแปลงผ่านตาราง #Alias ซึ่งเจ้าของระบบยืนยันแล้ว
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

-- ── ขั้นที่ 0 · เพิ่มเขตขาย "บึงกาฬ" ─────────────────────────────────
--
-- บึงกาฬแยกออกจากหนองคายเมื่อ พ.ศ. 2554 แต่ dbo.EMSaleArea ยังไม่มีแถวของจังหวัดนี้
-- ลูกค้าที่อยู่บึงกาฬจึงเติมเขตไม่ได้เลย ต้องสร้างเขตก่อน
--
-- รหัสตามรูปแบบที่ตารางใช้อยู่: ภาค(2) + รหัสจังหวัด(2) + 01 + กลุ่มย่อย(2)
--   หนองคาย = 03430102   (43 = รหัสจังหวัดหนองคาย · กลุ่มย่อย 02 = กลุ่มอุดร-หนองคาย)
--   บึงกาฬ  = 03380102   (38 = รหัสจังหวัดบึงกาฬ · อยู่กลุ่มย่อยเดียวกับหนองคายที่แยกมา)
--
-- SaleAreaID เป็น int และไม่ใช่ IDENTITY จึงต้องกำหนดเลขเอง — ใช้ค่าถัดจากที่มากที่สุด

IF NOT EXISTS (SELECT 1 FROM dbo.EMSaleArea WHERE SaleAreaCode = '03380102')
BEGIN
    DECLARE @NewAreaID INT = (SELECT MAX(SaleAreaID) + 1 FROM dbo.EMSaleArea);
    INSERT INTO dbo.EMSaleArea (SaleAreaID, SaleAreaCode, SaleAreaName, SaleAreaNameEng, Remark)
    VALUES (@NewAreaID, '03380102', N'บึงกาฬ', 'Bueng Kan',
            N'เพิ่มเมื่อ 5 ส.ค. 2569 - จังหวัดใหม่แยกจากหนองคาย ยืนยันโดยเจ้าของระบบ');
    PRINT N'เพิ่มเขตขายบึงกาฬ SaleAreaID = ' + CAST(@NewAreaID AS NVARCHAR(10));
END
ELSE
    PRINT N'มีเขตขายบึงกาฬ (03380102) อยู่แล้ว - ข้าม';
GO

-- ── แผนการเติม — คิดให้จบก่อนแตะข้อมูลลูกค้าแม้แต่แถวเดียว ─────────────

IF OBJECT_ID('tempdb..#Plan')  IS NOT NULL DROP TABLE #Plan;
IF OBJECT_ID('tempdb..#Alias') IS NOT NULL DROP TABLE #Alias;

-- ต้องตรงกับตาราง #Alias ในไฟล์ review — ยืนยันโดยเจ้าของระบบเมื่อ 5 ส.ค. 2569
-- ค่าที่ใส่ต้องเป็นค่า "หลังตัดคำนำหน้าและช่องว่างแล้ว" เช่น '  BANGKOK' เขียนเป็น 'BANGKOK'
-- COLLATE DATABASE_DEFAULT จำเป็น เพราะตารางชั่วคราวเกิดใน tempdb ซึ่งใช้ collation
-- ของเซิร์ฟเวอร์ (มักเป็น SQL_Latin1_General_CP1_CI_AS) ส่วนคอลัมน์ในฐานนี้เป็น Thai_CI_AS
-- ถ้าไม่บังคับ การเทียบข้อความจะล้มด้วย Msg 468 collation conflict
CREATE TABLE #Alias (
  Variant   NVARCHAR(100) COLLATE DATABASE_DEFAULT PRIMARY KEY,
  Canonical NVARCHAR(100) COLLATE DATABASE_DEFAULT NOT NULL);
INSERT INTO #Alias (Variant, Canonical) VALUES
  (N'กรุงเทพ',   N'กรุงเทพมหานคร'),
  (N'กรุงเทพฯ',  N'กรุงเทพมหานคร'),
  (N'BANGKOK', N'กรุงเทพมหานคร');
GO

WITH c AS (
  SELECT cu.CustID, cu.Province, ISNULL(al.Canonical, n.P) AS P
  FROM dbo.EMCust cu
  CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(cu.Province)), N'จ.', N''), N'จังหวัด', N''), N' ', N'') AS P) n
  LEFT JOIN #Alias al ON al.Variant = n.P
  WHERE cu.SaleAreaID IS NULL
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

SELECT LEFT(SaleAreaCode, 2) AS [ภาค], COUNT(*) AS [ลูกค้าที่จะได้เขต]
FROM #Plan GROUP BY LEFT(SaleAreaCode, 2) ORDER BY [ภาค];
GO

-- ── ขั้นที่ 1 · สำรองค่าเดิมไว้ก่อน ────────────────────────────────

IF OBJECT_ID('dbo.WFCustSaleAreaBackup') IS NULL
BEGIN
    CREATE TABLE dbo.WFCustSaleAreaBackup (
        CustID        NVARCHAR(20)  NOT NULL,
        OldSaleAreaID INT           NULL,     -- ชนิดต้องตรงกับ dbo.EMCust.SaleAreaID (int)
        NewSaleAreaID INT           NULL,
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
DECLARE @rowsPlanned INT = (SELECT COUNT(*) FROM #Plan);

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

SELECT ISNULL(LEFT(a.SaleAreaCode, 2), N'99') AS [ภาค], COUNT(*) AS [ลูกค้า]
FROM dbo.EMCust c
LEFT JOIN dbo.EMSaleArea a ON a.SaleAreaID = c.SaleAreaID
GROUP BY ISNULL(LEFT(a.SaleAreaCode, 2), N'99')
ORDER BY [ภาค];
GO

DROP TABLE #Plan;
DROP TABLE #Alias;
GO

-- ── ขั้นที่ 4 · ที่ยังเหลือหลังรันไฟล์นี้ ───────────────────────────────
--
-- ควรเหลือเฉพาะลูกค้าที่ไม่มีจังหวัดในระเบียนเลย (ต้องกรอกที่อยู่ก่อน)
-- และลูกค้าต่างประเทศที่ต้องให้ฝ่ายต่างประเทศระบุเขตเอง
-- ดูรายชื่อได้จากส่วนที่ 4 ของ review-customer-sale-area.sql

-- ── ขั้นที่ 5 · ย้อนกลับทั้งหมด ─────────────────────────────────────
--
-- คืนค่าเฉพาะแถวที่สคริปต์นี้เขียนไว้ และเฉพาะที่ยังไม่มีใครแก้ต่อ
-- เขตขายบึงกาฬที่เพิ่มในขั้นที่ 0 ไม่ถูกลบ เพราะเป็นข้อมูลที่ถูกต้องอยู่แล้ว
-- ถ้าต้องการลบด้วย ต้องแน่ใจว่าไม่มีลูกค้าหรือใบสั่งขายอ้างถึง

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
