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
-- =============================================================

SET NOCOUNT ON;
GO

-- ตัดคำนำหน้าและช่องว่างออกก่อนเทียบ เพราะข้อมูลจริงมีทั้ง "นนทบุรี" และ "จังหวัดนนทบุรี"
IF OBJECT_ID('tempdb..#Cust') IS NOT NULL DROP TABLE #Cust;
IF OBJECT_ID('tempdb..#Area') IS NOT NULL DROP TABLE #Area;

SELECT CustID, CustName, Province,
       REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(Province)), N'จ.', N''), N'จังหวัด', N''), N' ', N'') AS P
INTO #Cust
FROM dbo.EMCust WHERE SaleAreaID IS NULL;

SELECT SaleAreaID, SaleAreaCode, SaleAreaName,
       REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(SaleAreaName)), N'จ.', N''), N'จังหวัด', N''), N' ', N'') AS P
INTO #Area
FROM dbo.EMSaleArea;

-- ── 1 · ภาพรวม ────────────────────────────────────────────────

SELECT N'ลูกค้าที่ยังไม่มีเขตขาย' AS รายการ, COUNT(*) AS จำนวน FROM #Cust
UNION ALL SELECT N'จับคู่จังหวัดได้ (พร้อมเติม)', COUNT(*) FROM #Cust c
          WHERE EXISTS (SELECT 1 FROM #Area a WHERE a.P = c.P)
UNION ALL SELECT N'ไม่มีจังหวัดในระเบียน',        COUNT(*) FROM #Cust WHERE NULLIF(P, N'') IS NULL
UNION ALL SELECT N'มีจังหวัดแต่ไม่ตรงเขตใด',      COUNT(*) FROM #Cust c
          WHERE NULLIF(c.P, N'') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #Area a WHERE a.P = c.P);
GO

-- ── 2 · จะเติมภาคไหนให้บ้าง และใครจะเป็นผู้อนุมัติชั้นที่ 2 ──────────

SELECT LEFT(a.SaleAreaCode, 2) AS ภาค,
       COUNT(*) AS ลูกค้าที่จะได้เขต,
       (SELECT TOP 1 u.DisplayName FROM wf.UserSaleArea ua
        JOIN wf.AppUser u ON u.Id = ua.UserId
        WHERE ua.RegionCode = LEFT(a.SaleAreaCode, 2)
        ORDER BY ua.IsPrimary DESC) AS ผู้อนุมัติชั้น2
FROM #Cust c JOIN #Area a ON a.P = c.P
GROUP BY LEFT(a.SaleAreaCode, 2)
ORDER BY ภาค;
GO

-- ── 3 · รายชื่อเต็มให้ฝ่ายขายตรวจ (ส่งออกเป็น Excel ได้จากผลลัพธ์นี้) ──

SELECT c.CustID       AS รหัสลูกค้า,
       c.CustName     AS ชื่อลูกค้า,
       c.Province     AS จังหวัดในระเบียน,
       a.SaleAreaCode AS รหัสเขตที่จะเติม,
       a.SaleAreaName AS ชื่อเขต,
       LEFT(a.SaleAreaCode, 2) AS ภาค,
       (SELECT COUNT(*) FROM dbo.SOHD h WHERE h.CustID = c.CustID) AS ใบสั่งขายที่เคยมี
FROM #Cust c JOIN #Area a ON a.P = c.P
ORDER BY LEFT(a.SaleAreaCode, 2), a.SaleAreaCode, c.CustID;
GO

-- ── 4 · รายการที่เติมอัตโนมัติไม่ได้ — ต้องให้คนตัดสิน ─────────────────

SELECT c.CustID AS รหัสลูกค้า, c.CustName AS ชื่อลูกค้า,
       ISNULL(NULLIF(c.Province, N''), N'(ไม่ระบุจังหวัด)') AS จังหวัดในระเบียน,
       (SELECT COUNT(*) FROM dbo.SOHD h WHERE h.CustID = c.CustID) AS ใบสั่งขายที่เคยมี,
       CASE WHEN NULLIF(c.P, N'') IS NULL THEN N'ไม่มีจังหวัด — ต้องกรอกที่อยู่ก่อน'
            ELSE N'จังหวัดไม่ตรงเขตใด — สะกดต่างกัน หรือยังไม่มีเขตขายของจังหวัดนี้' END AS เหตุผล
FROM #Cust c
WHERE NOT EXISTS (SELECT 1 FROM #Area a WHERE a.P = c.P)
ORDER BY ใบสั่งขายที่เคยมี DESC, c.CustID;
GO

-- ── 5 · ความปลอดภัย: จังหวัดที่ตรงกับมากกว่าหนึ่งเขต ──────────────────
--
-- ถ้ามีแถวออกมา แปลว่าการเติมอัตโนมัติจะเลือกเขตไม่ได้ และสคริปต์ apply
-- จะข้ามลูกค้ากลุ่มนี้ไปโดยอัตโนมัติ ต้องให้คนเลือกเอง

SELECT a.P AS จังหวัด, COUNT(*) AS จำนวนเขตที่ชนกัน,
       STRING_AGG(a.SaleAreaCode + N' ' + a.SaleAreaName, N' · ') AS เขตที่ชนกัน
FROM #Area a GROUP BY a.P HAVING COUNT(*) > 1;
GO

DROP TABLE #Cust;
DROP TABLE #Area;
GO
