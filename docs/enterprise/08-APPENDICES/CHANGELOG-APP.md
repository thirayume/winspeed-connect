---
documentId: "WF-REL-001"
title: "Changelog"
version: "v1.0"
status: Released
owner: "Release Manager"
normative: true
---
# Changelog

> **หมายเหตุ:** เวอร์ชันปัจจุบัน = **1.6.0** · รายการ `[v5.x]` ด้านล่างเป็น**ประวัติ build ภายในก่อน reset** (คงไว้เพื่อ traceability ตาม ISO — ไม่ลบ)
>
> ตั้งแต่ 1.6.0 เป็นต้นไป ชุดเอกสาร **v1.5.0 ถือเป็นฐานที่สมบูรณ์แล้วและจะไม่ถูกแก้ในที่เดิม** — การเปลี่ยนแปลงทุกอย่างบันทึกเป็นส่วนต่างในไฟล์นี้และใน [CHANGES-v1.5.0-TO-v1.6.0](CHANGES-v1.5.0-TO-v1.6.0.md)

## [1.6.1] - 2026-08-06

### Added
- **Legacy Rebate Data Migration**: Added a migration script and a backend route to migrate old WINSpeed coupon data (`dbo.WFCoupon`) into the new `wf.RebatePlan` architecture.
- Added a "Migrate to App" button in the CN Rebate page (for ADMIN, MANAGER, C_LEVEL roles) to trigger the legacy data migration with a dynamic Baht/Ton conversion rate.

### Fixed
- Fixed TypeScript errors in `SalesPortal.tsx` related to `navParams.soId` coercion when setting `selectedId` and fetching order details.
- Fixed `AppAlert` missing export in `CnRebatePage.tsx` by reverting to standard `window.alert()`.

## [1.6.0] - 2026-08-06

รุ่นนี้ทำตาม [V1.6.0-IMPLEMENTATION-PLAN](../09-ROADMAP-AND-BACKLOG/V1.6.0-IMPLEMENTATION-PLAN.md) — ต้นทางคือเอกสารกระดาษจริงของฝ่ายขาย (ใบขอเคลียร์รีเบท ใบขออนุมัติโปรโมชั่น ฟอร์มราคาประจำเดือน) และรายงาน Crystal Reports เดิมของเครื่องชั่ง รายละเอียดระดับเอกสารและสิ่งที่ต้องรีวิวอยู่ใน [CHANGES-v1.5.0-TO-v1.6.0](CHANGES-v1.5.0-TO-v1.6.0.md)

### Added

**รีเบท — บันทึกใบขอเคลียร์ได้เหมือนกระดาษจริง**
- `wf.RebateClaimLine` (migration 064, 068) — เดิมเก็บได้แค่ยอดรวม ใบจริงมีหลายบรรทัด แต่ละบรรทัดมีสูตร ปริมาณ ราคาต่อตัน ราคาสุทธิ และส่วนต่าง · `LineType` แยก `REBATE` กับ `DIFF` เพราะฟอร์มกระดาษมีสองตารางคนละหัวตาราง ถ้ารวมเป็นก้อนเดียวยอดสองแบบจะแยกกันไม่ออก
- `wf.RebateClaimApproval` (migration 065) — ลายเซ็น 4 ตำแหน่งบนกระดาษ ระบบเดิมมีช่องอนุมัติช่องเดียว · เก็บ `DecidedByName` เป็นสแนปช็อตชื่อ ณ เวลาอนุมัติ เพราะหลักฐานต้องอ่านได้แม้ผู้ใช้ถูกเปลี่ยนชื่อหรือปิดบัญชีภายหลัง
- `wf.RebateClaimInvoice` (migration 066) + `InvoiceNo` รายบรรทัด (068) — ใบจริงอ้างใบกำกับหลายใบ ต้องกระทบยอดกลับได้
- `wf.RebatePlanApproval` (migration 069) — ใบขออนุมัติโปรโมชั่นเป็นเอกสารต้นทางที่กำหนดราคาสุทธิให้ใบขอเคลียร์ทุกใบ แต่เดิมไม่มีร่องรอยการอนุมัติเลย · สายอนุมัติต่างจากใบขอเคลียร์ที่ชั้น 3 (ผู้จัดการฝ่ายขาย ไม่ใช่ผู้จัดการฝ่ายตลาด)
- `wf.SaleRegion` / `wf.UserSaleArea` (migration 063) + บทบาท `MARKETING` (062, 067) — ชั้น 2 และ 3 ต้องแยกผู้อนุมัติตามภาค ไม่ใช่ MANAGER รวม · ภาคได้จาก 2 หลักแรกของ `dbo.EMSaleArea.SaleAreaCode` ครอบคลุม 76 จังหวัดเป็น 6 ภาค
- `wf.v_RebateClaimTotals` — แยก `RebateAmt` / `DiffAmt` / `RebateTon` / `DiffTon` ให้ตรงกับสองตารางบนกระดาษ
- หน้าจอ `RebateClaimForm` และ `RebatePlanApproval` พร้อมแบบพิมพ์ที่ผู้อนุมัติเซ็นบนกระดาษที่ระบบออกให้ได้

