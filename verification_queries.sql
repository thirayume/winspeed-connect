-- ==============================================================================
-- WS-SALE-APP DATA VERIFICATION QUERIES
-- ==============================================================================
-- ชุดคำสั่ง SQL สำหรับใช้ตรวจสอบความถูกต้องของข้อมูล (Audit/Verification)
-- เทียบกับสิ่งที่แสดงผลบนระบบหน้าบ้าน (Frontend Web)
-- 
-- คำเตือน: ชื่อคอลัมน์ด้านล่างถูกเขียนตามโครงสร้างของ Backend (Prisma/TypeORM)
-- โปรดแก้ไขชื่อคอลัมน์ [ในวงเล็บ] ให้ตรงกับโครงสร้างจริงในฐานข้อมูล WINSpeed ของคุณ
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. จัดการข้อมูลหลัก (Master Data) -> แท็บ "ข้อมูลสินค้า" (GoodsManager)
-- ------------------------------------------------------------------------------
-- การแสดงผล: เรียงลำดับสินค้าขายดี (Best Sellers) และประวัติการขาย
-- หมายเหตุบนเว็บ: ดึง 500 รายการล่าสุด
-- Query สำหรับดูยอดขาย "ทั้งหมด" เรียงจากมากไปน้อย:
SELECT 
    g.GoodName1 AS GoodName, -- ตรวจสอบว่าตารางคุณใช้ GoodName1 หรือ GoodName2
    line.GoodId, 
    SUM(line.QtyTon) AS TotalQtyTon,
    COUNT(DISTINCT so.Id) AS TransactionCount
FROM wf.SalesOrder so
JOIN wf.SalesOrderLine line ON so.Id = line.SoId
JOIN dbo.EMGood g ON g.GoodID = line.GoodId
WHERE so.Status NOT IN ('CANCELLED', 'DRAFT') 
GROUP BY line.GoodId, g.GoodName1
ORDER BY TotalQtyTon DESC;

-- ------------------------------------------------------------------------------
-- 2. จัดการข้อมูลหลัก (Master Data) -> แท็บ "รถบรรทุก" (TrucksManager)
-- ------------------------------------------------------------------------------
-- การแสดงผล: สถิติรถบรรทุกที่เข้ามารับของบ่อยที่สุด และยอดขายที่พ่วงกับรถคันนั้น
-- หมายเหตุบนเว็บ: ดึง 500 รายการล่าสุด
-- Query สำหรับดูสถิติรถทั้งหมด:
SELECT 
    so.TruckPlate,
    so.CustName,
    COUNT(DISTINCT so.Id) AS VisitCount,
    SUM(line.QtyTon) AS TotalQtyTon,
    MAX(so.CreatedAt) AS LastVisitDate
FROM wf.SalesOrder so
JOIN wf.SalesOrderLine line ON so.Id = line.SoId
WHERE so.Status NOT IN ('CANCELLED', 'DRAFT') 
  AND so.TruckPlate IS NOT NULL 
  AND so.TruckPlate <> ''
  AND so.TruckPlate <> '-'
GROUP BY so.TruckPlate, so.CustName
ORDER BY VisitCount DESC;

-- ------------------------------------------------------------------------------
-- 3. แดชบอร์ด (Dashboard) -> รายงานสินค้าค้างรับ (Aging Orders)
-- ------------------------------------------------------------------------------
-- การแสดงผล: ยอดสินค้าค้างส่งมอบ แยกตามอายุใบสั่งขาย (Days Open)
-- สถานะที่สนใจ: CONFIRMED และ PICKING
-- Query ตรวจสอบ:
SELECT 
    so.WfRef,
    so.CustName,
    line.GoodCode,
    line.QtyTon,
    so.Status,
    DATEDIFF(day, so.CreatedAt, GETDATE()) AS DaysOpen
FROM wf.SalesOrder so
JOIN wf.SalesOrderLine line ON so.Id = line.SoId
WHERE so.Status IN ('CONFIRMED', 'PICKING')
ORDER BY DaysOpen DESC;

-- ------------------------------------------------------------------------------
-- 4. จัดการของแถม (GiveawaysManager) -> รายการเบิกจ่ายของแถม (Withdrawals)
-- ------------------------------------------------------------------------------
-- การแสดงผล: ตรวจสอบจำนวนเบิกจ่ายของแถมในระบบ
-- Query ตรวจสอบ:
SELECT 
    w.Region,
    w.Brand,
    w.ItemName,
    SUM(w.Qty) AS TotalWithdrawn
FROM wf.GiveawayWithdrawal w
WHERE w.PeriodYear = YEAR(GETDATE()) + 543 -- ดึงเฉพาะปีปัจจุบัน (บวก 543 เพื่อเป็น พ.ศ.)
GROUP BY w.Region, w.Brand, w.ItemName
ORDER BY w.Region, TotalWithdrawn DESC;

-- ------------------------------------------------------------------------------
-- 5. บัญชี (Accounting) -> ส่วนลดสะสม (Rebate Ledger)
-- ------------------------------------------------------------------------------
-- การแสดงผล: ยอดรีเบทคงเหลือ (Accrued vs Claimed)
-- Query ตรวจสอบ:
SELECT 
    r.SalesUserId,
    SUM(l.RebateAmount) AS TotalRebateAccrued,
    SUM(CASE WHEN l.Status = 'CLAIMED' THEN l.RebateAmount ELSE 0 END) AS TotalRebateClaimed,
    SUM(CASE WHEN l.Status = 'PENDING' THEN l.RebateAmount ELSE 0 END) AS TotalRebateAvailable
FROM wf.RebatePool r
JOIN wf.RebateLedger l ON r.Id = l.PoolId
GROUP BY r.SalesUserId
ORDER BY TotalRebateAvailable DESC;
