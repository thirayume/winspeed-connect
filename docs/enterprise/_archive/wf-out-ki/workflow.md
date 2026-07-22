# World Fert — Workflow & Data Flow
DB: dbwins_worldfert9 | ยืนยันจากข้อมูลจริง | 2026-06-05

---

## ภาพรวม Document Chain

```
[ใบจอง 103]──AppvDocuNo──▶[ตั๋วคุม AI68-XXXXX]
      │                            │
      │                    RefNo ◀─┘
      │                            │
      ▼                            ▼
[ใบสั่งขาย 104] ◀──────────────────┘
      │ DocuNo
      │ SONo ◀─────────────────────┐
      ▼                            │
[ใบกำกับขาย 107/202] ────────────►[GL 501]
      │ SOInvID                    │ FromFlag=107
      ▼                            │ DocuNo = InvDocuNo
[ใบวางบิล 203]                     │
      │                     GLDT ──┘
      ▼                    AccID→EMAcc
[รับชำระ / AR]
```

### Join Keys ที่ยืนยันแล้ว
| จาก | ไปยัง | คอลัมน์ |
|---|---|---|
| SOHD 104 | SOHD 103 | `h104.RefNo = h103.AppvDocuNo` |
| SOInvHD 107 | SOHD 104 | `inv.SONo = h104.DocuNo` |
| SOInvHD 107 | GLHD | `g.DocuNo = inv.DocuNo AND g.FromFlag=107` |
| ARBillDT | SOInvHD | `dt.SOInvID = inv.SOInvID` |
| SOInvHD 109 (CN) | SOInvHD 107 | `cn.RefSOID = orig.SOInvID` |
| SOInvHD 110 (DN) | SOInvHD 107 | `dn.RefNo = orig.DocuNo` (RefSOID=NULL) |

---

## Scenario A — กระบวนการปกติ (Happy Path)

```
[1] เปิดใบจอง (103)  →  [2] เข้าชั่ง  →  [3] ใบสั่งขาย (104)
     →  [4] ใบกำกับ (107)  →  [5] ใบวางบิล (203)  →  [6] Post GL
```

### ขั้นที่ 1 — เปิดใบจอง (SOHD DocuType=103)

ระบบสร้าง SOHD + SODT เมื่อลูกค้ามาจอง
- `AppvFlag = 'W'` (รอชั่ง)
- `AppvDocuNo = NULL` (ยังไม่มีเลขตั๋วคุม)
- `SODT.GoodQty2` = ปริมาณที่จอง (ตัน)
- `SODT.GoodPrice2 = 0` สำหรับ **ของแถม** (เสื้อ/ปุ๋ยโบนัส)

```sql
-- ดูใบจองพร้อมรายการสินค้าและของแถม
SELECT
    h.DocuNo        AS ใบจอง,
    h.DocuDate      AS วันที่,
    c.CustName      AS ลูกค้า,
    h.TransRegistration AS ทะเบียนรถ,
    d.ListNo,
    g.GoodName1     AS สินค้า,
    d.GoodQty2      AS ปริมาณ_ตัน,
    d.GoodPrice2    AS ราคาต่อตัน,
    d.GoodAmnt      AS ยอด,
    CASE WHEN d.GoodPrice2 = 0 THEN 'ของแถม' ELSE 'ขาย' END AS ประเภท
FROM dbo.SOHD h
JOIN dbo.EMCust c ON c.CustID = h.CustID
JOIN dbo.SODT   d ON d.SOID   = h.SOID
LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
WHERE h.DocuType = 103
  AND h.AppvFlag  = 'W'
  AND h.DocuStatus = 'Y'
ORDER BY h.DocuDate DESC;
```

### ขั้นที่ 2 — เข้าชั่ง / อนุมัติตั๋วคุม

WINSpeed อัปเดต SOHD:
- `AppvFlag → 'Y'`
- `AppvDocuNo → 'AI68-XXXXX'`  (เลขตั๋วคุมจะ assign)
- `AppvDate → วันที่ชั่ง`

> **⚠ ไม่มี Gross/Tare/Net weight ใน WINSpeed** — ถ้าต้องการเก็บต้องเพิ่มใน `wf.WeighTicket`