**ตารางราคาประจำเดือน**
- `LineStatus` บน `wf.PriceBookLine` (migration 070) — ฟอร์มราคาจริงมีทั้ง `***` (กำลังยกเลิก ยังขายได้ ต้องมีราคา) และ "งดขาย" (ห้ามขาย ไม่มีราคา) สองอย่างนี้คนละความหมาย ถ้าเก็บเป็นราคาว่างเหมือนกัน **"งดขาย" จะถูกอ่านเป็นศูนย์บาท** · บังคับด้วย CHECK `chk_PBL_PriceVsStatus` ที่ฐานข้อมูล ไม่ใช่แค่ที่ API
- `wf.PriceBookSpecialPrice` + `wf.v_PriceBookEffective` — ตารางร้านค้าที่ขอราคาพิเศษท้ายฟอร์ม · ผู้ยื่นอนุมัติคำขอตัวเองไม่ได้ (403)

**รายงานเครื่องชั่งบนเว็บ — แทน Crystal Reports 9 ฉบับ**
- สรุป 5 มิติ (วัน · สูตรปุ๋ย · เที่ยว · คลัง · ลูกค้า) และแจกแจงรายเที่ยว 4 ฉบับพร้อมช่องกรองรายมิติ · ส่งออก CSV มี BOM เปิดใน Excel แล้วภาษาไทยไม่เพี้ยน
- อ่านอย่างเดียวทั้งหมด · จำกัด 500 รายการต่อครั้ง · กรองวันที่ด้วย `Date_Out2` (OLE serial) เท่านั้น เพราะ `Date_Out` เป็น varchar `DD/MM/YYYY` ปี พ.ศ. ที่เรียงลำดับและเทียบช่วงไม่ได้

**เครื่องชั่ง — เขียนกลับให้ครบ**
- เขียน `tblproduct_detail` เมื่อรถเที่ยวเดียวมีหลายสูตร (T6-01) — เดิมเขียนเฉพาะหัวบิล ทำให้**รายงานแยกสูตรฝั่งโรงงานขาดตันที่แอปขนไป** ซึ่งร้ายกว่าการไม่มีข้อมูลของเราเอง
- MySQL migration runner แยกบัญชีของตัวเอง (`wf_schema_migration`) + index บน `tblproduct_detail.one_num` — รายงานตามเที่ยวเดิมหมดเวลาทุกครั้งเพราะสแกน 550,000 แถว ลดจาก 1,328 เหลือ 593 มิลลิวินาที

**รายงานเชิงวิเคราะห์ใน `backend/routes/reports.js`** (คนละชุดกับรายงานเครื่องชั่ง — ชุดนี้อยู่ในระบบรายงานเดิมที่พิมพ์ A4/ส่งออก Excel ได้)
- `rebate-claim-detail` — ใบขอเคลียร์รีเบทระดับบรรทัด พร้อม `LineType`, `InvoiceNo` และผู้ยื่น
- `special-price-detail` — คำขอราคาพิเศษรายร้านค้า พร้อมผู้ยื่นและผู้อนุมัติ ใช้เป็นหลักฐานการตรวจสอบ
- `weighbridge-detail` — การชั่งเข้า-ออก พร้อมผลการเขียนกลับเครื่องชั่ง

**ราคาที่ใช้จริงไหลเข้าใบสั่งขาย** (`CreateSODialog.tsx`)
- ดึงราคาที่ใช้จริงจาก Price Book ที่ ACTIVE ตามลูกค้าที่เลือก แล้วเติมให้อัตโนมัติ
- ลำดับการใช้ราคา: ราคาพิเศษของลูกค้ารายนั้น → ราคามาตรฐานในเล่ม → ราคาเดิมจาก WINSpeed · แสดงป้ายว่าราคามาจากแหล่งใด
- สินค้าที่ "งดขาย" ในเล่มที่ใช้อยู่ถูกกันไม่ให้เลือก

**ความปลอดภัย — D6-02 บังคับที่เซิร์ฟเวอร์แล้ว**

