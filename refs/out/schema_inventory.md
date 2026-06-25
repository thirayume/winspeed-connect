# Schema Inventory — ตารางที่เกี่ยวข้อง 6 โมดูล
DB: dbwins_worldfert9 | สำรวจ: 2026-06-05

ตัวเลขในวงเล็บ = จำนวนแถวจริงใน DB

---

## SO Module — Sales Order

### SOHD — ใบจอง / ใบสั่งขาย (107,018 rows)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **SOID** | int | PK |
| DocuNo | varchar | รหัสเอกสาร (prefix K=Confirm, I=SaleOrder + ปีพ.ศ. 2 หลัก) |
| DocuDate | datetime | วันที่เอกสาร |
| DocuType | smallint | 103=Confirm Order, 104=Sale Order |
| DocuStatus | varchar(1) | Y=Active |
| CustID | int | → EMCust.CustID |
| EmpID | int | → EMEmp.EmpID |
| BrchID | smallint | → EMBrch.BrchID |
| SaleAreaID | int | → EMSaleArea.SaleAreaID |
| TranspID | int | → EMTransp.TranspID |
| CreditID | int | → EMCreditTerm.CreditID |
| NetAmnt | decimal(18,4) | ยอดสุทธิ |
| ShipDate | datetime | วันที่ส่งสินค้า |
| VATRate | decimal | อัตราภาษี |

### SODT — รายการสินค้าในใบจอง (190,931 rows)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **SOID** | int | PK part + FK → SOHD.SOID |
| **ListNo** | int | PK part |
| GoodID | int | → EMGood.GoodID |
| GoodUnitID1 | int | หน่วยหลัก (มักว่าง) |
| GoodQty1 | decimal | ปริมาณหน่วยหลัก |
| GoodUnitID2 | int | หน่วยขาย (1002=ตัน) |
| GoodQty2 | decimal | ปริมาณหน่วยขาย |
| GoodStockUnitID | int | หน่วยสต็อก |
| GoodStockQty | decimal | ปริมาณสต็อก |
| GoodPrice1/2 | decimal | ราคาต่อหน่วย |
| GoodAmnt | decimal(18,4) | ยอดรวม |
| GoodDiscFormula/Amnt | varchar/decimal | ส่วนลด |
| InveID | int | → EMInve.InveID |
| LocaID | int | → EMLoca.LocaID |

### SOPickingHD / SOPickingDT — ใบจัดสินค้า (**0 rows — ว่าง**)

- DocuType=105, PK=PickingID
- ไม่ได้ใช้งานใน World Fert

### SOInvHD — ใบกำกับภาษี Header (282,087 rows)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **SOInvID** | int | PK |
| DocuNo | varchar | รหัสใบกำกับ (N=ขายเชื่อ, J=ขายเชื่อ + ปีพ.ศ.) |
| DocuDate | datetime | วันที่ใบกำกับ |
| Docutype | smallint | 107=ขายเชื่อ, 109=CN, 110=DN, 108=สด |
| DocuStatus | varchar(1) | Y=Active |
| CustID | int | → EMCust.CustID |
| ARID | int | = CustID (ลูกหนี้การค้า) ทุกแถว |
| EmpID | int | → EMEmp.EmpID |
| BrchID | smallint | → EMBrch.BrchID |
| SaleAreaID | int | → EMSaleArea.SaleAreaID |
| TranspID | int | → EMTransp.TranspID |
| CreditID | int | → EMCreditTerm.CreditID |
| NetAmnt | decimal(18,4) | ยอดสุทธิ |
| VATAmnt | decimal(18,4) | ภาษีมูลค่าเพิ่ม |
| PostGL | varchar(1) | Y=บันทึก GL แล้ว |
| **PostID** | int | → GLHD.FromID (posting reference) |
| PostGLDate | datetime | วันที่บันทึก GL |
| InvNo | varchar | เลขที่ใบกำกับ (อาจต่างจาก DocuNo) |
| ShipDate | datetime | วันที่ส่ง |
| InvoiceType | varchar(1) | I=Invoice |
| RefSOID | int | → SOHD.SOID (ใบจองต้นทาง) |

