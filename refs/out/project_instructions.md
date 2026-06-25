# World Fert — Winspeed Sale Connect App

## บทบาทและเป้าหมาย
ศึกษา Prosoft WINSpeed v9.0 DB (SQL Server 2022) เพื่อพัฒนาระบบสั่งขายปุ๋ย + ส่วนลดรีเบท เป็น Web App (React + NestJS) เชื่อมตรง **SQL Server เดียว** — schema `wf` ใน DB เดียวกันกับ `dbo` · **ไม่ใช้ PostgreSQL / Redis / Queue** (เน้น simple, JOIN ข้าม schema ได้ตรง)

---

## กฎเหล็ก (ห้ามฝ่าฝืน)
1. **`dbo` = READ-ONLY** ห้าม INSERT/UPDATE/DELETE/DDL บน schema `dbo` เด็ดขาด
2. เขียนได้เฉพาะใน schema `wf` ที่เราสร้างเอง
3. ก่อนรัน query ที่ไม่ใช่ SELECT ให้ถามยืนยันทุกครั้ง
4. ใช้ login: `wf_reader` สำรวจ / `wf_owner` สร้าง object

---

## DB Connection
- Server: `.\SQLEXPRESS` | DB: `dbwins_worldfert9` | SQL Server 2022
- `wf_reader` / `ChangeMe_Strong#2026` (db_datareader ทั้ง DB)
- sqlcmd: `sqlcmd -S .\SQLEXPRESS -U wf_reader -P ChangeMe_Strong#2026 -d dbwins_worldfert9 -C -W -s , -h -1`

---

## โครงสร้าง DB (ยืนยันแล้ว)
- 669 ตาราง / **FK จริงแค่ 4 รายการ** → relationship เป็น naming convention (`*ID` → PK master)
- Single branch (BrchID=1), Single warehouse
- Data ตั้งแต่ปี 2555–2025
- field ภาษาไทยใน `wf` ใช้ **NVARCHAR** เท่านั้น

---

## DocuType Reference
| DocuType | ชื่อ | ตาราง | PK |
|---|---|---|---|
| 103 | ใบจอง (Confirm Order) | SOHD/SODT | SOID |
| 104 | ใบสั่งขาย (Sale Order) | SOHD/SODT | SOID |
| **107** | **ใบกำกับขายเชื่อ** | **SOInvHD/DT** | **SOInvID** |
| 108 | ขายสด | SOInvHD/DT | SOInvID |
| 109 | Credit Note | SOInvHD/DT | SOInvID |
| 202 | (ไม่ชื่อใน ICDocuTypeHD) | SOInvHD/DT | SOInvID |
| **501** | **GL Journal** | **GLHD/GLDT** | **GLID** |

---

## Row Counts ตารางสำคัญ
| ตาราง | แถว | หมายเหตุ |
|---|---|---|
| SOHD | 107,018 | 103=54,095 / 104=52,923 |
| SOInvHD | 282,087 | 107=146,276 / 202=113,043 |
| SOInvDT | 471,641 | GoodID=NULL 224,571 rows |
| GLHD/GLDT | 384,400 / 813,085 | |
| EMGood | 417 | EMCust=790 |
| EMSetPriceHD/DT | 129 / 4,054 | 2022–2025 |

**ตารางว่าง (0 rows):** SOPickingHD/DT, ICStock, ICPriceHD/DT, EMCreditTerm, BTCar, TMTruck

---

## GL Flow (ยืนยันแล้ว)
```
SOHD (103→104) → SOInvHD (107, PostGL='Y') → GLHD → GLDT → EMAcc
```
✅ Join ถูก: `JOIN GLHD g ON g.DocuNo = s.DocuNo AND g.FromFlag = 107`  
✅ Join ถูก: `JOIN GLHD g ON g.FromID = s.PostID AND g.FromFlag = 107`  
❌ Join ผิด: `JOIN GLHD g ON g.FromID = s.SOInvID` (ตัวเลขชนโดยบังเอิญ!)

GL pattern 107: Dr 1037 (ลูกหนี้-ค้างส่ง) / Cr 1120 (ขายสินค้า-เงินเชื่อ); 1129=รายได้อื่น. ปุ๋ยยกเว้น VAT → ไม่มี VAT line

---

## หน่วย & ราคา
- `GoodUnitID=1002` = ตัน | `GoodUnitID=1001` = ใบ
- **ไม่มี conversion ตัน↔กระสอบ ใน DB** → ใส่ใน `wf.GoodExtra.BagPerTon` (1 ตัน = 20 กระสอบ)
- `SOInvDT.GoodQty2` = qty ตัน | `SOInvDT.GoodPrice2` = บาท/ตัน
- ราคา NET อยู่ที่ **`EMSetPriceDT.GoodPriceNet`** (ICPriceHD/DT ว่าง)

---

## ตั๋วคุม Flow
```
SOHD 103 AppvFlag='W' → AppvFlag='Y' + AppvDocuNo='AI68-XXXXX'
→ SOHD 104 RefNo='AI68-XXXXX' → SOInvHD 107
```
- ทะเบียนรถ: `SOHD.TransRegistration` / backup: `SOHDRemark.Remark` ListNo=1
- **ไม่มี Gross/Tare/Net weight ใน WINSpeed** → ต้องสร้าง `wf.WeighTicket`

---

## Key Relationships
- `SOInvHD.ARID` = `CustID` → อ้าง `EMCust`
- `GLHD.FromFlag` = source DocuType (ไม่ใช่ GLHD.DocuType ซึ่ง=501 เสมอ)
- `SOInvHD.PostID` = `GLHD.FromID` (ไม่ใช่ GLHD.GLID)
- `SOInvHD.SONo` = `SOHD104.DocuNo`; `SOHD104.RefNo` = `SOHD103.AppvDocuNo`
- **CN 109**: `RefSOID`→SOInvID | **DN 110**: `RefNo`→DocuNo (RefSOID=NULL!)
- รับชำระ: `ARReceDT.SOInvID` = SOInvHD (131,816 แถว)
- `EMSetPriceHD`: CustID + GoodID + BeginDate/EndDate → `EMSetPriceDT`: ListID + qty tier

## Credit — ไม่มีใน WS
- `EMCust.CreditAmnt = 0` ทุกราย (790), ARControl ว่าง → ออกแบบ Credit Master ใน wf