- **เปิดใช้เฉพาะเซิร์ฟเวอร์ที่ deploy จริง** — ตั้ง `ENFORCE_PASSWORD_CHANGE="true"` ใน `.env` ของเซิร์ฟเวอร์ · **ค่าปริยายคือปิด** เครื่องนักพัฒนาจึงไม่ได้รับผลใด ๆ เพราะความเสี่ยงอยู่ที่ฐานของโรงงาน ไม่ใช่ฐานบนเครื่องตัวเอง และการบังคับบนเครื่องพัฒนามีแต่ทำให้ชุดทดสอบติดขัดโดยไม่ได้ลดความเสี่ยงจริง
- **บัญชีที่ยังใช้รหัสผ่านตั้งต้น เขียนข้อมูลไม่ได้** — `requireAuth` ปฏิเสธ `POST/PUT/PATCH/DELETE` ด้วย 403 `PASSWORD_CHANGE_REQUIRED` · **การอ่านยังทำได้ตามปกติ** คนที่มีงานค้างจึงเปิดดูงานตัวเองได้ระหว่างถูกผลักให้เปลี่ยนรหัส การตัดทุก request จะทำให้งานที่กรอกค้างไว้หายและกลายเป็นการหยุดทั้งแผนกในวันที่เปิดใช้
- **หน้าบังคับเปลี่ยนรหัสผ่านทันทีที่ล็อกอิน** (`components/auth/ForcePasswordChange.tsx`) — ขึ้นแทนทั้งแอป เข้าหน้าอื่นไม่ได้จนกว่าจะเปลี่ยน ยังออกจากระบบได้เผื่อเข้าผิดบัญชี · แถบเตือนแบบเดิมถูกถอดออกเพราะไม่มีทางไปถึงแล้ว
- **ผู้ดูแลรีเซ็ตรหัสผ่านให้ผู้ใช้ได้** — เมื่อผู้ดูแลตั้งรหัสให้คนอื่นผ่าน `PATCH /api/auth/users/:id` ระบบตั้ง `MustChangePassword = 1` ให้อัตโนมัติ เพราะผู้ดูแลรู้รหัสนั้น ถ้าปล่อยไว้ชื่อผู้ทำรายการในหลักฐานก็ยังไม่ยืนยันตัวเจ้าของบัญชี · เปลี่ยนรหัสของตัวเองไม่เข้าเงื่อนไขนี้
- ยกเว้น `/api/auth` ทั้งชุด มิฉะนั้นจะเปลี่ยนรหัสผ่านไม่ได้เลย เพราะ endpoint เปลี่ยนรหัสเองก็เป็น `PUT`
- ตอน **Access As** ใช้ธงของบัญชีที่ยืนยันตัวตนจริง ไม่ใช่บัญชีที่ถูกสวมสิทธิ์ — ผู้ดูแลที่เปลี่ยนรหัสแล้วไม่ควรถูกบล็อกเพราะบัญชีปลายทางยังไม่เปลี่ยน
- เปลี่ยนรหัสผ่านสำเร็จแล้ว **ระบบออก token ใหม่ให้ทันที** ไม่ต้องรอ token เดิมหมดอายุ 8 ชั่วโมงจึงจะกลับมาเขียนได้
- บัญชีทดสอบ `e2e_*` ถูกยกเว้นทั้งใน `--fix` และใน `db-init/e2e-seed.sql` — ถ้าตั้งธงให้บัญชีชุดนี้ ชุด E2E จะล้มทั้งชุดตั้งแต่ขั้นสร้างใบสั่งขาย โดยที่ไม่มีอะไรผิดในโค้ดที่กำลังทดสอบ
- พิสูจน์ด้วย `backend/scripts/verify-password-gate.js` — ผ่าน 11 ข้อ รวมถึงกรณี token เดิมยังถูกบล็อกและ token ใหม่ผ่าน

**ความปลอดภัย — D6-02 การตรวจและตั้งธง**
- `backend/scripts/audit-duplicate-passwords.js` ตรวจพบว่า **บัญชีทั้ง 71 บัญชีในระบบใช้รหัสผ่านซ้ำกับบัญชีอื่นทั้งหมด** แยกเป็นสองกลุ่ม: กลุ่มพนักงาน 61 บัญชี และกลุ่มบัญชีทดสอบ `e2e_*` 10 บัญชี
- รัน `--fix` แล้ว ตั้ง `MustChangePassword = 1` ให้ **51 บัญชีที่ยังใช้งานอยู่** (สคริปต์กรอง `IsActive = 1`)
- `/api/auth/login` และ `/api/auth/me` ส่งค่า `mustChangePassword` กลับให้หน้าจอ · แถบเตือนสีเหลืองบนสุดของแอป · หน้าโปรไฟล์เปิดแท็บความปลอดภัยให้เอง · เปลี่ยนรหัสสำเร็จแล้วธงถูกล้างเป็น 0 ทันที

**ผู้อนุมัติรายภาค — จัดการจากหน้าจอได้แล้ว**
- หน้าจอ **ข้อมูลหลัก → ผู้อนุมัติรายภาค** (`SaleRegionManager.tsx`) เพิ่ม/ถอดผู้อนุมัติชั้นที่ 2 ได้เอง · เตือนภาคที่ยังว่างพร้อมจำนวนลูกค้าที่ได้รับผลกระทบ
- `GET /api/rebate/regions/coverage` และ `DELETE /api/rebate/user-regions/:userId/:regionCode` — จำกัด ADMIN · C_LEVEL · MANAGER
- **ที่ผูกไว้เดิมผิด** — `emp-00036` EMP-00036 ถูกผูกกับภาคใต้ ทั้งที่ยอดขาย 16,848 ใบอยู่ภาคอีสาน และไม่มีทางแก้จากระบบเลย · แต่งตั้งใหม่ครบทั้ง 7 ภาคจากสายบังคับบัญชาจริงใน `dbo.EMEmp.EmpHead` ไม่ใช่จากผู้ที่ทำยอดสูงสุด เพราะผู้ทำยอดสูงสุดเป็นเพื่อนร่วมงานระดับเดียวกับผู้ยื่นเรื่อง
- **บริษัทไม่มีฝ่ายการตลาด** — `dbo.EMPost` มี 10 ตำแหน่งและไม่มีตำแหน่งใดเกี่ยวกับการตลาด · ใช้กรรมการบริหารสองคนที่มีจริงเป็นชั้น 3 และ 4 แทน (`emp-00016` EMP-00016 · `emp-00059` EMP-00059 เลื่อนเป็น `C_LEVEL`)

**ศูนย์รวมการอนุมัติ (Approval Center)**
- `UnlockReviewModal.tsx` ขยายเป็น Approval Center สองแท็บ — แท็บแรกคำขอปลดล็อก (ของเดิม) · แท็บที่สองอนุมัติของแถมรายบรรทัด (`GET /api/so/giveaways/pending`) พร้อมการ์ดแสดงชื่อสินค้า ลูกค้า จำนวน และผู้สร้าง
- Notification badge บน App bar รวมจำนวนคำขอปลดล็อก + ของแถมที่รออนุมัติ (polling)
- `PendingGiveaway` type ใหม่ใน `types/index.ts` และ `pendingGiveaways` state ใน `erp-store.ts`

