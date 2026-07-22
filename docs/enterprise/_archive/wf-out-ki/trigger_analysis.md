# Trigger / GL-Posting Analysis — ข้อค้นพบสำคัญ
DB: dbwins_worldfert9 | ตรวจ: 2026-06-09 (หลัง GRANT VIEW DEFINITION)

## คำถาม
เมื่อระบบใหม่เขียน `dbo.SOInvHD/DT` ตอน Shipped — WINSpeed จะ **post GL อัตโนมัติ** หรือไม่?

## คำตอบ: ❌ ไม่ — ฐานข้อมูลไม่มีกลไก post GL อัตโนมัติ

### หลักฐาน (3 วิธี ยืนยันตรงกัน)

**1. Trigger บน SOInvHD/SOHD/GLHD = ERwin RI-enforcement ล้วน**
- ทั้ง 9 trigger (`tI/tU/tD` × SOInvHD/SOHD/GLHD) มีแต่ `raiserror`/`rollback` (ตรวจ FK)
- ไม่มี `insert into GLHD/GLDT`, ไม่แตะ `ICStock`, ไม่ `exec` SP ลงบัญชี
- header: `/* ERwin Builtin ... default body */`

**2. `tI_SOInvHD` อ้างถึงเฉพาะ 16 ตาราง master (RI parents) — ไม่มี GLHD/GLDT**
```
CSCommit, EMBrch, EMcnremarkType, EMCreditTerm, EMCurr, EMCurrType, EMCust,
EMDept, EMEmp, EMIntroduce, EMJob, EMSaleArea, EMTransp, EMTranspArea, EMVATGroup, SMSat
```
→ INSERT SOInvHD จะถูก **reject** ถ้า FK เหล่านี้ไม่ valid (ต้องเตรียมให้ครบ)

**3. ไม่มี trigger/SP ใดเขียน GLHD/GLDT แทนเรา**
```sql
-- ตรวจทุก module ใน DB ที่ INSERT เข้า GLHD/GLDT
SELECT o.type_desc, OBJECT_NAME(m.object_id)
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id=m.object_id
WHERE LOWER(m.definition) LIKE '%insert%glhd%' OR LOWER(m.definition) LIKE '%insert%gldt%';
```
ผล: 23 ตัว แต่ทั้งหมดเป็น **RI-cascade trigger** บน GL/master เอง + SP utility
(`Spu_ClearData_glhd`=ล้างข้อมูล, `spu_insert_sodeposit/podeposit`=เงินมัดจำ)
→ **ไม่มีตัวใด post GL ของใบกำกับขาย**

- `tI_GLDT`, `tI_GLHD`, `tI_SOInvHD/DT` : is_updated dependencies = **(none)** → ไม่เขียนตารางอื่น
- `GLPostSum` = 0 rows (ไม่ใช้)

## สรุป
ในข้อมูลจริง ทุกใบกำกับ 107 มี GLHD คู่ (DocuNo เดียวกัน) — แต่ **ฐานข้อมูลไม่ได้สร้างให้**
→ **WINSpeed client application** เป็นผู้ insert ทั้ง SOInvHD/DT **และ** GLHD/GLDT พร้อมกันใน code

## ผลต่อการออกแบบ (แก้สมมุติฐานเดิม!)
เอกสาร v3.0 เดิมเขียนว่า "เขียน SOInvHD/DT → WS post GL ตามกลไกเดิม" — **ไม่ถูกต้อง**
ความจริง: เขียน SOInvHD/DT แล้ว **GL จะไม่เกิดเอง** ต้องเลือกแนวทาง:

| แนวทาง | ทำอะไร | ข้อดี | ข้อเสีย/ความเสี่ยง |
|---|---|---|---|
| **A. Replicate GL** | SP ของเราเขียน SOInvHD/DT **+ GLHD/GLDT เอง** (Dr 1037/Cr 1120, FromFlag=107) ใน transaction เดียว | ครบจบในระบบเดียว, real-time | ต้อง replicate logic บัญชีให้ตรง 100% (เสี่ยงลงผิด) + อาจมี side-effect อื่นที่ WINSpeed ทำ (AR aging, balance) |
| **B. ไม่เขียน dbo เลย** | WINSpeed ยังเป็นเจ้าของการออกใบกำกับ/GL; ระบบเราคุมแค่ pre-invoice (SO/rebate/paper/ชั่ง) ใน wf แล้ว export/ให้ key ใน WS | เสี่ยงบัญชีต่ำสุด, non-invasive จริง | คีย์ซ้ำขั้นออกใบกำกับ (แต่ลดงานส่วนอื่นได้มาก) |
| **C. Hybrid** | เขียน SOInvHD/DT + GLHD/GLDT เอง แต่ทำ reconcile/ตรวจสอบเทียบ WINSpeed ทุกวัน | สมดุล | ซับซ้อนกว่า A เล็กน้อย |

## ✅ การตัดสินใจ (D-03 → ปิดแล้ว): แนวทาง B
ลูกค้ายืนยัน: **WINSpeed = เจ้าของบัญชี 100% ห้ามผิดพลาด · ระบบใหม่ = ชั้นช่วยกรอก + สถานะ**
→ เลือก **B** (ไม่เขียนตารางบัญชีของ dbo เลย)

### กลไกส่งข้อมูลเข้า WINSpeed: ใช้ฟีเจอร์ Import/Export (IE) ของ WINSpeed เอง
หลักฐาน: `dbo.IEImportTemplate_wf` (35 แถว) = template ของฟีเจอร์ Import WINSpeed ที่งานก่อน (`_wf`) ตั้งไว้
- Module ที่มี: **IssueStock** (จ่ายสต็อก), **ReceiptFG** (รับสินค้าสำเร็จรูป) — โครงสร้าง Header + Detail
  (เช่น ReceiptFG: Header=Branchcode/DocuNo/DocuDate/EmpCode...; Detail=PartCode/Unit/InveCode/Qty/Goodprice2...)
- ⚠ **ยังไม่มี template ใบสั่งขาย/ใบกำกับ** — ต้องตั้งเพิ่ม (WINSpeed IE รองรับ doc อื่นได้)
- WINSpeed Import รัน logic การลงบัญชีของแอปเอง → GL ถูกต้องเหมือนคีย์มือ

### สถาปัตยกรรมที่สรุป
```
app (schema wf): SO/รอชั่ง/ชั่ง/rebate/ของแถม/ตั๋วคุม/paper + สถานะ override
   → สร้างไฟล์ import (รูปแบบ WINSpeed Header+Detail)
   → WINSpeed Import (feature เดิม) → WINSpeed post invoice+GL เอง (ถูก 100%)
   ← อ่านกลับ DocuNo/SOInvID มา sync สถานะใน wf (read-only JOIN)
dbo accounting: เราเขียน = 0  → ความเสี่ยงบัญชี = 0
```

### ต้องยืนยันต่อกับผู้ดูแล WINSpeed / vendor
1. ตั้ง IE template สำหรับ Sales Order / ใบกำกับ (ปัจจุบันมีแค่ IC)
2. ยืนยันว่า WINSpeed Import **post GL ให้จริง** (พฤติกรรมระดับแอป)