### SOInvDT — รายการสินค้าในใบกำกับ (471,641 rows)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **SOInvID** | int | PK part + FK → SOInvHD |
| **ListNo** | int | PK part |
| GoodID | int | → EMGood (NULL 224,571 rows = misc/service) |
| GoodUnitID1 | int | หน่วยหลัก (NULL สำหรับ Docutype=107) |
| GoodQty1 | decimal | — |
| GoodUnitID2 | int | **หน่วยขาย** (1002=ตัน) |
| **GoodQty2** | decimal | **ปริมาณ (ตัน)** |
| GoodStockUnitID | int | หน่วยสต็อก (=GoodUnitID2) |
| GoodStockQty | decimal | ปริมาณสต็อก (=GoodQty2) |
| GoodPrice1 | decimal | — (มักว่าง) |
| **GoodPrice2** | decimal | **ราคาต่อตัน (บาท)** |
| GoodAmnt | decimal(18,4) | ยอดรวม = GoodQty2 × GoodPrice2 |
| GoodDiscFormula/Amnt | varchar/decimal | ส่วนลด |
| InveID | int | → EMInve |
| LocaID | int | → EMLoca |
| Docutype | smallint | สำเนาจาก SOInvHD |

---

## AR Module — Accounts Receivable

### ARBillHD — ใบวางบิล Header (885 rows)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **ARBillID** | int | PK |
| DocuNo | varchar | prefix K |
| DocuDate | datetime | |
| DocuType | smallint | 203 |
| CustID | int | → EMCust |
| EmpID | int | → EMEmp |
| BrchID | smallint | → EMBrch |
| CreditID | int | → EMCreditTerm |
| TotaBillAmnt | decimal | ยอดวางบิล |
| DocuStatus | varchar(1) | |

### ARBillDT — รายการใบกำกับในใบวางบิล (2,180 rows)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **ARBillID** | int | PK part + FK → ARBillHD |
| **ListNo** | int | PK part |
| SOInvID | int | → SOInvHD.SOInvID |
| SOInvNo | varchar | DocuNo ของใบกำกับ |
| SOInvDate | datetime | วันที่ใบกำกับ |
| BillAmnt | decimal | ยอดในบิล |
| NetAmnt | decimal | ยอดสุทธิ |
| RemaAmnt | decimal | ยอดค้างชำระ |
| DueDate | datetime | วันครบกำหนด |

---

## IC Module — Inventory Control

### ICStock — สต็อกสินค้า (**0 rows — ว่าง**)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **StockID** | int | PK |
| DocuDate | datetime | |
| BrchID | smallint | → EMBrch |
| GoodID | int | → EMGood |
| InveID | int | → EMInve |
| LocaID | int | → EMLoca |
| BegnQty | decimal | ยอดยกมา |
| ReceQty | decimal | รับเข้า |
| PayQty | decimal | จ่ายออก |
| RemaQty | decimal | คงเหลือ |
| StockAvailable | decimal | พร้อมขาย |

**⚠ ว่างทั้งหมด** — World Fert ไม่ใช้ IC module สำหรับ stock movement

### ICPriceHD / ICPriceDT (**0 rows — ว่าง**)

ไม่ได้ใช้งาน

---

## GL Module — General Ledger

### GLHD — GL Journal Header (384,400 rows)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **GLID** | int | PK |
| DocuNo | varchar | = DocuNo ของ source document |
| DocuDate | datetime | วันที่บันทึก (= วันที่ใบกำกับ) |
| DocuType | smallint | **501** ทุกแถว |
| **FromFlag** | smallint | DocuType ของ source (107=ใบกำกับขาย) |
| **FromID** | int | = SOInvHD.PostID ของ source |
| BrchID | smallint | → EMBrch |
| EmpID | int | → EMEmp |
| JourID | int | → EMAccJour |

### GLDT — GL Journal Detail (813,085 rows)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **GLID** | int | PK part + FK → GLHD |
| **ListNo** | int | PK part |
| AccID | int | → EMAcc (ผังบัญชี) |
| JourID | int | → EMAccJour |
| BrchID | smallint | → EMBrch |
| DrAmnt | decimal(18,4) | ยอด Debit |
| CrAmnt | decimal(18,4) | ยอด Credit |

---

## EM Module — Master Data