**การควบคุมน้ำหนักรถบรรทุก**
- `VisualTruckLoader.tsx` ตรวจน้ำหนักรวมที่จัดวางเทียบกับความจุรถ — แสดงข้อความ "⚠️ น้ำหนักเกินที่รถบรรทุกรับได้" และปิดปุ่มยืนยันเมื่อน้ำหนักเกินขีดจำกัด `MaxWeightMain` หรือ `MaxWeightTrailer`

**ปฏิบัติการ**
- `backend/scripts/backup-truckscale.js` (D6-03) — ฐานเครื่องชั่งไม่เคยถูกสำรองเลยแม้แต่ครั้งเดียว ทั้งที่เป็นต้นทางของน้ำหนักที่ใช้ออกใบกำกับ · วัดจริง 954,074 แถว / 41 วินาที / 38.6 MB และเทียบจำนวนแถวกับ `COUNT(*)` ทุกตาราง ไม่ตรงถือว่าล้มเหลว
- สคริปต์ตรวจอัตโนมัติ 8 ตัว (`verify-*.js`) ครอบคลุม RBAC 24 กรณี วงจรรีเบทเต็ม อนุมัติ 4 ชั้น ราคาพิเศษ และการเขียนกลับเครื่องชั่ง

### Changed
- **จับคู่ใบชั่งด้วย `movebill` เป็นหลัก** (T6-03) — เดิมใช้ทะเบียนรถซึ่งจับผิดคันเมื่อเป็นรถพ่วง · เมื่อยังกำกวมระบบ **ปฏิเสธพร้อมคืนรายการที่เข้าข่าย** แทนการเดา · ใช้ทั้งใน `services/truckscale-db.js` (ตอนจับคู่/เขียนกลับ) และ `routes/recon.js` (ตอนกระทบยอด)
- **กระทบยอดใบขอเคลียร์กับยอดขนจริงใน WINSpeed** — เดิมเทียบกับ ledger ของแอปเอง ซึ่งเป็นการเอาตัวเลขของเราไปยืนยันตัวเลขของเรา · ตอนนี้อ่านจาก `dbo.SOHD`/`dbo.SODT` ที่ `clearflag='Y'`
- **เขียน `dbo` ผ่าน owner pool** (`dboWrite`) และคืน `rowsAffected` จริง — เดิม `query()` คืนเฉพาะ `recordset` ทำให้โค้ดที่อ่าน `rowsAffected` ได้ `undefined`
- **ชั่งออกต้องมีน้ำหนัก** — เดิมกด "ส่งออก" โดยไม่มีน้ำหนักได้ ระบบรับและปิดใบให้
- **ยอดรีเบทเข้ากระเป๋าเจ้าของใบสั่งขาย** (`so.SalesUserId`) ไม่ใช่ผู้กดชั่งออก
- Price Book: `Price` เป็น nullable ได้แล้ว เพื่อให้ "งดขาย" ไม่มีราคาได้จริง
- **`wf.sp_ConfirmSalesOrder` ส่งเอกสารเข้า WINSpeed เป็น Approved ทันที** (migration 072) — เดิมตั้ง `AppvFlag='W'`, `DocuStatus='N'` บังคับให้บัญชีต้องเข้า WINSpeed กด Confirm ซ้ำ ซึ่งทำให้ WINSpeed รีเซ็ต `clearflag` และสถานะถอยกลับจาก SHIPPED เป็น LOADED · ตอนนี้ตั้ง `AppvFlag='Y'`, `DocuStatus='Y'` ไม่ต้อง Confirm ซ้ำอีก

