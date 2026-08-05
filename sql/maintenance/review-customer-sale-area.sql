-- =============================================================
-- review-customer-sale-area.sql — ตรวจก่อนเติมเขตขายให้ลูกค้าที่ยังไม่มี
--
-- ⚠ อ่านอย่างเดียวทั้งไฟล์ ไม่มีคำสั่งเขียนใด ๆ · รันซ้ำได้
--
-- ปัญหาที่กำลังแก้: ลูกค้า 329 รายไม่มี dbo.EMCust.SaleAreaID จึงตกไปอยู่ภาค "ไม่ระบุ" (99)
-- ทั้งหมด ทำให้การอนุมัติรีเบทชั้นที่ 2 ของลูกค้าเหล่านี้ไปรวมอยู่ที่ผู้ดูแลภาค 99 คนเดียว
-- แทนที่จะไปหาผู้จัดการของพื้นที่จริง
--
-- วิธีเดา: ใช้ "จังหวัดของลูกค้าเอง" ที่อยู่ในระเบียนลูกค้าอยู่แล้ว เทียบกับ dbo.EMSaleArea
-- ซึ่งแบ่งเขตขายเป็นรายจังหวัด (SaleAreaName = ชื่อจังหวัด) — ตรงกว่าการเดาจากผู้ขาย
-- เพราะผู้ขายคนหนึ่งขายข้ามจังหวัดได้ แต่ที่อยู่ของลูกค้าคือข้อเท็จจริงของลูกค้ารายนั้น
--
-- เมื่อฝ่ายขายตรวจรายชื่อจากไฟล์นี้แล้ว จึงค่อยรัน apply-customer-sale-area.sql
--
-- ── วิธีรัน ───────────────────────────────────────────────────
--   sqlcmd -S <server> -d dbwins_worldfert9 -U <user> -i review-customer-sale-area.sql -o review.txt
--
--   ไฟล์นี้บันทึกเป็น UTF-8 พร้อม BOM เพื่อให้ sqlcmd อ่านภาษาไทยถูกต้องโดยไม่ต้องใส่ -f 65001
--   ถ้าแก้ไฟล์ด้วยเอดิเตอร์อื่น ต้องรักษา BOM ไว้ ไม่งั้นชื่อคอลัมน์ภาษาไทยจะเพี้ยนทั้งไฟล์
--   ถ้าลืมใส่ -d จะไปรันบน master แล้วไม่พบตารางใด ๆ
--   ส่วนที่ 2.1 ต้องใช้สคีมา wf ของแอป ซึ่งอาจอยู่คนละฐาน — ถ้าไม่มีจะข้ามให้เอง
-- =============================================================

SET NOCOUNT ON;
GO

IF OBJECT_ID('tempdb..#Cust')  IS NOT NULL DROP TABLE #Cust;
IF OBJECT_ID('tempdb..#Area')  IS NOT NULL DROP TABLE #Area;
IF OBJECT_ID('tempdb..#Alias') IS NOT NULL DROP TABLE #Alias;

-- ── ตารางชื่อพ้อง — ยืนยันโดยเจ้าของระบบเมื่อ 5 ส.ค. 2569 ────────────────
--
-- ทั้งสามแบบคือกรุงเทพมหานครเหมือนกัน ต่างกันแค่วิธีสะกดในระเบียนลูกค้า
-- เพิ่มบรรทัดใหม่ได้เมื่อพบการสะกดแบบอื่น — ทั้งไฟล์ review และ apply ใช้ตารางนี้ชุดเดียวกัน
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

-- ตัดคำนำหน้าและช่องว่างออกก่อนเทียบ เพราะข้อมูลจริงมีทั้ง "นนทบุรี" และ "จังหวัดนนทบุรี"
-- แล้วจึงแปลงชื่อพ้องเป็นชื่อทางการ
SELECT c.CustID, c.CustName, c.Province,
       ISNULL(al.Canonical, n.P) AS P
INTO #Cust
FROM dbo.EMCust c
CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.Province)), N'จ.', N''), N'จังหวัด', N''), N' ', N'') AS P) n
LEFT JOIN #Alias al ON al.Variant = n.P
WHERE c.SaleAreaID IS NULL;