```sql
-- ดูตั๋วคุมที่เพิ่งเข้าชั่งวันนี้
SELECT
    h.AppvDocuNo    AS เลขตั๋วคุม,
    h.DocuNo        AS ใบจอง,
    CONVERT(DATE, h.AppvDate) AS วันชั่ง,
    c.CustName      AS ลูกค้า,
    h.TransRegistration AS ทะเบียนรถ,
    h.NetAmnt       AS ยอดสุทธิ
FROM dbo.SOHD h
JOIN dbo.EMCust c ON c.CustID = h.CustID
WHERE h.DocuType  = 103
  AND h.AppvFlag  = 'Y'
  AND h.DocuStatus = 'Y'
  AND CONVERT(DATE, h.AppvDate) = CONVERT(DATE, GETDATE())
ORDER BY h.AppvDate DESC;
```

### ขั้นที่ 3 — สร้างใบสั่งขาย (SOHD DocuType=104)

WINSpeed auto-generate จาก 103:
- `RefNo = AppvDocuNo` (อ้างเลขตั๋วคุม)
- `DocuNo` = เลขเดิมจาก K/I prefix แต่ใหม่

```sql
-- ดูคู่ ใบจอง 103 <-> ใบสั่งขาย 104
SELECT
    h103.DocuNo     AS ใบจอง_103,
    h103.AppvDocuNo AS ตั๋วคุม,
    h103.AppvDate   AS วันชั่ง,
    h104.DocuNo     AS ใบSO_104,
    h104.DocuDate   AS วันสร้าง_SO,
    c.CustName      AS ลูกค้า,
    h103.NetAmnt    AS ยอด
FROM dbo.SOHD h103
JOIN dbo.SOHD   h104 ON h104.RefNo = h103.AppvDocuNo AND h104.DocuType = 104
JOIN dbo.EMCust c    ON c.CustID   = h103.CustID
WHERE h103.DocuType = 103
  AND h103.AppvFlag = 'Y'
ORDER BY h103.AppvDate DESC;
```

### ขั้นที่ 4 — ออกใบกำกับขายเชื่อ (SOInvHD DocuType=107)

- `SONo = SOHD 104 DocuNo` (link กลับไป SO)
- `DocuNo` = N68-XXXXX หรือ J68-XXXXX prefix ใหม่
- `PostGL = 'N'` → รอ post

```sql
-- Full chain: ตั๋วคุม -> SO -> ใบกำกับ
SELECT
    h103.AppvDocuNo             AS ตั๋วคุม,
    CONVERT(DATE,h103.AppvDate) AS วันชั่ง,
    h103.TransRegistration      AS ทะเบียนรถ,
    h104.DocuNo                 AS ใบSO,
    inv.DocuNo                  AS ใบกำกับ,
    CONVERT(DATE,inv.DocuDate)  AS วันออกบิล,
    c.CustName                  AS ลูกค้า,
    inv.NetAmnt                 AS ยอดสุทธิ,
    inv.VATAmnt                 AS ภาษี,
    inv.PostGL                  AS PostGL
FROM dbo.SOHD    h103
JOIN dbo.SOHD    h104 ON h104.RefNo = h103.AppvDocuNo AND h104.DocuType = 104
JOIN dbo.SOInvHD inv  ON inv.SONo   = h104.DocuNo     AND inv.Docutype  = 107
JOIN dbo.EMCust  c    ON c.CustID   = h103.CustID
WHERE h103.DocuType  = 103
  AND h103.AppvFlag  = 'Y'
ORDER BY inv.DocuDate DESC;
```

### ขั้นที่ 4b — รายการใบกำกับ (SOInvDT) แยกสินค้าจริง / ของแถม

```sql
SELECT
    inv.DocuNo                  AS ใบกำกับ,
    d.ListNo,
    d.GoodName                  AS สินค้า,
    d.GoodQty2                  AS ปริมาณ_ตัน,
    d.GoodPrice2                AS ราคา_ต่อตัน,
    d.GoodAmnt                  AS ยอด,
    CASE
        WHEN d.GoodID IS NULL       THEN 'Misc/Service'
        WHEN d.GoodPrice2 = 0       THEN 'ของแถม'
        ELSE 'สินค้าปกติ'
    END AS ประเภทบรรทัด
FROM dbo.SOInvHD inv
JOIN dbo.SOInvDT d ON d.SOInvID = inv.SOInvID
WHERE inv.DocuNo = 'N68-01455'   -- ← แทนด้วยเลขที่ต้องการ
ORDER BY d.ListNo;
```