### Fixed
- **วันที่จากฐานเครื่องชั่งแสดงเป็นปี 3112** — `Date_In`/`Date_Out` ของ `tblscale` เก็บเป็น **พ.ศ. อยู่แล้ว** ในรูป `'DD/MM/BBBB'` ต่างจาก `dbo` และ `wf` ที่เก็บเป็น ค.ศ. แต่หน้าจอเอาไปเข้า `formatThaiDate()` ซึ่งบวก 543 ซ้ำ · ผิดสองชั้น เพราะ `new Date('01/05/2569')` ยังตีความแบบอเมริกันเป็นเดือน/วันก่อน หลายแถวจึงเป็น Invalid Date แล้วขึ้นขีดกลางแทนวันที่ · เพิ่ม `formatBuddhistDateString()` สำหรับค่าที่เป็น พ.ศ. อยู่แล้ว แก้หน้า TruckScale และ Weigh Inbox · **ฝั่งเขียนกลับถูกต้องอยู่แล้ว ไม่ได้แตะ** (`Date_Out` เขียน พ.ศ. · `Date_Out2` เขียน OLE serial ค.ศ.)
- **คะแนน "วันที่ชั่งตรงกับ SO" ไม่เคยถูกบวกเลย** ในการจับคู่ใบชั่งอัตโนมัติ — เทียบ `Date_Out` ที่เป็น `'DD/MM/BBBB'` พ.ศ. กับ `RefDate` ที่เป็น `'YYYY-MM-DD'` ค.ศ. ตรง ๆ ซึ่งไม่มีทางตรงกัน · เพิ่ม `beDateToIso()` แปลงก่อนเทียบ
- **28 endpoint ตอบ 200 ทั้งที่ไม่มีแถวถูกแก้** (D6-01 ประเมินไว้ 14 พบจริง 28) — การตอบสำเร็จทั้งที่ไม่มีอะไรเปลี่ยนคือการสร้างหลักฐานของสิ่งที่ไม่เคยเกิด ขัดกับงาน ISO โดยตรง · ตรวจซ้ำได้ 0/28
- **อนุมัติของแถมสองคนพร้อมกันแล้วสำเร็จทั้งคู่** — เพิ่ม `AND Status='PENDING'` และคืน 409 เมื่อคำขอถูกดำเนินการไปแล้ว
- `DecidedByName` เก็บเป็นรหัสผู้ใช้ตัวเลข และคิวรีอ่านซ้อนคอลัมน์จนได้ค่า `"ชื่อ,ชื่อ"` — แก้แล้วพร้อมซ่อมข้อมูลเดิม 8 แถว
- `chk_RC_Status` เดิมกันสถานะของการอนุมัติ 4 ชั้นทั้งหมด (migration 067)
- `wf.AppUser.MustChangePassword` ถูกสร้างด้วย `ALTER` นอกบัญชี migration ฐานที่ deploy ใหม่จะ login ไม่ได้ (migration 071)
- ตัวตรวจ doc-control นับ `migrations/001` กับ `migrations/mysql/001` เป็นเลขซ้ำ ทั้งที่เป็นคนละ ledger คนละฐานข้อมูล
- **สถานะ SO ถอยจาก SHIPPED เป็น LOADED** เมื่อ WINSpeed sync — ระบบเดิมใช้ `clearflag='Y'` ใน `dbo.SOHD` เป็นตัวบอกสถานะ SHIPPED แต่ WINSpeed รีเซ็ต `clearflag` เมื่อผู้ใช้แก้ไขเอกสาร · แก้โดยใช้ `ext.WeighOutWeight IS NOT NULL` เป็นตัวตัดสินหลักใน SQL CASE ทุกจุด พร้อม fallback `OR hd.clearflag = 'Y'` สำหรับเอกสารเก่าที่ SHIPPED ก่อนมีน้ำหนัก
- **SO ที่ส่งออกจากตาชั่งแล้วหายจากหน้า Post Invoice ของ WINSpeed** — endpoint `/ship` ตั้ง `clearflag='Y'` ใน `dbo.SOHD` ซึ่งทำให้ WINSpeed มองว่าเอกสารถูกปิดแล้ว ไม่แสดงในหน้าออกบิล · ลบคำสั่งอัปเดต `clearflag` ออก ใช้ `WeighOutWeight` ใน `wf.SalesOrderExt` เป็นตัวบ่งชี้แทน
- **ใบชั่งที่มีน้ำหนักชั่งออกแต่ไม่มีวันที่ชั่งออก** (migration 073 + MySQL migration 002) — ซ่อมข้อมูลที่ขาดทั้งใน SQL Server (`wf.WeighTicket`) และ MySQL (`tblscale`) เพื่อให้รายงานและ Weigh Inbox แสดงผลครบถ้วน

**เสถียรภาพและประสบการณ์ผู้ใช้ (UX/UI)**
- **เปลี่ยนระบบแจ้งเตือน (Alert/Prompt)** — ยกเลิกการใช้ `window.alert()` และ `window.prompt()` ของเบราว์เซอร์ (ซึ่งทำให้ UI ถูกบล็อกและแสดงผลต่างกันในแต่ละอุปกรณ์) เปลี่ยนมาใช้คอมโพเนนต์ `AlertDialog` และ `AppAlert` ภายในแอปแทน เพื่อให้ดีไซน์สม่ำเสมอและไม่บล็อกเธรดหลัก
- **แก้ไขปัญหาระบบฐานข้อมูล (SQL Triggers)** — สร้างและรันแพตช์ `fix-winspeed-legacy-raiserror.sql` อัปเดตทริกเกอร์เก่ากว่า 1,278 ตัว (เช่น `tU_SOHD`) ที่ใช้ไวยากรณ์ `raiserror` ล้าสมัย ทำให้เกิด HTTP 500 เวลาอัปเดตสถานะผ่าน API กลับสู่ฐานข้อมูล UAT (Compatibility Level 100) ระบบกลับมาทำงานและอัปเดตสถานะได้ 100%
- **คู่มือ Paper Trail** — เพิ่มข้อกำหนดปฏิบัติการที่ชัดเจนในคู่มือผู้ใช้ (`USER-MANUAL-CURRENT.md`) เกี่ยวกับลำดับการสแกน QR Code เพื่อติดตาม "สำเนา 2 (ใบสีชมพู)" แยกออกจากสถานะ ERP (Order-to-Cash) ปกติ เพื่อลดความสับสนของฝ่ายปฏิบัติการ

### Known gaps
- **20 บัญชีที่รหัสผ่านซ้ำแต่ไม่ถูกตั้งธง** เพราะ `--fix` กรองเฉพาะ `IsActive = 1` · ทั้ง 20 เป็นบัญชี SALES ที่ปิดใช้งานอยู่ ถ้าถูกเปิดใช้อีกครั้งจะกลับมาพร้อมรหัสผ่านที่ใช้ร่วมกับอีก 40 คน · เตรียมสคริปต์ไว้แล้วที่ `sql/maintenance/cleanup-inactive-users.sql` รอเจ้าของระบบสั่งรัน
- **ไม่มีการตรวจสิทธิ์ระดับ router บน `POST /api/rebate/claims/:id/approve`** ตั้งแต่ตอนทำอนุมัติ 4 ชั้น การตรวจย้ายเข้าไปอยู่ในตัว handler รายชั้น ทำให้ทุกบทบาทที่เข้าระบบได้ยิง endpoint นี้แล้วแยกออกว่าใบมีอยู่จริงหรือไม่ (404 กับ 400 ต่างกัน) แม้จะอนุมัติไม่ได้ก็ตาม

