---
documentId: "WF-LEG-001"
title: "Findings — ข้อสังเกต ความเสี่ยง และข้อมูลที่ตารางว่าง"
version: "v1.0"
status: Archived
owner: "Data Architect"
normative: false
---
# Findings — ข้อสังเกต ความเสี่ยง และข้อมูลที่ตารางว่าง
DB: dbwins_worldfert9 | สำรวจ: 2026-06-05

---

## 1. ตารางว่าง (0 rows)

| ตาราง | ผลกระทบ |
|---|---|
| **SOPickingHD/DT** | ระบบไม่ผ่านขั้นตอน Picking — ใบกำกับสร้างตรงจากใบสั่งขาย |
| **ICStock** | ไม่มีข้อมูลสต็อกใน WINSpeed — ต้องสอบถามว่าจัดการสต็อกที่อื่น |
| **ICPriceHD/DT** | Price module นี้ไม่ใช้งาน |
| **EMCreditTerm** | SOHD/SOInvHD มี CreditID แต่ master ว่าง — FK ด้านนี้ใช้ไม่ได้ |
| **ICOptionPrice** | ว่าง |

---

## 2. ความเสี่ยงที่ค้นพบ

### 2.1 ID Space ร่วมกันระหว่างตาราง
WINSpeed ใช้ single sequence สำหรับ PK ข้ามตาราง (SOHD.SOID, SOInvHD.SOInvID, GLHD.GLID มีตัวเลขซ้อนทับกัน)
- **ความเสี่ยง**: `GLHD.FromID = SOInvHD.SOInvID` ดูเหมือนจะ join ได้แต่ **ผิด** — ตัวเลขชนโดยบังเอิญ
- **วิธีที่ถูก**: join ด้วย `GLHD.DocuNo = SOInvHD.DocuNo AND GLHD.FromFlag = 107` หรือ `GLHD.FromID = SOInvHD.PostID`

### 2.2 PostID ใน SOInvHD ≠ GLHD.GLID
- `SOInvHD.PostID` → `GLHD.FromID` (ไม่ใช่ GLHD.GLID)
- ชื่อคอลัมน์ "PostID" ทำให้เข้าใจผิดว่าชี้ไปที่ GL record ID

### 2.3 หน่วยสินค้า: ไม่มี ตัน↔กระสอบ ใน DB
- EMGoodUnit.RateQty = 1.0 ทุก unit — ไม่มี conversion factor เก็บไว้
- ถ้าระบบใหม่ต้องแสดงหน่วยกระสอบ (50 kg) ต้องเพิ่ม conversion logic ในแอป (1 ตัน = 20 กระสอบ)
- หรือเพิ่มคอลัมน์ใน `wf` schema สำหรับ bag_per_ton

### 2.4 DocuType 202 ใน SOInvHD ไม่มีใน ICDocuTypeHD
- 113,043 records ใน SOInvHD มี Docutype=202
- ไม่มีคำอธิบายใน ICDocuTypeHD — อาจเป็น legacy type หรือ IC-integrated
- DocuNo prefix: K/I (ซ้อนกับ SOHD Docutype=103/104)
- GLHD.FromFlag=202 มี 112,274 rows → ถูก post GL เช่นกัน
- **ความเสี่ยง**: ถ้า query รายได้ขายแยก Docutype ต้องรวม 107 + 202

### 2.5 ARBillDT.SOInvID อ้าง SOInvHD โดยตรง (ไม่ผ่าน ARBillHD)
- `ARBillDT.SOInvID = SOInvHD.SOInvID` — ต้อง join ผ่าน ARBillDT เท่านั้น
- ไม่มี direct FK ระหว่าง SOInvHD ↔ ARBillHD

### 2.6 GoodID = NULL ใน SOInvDT
- 224,571 / 471,641 rows (47.6%) มี GoodID=NULL
- เหล่านี้คือ misc charges, service lines, ค่าขนส่ง ฯลฯ
- ต้อง `WHERE GoodID IS NOT NULL` เมื่อ query ยอดขายสินค้า

