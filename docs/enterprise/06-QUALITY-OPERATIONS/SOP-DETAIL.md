---
documentId: "WF-QA-013"
title: "04 — ขั้นตอนปฏิบัติงานมาตรฐาน (Standard Operating Procedures · SOP)"
version: "v1.0"
status: Released
owner: "QA Lead"
normative: true
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-QA-013` · Version: v1.0 · Date: 21 กรกฎาคม 2569 (21 July 2026) · Status: Released
> Classification: Confidential — Client / Authorized Partner Use Only
> Source of truth: operational build v1.0 · verified against `dbwins_worldfert9`

---
# 04 — ขั้นตอนปฏิบัติงานมาตรฐาน (Standard Operating Procedures · SOP)

> สำหรับระบบบริหารคุณภาพ ISO 9001 · WS-Sale-App · build v5.0.0
> เอกสารควบคุม — แก้ไขต้องผ่านผู้อนุมัติและขึ้นเวอร์ชันใหม่

## ข้อมูลควบคุมเอกสาร (Document Control)
| รายการ | ค่า |
|--------|-----|
| รหัสเอกสาร | WF-SOP-WSSALE |
| เวอร์ชัน | 1.0 |
| วันที่บังคับใช้ | 27 มิ.ย. 2569 |
| เจ้าของเอกสาร | ฝ่ายขาย / IT (Solution Architect) |
| ผู้อนุมัติ | กรรมการบริหาร |
| รอบทบทวน | ปีละ 1 ครั้ง หรือเมื่อระบบเปลี่ยนสำคัญ |

## บันทึก/ประวัติการแก้ไข (Revision History)
| Ver | วันที่ | ผู้แก้ | รายละเอียด |
|-----|--------|--------|------------|
| 1.0 | 27/06/2569 | T. Meeriksom | ฉบับแรก ครอบคลุม SOP-01..08 |

---

## SOP-01 — กระบวนการใบสั่งขาย (Sales Order Lifecycle)
**วัตถุประสงค์:** ให้การสร้างและดำเนินการใบสั่งขายถูกต้อง ตรวจสอบได้ มี audit ครบ
**ขอบเขต:** ตั้งแต่รับ order จนถึงส่งออก (Shipped)
**ผู้รับผิดชอบ:** SALES, COUNTER_SALES, WAREHOUSE, WEIGHBRIDGE, APPROVER

**ขั้นตอน:**
1. **SALES** สร้าง SO (หน้า "ขาย") → ระบุลูกค้า/สินค้า/ตัน/ทะเบียนรถ → บันทึก (สถานะ **DRAFT**)
2. **COUNTER_SALES** ตรวจซ้ำ (หน้า Paper Trail การ์ด DRAFT → "ตรวจแล้ว") → บันทึก VerifiedBy/At
3. **SALES** กด **ยืนยัน** (ระบบบล็อกถ้ายังไม่ตรวจ) → สถานะ **CONFIRMED** + ตั้ง Rebate accrual อัตโนมัติ + ส่งข้อมูลเข้า WINSpeed (dbo.SOHD/SODT)
4. **WAREHOUSE** "เริ่มรับสินค้า" → **PICKING** → จัดลำดับโหลดแม่-ลูก
5. **WEIGHBRIDGE** ชั่งออก (ดู SOP-03) → **SHIPPED**
6. **ACCOUNTING** เปิดเมนู Post Invoice ใน app เพื่อตรวจรายการ SHIPPED ที่พร้อม post จากนั้นไปทำ **Post Invoice (WF)** ใน WINSpeed
7. WINSpeed ออกใบกำกับ + ลงบัญชี (GL) เอง (ดู SOP ของบัญชี WINSpeed)
8. หลังพบ invoice ใน WINSpeed แล้ว app จะ lock การแก้ SO เพื่อป้องกันข้อมูล SO ไม่ตรงกับ invoice/GL

**การควบคุม:** ทุก transition บันทึก `wf.SalesOrderAudit` (ผู้ทำ, IP, เวลา, before/after) · ห้ามแก้ DRAFT หลังยืนยันโดยไม่ผ่าน Unlock (SOP-05)
**บันทึก/หลักฐาน:** wf.SalesOrder, SalesOrderAudit, เอกสาร 4 สี (SOP-04)

---

## SOP-02 — การบริหารรีเบท (Rebate Management)
**วัตถุประสงค์:** คำนวณ/เคลม/คืนรีเบทถูกต้อง ตรวจสอบย้อนกลับได้ 100%
**ผู้รับผิดชอบ:** MANAGER (Plan), SALES (เคลม), ACCOUNTING (อนุมัติ/ตรวจเอกสาร WINSpeed)

**ขั้นตอน:**
1. **MANAGER** สร้าง Rebate Plan (หน้า Rebate Plan) → เปิดใช้งาน (ACTIVE) → จัดสรรงบให้พนักงานขาย (เข้า Pool)
2. เมื่อ **ยืนยัน SO** ที่ราคาขาย > NET → ระบบตั้ง accrual = (ราคาขาย − NET) × ตัน เข้า `wf.RebateLedger` (FIFO) + tag Plan
3. **SALES** ยื่นเคลม (หน้า รีเบท) → ระบบตัด FIFO จากรายการเก่าสุด
4. **ACCOUNTING** อนุมัติ claim ใน app → บันทึกเลขอ้างอิงเอกสาร WINSpeed เมื่อมี โดยไม่ให้ app เป็นผู้ post GL/AR แทน WINSpeed
5. ตรวจประวัติ WF Rebate จริงได้ที่หน้า **WF Rebate Trail** (อ่านจาก WINSpeed: `WFCoupon` → `WFRedemtion` → `SOInv` → Receipt/GL)

**การควบคุม:** ฐานราคา NET มาจาก Price Book (dbo.EMSetPriceDT, SOP-06) · การ unlock จะ reverse accrual (ไม่ลบ — ReversedFlag)
**บันทึก:** wf.RebatePlan/Pool/Ledger/Claim, dbo.WFCoupon/WFRedemtionHD/DT/SOInvHD/SOInvDT (อ่านเพื่อตรวจสอบ)

---

## SOP-03 — การชั่งออกและส่งสินค้า (Weigh-out & Shipping)
**วัตถุประสงค์:** บันทึกน้ำหนักจริงถูกต้อง เชื่อมเครื่องชั่ง (TruckScale)
**ผู้รับผิดชอบ:** WEIGHBRIDGE

**ขั้นตอน:**
1. รถเข้า → SO อยู่สถานะ PICKING/LOADED
2. หน้า **คลัง** → เลือก SO → "ชั่งออก"
3. **วิธี A (เชื่อม TruckScale):** กด "🔗 ดึงน้ำหนักจาก TruckScale" → ระบบค้นใบชั่งด้วยทะเบียนรถ → เลือกใบชั่ง → tare/gross/net/เครื่องชั่ง/movebill เติมอัตโนมัติ
4. **วิธี B (กรอกมือ):** กรอกชั่งเข้า (รถเปล่า) + ชั่งออก (รถ+สินค้า) เป็น กก. → ระบบคำนวณสุทธิ
5. กด **ยืนยัน/ส่งออก** → SO = **SHIPPED** + บันทึก `wf.WeighTicket` (gross/tare/net + เวลา + เครื่องชั่ง + movebill)

**การควบคุม:** ความจุเครื่องชั่ง 80 ตัน/เครื่อง · completed-weigh source ของ TruckScale = read-only · App เขียนเฉพาะ pre-weigh queue `tbl_keyone` · จับคู่ด้วยทะเบียนรถ (เลข invoice ฝั่ง TruckScale ไม่น่าเชื่อถือ)
**บันทึก:** wf.WeighTicket, TruckScale.tblscale (อ้างอิง)

---

## SOP-04 — การควบคุมเอกสาร (Document Control / Paper Trail)
**วัตถุประสงค์:** ติดตามเอกสารจ่ายสินค้า 4 สี ไม่ให้สูญหาย
**ผู้รับผิดชอบ:** COUNTER_SALES, WAREHOUSE, รปภ.

**ขั้นตอน:**
1. หลังยืนยัน SO → หน้า Paper Trail → "พิมพ์ 4 สี" → พิมพ์ (ขาว=บัญชี, ฟ้า=เก็บ, ชมพู=ลูกค้า, เหลือง=รปภ.) แต่ละใบมี QR ไม่ซ้ำ
2. ทุกจุดส่งมอบ **สแกน QR** → เลือกสถานะ (กำลังส่ง/เซ็นรับ/จัดเก็บ)
3. ใบหาย → สแกน "แจ้งหาย" → ระบบขึ้นเตือน
4. ตรวจรายวัน: แถบ "ใบค้าง/หาย" — ติดตามใบค้าง >3 วัน

**การควบคุม:** QR unique ต่อสำเนา · ประวัติ scan ทุกครั้ง (wf.PaperScan) · alert อัตโนมัติ
**บันทึก:** wf.PaperCopy, PaperScan

---

## SOP-05 — การขอ/อนุมัติปลดล็อก (Unlock Request)
**วัตถุประสงค์:** ควบคุมการแก้ไข SO หลังยืนยัน
**ผู้รับผิดชอบ:** ผู้ขอ (SALES/WAREHOUSE), ผู้อนุมัติ (APPROVER)

**ขั้นตอน:**
1. ผู้ขอ: หน้า Paper Trail การ์ด PICKING → "ขอปลดล็อก" → ระบุเหตุผล (≥10 ตัวอักษร)
2. APPROVER: "คำขอปลดล็อก (n)" → ตรวจเหตุผล → **อนุมัติ** หรือ **ปฏิเสธ**
3. ถ้าอนุมัติ: SO กลับ CONFIRMED + **reverse Rebate accrual** (ไม่ลบ) + ปลด PkgStatus

**การควบคุม:** 1 SO มีคำขอ PENDING ได้ครั้งละ 1 · ทุกการอนุมัติบันทึกผู้อนุมัติ+เวลา
**บันทึก:** wf.UnlockRequest, SalesOrderAudit

---

## SOP-06 — ข้อมูลหลัก & Price Book (Master Data)
**วัตถุประสงค์:** ราคา NET และ master ถูกต้องเป็นปัจจุบัน
**ผู้รับผิดชอบ:** ADMIN

**ขั้นตอน:**
1. หน้า ข้อมูลหลัก → Prices → ปรับ **ราคา NET รายเดือน** (เขียน dbo.EMSetPriceDT)
2. ขึ้นเดือนใหม่: **clone (bulk-extend)** ราคาจากเดือนก่อน → ปรับเฉพาะที่เปลี่ยน
3. แก้ลูกค้า/สินค้าเท่าที่จำเป็น

**การควบคุม:** ราคา NET = ฐานคำนวณรีเบท (SOP-02) — ต้องอนุมัติก่อนใช้จริง · เป็นการเขียน dbo ที่อนุญาต
**บันทึก:** dbo.EMSetPriceHD/DT (DocuNo WEB-YYYYMMDD-xxxx)

---

## SOP-07 — ฐานข้อมูล & การ Deploy (IT Operations)
**วัตถุประสงค์:** ดูแลฐานข้อมูล/การปรับปรุงระบบให้ปลอดภัย ตรวจสอบได้
**ผู้รับผิดชอบ:** ADMIN / IT

**ขั้นตอน:**
1. **เปลี่ยน schema wf:** เขียน migration ใหม่ใน `backend/migrations/0xx.sql` เท่านั้น → `npm run migrate:local` ทดสอบ → `npm run migrate:remote`
2. **Deploy:** `npm run deploy` (หรือ deploy:skip-migrate) → bump version + push → Railway/Vercel auto-deploy
3. **สลับ DB:** ADMIN ใช้ปุ่ม LOCAL/REMOTE (ทดสอบ vs จริง)
4. **TruckScale (MySQL):** ตั้ง env `MYSQL_*` ทั้ง local และ Railway · ห้ามตั้ง DB_MODE=mysql
5. **Backup:** สำรอง SQL Server (wf+dbo) ตามนโยบาย; TruckScale บน Railway มี backup ของ provider

**การควบคุม:** dbo = READ-ONLY ยกเว้นที่ระบุ (confirm/picking/ship/cancel/prices) · GL เป็นของ WINSpeed · ทุก deploy มีเลขเวอร์ชัน
**บันทึก:** git history, migration files, deploy log

---

## SOP-08 — ผู้ใช้และสิทธิ์ (User & Access Management)
**วัตถุประสงค์:** ควบคุมการเข้าถึงตามหน้าที่ (RBAC)
**ผู้รับผิดชอบ:** ADMIN

**ขั้นตอน:**
1. หน้า ผู้ใช้งาน → สร้าง user → กำหนด Role (7 บทบาท) → map กับพนักงาน (EmpId)
2. พนักงานลาออก → ปิดการใช้งาน (IsActive=0)
3. ทบทวนสิทธิ์ตามรอบ

**การควบคุม:** รหัสผ่าน bcrypt · JWT หมดอายุตามกำหนด · permission ตรวจทั้ง frontend + backend
**บันทึก:** wf.AppUser, wf.AccessAsAudit, wf.ApiAuditLog

---

## เอกสารอ้างอิง (References)
- [00-DATABASE-OVERVIEW.md](../04-DATA-INTEGRATION/DATABASE-OVERVIEW.md) — ฐานข้อมูล & mapping
- [01-PAGES-SQL-MAP.md](../04-DATA-INTEGRATION/PAGES-SQL-MAP.md) — หน้า → SQL → migration
- [02-TEST-CASES.md](TEST-CASES-DETAIL.md) — กรณีทดสอบ
- [03-USER-GUIDE.md](USER-GUIDE-DETAIL.md) — คู่มือผู้ใช้
- SRS v6.2 (`refs/WorldFert_SRS_v6_0.docx`), Diagrams v6.2, Presentation v6.2

---

## Current Addendum - 2026-07-08

### SOP-01 Sales Order updates
- SALES can record requested/notification date-time, own truck, no truck required, and P-Sling during SO create/edit.
- Price color is displayed against Set Price to support review before save/confirm.
- Giveaway line items require Manager/Admin approval before SO confirm.

### SOP-04 Paper Trail updates
- Customer and security copies must not show prices.
- Security copy styling is green.
- SO detail now surfaces status timestamps, including shipping/weigh-out time where available.

### SOP-06 Master / Customer request updates
- New customer requests are captured in `wf.CustomerRequest`.
- Sale Admin/Admin reviews the request and creates/maintains the official customer master in WINSpeed.
- WS-Sale-App does not automatically insert `dbo.EMCust` for this flow.

### SOP-08 User & Access updates
- LINE Login is enabled through LINE OAuth.
- First-time LINE users link themselves by entering their existing WS-Sale-App username/password.
- If the credential check succeeds, `wf.AppUser.LineUserId` is saved and the user logs in with the existing role/employee mapping.
- Access As is available from the topbar for Admin, Manager, Accounting, Approver, and Counter Sale. While active, the app works as the selected effective user, but audit records both the real actor and effective user.

### SOP-09 Automated QA before UAT
1. After DB restore, run `npm run migrate:local`.
2. Run `npm run smoke:queries`.
3. Run `npm run smoke:api:local`.
4. Run frontend lint and production build.
5. Record the result in the Test Log and compare with [09-AUTOMATED-QA.md](AUTOMATED-QA.md).
- If the credential check fails, the user contacts Admin to create, activate, reset, or correct the mapped user first.

### IT operation note
- Migrations `031-035` were applied to the restored local `dbwins_worldfert9` database on 2026-07-08.
- Restart backend after migration/config changes.