## [1.5.0] - 2026-07-26

### Added
- **ชุดเอกสารพิมพ์และรายงาน** — `SOBookingDocModal` (ใบจองสินค้า), `LegacyReportPdfModal` (รายงาน PDF รูปแบบเดิม), `DocHeaderSettingsModal` (ตั้งค่าหัวกระดาษ) พร้อม endpoint `GET /api/reports/types`, `/api/reports/:type`, `/api/reports/:type/export`
- **บทบาท `C_LEVEL`** เป็นบทบาทที่ 9 — เห็นข้อมูลรีเบททั้งหมดและตั้งค่าหัวเอกสารได้

### Changed
- **TruckScale MySQL pool แข็งแรงขึ้น** — เพิ่ม `connectTimeout` 5 วินาที, `queueLimit` 10 และ query timeout 6 วินาที ป้องกันคำขอค้างสะสมเมื่อเครื่องชั่งตอบช้า

### Fixed
- E2E ชุด UAT เทสต์ที่ 4 ค้างจนหมดเวลา เพราะยังกดปุ่มชื่อเดิม `ยืนยัน / ส่งออก` ที่ถูกเปลี่ยนเป็น `บันทึกน้ำหนัก & ส่งออก` ตั้งแต่ v1.3.x — แก้แล้ว กลับมาผ่าน 10/10

- **รายงานกระทบยอดใบชั่งที่ระบบเขียนกลับ (R-3)** — แยก 5 กรณีระหว่างใบที่แอปสร้างเอง ใบที่เขียนทับของจริง ใบที่เขียนไม่สำเร็จ ใบกำพร้า และน้ำหนักสองระบบไม่ตรง · เก็บผลการเขียนกลับใน `wf.WeighTicket` (migration 061)
- **เครื่องมือซ่อม checksum ของ migration** เมื่อแก้เฉพาะคอมเมนต์ในไฟล์ที่ apply แล้ว
- **E2E ล้างข้อมูลทดสอบครบทั้งสองฐานข้อมูลทุกรอบ**

### Known gaps
- `C_LEVEL` ประกาศเฉพาะฝั่ง frontend — **backend ไม่รู้จักบทบาทนี้เลย** ผู้ใช้ `C_LEVEL` จะเห็นเมนูแต่ถูก API ปฏิเสธทุก endpoint ที่ตรวจสิทธิ์
- `permissions.ts` ให้สิทธิ์ผ่านด้วยรหัสพนักงานที่ฝังในโค้ด (`EMP-00008`, `EMP-00059`) ควรย้ายไปเป็นค่าตั้งค่าหรือสิทธิ์ตามบทบาท

## [1.4.0] - 2026-07-26

### Added
- **เขียนกลับ TruckScale สองทาง (TS-01/TS-02)** — เมื่อยืนยันชั่งออก ระบบอัปเดต `weight_out`/`weight_net`/`Date_Out` ในใบชั่งที่เปิดค้าง หรือสร้างใบใหม่รหัส `WF` เมื่อไม่พบ แล้วลบคิวใน `tbl_keyone`

### Known gaps
- การเขียนกลับไม่ถูกรอผลและไม่มีการลองใหม่ (TS-05 ยังไม่ได้ทำ) — ดู [WF-APP-011](../09-ROADMAP-AND-BACKLOG/TRUCKSCALE-WRITEBACK-AND-INTEGRATION-ROADMAP.md)

## [1.3.0] – [1.3.1] - 2026-07-26

### Added
- ชั่งหลายรอบและบันทึกรายการระหว่างชั่ง (`wf.WeighTicketItemLog`, migration 059)
- เกณฑ์ผ่อนผันความคลาดเคลื่อนของเครื่องชั่งตั้งค่าได้ที่ `wf.SystemSetting`
- ดุลยพินิจของนายด่านชั่ง: เหตุผล ผู้อนุมัติ และภาพถ่ายหลักฐาน (migration 060)

## [1.2.3] – [1.2.5] - 2026-07-25

### Changed
- ขยายสิทธิ์เบิกของแถมเป็น `SALES`, `COUNTER_SALES`, `ADMIN`, `MANAGER`, `APPROVER` (ถอด `WAREHOUSE` ออก)

### Fixed
- งบและรายการเบิกของแถมกับ RebatePool ใช้ปี พ.ศ. (migration 056/057)
- `wf.v_AllSalesOrders` ประเมินสถานะ SHIPPED จาก `clearflag='Y'` ได้ถูกต้อง (migration 058)

## [1.0.0] - 2026-07-22 (Production Go-Live)

### Added
- **Rebate & Coupon Sync**: Automated synchronization of `dbo.WFCoupon` and `dbo.WFRedemtionDT` from WINSpeed into `wf.CouponMirror` for real-time, highly accurate dashboard rebate tracking.
- **TruckScale Integration (Write-back)**: Automated push of Sales Order data (truck plate, customer, weight, items) directly into MySQL `tbl_keyone` to queue Pre-Weigh tickets as soon as the order is Confirmed.
- **Quotation to SO Conversion**: Enhanced multi-bill Quotation conversion interface supporting custom transport flags, giveaway splits, and accurate reference linkage.
- **Paper Trail Control Tickets**: Added a dedicated "ตั๋วคุม (ล่วงหน้า)" Kanban column in Paper Trail to visually separate pre-purchased inventory bills from active warehouse logistics.
- **E2E UAT Automation**: Complete 5-Role Playwright automation suite guaranteeing 100% stable workflow across Sales, Manager, Counter Sales, Warehouse, and Admin functions.