### EMGood — สินค้า (417 rows)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **GoodID** | int | PK |
| GoodCode | varchar | รหัสสินค้า (เช่น 1-08242400BBCAR) |
| GoodName1 | varchar | ชื่อสินค้า Thai (CP874) |
| GoodName2 | varchar | ชื่อสำรอง |
| **MainGoodUnitID** | int | หน่วยหลัก → EMGoodUnit (**1002=ตัน** สำหรับปุ๋ย) |
| SaleGoodUnitID | int | หน่วยขาย (**NULL ทุก record** → ใช้ MainGoodUnitID) |
| MultiUnitFlag | smallint | 3 = single unit mode |
| GoodGroupID | int | หมวดสินค้า |
| GoodTypeID | int | ประเภทสินค้า |
| StandardSalePrce | decimal | **NULL ทุกแถว** (ไม่ได้ตั้งค่า) |
| StockFlag | varchar | ควบคุมสต็อก |
| Inactive | varchar(1) | Y=ยกเลิก |

### EMCust — ลูกค้า (790 rows)

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| **CustID** | int | PK |
| CustCode | varchar | รหัสลูกค้า |
| CustName1 | varchar | ชื่อลูกค้า |
| BrchID | smallint | → EMBrch |
| SaleAreaID | int | → EMSaleArea |
| AccID | int | → EMAcc (บัญชีลูกหนี้) |
| CreditID | int | → EMCreditTerm |

### EMEmp — พนักงาน (59 rows)
PK: EmpID | คอลัมน์สำคัญ: EmpCode, EmpName1, BrchID, SaleAreaID

### EMBrch — สาขา (**1 row**)
PK: BrchID=1 — World Fert มีสาขาเดียว

### EMSaleArea — พื้นที่ขาย (76 rows)
PK: SaleAreaID | คอลัมน์: SaleAreaCode, SaleAreaName1

### EMTransp — บริษัทขนส่ง (3 rows)
PK: TranspID

### EMInve — คลังสินค้า (**1 row**)
PK: InveID=1

### EMLoca — ที่เก็บในคลัง (**1 row**)
PK: LocaID=1, InveID=1

### EMAcc — ผังบัญชี (372 rows)
PK: AccID | คอลัมน์: AccCode, AccName, AccType

บัญชีที่พบในสาย SO→GL (ชื่อจริงจาก EMAcc):
- AccID=1037 → ลูกหนี้-ค้างส่ง (Dr เมื่อขาย, 145,038)
- AccID=1120 → ขายสินค้า - เงินเชื่อ (Cr เมื่อขาย, 145,014)
- AccID=1129 → รายได้อื่น (Cr, 32)

### EMAccJour — สมุดรายวัน (7 rows)
PK: JourID

### EMCreditTerm — เงื่อนไขเครดิต (**0 rows — ว่าง**)
⚠ ตารางว่าง — SOHD/SOInvHD มี CreditID แต่ master ไม่มีข้อมูล

### EMGoodUnit — หน่วยสินค้า (16 rows)

| GoodUnitID | ชื่อ (CP874 hex) | BaseFlag | RateQty |
|---|---|---|---|
| 1001 | ใบ (0xE3BA) | N | 1.0 |
| **1002** | **ตัน (0xB5D1B9)** | **N** | **1.0** |
| 1003 | ตัว (0xB5D1C7) | Y | 1.0 |
| 2000 | ตัน | Y | 1.0 |
| อื่นๆ | — | N | 0.0 |

**หมายเหตุหน่วย**: RateQty=1.0 ทุกหน่วย — ไม่มี conversion ตัน↔กระสอบใน DB  
ปุ๋ยทุกตัวใช้ GoodUnitID=**1002** (ตัน) เป็น MainGoodUnitID

---

## Price List

### EMSetPriceHD — หัวรายการราคา (129 rows, 2022–2025)
PK: SetPriceID | สำคัญ: CustID, GoodID, BeginDate, EndDate, DocuNo (SPLyyMM-xxxxx)

### EMSetPriceDT — รายการราคา (4,054 rows)
PK: SetPriceID+ListNo | สำคัญ: **GoodPriceNet** (ราคาสุทธิ บาท/ตัน), startgoodqty, endgoodqty, GoodUnitID
