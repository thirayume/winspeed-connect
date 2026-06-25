# Open Items Answers
วันที่สำรวจ: 2026-06-05 | DB: dbwins_worldfert9 | Login: wf_reader (read-only)

---

## คำถาม 1 — DocuType ของใบกำกับขายและการ join GL

### 1.1 SOInvHD.Docutype distribution

```sql
SELECT Docutype, COUNT(*) AS cnt FROM dbo.SOInvHD GROUP BY Docutype ORDER BY cnt DESC
```

| Docutype | ความหมาย (จาก ICDocuTypeHD) | จำนวนแถว |
|---|---|---|
| **107** | **Sale on Credit (ใบกำกับขายเชื่อ)** | **146,276** |
| 202 | ไม่มีใน ICDocuTypeHD (ดูหมายเหตุ) | 113,043 |
| 106 | ไม่มีใน ICDocuTypeHD | 17,139 |
| 109 | Credit Note (ลดหนี้ลูกหนี้) | 2,702 |
| 110 | Debit Note (เพิ่มหนี้ลูกหนี้) | 2,420 |
| 201 | — | 408 |
| 108 | Cash Sale (ขายสด) | 83 |
| 114 | Credit Note Cash | 16 |

**สรุป**: ใบกำกับขายเชื่อหลักใช้ `Docutype = 107` (DocuNo prefix: N55–N68, J63–J68)

### 1.2 GLHD.DocuType และ FromFlag

```sql
SELECT DocuType, FromFlag, COUNT(*) AS cnt FROM dbo.GLHD GROUP BY DocuType, FromFlag ORDER BY cnt DESC
```

- `GLHD.DocuType = 501` ทุกรายการ (GL journal entry)
- `GLHD.FromFlag` = DocuType ของต้นทาง (107=ใบกำกับขายเชื่อ, 202, 309=Credit Purchase ฯลฯ)
- `GLHD.DocuType ≠ FromFlag` — ห้ามสับสน

### 1.3 วิธี Join GL (ยืนยันด้วยข้อมูลจริง)

**วิธีที่ 1 (แนะนำ): join ผ่าน DocuNo**
```sql
SELECT s.SOInvID, s.DocuNo, s.DocuDate,
       g.GLID, g.DocuDate AS GLDate,
       dt.AccID, dt.DrAmnt, dt.CrAmnt
FROM   dbo.SOInvHD s
JOIN   dbo.GLHD    g  ON g.DocuNo   = s.DocuNo  AND g.FromFlag = 107
JOIN   dbo.GLDT    dt ON dt.GLID    = g.GLID
WHERE  s.Docutype = 107
```

**วิธีที่ 2: join ผ่าน PostID**
```sql
-- SOInvHD.PostID = GLHD.FromID (ไม่ใช่ GLHD.GLID)
JOIN dbo.GLHD g ON g.FromID = s.PostID AND g.FromFlag = 107
```

**ผลตัวอย่าง (5 แถว, รันได้จริง)**:

| SOInvID | InvNo | InvDate | GLID | GLNo | GLDate | ListNo | AccID | DrAmnt | CrAmnt |
|---|---|---|---|---|---|---|---|---|---|
| 1542 | N55-00908 | 2012-02-29 | 3883 | N55-00908 | 2012-02-29 | 1 | 1037 | 532,800 | 0 |
| 1542 | N55-00908 | 2012-02-29 | 3883 | N55-00908 | 2012-02-29 | 2 | 1120 | 0 | 532,800 |
| 1661 | N55-01192 | 2012-03-22 | 9152 | N55-01192 | 2012-03-22 | 1 | 1037 | 195,000 | 0 |
| 1661 | N55-01192 | 2012-03-22 | 9152 | N55-01192 | 2012-03-22 | 2 | 1120 | 0 | 195,000 |
| 1662 | N55-01193 | 2012-03-22 | 9153 | N55-01193 | 2012-03-22 | 1 | 1037 | 113,000 | 0 |

**⚠ ข้อควรระวัง**: `GLHD.FromID = SOInvHD.SOInvID` ใช้ไม่ได้ — ตัวเลขชนกันโดยบังเอิญ (GLHD เก่าอ้าง SOInvID ที่เกิดขึ้นทีหลัง)

---

## คำถาม 2 — หน่วย ตัน↔กระสอบ

### 2.1 EMGoodUnit ที่ใช้จริง

```sql
SELECT GoodUnitID, GoodUnitCode, GoodUnitName, BaseFlag, RateQty, BaseQty
FROM dbo.EMGoodUnit ORDER BY GoodUnitID
```

| GoodUnitID | ชื่อ (hex → CP874) | BaseFlag | RateQty | หมายเหตุ |
|---|---|---|---|---|
| 1001 | 0xE3BA → **ใบ** | N | 1.0 | — |
| **1002** | 0xB5D1B9 → **ตัน** | N | 1.0 | หน่วยหลักปุ๋ย |
| 1003 | 0xB5D1C7 → ตัว | Y | 1.0 | — |
| 2000 | ตัน (เหมือน 1002) | Y | 1.0 | — |