SELECT SaleAreaID, SaleAreaCode, SaleAreaName,
       REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(SaleAreaName)), N'จ.', N''), N'จังหวัด', N''), N' ', N'') AS P
INTO #Area
FROM dbo.EMSaleArea;
GO

-- ── 1 · ภาพรวม ────────────────────────────────────────────────

SELECT N'ลูกค้าที่ยังไม่มีเขตขาย' AS [รายการ], COUNT(*) AS [จำนวน] FROM #Cust
UNION ALL SELECT N'จับคู่จังหวัดได้ (พร้อมเติม)', COUNT(*) FROM #Cust c
          WHERE EXISTS (SELECT 1 FROM #Area a WHERE a.P = c.P)
UNION ALL SELECT N'ไม่มีจังหวัดในระเบียน',        COUNT(*) FROM #Cust WHERE NULLIF(P, N'') IS NULL
UNION ALL SELECT N'มีจังหวัดแต่ไม่ตรงเขตใด',      COUNT(*) FROM #Cust c
          WHERE NULLIF(c.P, N'') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #Area a WHERE a.P = c.P);
GO

-- ── 2 · จะเติมภาคไหนให้บ้าง ───────────────────────────────────────

SELECT LEFT(a.SaleAreaCode, 2) AS [ภาค], COUNT(*) AS [ลูกค้าที่จะได้เขต]
FROM #Cust c JOIN #Area a ON a.P = c.P
GROUP BY LEFT(a.SaleAreaCode, 2)
ORDER BY [ภาค];
GO

-- ── 2.1 · ใครจะเป็นผู้อนุมัติชั้นที่ 2 ของภาคเหล่านั้น ─────────────────────
--
-- ตาราง wf.* เป็นสคีมาของแอป ไม่ใช่ของ WINSpeed และอาจอยู่คนละฐานข้อมูล
-- จึงต้องเรียกผ่าน sp_executesql มิฉะนั้น SQL Server จะ compile ทั้ง batch ไม่ผ่าน
-- ด้วย Msg 208 ตั้งแต่ก่อนได้อ่านคำสั่ง IF — ส่วนที่เหลือของไฟล์ไม่พึ่ง wf. เลย

IF OBJECT_ID('wf.UserSaleArea') IS NOT NULL AND OBJECT_ID('wf.AppUser') IS NOT NULL
    EXEC sp_executesql N'
        SELECT r.RegionCode AS [ภาค], r.RegionName AS [ชื่อภาค],
               ISNULL(u.DisplayName, N''- ยังไม่มีผู้อนุมัติ -'') AS [ผู้อนุมัติชั้น2],
               u.Username AS [ชื่อผู้ใช้]
        FROM wf.SaleRegion r
        LEFT JOIN wf.UserSaleArea ua ON ua.RegionCode = r.RegionCode
        LEFT JOIN wf.AppUser u ON u.Id = ua.UserId
        ORDER BY r.RegionCode, ua.IsPrimary DESC;';
ELSE
    SELECT N'ข้ามส่วนผู้อนุมัติรายภาค - ฐานนี้ไม่มีสคีมา wf (เป็นสคีมาของแอป ไม่ใช่ของ WINSpeed)'
           AS [หมายเหตุ], DB_NAME() AS [ฐานที่กำลังรัน];
GO

-- ── 2.2 · รายที่จับคู่ได้เพราะตารางชื่อพ้อง ─────────────────────────────
--
-- แยกออกมาให้เห็นชัด เพราะเป็นการตัดสินใจของคน ไม่ใช่การจับคู่ตรงตัว

SELECT c.CustID AS [รหัสลูกค้า], c.CustName AS [ชื่อลูกค้า],
       c.Province AS [ที่เขียนไว้ในระเบียน], c.P AS [ตีความเป็นจังหวัด],
       a.SaleAreaCode AS [รหัสเขตที่จะเติม], a.SaleAreaName AS [ชื่อเขต]
-- แถวที่ถูกแปลงชื่อ = ค่าหลังตัดคำนำหน้าไม่เท่ากับค่าที่ใช้จับคู่จริง
FROM #Cust c
JOIN #Area a ON a.P = c.P
WHERE REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.Province)), N'จ.', N''), N'จังหวัด', N''), N' ', N'') <> c.P
ORDER BY c.CustID;
GO