### ขั้นที่ 5 — ใบวางบิล (ARBillHD DocuType=203)

```sql
-- ใบวางบิลพร้อมใบกำกับที่รวมอยู่
SELECT
    b.DocuNo        AS ใบวางบิล,
    CONVERT(DATE,b.DocuDate) AS วันที่,
    c.CustName      AS ลูกค้า,
    b.TotaBillAmnt  AS ยอดรวม,
    dt.SOInvNo      AS ใบกำกับ,
    dt.BillAmnt     AS ยอดในบิล,
    dt.RemaAmnt     AS ยอดค้าง
FROM dbo.ARBillHD b
JOIN dbo.ARBillDT dt ON dt.ARBillID = b.ARBillID
JOIN dbo.EMCust   c  ON c.CustID    = b.CustID
WHERE b.CustID = 1037  -- ← แทน CustID
ORDER BY b.DocuDate DESC;
```

### ขั้นที่ 6 — Post GL (GLHD/GLDT)

```sql
-- GL entries ของใบกำกับ
SELECT
    inv.DocuNo      AS ใบกำกับ,
    g.GLID,
    g.DocuDate      AS วันPost,
    dt.ListNo,
    dt.AccID,
    a.AccName,      -- AccName ต้อง cast ถ้า collation ต่าง
    dt.DrAmnt,
    dt.CrAmnt
FROM dbo.SOInvHD inv
JOIN dbo.GLHD    g   ON g.DocuNo = inv.DocuNo AND g.FromFlag = 107
JOIN dbo.GLDT    dt  ON dt.GLID  = g.GLID
JOIN dbo.EMAcc   a   ON a.AccID  = dt.AccID
WHERE inv.DocuNo = 'N68-01455'   -- ← แทนเลขใบกำกับ
ORDER BY dt.ListNo;
-- Pattern: Dr 1037 (ลูกหนี้-ค้างส่ง) / Cr 1120 (ขายสินค้า-เงินเชื่อ); ปุ๋ยยกเว้น VAT ไม่มี VAT line
```

---

## Scenario B — DocuType 202 (Flow ลัด / ขายตรง)

พบว่า **DocuType=202** ใน SOInvHD คือ invoice ที่สร้างตรงจากใบจอง/ใบสั่งขาย **โดยไม่เปลี่ยน DocuNo** (SONo = DocuNo ของตัวเอง) ต่างจาก 107 ตรงที่ไม่มีเลข N/J ใหม่

- `inv.DocuNo = inv.SONo` (เลขเดียวกัน)
- `inv.SONo = SOHD.DocuNo` (ทั้ง 103 และ 104)
- ถูก Post GL เช่นกัน (`FromFlag=202`, 112,274 records)

```sql
-- ดู 202 records ล่าสุดพร้อม chain
SELECT TOP 20
    h.DocuNo        AS SO_DocuNo,
    h.DocuType      AS SO_Type,
    h.AppvDocuNo    AS ตั๋วคุม,
    inv.DocuNo      AS Inv_DocuNo,
    inv.Docutype    AS Inv_Type,
    CONVERT(DATE,inv.DocuDate) AS วันที่,
    c.CustName,
    inv.NetAmnt,
    inv.PostGL
FROM dbo.SOInvHD inv
JOIN dbo.SOHD    h ON h.DocuNo  = inv.SONo
JOIN dbo.EMCust  c ON c.CustID  = inv.CustID
WHERE inv.Docutype = 202
ORDER BY inv.SOInvID DESC;
```

---

## Scenario C — ยกเลิกใบจอง

```
SOHD 103: DocuStatus = 'N'   (ยกเลิก)
```

```sql
-- ใบจองที่ถูกยกเลิก
SELECT
    h.DocuNo, CONVERT(DATE,h.DocuDate) AS วันที่,
    c.CustName,
    h.AppvFlag,    -- W=ยกก่อนชั่ง, Y=ยกหลังชั่ง
    h.AppvDocuNo,  -- มีเลข AI = เคยชั่งแล้วก่อนยกเลิก
    h.NetAmnt
FROM dbo.SOHD h
JOIN dbo.EMCust c ON c.CustID = h.CustID
WHERE h.DocuType   = 103
  AND h.DocuStatus = 'N'
ORDER BY h.DocuDate DESC;
```