### 2.2 SOInvDT หน่วยที่ใช้จริง

```sql
SELECT GoodUnitID1, GoodUnitID2, GoodStockUnitID, COUNT(*) cnt
FROM dbo.SOInvDT WHERE Docutype=107
GROUP BY GoodUnitID1, GoodUnitID2, GoodStockUnitID ORDER BY cnt DESC
```

| GoodUnitID1 | GoodUnitID2 | GoodStockUnitID | จำนวน |
|---|---|---|---|
| NULL | 1002 | 1002 | 240,925 |
| NULL | 1001 | 1001 | 62 |

**ตัวอย่าง 1 รายการ**: GoodID=1121, GoodQty2=36.0000 ตัน, GoodPrice2=15,600 บาท/ตัน → GoodAmnt=561,600 บาท

### 2.3 สรุปหน่วย

- **ระบบขายเป็นตัน (GoodUnitID=1002)** โดยตรง
- **ไม่มี conversion ตัน↔กระสอบ** ใน EMGoodUnit (RateQty=1.0 ทุกหน่วย, SaleGoodUnitID=NULL ทุกสินค้า)
- 1 กระสอบ = 50 kg → 1 ตัน = 20 กระสอบ **แต่ค่านี้ไม่เก็บใน DB** ต้องคำนวณในแอปพลิเคชัน
- MultiUnitFlag=3 ทุก EMGood → WINSpeed ใช้หน่วยเดียว (ไม่ multi-unit)

---

## คำถาม 3 — ราคา NET รายเดือนเก็บที่ไหน

### 3.1 ICPriceHD/DT — ว่างทั้งคู่

```sql
SELECT COUNT(*) FROM dbo.ICPriceHD  -- 0
SELECT COUNT(*) FROM dbo.ICPriceDT  -- 0
```

**ICPriceHD และ ICPriceDT ไม่มีข้อมูล — ไม่ได้ใช้**

### 3.2 EMSetPriceHD/DT — ที่เก็บ Price List จริง

```sql
SELECT COUNT(*) FROM dbo.EMSetPriceHD  -- 129 รายการ (2022-06 ถึง 2025-05)
SELECT COUNT(*) FROM dbo.EMSetPriceDT  -- 4,054 รายการ
```

**EMSetPriceHD** (129 rows, DocuNo format: SPLyyMM-xxxxx):
- `CustID` / `CustGroupID` — กำหนดราคาให้ลูกค้าเฉพาะหรือกลุ่ม
- `GoodID` / `GoodGroupID` — ระบุสินค้าหรือหมวดสินค้า
- `BeginDate`, `EndDate` — ช่วงเวลามีผล
- `BeginTime`, `EndTime` — เวลา

**EMSetPriceDT** (4,054 rows, คอลัมน์สำคัญ):
- `ListID` = GoodID
- `GoodUnitID` = 1002 (ตัน)
- `GoodPrice` = ราคาก่อนส่วนลด
- `GoodDiscAmnt` = ส่วนลด
- **`GoodPriceNet`** = ราคา NET (บาท/ตัน)
- `startgoodqty`, `endgoodqty` = tier ปริมาณ (min 1.0000, max 2000.0000 ตัน)

**ตัวอย่าง**:
| SetPriceID | GoodID | GoodPrice | GoodPriceNet | startQty | endQty |
|---|---|---|---|---|---|
| 1000 | 1093 | 26,500 | 26,500 | 1 | 2,000 |
| 1000 | 23042 | 27,000 | 27,000 | 1 | 2,000 |

### 3.3 ราคาระดับ Transaction

- **SOInvDT.GoodPrice2** = ราคาจริงที่ใช้ในใบกำกับ (บันทึกถาวร)
- **EMGood.StandardSalePrce** = ทุกแถว NULL (ไม่ได้ตั้งค่า)
- ICOptionPrice = ว่าง (0 rows)

### 3.4 สรุป

| แหล่งข้อมูล | สถานะ | ใช้สำหรับ |
|---|---|---|
| ICPriceHD/DT | ว่าง — ไม่ใช้ | — |
| **EMSetPriceHD/DT** | **มีข้อมูล 2022–2025** | **Price List / ราคาตั้ง** |
| SOInvDT.GoodPrice2 | ทุก transaction | ราคาจริงในใบกำกับ |
| EMGood.StandardSalePrce | NULL ทั้งหมด | ไม่ได้ใช้ |

**คำตอบ**: ราคา NET ปัจจุบันเก็บใน `EMSetPriceDT.GoodPriceNet` (จับคู่ด้วย SetPriceID → EMSetPriceHD ซึ่งมี BeginDate/EndDate + CustID/GoodID)  
ข้อมูลก่อนปี 2022 ไม่มี price list — ต้องดึงจาก SOInvDT.GoodPrice2 (transaction history)
