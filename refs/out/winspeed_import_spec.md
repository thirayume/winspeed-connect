# WINSpeed Import Spec — ฟอร์แมตจริง (จากคู่มือ Prosoft)
แหล่ง: `C:\Program Files (x86)\Prosoft\WINSpeed\Document\Export-Import Document.pdf` (FR-GN-019, 12 หน้า)
ตรวจ: 2026-06-09 | ใช้ออกแบบการเชื่อมต่อแนวทาง B

---

## 🎯 ข้อสรุปชี้ขาด (ตอบ D-03)
> หน้า 12 — For Management Note:
> **"สำหรับระบบ SO ขายเชื่อ, ระบบ PO ซื้อเชื่อ จะไม่มีการดำเนินการจนกว่าจะมีการอนุมัติจากผู้มีอำนาจแล้วเท่านั้น"**

- Import ใบสั่งขาย → สร้าง **DocuType 104 (Sale Order)** = เอกสารรอ ยังไม่กระทบบัญชี/GL
- ต้อง **อนุมัติโดยผู้มีอำนาจ** ก่อน WINSpeed ถึงจะออกใบกำกับ + post GL (ด้วย logic ของ WINSpeed เอง)
- → **แนวทาง B สมบูรณ์**: app เราสร้างไฟล์ import → WINSpeed รับเป็นใบสั่งขาย → อนุมัติในWINSpeed → WINSpeed ลงบัญชีเอง 100% (เราไม่แตะบัญชีเลย)

---

## กลไก Export/Import Service (Accounting Alliance)
- ไฟล์ **Tab-Delimited TXT** · แยก **Header + Detail คนละไฟล์** · จัดใน **โฟลเดอร์ YYYYMMDD** (+ _รหัสสาขา)
- แต่ละไฟล์มีบรรทัดแรกเป็น **ชื่อคอลัมน์ (Header)** ตามสเปก
- ปุ่ม **Template** = export ไฟล์ตัวอย่างฟอร์แมต, **Report** = พิมพ์ Data Structure
- รองรับ import จากระบบอื่น (non-Core-ERP) ถ้าคอลัมน์ครบ
- Backup อัตโนมัติก่อน import (ใน MSSQL Backup folder)

### เมนู Export/Import แต่ละระบบ (เปิดด้วย `exec sp_smobject_open '<screen>','Y'`)
| เมนู | screen | DocuType | ระบบ |
|---|---|---|---|
| SO Export/Import | `w_importexport_so` | **104** | SO สั่งขาย |
| PO Export/Import | `w_importexport_po` | 305 | PO สั่งซื้อ |
| GL Export/Import | `w_importexport` | 501 | GL รายการรายวัน |
| AR Export/Import | `w_importexport_ar` | 201 | AR ลูกหนี้ยกมา |
| AP Export/Import | `w_importexport_ap` | 401 | AP เจ้าหนี้ยกมา |

> เราใช้ **SO เท่านั้น** (104). ไม่ import GL ตรง (นั่นคือแนวทาง A ที่ตัดทิ้ง)

---

## ★ ฟอร์แมต SO Import (ที่เราต้องสร้าง)

