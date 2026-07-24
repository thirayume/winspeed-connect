---
documentId: "WF-QA-012"
title: "03 — คู่มือผู้ใช้งาน (User Guide & Manual)"
version: "v1.0"
status: Superseded
statusDetail: "Superseded by source-aligned WF-UG-101; retained for history only"
supersededBy: "WF-UG-101"
owner: "QA Lead"
normative: true
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-QA-012` · Version: v1.0 · Date: 21 กรกฎาคม 2569 (21 July 2026) · Status: Superseded
> Classification: Confidential — Client / Authorized Partner Use Only
> Source of truth: operational build v1.0 · verified against `dbwins_worldfert9`

---
# 03 — คู่มือผู้ใช้งาน (User Guide & Manual)

> WS-Sale-App · build v5.0.0 · สำหรับผู้ใช้ทุก Role
> ระบบเป็น Web App (tablet-first, iPad 768–1024px) · เข้าผ่าน browser

## บทบาทผู้ใช้ (Roles)
| Role | หน้าที่หลัก | เมนูที่เห็น |
|------|------------|------------|
| **SALES** | สร้างใบสั่งขาย, ดูรีเบท/ของแถม, ขอปลดล็อก | Dashboard, ขาย, เสนอราคา, Paper Trail, รีเบท, WF Rebate Trail, Voucher, ของแถม, SO ค้างจัดส่ง, ชุดตั๋วคุม |
| **COUNTER_SALES** | คีย์/ตรวจซ้ำ SO, พิมพ์เอกสาร | + ตรวจซ้ำ (Verification), TruckScale |
| **WAREHOUSE** | รับสินค้า, จัดของ, ชั่งออก | คลัง, Paper Trail, TruckScale |
| **WEIGHBRIDGE** | ยืนยันน้ำหนัก, ส่งออก | คลัง, TruckScale |
| **APPROVER** | อนุมัติ Unlock/Plan | + คำขอปลดล็อก, Rebate Plan, รายงาน |
| **ACCOUNTING** | ตรวจรีเบทและเอกสาร WINSpeed | + บัญชี, WF Rebate Trail, รายงาน, Rebate Plan |
| **ADMIN** | จัดการ user, ข้อมูลหลัก, สลับ DB | ทุกเมนู + ผู้ใช้งาน + ข้อมูลหลัก |

## การเข้าระบบ
1. เปิด URL → กรอก Username / Password → **เข้าสู่ระบบ**
2. (ADMIN) มุมซ้ายล่างมีปุ่มสลับแหล่งข้อมูล **LOCAL / REMOTE** — ปกติใช้ REMOTE (ข้อมูลจริง)
3. ออกจากระบบ: ปุ่ม **ออกจากระบบ** มุมซ้ายล่าง

---

## 1. Dashboard — ภาพรวม
- เห็น: SO ทั้งหมด, รอจัดส่ง/รับสินค้า, ส่งออกจากตาชั่ง, ปิด SO ใน WINSpeed, SO ค้างจัดส่ง >30 วัน, รีเบทใช้ได้ (฿)
- ตาราง SO ค้างจัดส่ง: สีเหลือง >30 วัน, สีแดง >45 วัน; แสดงเลขเอกสาร, ลูกค้า, สินค้าบรรทัดแรก, จำนวนตัน, จำนวนวันค้าง
- หมายเหตุ: ส่วนนี้ไม่ใช่ลูกหนี้ค้างชำระ และไม่ใช่หน้าตั๋วคุมโดยตรง
- ใช้ดูสถานะรวมประจำวัน

## 2. ขาย / SO (POS) — สร้างใบสั่งขาย
**ใครใช้:** SALES, COUNTER_SALES
1. เลือก **prefix** (I=เชื่อม / K=คลัง / AI=ตั๋วคุม)
2. ค้นหา/เลือก **ลูกค้า** → กรอก **ทะเบียนรถ**, วันส่ง
3. แตะการ์ดสินค้าเพื่อ **เพิ่มรายการ** → ระบุจำนวน (ตัน)
   - ระบบแสดง **Reb** (รีเบท/ตัน = ราคาขาย − NET) และยอดรวมทันที
4. (ถ้ามี) เลือก **ของแถม** — เห็นงบคงเหลือ
5. (ถ้ามี) เลือก **ตั๋วคุม** เพื่อตัดจากยอดจอง
6. กด **บันทึก** → ได้ SO สถานะ DRAFT
> ⚠️ DRAFT ยังต้อง **ตรวจซ้ำ** ก่อนยืนยัน (ดูข้อ 5)

## 3. เสนอราคา / Quotation
1. สร้างใบเสนอราคา (ลูกค้า + รายการ + ราคา)
2. สถานะ DRAFT → SENT → ACCEPTED
3. **แปลงเป็น SO**: ปุ่ม Convert → สร้าง SO DRAFT อัตโนมัติ
4. เมื่อบันทึกใบเสนอราคา ระบบจะสร้าง native WINSpeed Quotation ใน `dbo.SOHD/SODT` เป็น `DocuType=102` เลข `QU...`; เมื่อกดยืนยัน/อนุมัติ ระบบจะสร้างหรือผูก `QC...` เป็น `DocuType=113` ก่อนจึงจะแปลงเป็น SO ได้

## 4. คลัง / Store — รับสินค้า & ชั่งออก
**ใครใช้:** WAREHOUSE, WEIGHBRIDGE
1. **เริ่มรับสินค้า** (CONFIRMED → PICKING)
2. **จัดลำดับโหลด** แม่-ลูก (VisualTruckLoader) — ลากกำหนดลำดับ
3. **ชั่งออก:**
   - กรอก **ชั่งเข้า (รถเปล่า, กก.)** + **ชั่งออก (รถ+สินค้า, กก.)** + เลือก **เครื่องชั่ง** → ระบบคำนวณ **สุทธิ**
   - หรือกด **🔗 ดึงน้ำหนักจาก TruckScale** → เลือกใบชั่งที่ทะเบียนตรงกัน → ค่าเติมอัตโนมัติ
   - กด **ยืนยัน / ส่งออก** → SO = SHIPPED + บันทึกใบชั่ง (WeighTicket)

## 5. ตรวจซ้ำ (Verification Gate) — Counter Sales
**ใครใช้:** COUNTER_SALES, ADMIN, MANAGER
- ไปที่ **Paper Trail** → การ์ดคอลัมน์ "ร่าง (DRAFT)"
- ตรวจความถูกต้อง → กด **ตรวจแล้ว** (ปุ่มเขียว) → ขึ้น ✓ ตรวจแล้ว
- หลังจากนี้ SALES จึงกด **ยืนยัน** ได้ (ระบบบล็อกถ้ายังไม่ตรวจ)

## 6. Paper Trail — เอกสาร 4 สี + QR
**ใครใช้:** ทุกคน
- **Kanban** 4 สถานะ: ร่าง / ยืนยัน / รอรับสินค้า / ส่งออก
- **พิมพ์ 4 สี:** การ์ด → "พิมพ์ 4 สี" → เห็น 4 สำเนา (ขาว=บัญชี, ฟ้า=เก็บ, ชมพู=ลูกค้า, เหลือง=รปภ.) แต่ละใบมี **QR ไม่ซ้ำ** → กด "พิมพ์"
- **สแกนติดตาม:** ปุ่ม "สแกนเอกสาร" → กรอก/สแกน QR → เลือกการกระทำ (กำลังส่ง / เซ็นรับ / จัดเก็บ / แจ้งหาย) → บันทึกประวัติ
- **แจ้งเตือนใบหาย:** แถบแดง "ใบค้าง/หาย (n)" เมื่อสำเนา LOST หรือค้าง >3 วัน
- **ขอปลดล็อก** (การ์ด PICKING): ปุ่ม "ขอปลดล็อก" → เหตุผล ≥10 ตัว
- **อนุมัติปลดล็อก** (APPROVER): ปุ่ม "คำขอปลดล็อก (n)" → อนุมัติ/ปฏิเสธ

## 7. รีเบท (App) — Pool / FIFO / เคลม
**ใครใช้:** ทุกคน (เคลม: SALES/ACCOUNTING)
- เลือก **Pool** (ต่อพนักงานต่อเดือน) → เห็น Ledger FIFO (สะสม/เคลม/ใช้ได้)
- **ยื่นเคลม:** กด "ยื่นเคลม" → ระบุยอด (≤ ใช้ได้) → ตัด FIFO จากรายการเก่าสุด
- บัญชีตรวจสอบ/อนุมัติ claim ใน app; เอกสาร rebate/coupon/redemption/invoice อย่างเป็นทางการยังออกโดย WINSpeed

## 8. Rebate Plan — แผนส่งเสริม
**ใครใช้:** ADMIN, MANAGER, APPROVER, ACCOUNTING
1. **สร้าง Plan**: สูตร (เว้นว่าง=ทุกสูตร), ภาค, ประเภทคืน (รีเบท/ส่วนต่าง), ราคา NET, ช่วงเวลา, งบ, priority
2. **เปิดใช้งาน** (▶) → ACTIVE (accrual จะ match Plan นี้อัตโนมัติ)
3. **จัดสรรงบ** (💰) → เลือกพนักงานขาย + จำนวน → เพิ่มเข้า Pool
4. **ปิด** (⬛) เมื่อหมดโปรโมชั่น

## 9. WF Rebate Trail — Coupon / Redemption / Invoice (จาก WINSpeed)
**ใครใช้:** ACCOUNTING, ADMIN, MANAGER, SALES
- ดูประวัติ WF Rebate จริงจาก WINSpeed (single source of truth)
- กรองปี/ค้นหา → คลิก SO → รายละเอียดใบจอง/ใบสั่งขาย → คูปอง → Redemption → Invoice/Receipt/GL

## 10. Voucher — คูปองคงค้าง
- ยอดคูปองสะสม (หน่วยตัน) ต่อพนักงานขาย → drill ลูกค้า → ใบคูปอง

## 11. บัญชี / Accounting
**ใครใช้:** ACCOUNTING
- **ออกของวันนี้:** เลือกวันที่ → เห็นเอกสารที่ออกจาก WINSpeed
- **อนุมัติเคลมรีเบท:** กดอนุมัติ claim ใน app และบันทึกเลขอ้างอิงเอกสาร WINSpeed เมื่อมี
- **Post Invoice:** ไปที่เมนู **Post Invoice** เพื่อดูรายการ SHIPPED ที่พร้อมให้บัญชีไป Post Invoice (WF) ใน WINSpeed และตรวจรายการที่ post แล้ว

## 12. ของแถม / Giveaway
- เห็นงบ/เบิก/คงเหลือ ต่อภาค → พนักงาน → รายการ
- **เบิก:** เลือกรายการ + จำนวน (เบิกเกินงบได้แต่จะเตือน)

## 13. รายงาน / Reports
**ใครใช้:** ADMIN, MANAGER, ACCOUNTING, APPROVER
- เลือกรายงาน (สถานะ SO / Rebate Pool / ของแถม / Paper / WF Rebate Trail)
- กด **Export Excel** → ดาวน์โหลด .xlsx

## 13.1 Post Invoice / Reconciliation
**ใครใช้:** ACCOUNTING, ADMIN, MANAGER
- รายการ **พร้อม Post Invoice** = SO ที่ SHIPPED แล้ว แต่ยังไม่พบ invoice ใน WINSpeed
- รายการ **Post แล้ว** = พบ `SOInvHD/SOInvDT` จาก WINSpeed แล้ว
- เมื่อพบ invoice แล้ว ระบบจะ lock การแก้ SO ผ่าน app เพื่อป้องกันข้อมูลไม่ตรงกับบัญชี/GL

## 14. SO ค้างจัดส่ง / Aging
- SO ค้างจัดส่ง + อายุ (30/45 วัน) + ค้นหา/แบ่งหน้า
- ใช้ติดตามงานขาย/คลังที่ยังไม่จบ ไม่ใช่ AR aging; ถ้าต้องการลูกหนี้คงค้างให้ใช้รายงานบัญชี/AR แยก

## 15. ชุดตั๋วคุม / Control Ticket
- รายการตั๋ว AI ที่ยังมียอดคงเหลือ (จอง − ตัดแล้ว) + bar
- คลิก → รายการสินค้า + **ประวัติการตัด** (SO 104 ที่ตัดออก)

## 16. TruckScale — เครื่องชั่ง
**ใครใช้:** WAREHOUSE, WEIGHBRIDGE, COUNTER_SALES
- แถบสถานะการเชื่อมต่อ + จำนวนใบชั่ง
- ค้นหาด้วย **ทะเบียนรถ** หรือ **movebill** → ตารางใบชั่ง (เข้า/ออก/สุทธิ กก.)
- คลิกแถว → รายละเอียด + สินค้า

## 17. ผู้ใช้งาน / ข้อมูลหลัก (ADMIN)
- **ผู้ใช้งาน:** สร้าง/แก้ user + map กับพนักงาน (EmpId)
- **ข้อมูลหลัก:** แก้ลูกค้า/สินค้า, **จัดการราคา NET (Price Book)** + clone ราคาเดือนถัดไป

---
## ปัญหาที่พบบ่อย (Troubleshooting)
| อาการ | สาเหตุ/วิธีแก้ |
|-------|----------------|
| ยืนยัน SO ไม่ได้ "ต้องตรวจซ้ำ" | ให้ Counter Sales กด "ตรวจแล้ว" ที่ Paper Trail ก่อน |
| TruckScale "เชื่อมต่อไม่ได้" | แจ้ง Admin ตรวจ env MYSQL_* บน server |
| ข้อมูล LOCAL/REMOTE ต่างกัน | ปกติ — เลือกปุ่มให้ตรงงาน (REMOTE=จริง) |
| Export Excel ไม่ดาวน์โหลด | ตรวจ pop-up blocker ของ browser |

---

## Current Addendum - 2026-07-08

### Login with LINE
1. Click **Login with LINE** on the login page.
2. If the LINE account is not linked yet, the login page asks the user to enter their existing WS-Sale-App username/password.
3. If the username/password is valid and active, the app links LINE to that `wf.AppUser` and logs in immediately.
4. If login fails, contact Admin so the user can be created, activated, or reset first.
5. Admin can still review or clear `LineUserId` in **ผู้ใช้งาน / Admin Users** when support is needed.

LINE Developers setup:
- Messaging API Webhook URL: `https://<backend-domain>/api/line/webhook`
- LINE Login Callback URL: `https://<backend-domain>/api/auth/line/callback`