-- ── 3 · รายชื่อเต็มให้ฝ่ายขายตรวจ (ส่งออกเป็น Excel ได้จากผลลัพธ์นี้) ──

SELECT c.CustID       AS [รหัสลูกค้า],
       c.CustName     AS [ชื่อลูกค้า],
       c.Province     AS [จังหวัดในระเบียน],
       a.SaleAreaCode AS [รหัสเขตที่จะเติม],
       a.SaleAreaName AS [ชื่อเขต],
       LEFT(a.SaleAreaCode, 2) AS [ภาค],
       (SELECT COUNT(*) FROM dbo.SOHD h WHERE h.CustID = c.CustID) AS [ใบสั่งขายที่เคยมี]
FROM #Cust c JOIN #Area a ON a.P = c.P
ORDER BY LEFT(a.SaleAreaCode, 2), a.SaleAreaCode, c.CustID;
GO

-- ── 4 · รายการที่เติมอัตโนมัติไม่ได้ — ต้องให้คนตัดสิน ─────────────────

SELECT c.CustID AS [รหัสลูกค้า], c.CustName AS [ชื่อลูกค้า],
       ISNULL(NULLIF(c.Province, N''), N'(ไม่ระบุจังหวัด)') AS [จังหวัดในระเบียน],
       (SELECT COUNT(*) FROM dbo.SOHD h WHERE h.CustID = c.CustID) AS [ใบสั่งขายที่เคยมี],
       CASE WHEN NULLIF(c.P, N'') IS NULL THEN N'ไม่มีจังหวัด - ต้องกรอกที่อยู่ก่อน'
            ELSE N'จังหวัดไม่ตรงเขตใด - สะกดต่างกัน (เพิ่มใน #Alias) หรือยังไม่มีเขตขายของจังหวัดนี้' END AS [เหตุผล]
FROM #Cust c
WHERE NOT EXISTS (SELECT 1 FROM #Area a WHERE a.P = c.P)
ORDER BY [ใบสั่งขายที่เคยมี] DESC, c.CustID;
GO

-- ── 4.1 · จังหวัดที่ยังไม่มีเขตขายในระบบเลย ─────────────────────────────
--
-- ต่างจากการสะกดผิด: จังหวัดเหล่านี้ไม่มีแถวใน dbo.EMSaleArea จริง ๆ
-- ต้องเพิ่มเขตขายก่อนจึงจะเติมให้ลูกค้าได้ — apply ขั้นที่ 0 เพิ่มบึงกาฬให้แล้ว

SELECT c.P AS [จังหวัด], COUNT(*) AS [ลูกค้าที่รออยู่],
       CASE WHEN c.P = N'บึงกาฬ'
            THEN N'จังหวัดใหม่แยกจากหนองคาย อยู่ภาค 03 - apply ขั้นที่ 0 เพิ่มเขต 03380102 ให้'
            ELSE N'ต้องตัดสินว่าจะเพิ่มเขตขายใหม่ หรือผูกกับเขตที่มีอยู่' END AS [ทางแก้]
FROM #Cust c
WHERE NULLIF(c.P, N'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM #Area a WHERE a.P = c.P)
GROUP BY c.P
ORDER BY [ลูกค้าที่รออยู่] DESC;
GO

-- ── 5 · ความปลอดภัย: จังหวัดที่ตรงกับมากกว่าหนึ่งเขต ──────────────────
--
-- ถ้ามีแถวออกมา แปลว่าการเติมอัตโนมัติจะเลือกเขตไม่ได้ และสคริปต์ apply
-- จะข้ามลูกค้ากลุ่มนี้ไปโดยอัตโนมัติ ต้องให้คนเลือกเอง

SELECT a.P AS [จังหวัด], COUNT(*) AS [จำนวนเขตที่ชนกัน],
       STRING_AGG(CAST(a.SaleAreaCode AS NVARCHAR(50)) + N' ' + a.SaleAreaName, N' / ') AS [เขตที่ชนกัน]
FROM #Area a GROUP BY a.P HAVING COUNT(*) > 1;
GO

DROP TABLE #Cust;
DROP TABLE #Area;
DROP TABLE #Alias;
GO