### `SOHD.TXT` — Header (1 บรรทัด/ใบสั่งขาย)
| คอลัมน์ | ความหมาย | ชนิด | map จาก wf | อ้าง dbo |
|---|---|---|---|---|
| BrchCode* | รหัสสาขา | varchar(25) | =1 (สาขาเดียว) | EMBrch |
| DocuNo* | เลขที่เอกสาร | varchar(25) | wf.SalesOrder.SoNo | |
| DocuDate* | วันที่เอกสาร | DateTime | OrderDate | |
| CustCode* | รหัสลูกค้า | varchar(25) | → CustomerID | EMCust |
| CustName | ชื่อลูกค้า | varchar(255) | | |
| ContactName | ชื่อผู้ติดต่อ | varchar(255) | | |
| ValidDays | ส่งของภายใน(วัน) | long | | |
| ExpireDate | Expire | DateTime | | |
| ShipDate | กำหนดส่งของ | DateTime | ShipDate | |
| CreditDays | เครดิต(วัน) | long | | |
| TranspCode | รหัสการขนส่ง | varchar(25) | TranspID | EMTransp |
| EmpCode | รหัสพนักงาน(ขาย) | varchar(25) | SalesID | EMEmp |
| SumGoodAmnt* | จำนวนเงิน | dec(19,4) | Σ line | |
| BillDiscFormula/Amnt | ส่วนลดการค้า | varchar/dec | | |
| TotaBaseAmnt | จำนวนเงินรวม | dec(19,4) | | |
| VATType | ประเภทภาษี | varchar(1) | **='3' (ไม่คิดภาษี)** ปุ๋ยยกเว้น VAT | |
| VATRate / VATAmnt | อัตรา/เงินภาษี | number/dec | 0 / 0 | |
| NetAmnt | จำนวนเงินทั้งสิ้น | dec(19,4) | TotalAmount | |
| GoodType | ประเภทสินค้า | varchar(1) | ='1' สินค้า | |
| SaleAreaCode | รหัสเขตการขาย | varchar(25) | SaleAreaID | EMSaleArea |
| DeptCode / JobCode | แผนก / Job | varchar(25) | | EMDept/EMJob |
| MultiCurrency..ExchRate | สกุลเงิน | | ='N'/บาท | |
| **DocuType** | รายการเอกสาร | long | **Default 104** | |

### `SODT.TXT` — Detail (1 บรรทัด/รายการสินค้า)
| คอลัมน์ | ความหมาย | ชนิด | map จาก wf | อ้าง dbo |
|---|---|---|---|---|
| BrchCode* | รหัสสาขา | varchar(25) | =1 | EMBrch |
| DocuNo* | เลขที่เอกสาร | varchar(25) | = SOHD.DocuNo | |
| GoodCode | รหัสสินค้า | varchar(50) | → GoodID | EMGood |
| GoodName | ชื่อสินค้า | varchar(255) | | |
| InveCode | รหัสคลัง | varchar(25) | =1 | EMInve |
| LocaCode | รหัสที่เก็บ | varchar(25) | =1 | EMLoca |
| GoodUnitCode* | หน่วยนับ | varchar(25) | =1002 (ตัน) | EMGoodUnit |
| MainGoodUnitCode | หน่วยหลัก | varchar(25) | =1002 | EMGoodUnit |
| GoodStockRate2 | อัตราต่อหน่วยหลัก | number | =1 | |
| **GoodQty2** | จำนวน | dec(19,4) | **QtyTon (ตัน)** | |
| **GoodPrice** | ราคาต่อหน่วย | dec(19,4) | **UnitPrice (บาท/ตัน)** | |
| GgodDiscFormula/Amnt | ส่วนลดสินค้า | varchar/dec | DiscAmnt | |
| GoodAmnt | จำนวนเงิน | dec(19,4) | QtyTon×UnitPrice | |
| MiscChargFormula/Amnt | Charge | varchar/dec | | |
| JobCode | Job | varchar(25) | | EMJob |
| VatType | ประเภทภาษี | varchar(1) | ='3' | |
| **DocuType** | รายการเอกสาร | long | **Default 104** | |

> หมายเหตุของแถม: line ราคา 0 → GoodPrice=0 (ตรงกับ SOInvDT.GoodPrice2=0 ที่พบในข้อมูลจริง)

### ค่ามาตรฐาน (หน้า 12)
- **VATType**: 1=แยกนอก, 2=รวมใน, **3=ไม่คิดภาษี** ← ปุ๋ย World Fert ใช้ 3
- **GoodType**: 1=สินค้า, 2=บริการ
- prefixDate = `DD/MM/YYYY`; prefixAmnt/Qty/Price default 0
- ส่วนลด: ตัวเลขโดด=บาท, `7%`=เปอร์เซ็นต์, `@10`=ลดต่อหน่วย

---