### 2.7 EMCust.AccID = NULL สำหรับลูกค้าบางราย
- ต้องยืนยันว่า AccID = NULL กระทบ GL reconciliation หรือไม่

---

## 3. ข้อสังเกตเพิ่มเติม

### 3.1 ข้อมูลเก่า (2012) ปนกับข้อมูลใหม่
- SOInvHD มีข้อมูลตั้งแต่ปี 2012 (N55 prefix = BE 2555)
- EMSetPriceHD มีข้อมูลตั้งแต่ปี 2022 เท่านั้น
- ราคา NET ก่อนปี 2022 ต้องดึงจาก SOInvDT.GoodPrice2

### 3.2 Single Branch / Single Warehouse
- EMBrch = 1 row, EMInve = 1 row, EMLoca = 1 row
- World Fert ดำเนินงานสาขาเดียว คลังเดียว — ไม่ต้อง multi-branch logic

### 3.3 Collation Thai_CI_AS ใน EMGoodUnit/EMGood
- ชื่อสินค้าและหน่วยใช้ `varchar` + `Thai_CI_AS` collation (ไม่ใช่ NVARCHAR)
- Terminal แสดงผลผิด (garbled) แต่ข้อมูลในฐานถูกต้อง
- ใน `wf` schema ใหม่ ควรใช้ **NVARCHAR** + collation `Thai_CI_AS` หรือ default DB

### 3.4 GL pattern ใบกำกับขายเชื่อ = 2 lines เสมอ (ยืนยันแล้ว)
- Dr AccID=1037 (ลูกหนี้-ค้างส่ง, 145,038) / Cr AccID=1120 (ขายสินค้า - เงินเชื่อ, 145,014); 1129 (รายได้อื่น, 32)
- **ยืนยัน: ปุ๋ยยกเว้น VAT** (VATType=3, VATAmnt=0 ทุกใบ 146,276) → ไม่มี VAT line ใน GL

### 3.5 CN/DN linkage ต่างกัน (ยืนยันจากข้อมูลจริง)
- **CN 109**: `RefSOID` → SOInvID ต้นทาง (มีค่า 2,699/2,702)
- **DN 110**: `RefSOID = NULL ทุกแถว` → ต้อง link ด้วย `RefNo` (DocuNo ข้อความ)

### 3.6 Credit Limit ไม่มีใน WINSpeed
- `EMCust.CreditAmnt = 0` ทุกราย (790), `ARControl` ว่าง, `AROption` แค่ config
- → Credit Hold ต้องออกแบบ Credit Master ใน schema wf

### 3.7 RefSOID ใน SOInvHD
- `SOInvHD.RefSOID` น่าจะเป็น FK → SOHD.SOID (ใบจองต้นทาง)
- ยังไม่ยืนยันด้วยข้อมูลจริง — ควรตรวจก่อนใช้ใน report

---

## 4. ข้อเสนอสำหรับ schema wf

1. **qtyTon**: ทศนิยม 4 หลัก (`DECIMAL(18,4)`) — ตรงกับ SOInvDT.GoodQty2
2. **pricePerTon**: `DECIMAL(18,4)` — ตรงกับ SOInvDT.GoodPrice2
3. **bagPerTon**: เพิ่มคอลัมน์ใหม่ใน wf.GoodExtra (ไม่ใช่ dbo) สำหรับ 1 ตัน = N กระสอบ
4. **netPrice**: อ้าง EMSetPriceDT.GoodPriceNet สำหรับราคาปัจจุบัน
5. NVARCHAR สำหรับ text ภาษาไทย ทั้งหมดใน wf schema
6. ตรวจสอบ DocuType 202 ว่ารวมใน revenue report ของ World Fert หรือไม่ก่อน design report