### Changed
- **Version reset/unify → 1.0.0**: `package.json` both root and sub-packages standardized to `1.0.0` for the V1.0 Enterprise Go-Live baseline.
- ⚠ หมายเหตุ semver: 1.0.0 < 5.0.25 — ต้องอัปเดต deploy/CI/migration ให้สอดคล้องกับ baseline ใหม่.

### Note
- ประวัติ build 5.x (ด้านล่าง) เก็บไว้เป็นหลักฐาน ไม่ได้ลบ.

## [Docs v1.0] - 2026-07-21 (Documentation)

### Consolidated
- รวมเอกสารทั้งหมดไว้ที่ `docs/` แห่งเดียว (canonical); ชุดปฏิบัติการ 00–12 อยู่ที่ root, แยก `reference/` และ `records/`.
- ย้ายชุดซ้ำ/เก่าเข้า `_archive/_superseded-2026-07/` (`docs/docs`, `v7_Full`, `wf/out`, `markdowns/` ต้นฉบับ) — ไม่ลบ.

### Fixed
- ซ่อม encoding ภาษาไทย (mojibake) 9 ไฟล์ในชุด canonical (01–07, 09) ผ่าน CP874 → UTF-8.

### Added
- เอกสารใหม่ **12-REBATE-COUPON-SYSTEM** — reverse-engineer ระบบ Rebate/Coupon จากฐานข้อมูลจริง (WFCoupon/WFRedemtion, RBT 106, CN 109, wf engine) + query สำเร็จรูป + design เชื่อม dbo↔wf.

## [v5.1.0] - 2026-07-19

### Added
- Standardized Enterprise UI across master data modules with Clear buttons, DataSummaryCards, and loading states.
- Enhanced Trip Management with credit terms, mother/child tonnage granularity, and automatic 50kg/bag count calculations.
- Implemented historical giveaway withdrawals migration (Excel to DB).
- Fixed Railway deployment by resolving Express 5 CORS and routing incompatibilities.

### Changed
- Refactored Quotation system into a card-based UI with multi-bill SO conversion.
- Removed arbitrary bill prefix (AI/K) logic for "ตั๋วคุม" (Control Ticket), now strictly respecting the user-provided `TransRegistration` field.
- Modernized Create Sales Order interface with near full-screen layout, advanced customer dropdown, and realtime truck plate validation.
- Improved OT queue access control to prevent unauthorized cancellations.
- Migrated Admin Portal navigation to a hierarchical sidebar submenu.

## [v5.0.0] - 2026-07-14

### Added
- Added SO requested/notification date-time and transport flags: own truck, no truck required, and P-Sling.
- Added 5-level sales price color display compared with Set Price.
- Added role-based rebate amount visibility in backend/frontend paths.
- Added dashboard search by customer, truck plate, and date/time.
- Added customer filters by salesperson, area, customer group, and employee.
- Added per-item giveaway checkbox and manager/admin approval gate before SO confirm.
- Added status timeline timestamps, including shipping/weigh-out time.
- Added Paper Trail print changes: customer/security copies hide price; security copy uses green styling.
- Added Rebate Plan Ref Doc fields.
- Added app-owned new customer request flow through Sale Admin/Master Data without auto-writing `dbo.EMCust`.
- Added LINE Login OAuth with first-time self-link by existing username/password, plus Admin support override for `wf.AppUser.LineUserId`.
- Added read-only WF Rebate Trail from WINSpeed (`SOHD` 103/104 -> `WFCoupon` -> `WFRedemtion` -> `SOInv` -> receipt/GL trail).
- Added Post Invoice readiness indicators for shipped SOs and invoice/GL reconciliation visibility.
- Added WINSpeed invoice posted/locked badge to SO detail.
- Added WINSpeed SO Data Entry lab script and migration `038` to preserve transport display, header check-all, header totals, line descriptions, and Master/Child quantities.
- Added migration `039` and SO form/API mapping for explicit transporter (`TranspID`) selection, credit days, header remarks, and per-line Master/Child quantities across draft create/edit and WINSpeed confirm flow.
- Added migration `044` and WINSpeed Quotation lab script after validating native documents `QU6907-00001`, `QU6907-00002`, and `QC69-00002`.
- Added repeatable automated QA scripts: `smoke:queries`, `smoke:api`, and `smoke:api:local`.
- Added automated QA documentation and manual retest checklist in `docs/09-AUTOMATED-QA-v5.0.0.md`.

