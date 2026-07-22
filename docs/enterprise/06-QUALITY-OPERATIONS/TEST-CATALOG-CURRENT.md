---
documentId: "WF-QA-020"
title: "Test Catalog — ตามหน้าจอ/ฟังก์ชันปัจจุบัน (Source-Aligned)"
version: "v1.0"
status: Released
owner: "QA Lead"
normative: true
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-QA-020` · Version: v1.0 · Date: 21 กรกฎาคม 2569 · Status: Released
> Classification: Confidential — Client / Authorized Partner Use Only
> Derived from source: `winspeed-frontend/WSSale-App/src/components/*` (app 1.0.0)

# Test Catalog — ตามหน้าจอ/ฟังก์ชันปัจจุบัน (Source-Aligned)

เอกสารนี้แก้ปัญหา **Test/Test-Logs ไม่ตรงกับ UI/UX ปัจจุบัน** โดยดึงรายการหน้าจอจริงจาก source code แล้ว map เป็นกรณีทดสอบ ทุกครั้งที่ pipeline รัน (`build-docs.ps1`) จะเทียบ `src/components/*` กับตารางนี้และเตือนหน้าที่ยังไม่มี test

> รหัสทดสอบ: `TC-<AREA>-NN` · บันทึกผลใน [`TEST-LOG-TEMPLATE.md`](TEST-LOG-TEMPLATE.md)

## แผนที่ครอบคลุม (screen area → component → route)

| กลุ่มเมนู | หน้าจอ | Component (`src/components/…`) | Backend route |
|---|---|---|---|
| Auth | เข้าสู่ระบบ / LINE Login | `LoginPage.tsx` | `auth.js` |
| หลัก | Dashboard | `dashboard/DashboardPage.tsx` | `reports.js`, `so.js`, `rebate.js` |
| หลัก | ขาย (Sales Portal + POS) | `sales/SalesPortal.tsx`, `POSLayout.tsx` | `so.js`, `line.js` |
| หลัก | สร้าง/แก้บิล SO | `sales/CreateSODialog.tsx`, `EditSODialog.tsx`, `BillEditorModal.tsx` | `so.js` |
| หลัก | ทริป (Trip) | `sales/TripSetupModal.tsx`, `TripSummaryModal.tsx` | `so.js` |
| หลัก | เสนอราคา | `quotation/QuotationPage.tsx` | `quotation.js` |
| หลัก | คลัง (Picking/Receiving/Loader) | `store/StorePortal.tsx`, `PickingQueue.tsx`, `ReceivingQueue.tsx`, `VisualTruckLoader.tsx` | `so.js`, `stock.js`, `ops.js` |
| หลัก | Paper Trail | `papertrail/PaperTrailPage.tsx`, `ScanModal.tsx`, `RequestActionModal.tsx` | `papertrail.js` |
| หลัก | ตั๋วคงค้าง (Aging) | `aging/AgingPage.tsx` | `so.js`, `reports.js` |
| การเงิน | รีเบท (App) | `rebate/RebatePage.tsx` | `rebate.js` |
| การเงิน | Rebate Plan | `rebate/RebatePlanPage.tsx` | `rebate.js` |
| การเงิน | CN Rebate | `rebate/CnRebatePage.tsx` | `rebate.js` |
| การเงิน | ของแถม (Giveaway) | `giveaway/GiveawayPage.tsx` | `giveaway.js` |
| บัญชี | บัญชี | `accounting/AccountingPage.tsx` | `recon.js`, `reports.js` |
| บัญชี | กระทบยอด (Recon) | `recon/ReconciliationPage.tsx` | `recon.js` |
| บัญชี | รายงาน | `reports/ReportsPage.tsx` | `reports.js` |
| บัญชี | ชุดตั๋วคุม / Voucher | `voucher/VoucherPage.tsx`, `master/ControlTicketPage.tsx` | `rebate.js`, `master.js` |
| คลัง/ชั่ง | TruckScale | `truckscale/TruckScalePage.tsx` | `truckscale.js` |
| คลัง/ชั่ง | Weigh Inbox | `truckscale/WeighInboxPage.tsx` | `truckscale.js`, `so.js` |
| ตั้งค่า | ข้อมูลหลัก (Master) | `master/MasterDataPortal.tsx` + Customers/Goods/Prices/PriceBook/Trucks/TruckTypes/Giveaways Manager | `master.js`, `pricebook.js` |
| ตั้งค่า | นโยบายอนุมัติ | `policy/ApprovalPolicyPage.tsx` | `policy.js` |
| ตั้งค่า | กำกับข้อมูล (PDPA) | `governance/DataGovernancePage.tsx` | `pdpa.js` |
| ตั้งค่า | สถานะระบบ | `ops/OpsStatusPage.tsx` | `ops.js` |
| ตั้งค่า | ผู้ใช้งาน | `admin/AdminUsersPage.tsx` | `auth.js`, `policy.js` |

## กรณีทดสอบ (Test Cases)

### Auth — `LoginPage`
- **TC-AUTH-01** เข้าสู่ระบบด้วย username/password ถูกต้อง → เข้าได้ตาม role
- **TC-AUTH-02** รหัสผิด → แจ้ง error ไม่เข้าระบบ
- **TC-AUTH-03** LINE Login ครั้งแรก → ผูกบัญชีด้วย username/password เดิม (migration 035)
- **TC-AUTH-04** RBAC: แต่ละ role (SALES, COUNTER_SALES, WAREHOUSE, WEIGHBRIDGE, APPROVER, ACCOUNTING, ADMIN) เห็นเมนูเฉพาะที่มีสิทธิ์

### Dashboard — `DashboardPage`
- **TC-DASH-01** KPI cards แสดงค่าถูกต้อง (SO total, รอจัดส่ง, ปิด SO, SO ค้าง >30 วัน, รีเบท ฿)
- **TC-DASH-02** สถานะใบสั่งขาย (ร่าง/รอจัดส่ง/…/ปิด) แสดงจำนวนตรงกับ DB
- **TC-DASH-03** ค้นหาด้วยชื่อลูกค้า / ทะเบียนรถ / เลขเอกสาร + ช่วงวันที่
- **TC-DASH-04** การ์ดรีเบทต่อพนักงานขายซ่อน/แสดงตามสิทธิ์ (`canViewRebateAmounts`)

### Sales — `SalesPortal`, `CreateSODialog`, `EditSODialog`, `TripSetupModal`
- **TC-SALE-01** สร้าง SO ปกติ (I): เลือกลูกค้า→สินค้า→ราคา→บันทึก
- **TC-SALE-02** Multi-bill ในรถคันเดียว (I/K) + ทริป
- **TC-SALE-03** ราคาต่ำกว่า NET เกิน 500 → บล็อก/ต้องอนุมัติ ผจก.
- **TC-SALE-04** ขายพิเศษ (K) + ของแถม (giveaway) → ต้องอนุมัติก่อน confirm
- **TC-SALE-05** เบิกจากตั๋วคุม (AI) → ตัดจาก WFCoupon (ดู REBATE-COUPON-SYSTEM)
- **TC-SALE-06** ฟิลด์ทริป: วันนัด, ขึ้นรถตัวเอง, ไม่ต้องระบุรถ, P-Sling (migration 031-033)
- **TC-SALE-07** แปลงจากใบเสนอราคา → SO (convertFromQuoteId) ดึงข้อมูลรถ/เครดิต/บรรทัด
- **TC-SALE-08** แก้ไข SO ผ่าน state machine (cancel + create ใหม่)

### Quotation — `QuotationPage`
- **TC-QUO-01** สร้าง/แก้ใบเสนอราคา (card-based UI)
- **TC-QUO-02** สถานะ DRAFT→SENT→ACCEPTED→CONVERTED
- **TC-QUO-03** แปลงหลายใบเป็น multi-bill SO

### Warehouse/Store — `StorePortal`, `PickingQueue`, `VisualTruckLoader`
- **TC-STORE-01** คิว Picking: หยิบสินค้า → สถานะ PICKING
- **TC-STORE-02** Visual Truck Loader: จัดลำดับโหลด (LoadSequence)
- **TC-STORE-03** Receiving Queue: รับสินค้าเข้า

### Paper Trail — `PaperTrailPage`, `ScanModal`
- **TC-PT-01** Kanban แสดงการ์ดตามสถานะ
- **TC-PT-02** Scan เอกสาร + print (สำเนาลูกค้า/รักษาความปลอดภัย ซ่อนราคา)
- **TC-PT-03** Request action + unlock review (สิทธิ์)

### Aging — `AgingPage`
- **TC-AGE-01** SO ค้างจัดส่ง >30 (เหลือง) / >45 (แดง) วัน
- **TC-AGE-02** ตัด "ตั๋วคุม" ออกจาก aging

### Rebate (App) — `RebatePage`, `RebatePlanPage`, `CnRebatePage`
- **TC-REB-01** สรุป pool ต่อพนักงานขาย (สะสม/เคลม/ใช้ได้) = `wf.RebatePool`
- **TC-REB-02** Rebate Plan: สร้าง/active plan + FR-008 tag
- **TC-REB-03** เคลม FIFO ตัด `RebateLedger.RemainingAmt` → CN
- **TC-REB-04** CN Rebate list: `SOInvHD 109` + `CNRemarkTypeID 6001/1001` ผูก RefSOID
- **TC-REB-05** สิทธิ์เห็นยอดรีเบท (ACCOUNTING/ADMIN/MANAGER เท่านั้น)

### Giveaway — `GiveawayPage`
- **TC-GIVE-01** โควตาของแถมต่อพนักงาน/ปี + ตัดอัตโนมัติเมื่อ SHIPPED
- **TC-GIVE-02** ยืม/คืนโควตา (borrow) เมื่อเกิน

### Accounting / Recon / Reports — `AccountingPage`, `ReconciliationPage`, `ReportsPage`
- **TC-ACC-01** กระทบยอด SO ↔ WINSpeed (recon)
- **TC-ACC-02** รายงานตามช่วงเวลา/พนักงาน/ลูกค้า
- **TC-VOU-01** Voucher/ชุดตั๋วคุม: สรุปคูปองคงเหลือ (`WFCoupon.RemaQty`)

### TruckScale — `TruckScalePage`, `WeighInboxPage`
- **TC-TS-01** อ่านน้ำหนักจาก MySQL bridge (READ-ONLY)
- **TC-TS-02** Weigh Inbox: จับคู่ตั๋วชั่ง ↔ SO → SHIPPED + บันทึก WeighTicket
- **TC-TS-03** ชั่งออก (weigh-out) → trigger rebate accrual (`bookRebateAccrual`)

### Master Data — `MasterDataPortal` + managers
- **TC-MAS-01** Customers: ค้นหา/แก้ + คำขอลูกค้าใหม่ (ไม่เขียน `dbo.EMCust` อัตโนมัติ, migration 034)
- **TC-MAS-02** Goods: dedupe + กลุ่มสินค้า
- **TC-MAS-03** Price Book / Prices: 5-level price color เทียบ Set Price
- **TC-MAS-04** Trucks / TruckTypes / Control Ticket / Giveaways manager

### Settings — `ApprovalPolicyPage`, `DataGovernancePage`, `OpsStatusPage`, `AdminUsersPage`
- **TC-SET-01** นโยบายอนุมัติ: กำหนด role/threshold
- **TC-SET-02** PDPA/Governance: access-as audit (`wf.AccessAsAudit`, `wf.ApiAuditLog`)
- **TC-SET-03** สถานะระบบ (Ops): health/queue
- **TC-SET-04** ผู้ใช้งาน: CRUD + role assignment

### Profile & Shared — `ProfilePage`, `common/`, `ui/`
- **TC-PROF-01** โปรไฟล์ผู้ใช้ (`profile/ProfilePage`): ดู/แก้ข้อมูลตนเอง, เปลี่ยนรหัสผ่าน
- หมายเหตุ: `common/` และ `ui/` = shared components (ไม่ใช่หน้าจอเดี่ยว) — ไม่มี TC แยก

## การบำรุงรักษา (ให้ตรงเสมอ)

1. เพิ่มหน้าจอใหม่ใน `src/components/<area>` → ต้องเพิ่มแถวใน "แผนที่ครอบคลุม" + TC ในรอบเดียวกับ code
2. รัน `pipeline/build-docs.ps1` — ขั้น [4/6] จะเตือน area ที่ยังไม่มีใน catalog นี้
3. บันทึกผลการทดสอบทุกครั้งใน `TEST-LOG-TEMPLATE.md` (คัดลอกเป็นรอบ ๆ) อ้าง TC-ID + เวอร์ชัน app
