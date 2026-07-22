# GL Flow — ใบจอง → SOInv → AR/GL
DB: dbwins_worldfert9 | ยืนยัน: 2026-06-05

---

## สาย Document

```
SOHD/SODT (Docutype=103/104, ใบจอง/ใบสั่งขาย)
    ↓ SODT.SOID = SOHD.SOID
SOPickingHD/DT (Docutype=105, ใบจัดสินค้า)
    ↓ SOPickingDT.SOID = SOHD.SOID
SOInvHD/DT (Docutype=107, ใบกำกับขายเชื่อ)
    ↓ [PostGL='Y'] SOInvHD.PostID = GLHD.FromID
GLHD (DocuType=501, GL Journal)
    ↓ GLDT.GLID = GLHD.GLID
GLDT → EMAcc (AccID → ผังบัญชี)
```

---

## DocuType Reference

| DocuType | ชื่อ (EN) | ตาราง HD | ตาราง DT | PK |
|---|---|---|---|---|
| 103 | Confirm Order (ใบจอง) | SOHD | SODT | SOID |
| 104 | Sale Order (ใบสั่งขาย) | SOHD | SODT | SOID |
| 105 | Picking Slip (ใบจัดสินค้า) | SOPickingHD | SOPickingDT | PickingID |
| **107** | **Sale on Credit (ใบกำกับขายเชื่อ)** | **SOInvHD** | **SOInvDT** | **SOInvID** |
| 108 | Cash Sale (ขายสด) | SOInvHD | SOInvDT | SOInvID |
| 109 | Credit Note (ลดหนี้) | SOInvHD | SOInvDT | SOInvID |
| 110 | Debit Note (เพิ่มหนี้) | SOInvHD | SOInvDT | SOInvID |
| **501** | **GL Journal** | **GLHD** | **GLDT** | **GLID** |

**DocuType 202 ใน SOInvHD**: ไม่มีใน ICDocuTypeHD — คาดว่าเป็น IC-integrated transaction (prefix K/I, 113,043 rows)

---

## GLHD.FromFlag คืออะไร

`GLHD.FromFlag` = DocuType ของ source document (ไม่ใช่ GLHD.DocuType)

| FromFlag | Source | Count |
|---|---|---|
| 107 | SOInvHD (ใบกำกับขายเชื่อ) | 145,036 |
| 202 | SOInvHD (DocuType=202) | 112,274 |
| 206 | — | 50,138 |
| 309 | POInvHD (Credit Purchase) | 31,717 |
| 501 | GL ปรับปรุง | 21,660 |

---

## วิธี JOIN ที่ถูกต้อง

### ✅ วิธี 1: Join ผ่าน DocuNo (แนะนำ — ชัดเจนที่สุด)

```sql
SELECT
    s.SOInvID,
    s.DocuNo        AS InvNo,
    s.DocuDate      AS InvDate,
    s.CustID,
    s.NetAmnt       AS InvNetAmnt,
    g.GLID,
    g.DocuDate      AS GLPostDate,
    dt.ListNo,
    dt.AccID,
    a.AccName       AS AccName,
    dt.DrAmnt,
    dt.CrAmnt
FROM dbo.SOInvHD s
JOIN dbo.GLHD    g  ON g.DocuNo  = s.DocuNo  AND g.FromFlag = 107
JOIN dbo.GLDT    dt ON dt.GLID   = g.GLID
JOIN dbo.EMAcc   a  ON a.AccID   = dt.AccID
WHERE s.Docutype = 107
ORDER BY s.SOInvID, dt.ListNo;
```

### ✅ วิธี 2: Join ผ่าน PostID (เมื่อต้องการ PostID เป็น anchor)

```sql
-- SOInvHD.PostID = GLHD.FromID  (ไม่ใช่ GLHD.GLID!)
SELECT s.SOInvID, s.DocuNo, g.GLID, g.DocuNo AS GLNo, g.DocuDate
FROM dbo.SOInvHD s
JOIN dbo.GLHD    g ON g.FromID = s.PostID AND g.FromFlag = 107
WHERE s.Docutype = 107 AND s.PostGL = 'Y';
```

### ❌ วิธีผิด (อย่าใช้)

```sql
-- GLHD.FromID = SOInvHD.SOInvID → ตัวเลขชนกันโดยบังเอิญ
JOIN dbo.GLHD g ON g.FromID = s.SOInvID  -- WRONG
-- GLHD.GLID = SOInvHD.PostID → ทิศทางกลับด้าน
JOIN dbo.GLHD g ON g.GLID = s.PostID     -- WRONG (PostID = FromID ไม่ใช่ GLID)
```

---

## ผล Query จริง (5 แถว)

```
SOInvID | InvNo      | InvDate    | GLID  | GLNo       | GLDate     | ListNo | AccID | DrAmnt    | CrAmnt
--------|------------|------------|-------|------------|------------|--------|-------|-----------|----------
1542    | N55-00908  | 2012-02-29 | 3883  | N55-00908  | 2012-02-29 | 1      | 1037  | 532,800   | 0
1542    | N55-00908  | 2012-02-29 | 3883  | N55-00908  | 2012-02-29 | 2      | 1120  | 0         | 532,800
1661    | N55-01192  | 2012-03-22 | 9152  | N55-01192  | 2012-03-22 | 1      | 1037  | 195,000   | 0
1661    | N55-01192  | 2012-03-22 | 9152  | N55-01192  | 2012-03-22 | 2      | 1120  | 0         | 195,000
1662    | N55-01193  | 2012-03-22 | 9153  | N55-01193  | 2012-03-22 | 1      | 1037  | 113,000   | 0
```

**Pattern**: แต่ละใบกำกับขายเชื่อ → 2 GLDT rows: Dr AccID=1037 (ลูกหนี้-ค้างส่ง) / Cr AccID=1120 (ขายสินค้า - เงินเชื่อ); บางใบใช้ 1129 (รายได้อื่น, 32 แถว). ปุ๋ยยกเว้น VAT → ไม่มี VAT line

---

## ข้อสังเกต

1. **GLHD.DocuType = 501 เสมอ** (GL journal) — ใช้ FromFlag ระบุต้นทาง
2. **SOInvHD.PostID** เป็น pointer ไปที่ `GLHD.FromID` (ทิศทาง: PostID → FromID ของ GLHD row ที่มี DocuNo ตรงกัน)
3. InvDate = GLDate เมื่อ PostGL='Y' (post on invoice date)
4. `GLHD.DocuNo = SOInvHD.DocuNo` ทุกกรณีสำหรับ Docutype=107 — ใช้ join นี้ได้เลย