### Changed
- Aligned backend/frontend metadata and visible UI badge to v5.0.0.
- Updated documentation to reflect the actual stack: React 19 + Vite + Express.
- Clarified database architecture: SQL Server is the primary WINSpeed/App database; MySQL is used as the TruckScale bridge only.
- Re-aligned the old CN Rebate screen/report into WF Rebate Trail; legacy `cn-rebate` keys remain only for compatibility.
- Locked SO edit/unlock/cancel paths after a WINSpeed invoice is detected, preserving WINSpeed as the owner of invoice/AR/GL posting.
- Clarified and restricted approved dbo master-data write routes for customers, goods, and price lists.
- Aligned app-confirmed SO creation with the observed WINSpeed WF flow: app confirm now writes `SOHD/SODT` as `DocuType=103`; WINSpeed WF menus own the `103 -> 104` transition and invoice/accounting posting.
- Tightened app-created `DocuType=103` rows to match WINSpeed SO Data Entry after local validation with `I69-KORAT-1`: `SOHD.TranspID`, `SOHD.CheckAll`, `SODT.CheckFlag`, `SODT.MasterQty`, and `SODT.ChildQty` are now part of the mapped contract.
- Re-aligned app quotation integration to native WINSpeed Sale Quotation: `SOHD/SODT DocuType=102` for `QU...` and `DocuType=113` for confirmed `QC...`; `SCEstimate*` is no longer the active mapping for this flow.
- Aligned customer salesperson filtering and SALES visibility to `dbo.EMCustMultiEmp` instead of assuming salesperson fields exist on `dbo.EMCust`.
- Fixed API audit path capture so Access As API calls are reliably written to `wf.ApiAuditLog`.
- Improved `/api/so` list performance by splitting total-count and page queries while preserving the same response shape.
- Adjusted frontend lint policy to keep React/data-loading advisory rules as warnings while still failing on real lint errors.
- Added `07-SOURCE-ALIGNMENT-v5.0.0.md` to highlight source/document alignment, WINSpeed WF custom-build boundaries, and Meeting Minutes 02072026 backlog.

### Database Migration Status
- Applied schema migrations `001-035` to the restored local `dbwins_worldfert9` database on 2026-07-08.
- `000_logins.sql` is treated as a manual security setup file and is skipped by the default Node migration runner.
- Latest local QA successfully executed **all 56 migration files** up to `050_fix_confirm_sp_truckplate.sql` in the current environment.

### QA Status
- Migration smoke, SQL query smoke, API smoke, frontend lint, and production build passed in the latest local QA round.
- `/api/so?page=1&limit=5` improved from about 3.2 seconds to about 1.9 seconds in local API smoke; continue tuning only if concurrent UAT needs sub-second list response.

### Meeting Minutes Migration Batch
- `031_so_requested_transport_flags.sql`
- `032_rebate_plan_ref_doc.sql`
- `033_giveaway_line_approval.sql`
- `034_customer_request_flow.sql`
- `035_line_login_app_user.sql`
- `036_align_winspeed_so_flow.sql`
- `037_so_credit_days_and_remarks.sql`
- `038_winspeed_so_data_entry_mapping.sql`
- `039_so_transp_id.sql`
- `040_deduplicate_winspeed_so.sql`
- `041_app_user_profile.sql`
- `042_so_trip_quotation.sql`
- `043_winspeed_estimate_link.sql` (legacy/superseded for active WINSpeed Sale Quotation)
- `044_winspeed_native_quotation_link.sql`
- `045_access_as_audit.sql`
- `046_truck_types_nolock.sql`
- `047_seed_giveaway_items.sql`
- `048_seed_giveaway_withdrawals.sql`
- `049_giveaway_item_mapping.sql`
- `049_seed_all_employees.sql`
- `050_cleanup_hardcoded_users.sql`
- `050_fix_confirm_sp_truckplate.sql`

## [v4.2.0] - 2026-06-26

### Added
- **FIFO Rebate System**: Implemented a new rebate withdrawal system utilizing a First-In-First-Out (FIFO) strategy.
- **Rebate Ledger Integration**: Created the `/api/so/rebate-balance/:custId` endpoint to dynamically fetch the available rebate balance.
- **Order Processing Logic**: Updated the `/api/so/:id/confirm` endpoint and the `wf.sp_ConfirmSalesOrder` stored procedure to process the RebateDiscountAmt and accurately subtract it from the final bill's NetAmnt.
- **UI Interaction**: Added an 'Apply Rebate' input field in `CreateSODialog` that automatically validates against the available balance and the total bill amount, recalculating the totals in real-time.

### Changed
- **Backend Setup**: Added `nodemon` for auto-restarting the Node.js backend server during development.

## [v4.1.0] - 2026-06-25

### Changed
- **Paper Trail Performance**: Optimized the `/api/papertrail/board` query in `backend/routes/papertrail.js` to fix severe timeouts and memory issues. The query now limits the maximum number of items returned for each status column to 100 using `ROW_NUMBER() OVER(PARTITION BY ...)`. This mitigates UI freezing caused by rendering massive amounts of legacy `CONFIRMED` orders.
- **Paper Trail Kanban UI**: Expanded the Kanban columns to stretch and fill the available screen width (Full Frame) using `flex-1 min-w-[280px]` instead of a fixed width of `288px`.
- **Cancelled Orders View**: Refactored the Cancelled Orders feature from a popup modal (`CancelledOrdersModal`) into a full-page view (`CancelledOrdersView`). This provides a better user experience for browsing large amounts of data. Users can navigate back to the main board using the new back button.
- **Sales Portal Layout**: Adjusted the split-pane layout in `SalesPortal.tsx` to stop the left panel from resizing unexpectedly when an order is selected. The left panel is now fixed at `480px` (`540px` on XL screens) on desktop. The right detail pane now always displays a placeholder state when no order is selected instead of being invisible and occupying 50% of the screen.

### Fixed
- Fixed an `X is not defined` ReferenceError in `PaperTrailPage.tsx` caused by a missing import from `lucide-react`.
- Fixed a syntax parsing error `Unterminated regular expression` in `PaperTrailPage.tsx` caused by a mismatched closing `</div>` tag.




















