---

## Scenario D — แก้ไขยอดด้วย Credit Note / Debit Note

### Credit Note (CN) — ลดยอด DocuType=109

`SOInvHD.RefSOID` → `SOInvHD.SOInvID` ของต้นทาง

```sql
-- CN พร้อมใบกำกับต้นทาง
SELECT
    cn.DocuNo                   AS CN_DocuNo,
    CONVERT(DATE,cn.DocuDate)   AS วันที่_CN,
    orig.DocuNo                 AS ใบกำกับต้นทาง,
    CONVERT(DATE,orig.DocuDate) AS วันที่_ต้นทาง,
    c.CustName                  AS ลูกค้า,
    cn.NetAmnt                  AS ยอดลด,
    orig.NetAmnt                AS ยอดต้นทาง,
    cn.PostGL                   AS PostGL_CN
FROM dbo.SOInvHD cn
JOIN dbo.SOInvHD orig ON orig.SOInvID = cn.RefSOID
JOIN dbo.EMCust  c    ON c.CustID     = cn.CustID
WHERE cn.Docutype = 109
ORDER BY cn.DocuDate DESC;
```

### Debit Note (DN) — เพิ่มยอด DocuType=110

⚠ **ต่างจาก CN**: DN 110 มี `RefSOID = NULL ทุกแถว` (2,420) → ต้อง link ด้วย **`RefNo`** (ข้อความ = DocuNo ต้นทาง)

```sql
-- DN link ต้นทางด้วย RefNo (ไม่ใช่ RefSOID!)
SELECT
    dn.DocuNo, dn.DocuDate, c.CustName,
    dn.RefNo    AS อ้างถึง,
    orig.DocuNo AS ใบกำกับต้นทาง,
    dn.NetAmnt  AS ยอดเพิ่ม
FROM dbo.SOInvHD dn
JOIN dbo.SOInvHD orig ON orig.DocuNo = dn.RefNo
JOIN dbo.EMCust  c    ON c.CustID     = dn.CustID
WHERE dn.Docutype = 110
ORDER BY dn.DocuDate DESC;
-- ผลจริง: DNK67-003 → K67-03131 (202) ยอดเพิ่ม 6,000
```

### ยอดสุทธิหลัง CN/DN

```sql
-- ยอดที่ลูกค้า X จ่ายจริง (รวม CN/DN)
SELECT
    c.CustName,
    SUM(CASE WHEN inv.Docutype = 107 THEN  inv.NetAmnt ELSE 0 END) AS ยอดขาย,
    SUM(CASE WHEN inv.Docutype = 109 THEN  inv.NetAmnt ELSE 0 END) AS ยอดลด_CN,
    SUM(CASE WHEN inv.Docutype = 110 THEN  inv.NetAmnt ELSE 0 END) AS ยอดเพิ่ม_DN,
    SUM(CASE
        WHEN inv.Docutype = 107 THEN  inv.NetAmnt
        WHEN inv.Docutype = 109 THEN -inv.NetAmnt
        WHEN inv.Docutype = 110 THEN  inv.NetAmnt
        ELSE 0 END)                                                  AS ยอดสุทธิ
FROM dbo.SOInvHD inv
JOIN dbo.EMCust  c ON c.CustID = inv.CustID
WHERE inv.Docutype IN (107, 109, 110)
  AND inv.CustID = 1037              -- ← แทน CustID
  AND YEAR(inv.DocuDate) = 2025
GROUP BY c.CustName;
```

---

## Scenario E — ของแถม (เสื้อ / ปุ๋ยโบนัส)

ของแถมถูกบันทึกเป็น **SODT/SOInvDT line ที่มี `GoodPrice2 = 0`**  
ไม่มี FreeFlag ใน field จริง — ใช้ `GoodPrice2 = 0` เป็นตัวแยก

