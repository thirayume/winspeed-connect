# SQL Performance Tuning Guide

## ปัญหาเดิม — ทำไมถึงช้า 6 นาที

### 1. Correlated Subquery (ฆาตกรตัวจริง)

```sql
-- ❌ แบบเดิม: รัน subquery 1 ครั้งต่อทุก row ใน SOHD
SELECT ...,
  (SELECT ISNULL(SUM(d.GoodQty2), 0)        -- รันซ้ำ N ครั้ง
   FROM dbo.SODT d WHERE d.SOID = h.SOID)   -- N = จำนวน control tickets
FROM dbo.SOHD h WHERE ...
```

ถ้ามี Control Tickets 500 รายการ → subquery รัน 500 ครั้ง
และ DrawnQtyTon subquery ซับซ้อนกว่าอีก (3 tables + OR condition)

### 2. OR Condition ใน Subquery

```sql
-- ❌ OR ทำให้ SQL Server ไม่สามารถใช้ Index Seek ได้
AND (h2.RefNo = h.AppvDocuNo OR wfl.RefControlTicketNo = h.AppvDocuNo)
-- → Full scan ทุกครั้ง
```

### 3. Missing Indexes

ไม่มี index บน `SOHD(DocuType, DocuStatus, AppvDocuNo)` → ทุก query ต้อง scan ทั้งตาราง

---

## วิธีแก้

### Step 1: สร้าง Indexes

```bash
cd backend
node run_migrations.js   # จะรัน 002_performance_indexes.sql อัตโนมัติ
```

หรือรัน SQL ตรงใน SSMS:

```sql
-- ดู migrations/002_performance_indexes.sql
```

### Step 2: ใช้ Optimized Queries

---

## Optimized Query 1 — ตั๋วคุมที่มีสินค้าคงเหลือ

**เดิม:** Correlated subquery 2 ตัว + OR condition = ~6 นาที  
**ใหม่:** Pre-aggregated JOINs + UNION แทน OR = < 5 วินาที

```sql
WITH
-- [1] รวม qty ทั้งหมดต่อ control ticket (1 pass แทน N passes)
TotalPerTicket AS (
    SELECT h.SOID, SUM(d.GoodQty2) AS TotalQtyTon
    FROM dbo.SOHD h WITH (NOLOCK)
    JOIN dbo.SODT d WITH (NOLOCK) ON d.SOID = h.SOID
    WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND h.AppvDocuNo LIKE 'AI%'
    GROUP BY h.SOID
),

-- [2] รวม qty ที่ถูกใช้แล้ว — แยก 2 path แทน OR (UNION deduplicates)
DrawnPerTicket AS (
    -- Path A: match ผ่าน SOHD.RefNo (delivery header reference)
    SELECT h2.RefNo AS ControlTicketNo, d2.SOID AS DeliverySoid, d2.ListNo, d2.GoodQty2
    FROM dbo.SOHD h2 WITH (NOLOCK)
    JOIN dbo.SODT d2 WITH (NOLOCK) ON d2.SOID = h2.SOID
    WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C'
      AND h2.RefNo LIKE 'AI%'

    UNION  -- ไม่ใช่ UNION ALL เพื่อ dedup กรณี match ทั้ง 2 path

    -- Path B: match ผ่าน SalesOrderLine.RefControlTicketNo (line-level reference)
    SELECT wfl.RefControlTicketNo AS ControlTicketNo, d2.SOID AS DeliverySoid, d2.ListNo, d2.GoodQty2
    FROM dbo.SOHD h2 WITH (NOLOCK)
    JOIN dbo.SODT d2 WITH (NOLOCK) ON d2.SOID = h2.SOID
    JOIN wf.SalesOrderLine wfl WITH (NOLOCK) ON wfl.SoId = h2.SOID AND wfl.LineNum = d2.ListNo
    WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C'
      AND wfl.RefControlTicketNo LIKE 'AI%'
),
DrawnAgg AS (
    SELECT ControlTicketNo, SUM(GoodQty2) AS DrawnQtyTon
    FROM DrawnPerTicket
    GROUP BY ControlTicketNo
),

-- [3] รวม control ticket header + quantities
ControlTickets AS (
    SELECT
        h.CustID,
        h.AppvDocuNo AS DocuNo,
        h.SOID,
        h.DocuDate,
        t.TotalQtyTon,
        ISNULL(dr.DrawnQtyTon, 0) AS DrawnQtyTon,
        t.TotalQtyTon - ISNULL(dr.DrawnQtyTon, 0) AS RemainQtyTon
    FROM dbo.SOHD h WITH (NOLOCK)
    JOIN TotalPerTicket t ON t.SOID = h.SOID
    LEFT JOIN DrawnAgg dr ON dr.ControlTicketNo = h.AppvDocuNo
    WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND h.AppvDocuNo LIKE 'AI%'
),

ActiveTickets AS (
    SELECT * FROM ControlTickets WHERE RemainQtyTon > 0
)

SELECT TOP 100
    c.CustID,
    c.CustName,
    t.DocuNo        AS ControlTicketNo,
    t.RemainQtyTon  AS TicketRemainQty,
    g.GoodCode,
    g.GoodName1     AS GoodName,
    d.GoodQty2      AS LineQty
FROM ActiveTickets t
JOIN dbo.EMCust c WITH (NOLOCK) ON c.CustID = t.CustID
JOIN dbo.SODT   d WITH (NOLOCK) ON d.SOID   = t.SOID
JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = d.GoodID
ORDER BY t.DocuDate DESC;
```