## Flow ที่ออกแบบ (แนวทาง B — ยืนยันจากคู่มือ)
```
wf.SalesOrder/Line  →  สร้าง SOHD.TXT + SODT.TXT (DocuType 104, tab-delimited, โฟลเดอร์ YYYYMMDD)
   →  WINSpeed > SO Export/Import > Import Transaction
   →  WINSpeed สร้างใบสั่งขาย (รออนุมัติ — ยังไม่ลง GL)
   →  ผู้มีอำนาจอนุมัติใน WINSpeed → ออกใบกำกับ + post GL เอง (Post Invoice (WF))
   ←  อ่าน DocuNo/SOInvID กลับมา sync สถานะใน wf (read-only)
```
**บัญชีทั้งหมดทำใน WINSpeed หลังอนุมัติ — เราไม่เขียน dbo เลย ✅**

---

## ผลสำรวจ UI จริง (2026-06-09)

### Post Invoice (WF) — เครื่องมือ post ใบกำกับแบบชุด (ขั้นที่ WINSpeed ลง GL)
ฟอร์มชื่อ "Post Invoice" (custom WF). ลำดับงาน:
- **Filter**: จากวันที่ขาย · จากเลขที่ขาย · จากรหัสคลัง · **จากเลขที่ใบสั่งขาย** (+ปุ่ม refresh)
- **Grid**: No, S(เลือก), เลขที่ใบจอง, Coupon No., **เลขที่ใบสั่งขาย**, รหัสสินค้า, ชื่อสินค้า, คลัง, ที่เก็บ, หน่วยนับ, จำนวน
- เลือกรายการ (checkbox S) → กดปุ่ม **"Post Invoice"** → สร้างใบกำกับ (107) + GL เป็นชุด
- **= ขั้นตอนที่ WINSpeed ลงบัญชีเอง** (เราไม่แตะ); flow: ใบสั่งขาย(104) → Post Invoice(WF) → ใบกำกับ(107)+GL

### Sale Order (WF) — custom fields ของ World Fert
ฟอร์ม "ใบสั่งขาย / Sales Order" มี 4 tab: Detail · More · Description · **Define Field**
- Header เด่น: **"อ้างถึงอนุมัติใบสั่งจอง"** (link กลับใบสั่งจองที่อนุมัติ — = RefNo→AppvDocuNo)
- Tab **More**: กลุ่มภาษี = **ยกเว้น**, อัตราภาษี = **0.00** (ยืนยันปุ๋ยยกเว้น VAT), เขตการขาย/แผนก/Job, Clear flag
- Tab **Define Field** (custom WF): **`เลขทะเบียนรถ`** ← field เดียวที่ World Fert เพิ่ม
  → ตรงกับ `dbo.SOHD.TransRegistration` ที่พบในข้อมูล (ทะเบียนรถสำหรับงานชั่ง/ขนส่ง)
- ฟอร์มใบสั่งจอง (Confirm Order WF) เพิ่ม: "ขนพร้อมทะเบียน", "ตรวจสอบทั้งใบ" บน header

### สรุป customization "(WF)" ของ World Fert (เบาๆ)
1. field **เลขทะเบียนรถ** (Define Field) → ใช้ในงานตั๋วคุม/ชั่ง
2. **Post Invoice (WF)** = batch แปลงใบสั่งขาย→ใบกำกับ+GL
3. ฟอร์ม (WF): Confirm Order, Sale Order, Credit Note + Approve Confirm Order
→ ระบบใหม่: ป้อน SO ผ่าน import (มี GoodQty2 ตัน + เลขทะเบียนรถ) → ใช้ Post Invoice (WF) เดิมลงบัญชี

## ต้องยืนยัน/ทำต่อ
1. ทดสอบ import ไฟล์ตัวอย่าง 1 ใบในระบบทดสอบ (ไม่ใช่ production) — ตรวจว่าใบสั่งขายเข้าถูก + Post Invoice (WF) ออกใบกำกับ+GL ถูก
2. ยืนยันว่า import รองรับ field เลขทะเบียนรถ (custom) หรือต้องเติมหลัง import
3. map รหัส master: ลูกค้า/สินค้า/พนักงาน ใน wf ↔ รหัสจริงใน WINSpeed (EMCust/EMGood/EMEmp)