### Sales Order updates
- SO create/edit supports requested date-time, own truck, no truck required, and P-Sling.
- Price input uses 5 color levels compared with Set Price.
- Giveaway can be ticked per line; Manager/Admin must approve giveaway lines before SO confirm.
- SO detail shows status timeline timestamps, including shipping/weigh-out time where available.

### Admin / Sale Admin updates
- Rebate Plan supports Ref Doc fields.
- Master Data > Customers includes new customer request flow stored in `wf.CustomerRequest`.
- The customer request flow does not automatically create `dbo.EMCust`; Sale Admin/WINSpeed remains responsible for official customer master creation.

## Current Addendum - 2026-07-13

### Access As
1. Users with role `ADMIN`, `MANAGER`, `ACCOUNTING`, `APPROVER`, or `COUNTER_SALES` can use **Access As** from the topbar.
2. Role hierarchy from highest to lowest is: `ADMIN` -> `MANAGER` -> `ACCOUNTING` -> `APPROVER` -> `COUNTER_SALES` -> `SALES`.
3. While Access As is active, the app behaves like the selected effective user:
   - sidebar/menu visibility follows the effective role;
   - customer/data visibility follows the effective user mapping;
   - create/edit/approve permissions follow the effective role.
4. The real actor is still preserved in the token and audit trail.
5. Use **Stop Access As** to return to the real user.

Audit behavior:
- `wf.AccessAsAudit` records START and STOP.
- `wf.ApiAuditLog` records mutating API calls with both `ActorUserId` and `EffectiveUserId`.
- This allows review of who performed work directly and who performed work on behalf of another user.

### Automated QA reference
- IT/QA can repeat the latest smoke tests from [09-AUTOMATED-QA.md](AUTOMATED-QA.md).