```sql
-- ใบจองที่มีของแถมพร้อมรายการปกติ
SELECT
    h.DocuNo        AS ใบจอง,
    h.AppvDocuNo    AS ตั๋วคุม,
    c.CustName      AS ลูกค้า,
    d.ListNo,
    g.GoodName1     AS สินค้า,
    d.GoodQty2      AS ปริมาณ_ตัน,
    d.GoodPrice2    AS ราคา,
    d.GoodAmnt      AS ยอด,
    CASE WHEN d.GoodPrice2 = 0 THEN '★ ของแถม' ELSE 'ขาย' END AS ประเภท
FROM dbo.SOHD  h
JOIN dbo.EMCust c  ON c.CustID = h.CustID
JOIN dbo.SODT   d  ON d.SOID   = h.SOID
LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
WHERE h.DocuType  = 103
  AND h.AppvFlag  = 'Y'
  AND h.DocuStatus = 'Y'
  AND h.SOID IN (
      -- เฉพาะใบจองที่มีของแถม
      SELECT DISTINCT SOID FROM dbo.SODT
      WHERE GoodPrice2 = 0 AND GoodID IS NOT NULL
  )
ORDER BY h.DocuDate DESC, d.ListNo;
```

---

## Scenario F — Rebate (ส่วนลดย้อนหลัง)

> **⚠ WINSpeed ไม่มี Rebate module** — ต้องสร้างใน `wf` schema

### คำนวณ Rebate จากข้อมูล Transaction จริง

```sql
-- ยอดขายรายลูกค้า รายเดือน (base สำหรับคำนวณ rebate)
SELECT
    c.CustID,
    c.CustName,
    YEAR(inv.DocuDate)   AS ปี,
    MONTH(inv.DocuDate)  AS เดือน,
    SUM(d.GoodQty2)      AS ปริมาณรวม_ตัน,
    SUM(d.GoodAmnt)      AS ยอดขายรวม,
    COUNT(DISTINCT inv.SOInvID) AS จำนวนใบกำกับ
FROM dbo.SOInvHD inv
JOIN dbo.SOInvDT  d ON d.SOInvID = inv.SOInvID
JOIN dbo.EMCust   c ON c.CustID  = inv.CustID
WHERE inv.Docutype IN (107, 202)
  AND d.GoodID IS NOT NULL
  AND d.GoodPrice2 > 0       -- ไม่รวมของแถม
GROUP BY c.CustID, c.CustName, YEAR(inv.DocuDate), MONTH(inv.DocuDate)
ORDER BY ปี DESC, เดือน DESC, ยอดขายรวม DESC;
```

### Rebate จะถูกบันทึกเป็น CN (109) ใน WINSpeed

เมื่อออก rebate → สร้าง SOInvHD DocuType=109 (Credit Note) อ้าง invoice ต้นทาง

---

## Scenario G — สรุป Outstanding / ค้างชำระ

```sql
-- ใบกำกับที่ยังไม่ถูกวางบิล
SELECT
    inv.DocuNo,
    CONVERT(DATE,inv.DocuDate) AS วันที่,
    c.CustName,
    inv.NetAmnt,
    inv.PostGL,
    CASE
        WHEN EXISTS (SELECT 1 FROM dbo.ARBillDT dt WHERE dt.SOInvID = inv.SOInvID)
        THEN 'วางบิลแล้ว'
        ELSE '★ ยังไม่วางบิล'
    END AS สถานะวางบิล
FROM dbo.SOInvHD inv
JOIN dbo.EMCust  c ON c.CustID = inv.CustID
WHERE inv.Docutype IN (107, 202)
  AND inv.DocuStatus = 'Y'
  AND inv.PostGL = 'Y'         -- Post GL แล้ว
ORDER BY inv.DocuDate;
```

---

## Scenario H — ตรวจสอบ Order เดียวตลอด Chain