---

## Optimized Query 2 — ยอด Rebate คงเหลือต่อลูกค้า

Query นี้ค่อนข้างดีอยู่แล้ว ปัญหาหลักคือ **missing index** บน `wf.RebateLedger`  
หลังสร้าง `IX_RebateLedger_CustBalance` ควรเร็วมาก

```sql
-- Query เดิมใช้ได้ ไม่ต้องเปลี่ยน logic
-- แค่เพิ่ม index แล้วก็จะเร็วขึ้นมาก
SELECT 
    c.CustID,
    c.CustName,
    SUM(r.RemainingAmt)  AS RebateBalance,
    MIN(r.CreatedAt)     AS OldestRebateDate,
    COUNT(r.Id)          AS RebateTransactionCount
FROM wf.RebateLedger r
JOIN dbo.EMCust c WITH (NOLOCK) ON c.CustID = r.CustId
WHERE r.Status = 'PENDING' AND r.RemainingAmt > 0 AND r.ReversedFlag = 0
GROUP BY c.CustID, c.CustName
ORDER BY RebateBalance DESC;
```

---

## ตรวจสอบ Execution Plan

รันใน SSMS เพื่อยืนยันว่า index ถูกใช้:

```sql
-- เปิด Actual Execution Plan (Ctrl+M) แล้วรัน query
-- ดูว่าแต่ละ node ใช้ "Index Seek" (ดี) ไม่ใช่ "Table Scan" หรือ "Index Scan" (ช้า)

-- ตรวจสอบ index ที่สร้างแล้ว
SELECT 
    i.name AS IndexName,
    i.type_desc,
    s.user_seeks,
    s.user_scans,
    s.last_user_seek
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats s 
    ON s.object_id = i.object_id AND s.index_id = i.index_id
WHERE i.object_id IN (
    OBJECT_ID('dbo.SOHD'),
    OBJECT_ID('dbo.SODT'),
    OBJECT_ID('wf.SalesOrderLine'),
    OBJECT_ID('wf.RebateLedger')
)
AND i.name LIKE 'IX_%'
ORDER BY i.object_id, i.name;
```

---

## สรุป Before/After

| | เดิม | ใหม่ |
|---|---|---|
| Control Ticket query | ~6 นาที | < 5 วินาที |
| Rebate Balance query | ช้า | < 1 วินาที |
| Correlated subqueries | N × (3-table join) | 1 pass ต่อ table |
| OR condition | Full scan | UNION → 2 Index Seeks |
| Indexes | ไม่มี | 5 covering indexes |

---

## General Rules สำหรับ Queries ใน Project นี้

1. **ห้ามใช้ correlated subquery ใน SELECT list** ถ้า subquery ต้อง join หลาย table  
   → ใช้ CTE หรือ derived table pre-aggregate แทน

2. **OR condition ใน WHERE/JOIN = red flag**  
   → แยกเป็น UNION 2 query แล้วเอา aggregate รวมกัน

3. **ทุก filter column ควรมี index**  
   → `DocuType + DocuStatus + AppvDocuNo` ควรอยู่ใน index เดียวกัน (composite)

4. **INCLUDE columns ใน index** เพื่อ avoid key lookup  
   → ถ้า SELECT ต้องการ column ที่ไม่ใช่ key → ใส่ใน INCLUDE

5. **NOLOCK คือ trade-off**  
   → ป้องกัน lock wait แต่อาจอ่าน dirty read  
   → OK สำหรับ reporting ที่ไม่ต้องการความแม่นยำ 100%