```sql
-- ใส่เลขตั๋วคุม AI เพื่อดู lifecycle ทั้งหมด
DECLARE @AI VARCHAR(30) = 'AI68-03542'   -- ← แทนเลขตั๋วคุม

SELECT stage, DocuNo, DocuDate_str, Amnt, Status FROM (

-- [1] ใบจอง
SELECT '1_ใบจอง'       AS stage, h.DocuNo,
    CONVERT(VARCHAR,CONVERT(DATE,h.DocuDate)) AS DocuDate_str,
    h.NetAmnt AS Amnt, h.AppvFlag AS Status
FROM dbo.SOHD h WHERE h.AppvDocuNo=@AI AND h.DocuType=103

UNION ALL
-- [2] ใบสั่งขาย
SELECT '2_ใบSO', h.DocuNo,
    CONVERT(VARCHAR,CONVERT(DATE,h.DocuDate)), h.NetAmnt, h.DocuStatus
FROM dbo.SOHD h WHERE h.RefNo=@AI AND h.DocuType=104

UNION ALL
-- [3] ใบกำกับ
SELECT '3_ใบกำกับ', inv.DocuNo,
    CONVERT(VARCHAR,CONVERT(DATE,inv.DocuDate)), inv.NetAmnt, inv.PostGL
FROM dbo.SOHD h104
JOIN dbo.SOInvHD inv ON inv.SONo=h104.DocuNo AND inv.Docutype IN (107,202)
WHERE h104.RefNo=@AI AND h104.DocuType=104

UNION ALL
-- [4a] Credit Note (109) — link ด้วย RefSOID
SELECT '4_CN', cn.DocuNo,
    CONVERT(VARCHAR,CONVERT(DATE,cn.DocuDate)), cn.NetAmnt,
    CAST(cn.Docutype AS VARCHAR)
FROM dbo.SOHD h104
JOIN dbo.SOInvHD inv ON inv.SONo=h104.DocuNo AND inv.Docutype IN (107,202)
JOIN dbo.SOInvHD cn  ON cn.RefSOID=inv.SOInvID AND cn.Docutype=109
WHERE h104.RefNo=@AI AND h104.DocuType=104

UNION ALL
-- [4b] Debit Note (110) — link ด้วย RefNo (DocuNo) เพราะ RefSOID=NULL
SELECT '4_DN', dn.DocuNo,
    CONVERT(VARCHAR,CONVERT(DATE,dn.DocuDate)), dn.NetAmnt,
    CAST(dn.Docutype AS VARCHAR)
FROM dbo.SOHD h104
JOIN dbo.SOInvHD inv ON inv.SONo=h104.DocuNo AND inv.Docutype IN (107,202)
JOIN dbo.SOInvHD dn  ON dn.RefNo=inv.DocuNo AND dn.Docutype=110
WHERE h104.RefNo=@AI AND h104.DocuType=104

UNION ALL
-- [5] ใบวางบิล
SELECT '5_ใบวางบิล', b.DocuNo,
    CONVERT(VARCHAR,CONVERT(DATE,b.DocuDate)), b.TotaBillAmnt, b.DocuStatus
FROM dbo.SOHD h104
JOIN dbo.SOInvHD  inv ON inv.SONo=h104.DocuNo AND inv.Docutype IN (107,202)
JOIN dbo.ARBillDT dt  ON dt.SOInvID=inv.SOInvID
JOIN dbo.ARBillHD b   ON b.ARBillID=dt.ARBillID
WHERE h104.RefNo=@AI AND h104.DocuType=104

UNION ALL
-- [6] GL
SELECT '6_GL', g.DocuNo,
    CONVERT(VARCHAR,CONVERT(DATE,g.DocuDate)),
    (SELECT SUM(DrAmnt) FROM dbo.GLDT WHERE GLID=g.GLID),
    CAST(g.FromFlag AS VARCHAR)
FROM dbo.SOHD h104
JOIN dbo.SOInvHD inv ON inv.SONo=h104.DocuNo AND inv.Docutype IN (107,202)
JOIN dbo.GLHD    g   ON g.DocuNo=inv.DocuNo  AND g.FromFlag IN (107,202)
WHERE h104.RefNo=@AI AND h104.DocuType=104

) t ORDER BY stage;
```

---

## Quick Reference — Status Flags

| ตาราง | คอลัมน์ | ค่า | ความหมาย |
|---|---|---|---|
| SOHD | AppvFlag | W | รอชั่ง (pending) |
| SOHD | AppvFlag | Y | ผ่านชั่งแล้ว |
| SOHD | DocuStatus | Y | Active |
| SOHD | DocuStatus | N | ยกเลิก |
| SOInvHD | PostGL | Y | Post GL แล้ว |
| SOInvHD | PostGL | N | ยังไม่ Post |
| SOInvHD | DocuStatus | Y | Active |
| SOInvHD | Docutype | 107 | ใบกำกับขายเชื่อ (N/J prefix) |
| SOInvHD | Docutype | 202 | ขายตรง (DocuNo=SONo) |
| SOInvHD | Docutype | 109 | Credit Note (ลดยอด) |
| SOInvHD | Docutype | 110 | Debit Note (เพิ่มยอด) |
| GLHD | DocuType | 501 | GL Journal (ทุกแถว) |
| GLHD | FromFlag | 107/202 | มาจากใบกำกับขาย |
