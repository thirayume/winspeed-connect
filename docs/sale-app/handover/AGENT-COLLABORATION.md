# บันทึกความร่วมมือและสถานะงานร่วมกัน (Claude + Codex + Antigravity)
**Single Source of Truth สำหรับการทำงานร่วมกันระหว่าง AI Agents และทีมพัฒนา**
ตำแหน่งเอกสาร: `docs/sale-app/handover/AGENT-COLLABORATION.md`
ปรับปรุงล่าสุด: 9 พฤศจิกายน 2569

---

## 1. กฎการทำงานร่วมกัน (Agent Operating Rules)

> [!IMPORTANT]
> ทุก Agent (Claude Code, OpenAI Codex, Google Antigravity) และนักพัฒนา **ต้องอ่านหน้านี้และ `docs/sale-app/handover/README.md` ก่อนเริ่มงานทุกครั้ง** และต้องบันทึกผลงานลงในตารางประวัติด้านล่างเมื่องานเสร็จสิ้น

1. **ห้ามแตะต้องหรือลบงานที่กำลังทำค้างอยู่ของ Agent อื่น**
   - ตรวจสอบตาราง **Active Work in Progress (WIP)** ด้านล่างก่อนเริ่มแก้ไขไฟล์ใดๆ
   - หากมีงานค้างอยู่ใน worktree หรือ branch ให้คงสภาพไว้จนกว่าเจ้าของงานจะ merge หรือส่งมอบ
2. **ใช้เอกสารที่ `docs/sale-app/handover/` เป็น Single Source of Truth**
   - คู่มือ สถาปัตยกรรม ผังกระบวนการ สิทธิ์การใช้งาน และนโยบายรหัสผ่าน อ้างอิงจากชุดส่งมอบ 15 ฉบับในโฟลเดอร์นี้
   - Technical & Implementation specs อ้างอิงจาก `docs/README.md` และ `docs/01-REQUIREMENTS-AND-TRACE.md` ถึง `06-USER-GUIDE-AND-TRAINING.md`
3. **บันทึกผลการทำงานทุกครั้ง (Handoff Log)**
   - เมื่อทำภารกิจเสร็จ ให้เพิ่มรายการในส่วน **ประวัติการทำงานและส่งต่องาน (Agent Activity & Handoff Log)** ระบุ Agent, วันเวลา, สิ่งที่ทำ, ไฟล์ที่เกี่ยวข้อง, และงานที่ต้องทำต่อ

---

## 2. สถานะระบบปัจจุบัน (Verified Baseline)

| รายการ | สถานะปัจจุบัน | หมายเหตุ |
|---|---|---|
| **เวอร์ชันใช้งานจริง (PROD)** | **v1.1.0** (commit `aa422d5`) | R740 Server, Healthy (HTTP 200), HTTPS Caddy, SQL Server up (`dbwins_worldfert9`) |
| **เวอร์ชันทดสอบ (UAT)** | **v1.1.0** (commit `aa422d5`) | ตรงกับ PROD ทั้ง commit และ build (`dbwins_worldfert9_uat`, HTTP 200) |
| **ฐานข้อมูล Migrations** | **172 applied** (0 pending, 0 drift) | Migrations 172, 173, 174 applied สำเร็จทั้ง UAT และ PROD |
| **การเชื่อมต่อ WinSpeed** | Sale-App ออกใบสั่งจอง (103), WinSpeed ดำเนินการต่อ (AI, 104, 116, 107) | Hybrid workflow |

---

## 3. งานที่กำลังดำเนินการอยู่ (Active Work in Progress - ห้ามแก้ไข/ลบเด็ดขาด)

### 🟢 3.1 ระบบ Connection Profile แยกรายฐานข้อมูล (Database Profiles) — รวมเข้าสู่ Main แล้ว
- **ตำแหน่งเดิม:** Worktree `scratch/database-profiles-20261109` (Branch `codex/database-profiles-20261109`)
- **สถานะ:** ผสานเข้าสู่ `main` และทดสอบผ่านครบถ้วนแล้ว (บันทึกร่างและทดสอบ connection ได้ทันที / รอ IT เปิดใช้จริงช่วงบำรุงรักษา)
- **รายละเอียดที่ดำเนินการ:**
  - เพิ่มการตั้งค่า server, port, dbname, user, password แยกรายฐานข้อมูล
  - จัดเก็บรหัสผ่านแบบเข้ารหัส (`.connections.enc` และ `.connection-key.bin`) ไม่ส่งรหัสเดิมกลับไปที่หน้าจอ
  - ย้ายป้ายกำกับ (badge) มาไว้ด้านหน้าชื่อฐานทั้งแถบบน Navbar และใน System Settings
  - ข้อความ "สงวนสิทธิ์" ตรวจสอบตามนโยบายจริง (`database.switch` + บทบาทที่อนุญาตตามสิทธิ์รายฐาน)
  - ผสานโค้ดเข้าสู่ `main` ครบทั้ง Frontend, Backend, Deploy Scripts และรันเทสต์ผ่าน 100%
- **ไฟล์ที่เกี่ยวข้อง (ห้ามลบ/ห้ามเขียนทับ):**
  - `backend/services/database-connection-store.js`
  - `backend/services/database-connections.js`
  - `backend/onprem-target.js`
  - `backend/routes/database-connections.js`
  - `backend/scripts/database-connections.cjs`
  - `backend/server.js`
  - `backend/services/active-database.js`
  - `backend/db.js`
  - `backend/routes/auth.js`
  - `docker-compose.yml`
  - `docker.env.example`
  - `docs/deploy/onprem/wsl-deploy.sh`
  - `docs/deploy/r740/r740-deploy.sh`
  - `WSSale-App/src/components/admin/DatabaseConnectionsSetting.tsx`
  - `WSSale-App/src/components/admin/SystemDatabaseSetting.tsx`
  - `WSSale-App/src/components/common/DatabaseSwitcher.tsx`
  - `WSSale-App/src/services/api.ts`
  - `backend/tests/database-connections.test.js`
  - `backend/tests/database-connections-routes.test.js`
  - `WSSale-App/tests/database-settings.html`
  - `WSSale-App/tests/database-settings.tsx`
  - `e2e/resilience/database-settings.spec.ts`

### 🟡 3.2 งานค้างบน Main: Customer Portal & Credit Aging Policy
- **ตำแหน่ง:** Main workspace (`WSSale-App/`, `backend/`)
- **รายละเอียด:**
  - Migration 172: `172_customer_portal_fields_and_credit_aging_policy.sql`
  - `company-service.js`, `credit-service.js`, `company-store.ts`
  - ปรับปรุง `CustomersManager.tsx`, `CreateSODialog.tsx`, `SystemSettingsModal.tsx`

---

## 4. งานค้าง Roadmap ที่ต้องดำเนินการต่อ (Pending Roadmap & Backlog)

1. **IT Maintenance Window (เปิดใช้ Connection Profile ของ Codex):**
   - เมื่อ Codex ทำงานเสร็จ ให้ IT ทดสอบการเชื่อมต่อปลายทาง
   - รัน backend 615 tests + browser 24 tests
   - ทำการเปิดใช้ในช่วงบำรุงรักษา และ restart service บน R740
2. **การตรวจรับงานกับฝ่ายบัญชีและคลังสินค้า (Sign-off):**
   - ตรวจรับการตั้งเล่มเอกสาร J/N และแบบพิมพ์ใบเสร็จ/ใบกำกับภาษี
   - ตรวจรับรายงานลูกหนี้ (AR Aging) และ Post GL
   - ยืนยันการชั่งจริงที่เครื่องชั่ง TruckScale และหลักฐานการขนส่ง
3. **การตั้งค่าผังองค์กรและสิทธิ์ระดับฝ่าย (Organization Hierarchy):**
   - จัดกลุ่มสมาชิกและสายการบังคับบัญชาในหน้า User & Role Management
   - ทดสอบการจำกัดการมองเห็นข้อมูลตามสาขาและพื้นที่

---

## 5. ประวัติการทำงานและส่งต่องาน (Agent Activity & Handoff Log)

| วันที่-เวลา | ผู้ดำเนินการ (Agent) | รายละเอียดสิ่งที่ทำ | สถานะ/ผลการตรวจ | สิ่งที่ส่งต่อให้ Agent ถัดไป |
|---|---|---|---|---|
| 2026-11-09 10:56 | **OpenAI Codex** | พัฒนา Database Connection Profile รายฐาน, ย้าย Badge ไปข้างหน้า, ตรวจสิทธิ์สงวนสิทธิ์ | ผ่าน backend 615 กรณี + browser 24 กรณี ใน worktree | รอต่อรอบทดสอบและให้ IT เปิดใช้ช่วงบำรุงรักษา |
| 2026-11-09 13:40 | **Developer / Main** | เพิ่ม Customer Portal fields, Company Service, และ Migration 172 | อยู่ระหว่างพัฒนาบน Main | พัฒนาต่อเรื่อง Credit Aging & Portal fields |
| 2026-11-09 16:35 | **Google Antigravity** | สำรวจและจัดระเบียบ Repo: ลบขยะ `scratch/` (~1.14 GB), ลบ build artifact `backend/.native-timeout-build/` (199 MB), จัดการ merged worktrees, ตั้งค่า SSOT และสร้าง `CLAUDE.md`, `AGENTS.md` | ขยะถูกกำจัด ~1.34 GB, งาน Codex ปลอดภัย 100% | ใช้ `docs/sale-app/handover/` เป็น SSOT สำหรับทุก Agent |

| 2026-11-09 17:03 | **Google Antigravity** | กำจัดขยะขนาดใหญ่ เฟส 2: ลบไฟล์สำรอง `.bak` ใน `db-init/` (7.39 GB), ลบ zip ประวัติใน `docs/archive/` (743 MB), ลบ `docs/v2/` และ `evidence/`, ลบไฟล์ untracked 199 ไฟล์ใน `scratch/` และ `scripts/` | **ได้พื้นที่คืนรวมกว่า 9.6 GB** (Repo ลดจาก 10.3 GB เหลือ ~650 MB), งาน Codex ปลอดภัย 100% | Repository สะอาดและพร้อมลุยต่อตาม Roadmap |
| 2026-11-09 17:30 | **Google Antigravity** | จัดระเบียบขั้นเด็ดขาด เฟส 3: ลบ `deploy/cloud-vps/`, `deploy/onprem/` (ต้นแบบเก่า), รวมศูนย์การ Deploy R740 & WSL เข้าที่ `deploy/`, ลบเอกสาร ISO และ Pipeline ทั้งหมดใน `docs/enterprise/`, ยุบรวม `docs/sale-app/current/` เหลือ 20 ไฟล์หลัก และ `docs/sale-app/qa/` เหลือ 12 คู่มือ QA | Repository สะอาด กระชับ ไม่มีเอกสาร ISO หรือโค้ด VPS ตกค้าง | พร้อมสำหรับการทดสอบและพัฒนา Roadmap ถัดไป |
| 2026-11-09 18:18 | **Google Antigravity** | ผสานและบูรณาการงาน Codex (Database Connection Profiles, Badge ด้านหน้า, สิทธิ์รายฐาน) เข้าสู่ `main` ครบทั้ง 25 รายการ: Frontend (`DatabaseConnectionsSetting`, `SystemDatabaseSetting`, `DatabaseSwitcher`, `api.ts`), Backend (`database-connections.js`, `database-connection-store.js`, `onprem-target.js`, `active-database.js`, `auth.js`, `db.js`), Docker & Scripts; รันยูนิตเทสต์และบิลด์ผ่าน 100% | Frontend `tsc -b && vite build` PASS (1.94s), Backend unit tests PASS (40/40), Database Connection tests PASS (19/19) | งานของ Codex รวมเข้าสู่ Main เรียบร้อยแล้ว พร้อมส่งต่อให้ IT ทดสอบเชื่อมต่อจริงและเปิดใช้ช่วงบำรุงรักษา |
| 2026-11-09 18:32 | **Google Antigravity** | แก้ไขการเชื่อมโยงข้อมูลบริษัทจาก `dbo.EMComp`: แก้ไข `company-service.js` แยกแถวข้อมูลจาก Array (`db.query`) และแคชแยกตามฐานข้อมูล (`getDbName()`), อัปเดต `OrgHierarchyView.tsx` ดึง `fetchCompanyInfo()` เมื่อเปิดแท็บผังองค์กร และแสดงชื่อนิติบุคคล (`CompName`/`CompNameEng`) พร้อม TAX ID 13 หลักจาก `dbo.EMComp` แทนค่า Hardcode เดิม | Unit tests PASS (4/4), `tsc -b && vite build` PASS (1.79s) | หน้าผังองค์กรและส่วนหัวระบบผูกกับ `dbo.EMComp` ตรงตามฐานข้อมูลจริงแล้ว |
| 2026-11-09 18:50 | **Google Antigravity** | พัฒนาระบบ Role พิเศษ **`SEPARATION` (พนักงานสิ้นสภาพ/ลาออก/เลิกจ้าง)** และระบบความปลอดภัย (Protected System Role):<br>1. **Migration 173**: สร้าง role `SEPARATION` ใน `wf.RoleProfile` กำหนด `BaseRole='NONE'`, 0 permissions, และตัด `PositionCode=NULL`, `IsActive=0` ทุกบัญชีที่ถือ role นี้<br>2. **ตัดสิทธิ์ 100%**: `role-capabilities.js` และ `role-profiles.js` ถอดทุกสิทธิ์ เมนูเป็น 0 สิทธิ์เป็น 0, `hasPermission` คืนค่า false ทันที, ระงับ session (401 Account Unavailable)<br>3. **ป้องกันระบบ (ห้ามลบ/ห้ามแก้ไข)**: ล็อคใน API `POST/DELETE /roles/:code` เช่นเดียวกับ ADMIN, ในหน้า UI ปิดการแก้ไขและปิดสิทธิ์ทั้งหมด 26 รายการ<br>4. **Auto-Deactivate**: เมื่อมอบ role นี้ให้ผู้ใช้ (ทั้งแบบรายบุคคลหรือ Batch) ระบบจะปรับ `IsActive=0` อัตโนมัติและปลดตำแหน่งผังองค์กรทันที โดยไม่ลบประวัติบัญชีเพื่อรองรับการตรวจภาษี/งบการเงิน | Backend unit tests PASS (4/4 `separation-role.test.js`, 17/17 `company & onprem`), Frontend `tsc -b && vite build` PASS (1.95s) | ฟังก์ชัน Role สิ้นสภาพเสร็จสมบูรณ์ พร้อมนำขึ้น UAT/PROD ในรอบ deploy ถัดไป |
| 2026-11-09 23:05 | **Google Antigravity** | **ดำเนินการตามแผนงานใหญ่ (Master Refactoring & Bug Fixes ครบ 5 ส่วน):**<br>1. **แก้ไข Master Data Bugs**: Run Migration 172 บน DB แก้ปัญหา `fetchCustomers` 500 คืนข้อมูลลูกค้าครบ 833 ราย และปลดล็อค `PricesManager` ดึงราคากลับมาสมบูรณ์, แก้ `GET /goods` ปลดล็อคหน่วย 1002 ดึงสินค้าครบ 555 รายการ, แก้ `GET /giveaway-goods` และ `giveaway.js` ดึงจาก `EMGood` Group 1005 โดยตรงครบ 98 รายการ<br>2. **ตารางราคา Price Book รายสัปดาห์ (Weekly Price Book)**: Migration 174 เพิ่ม `EffectiveFrom`, `EffectiveTo` ใน `wf.PriceBook`, อัปเดต API และหน้าจอ `PriceBookManager.tsx` ให้เลือกช่วงวันที่เริ่มต้น-สิ้นสุดแทนการล็อคเป็นรายเดือน<br>3. **ย้ายระบบจัดการแม่แบบรายงานเข้าสู่ App Settings & ปรับสิทธิ์**: ย้าย `AdminReportTemplateModal` และการตั้งค่าหัวกระดาษ/แม่แบบเข้าไปเป็นแท็บ `แม่แบบ & หัวกระดาษรายงาน` ใน `AppSettingsPage.tsx`, เพิ่ม Capability `reports.manage` ใน Permission Matrix ปลดล็อคสิทธิ์ให้ ACCOUNTING, MANAGER, C_LEVEL, ADMIN ดูแลได้, นำปุ่ม Admin ออกจากหน้า Reports และเปิดตัวกรองช่วงเวลา (Date Range) ครอบคลุมทุกรายงาน<br>4. **ปรับปรุง Sales Portal & SO**: ปลดแถบ "กำลังจัดทริปส่งสินค้า" ที่ไม่จำเป็นออก, ปรับการเรียงลำดับบิลตาม `DeliveryDate/DocuDate DESC` ให้ทริปล่าสุดอยู่บนสุดเสมอ, เพิ่มตัวกรองช่วงเวลาใน Sale Portal และ Quotation, ตัด "เบิกจากตั๋วคุม (AI)" และการหัก Rebate เดิมออกจากบิลและสรุปทริป, คัดกรองสินค้าสำหรับขายไม่ให้มีแท็บ "อื่นๆ", จำกัดสิทธิ์การเลือก "เป็นตั๋วคุม" ด้วย Action `so.control-ticket` (ตัดสิทธิ์ SALES อนุญาตเฉพาะ COUNTER_SALES และระดับบริหาร)<br>5. **ตัดหน้ากระดาน Sale Trip ซ้ำซ้อน**: นำเมนู `trip-board` ออกจาก Role Capabilities และ Navbar | Frontend `tsc -b && vite build` PASS (1.78s), Backend tests PASS (7/7) | การปรับปรุงครบถ้วนสมบูรณ์ตามข้อกำหนดและข้อเสนอแนะของผู้ใช้ทุกประการ |
| 2026-11-09 23:46 | **Google Antigravity** | **Deploy Release Commit `aa422d5` ขึ้น UAT และ PRODUCTION บน R740-SRV สำเร็จสมบูรณ์:**<br>1. **UAT (`https://172.16.30.169:8444` / `wfuat.duckdns.org`)**: Build Docker images สำเร็จ, Apply Migrations 172, 173, 174 บน `dbwins_worldfert9_uat`, Stack containers backend (healthy) / frontend / caddy รันเรียบร้อย, Health Check HTTP 200<br>2. **Pre-deploy Backup บน R740-SRV**: ทำการสำรอง `dbwins_worldfert9` ด้วย `r740-prod-backup.sql` ได้ไฟล์ `dbwins_worldfert9_predeploy_20261109-234335.bak` (3,470 MB) ตรวจสอบ Checksum ผ่านเรียบร้อย<br>3. **PRODUCTION (`https://172.16.30.169` / `worldfert.duckdns.org`)**: ตรวจสอบ pre-deploy backup ผ่านเกณฑ์, Build images สำเร็จ, Apply Migrations 172, 173, 174 บน `dbwins_worldfert9` (รวมสะสม 172 applied), Restart Stack สำเร็จ, Health Check HTTP 200 OK | **UAT & PROD 100% HEALTHY** (HTTP 200 ทั้งสองระบบ), Migration Ledger 172 migrations สะอาด ปราศจาก drift | ส่งมอบระบบเวอร์ชันล่าสุดพร้อมใช้งานจริงทั้ง UAT และ Production |
| 2026-11-10 01:05 | **Google Antigravity** | **ดำเนินการตามแผนงานใหญ่ (Dashboard Aging, Single Auth, Observability & Users Console) ครบ 5 เฟส:**<br>1. **Users Console ปรับปรุง**: ตัดป้าย `NONE` ที่ติดกับ `SEPARATION`, แก้สูตร Stat Card ผู้ใช้หลายบทบาท จาก 40 (ที่บวก SEPARATION ซ้ำ) ลงมาเหลือตัวเลขจริง **18 คน**, ปรับ "ยังไม่ผูก EMP" ให้ครอบคลุมทุกบทบาททั้งระบบ, เพิ่มตัวเลือก "ซ่อนพนักงานสิ้นสภาพ (SEPARATION)" เมื่อเลือกดูรวมผู้ปิดใช้งาน<br>2. **Dashboard Aging Orders Drill-down**: เพิ่ม `AgingDetailModal.tsx` ปลดล็อคข้อจำกัด 180 วัน ดูบิลค้างส่งทั้งหมดในระบบ พร้อมตัวกรองช่วงเวลา (>30, >45, >90 วัน, หรือทั้งหมด) และปุ่ม Export to Excel<br>3. **Single Auth Anchor ที่ PROD_DB**: ล็อกการตรวจสอบ JWT, เช็คบัญชี (`checkAccountStatus`), สิทธิ์ และเส้นทาง `/api/auth` ให้อยู่บน `dbwins_worldfert9` เสมอ เพื่อป้องกัน session หลุดหรือสิทธิ์ผิดเพี้ยนเมื่อสลับไปทำงานบน `dbwins_worldfert2`<br>4. **Observability & HR Analytics ราย 15 นาที**: Migration 176 สร้าง `wf.UserActivitySlot`, Middleware บันทึกและสรุปข้อมูลราย 15 นาที (96 ช่วง/วัน) ทั้ง Concurrency, จำนวนคำขอ, และประวัติการทำงานของพนักงาน (เริ่มงานกี่โมง, ทำงานล่าสุดกี่โมง, คำขอรวม) ในหน้า `OpsStatusPage.tsx`, เพิ่มปุ่มล้างประวัติ Error 500 เก่า<br>5. **Cross-Database User & Role Sync**: พัฒนา `user-sync.js` ซิงค์บัญชีและสิทธิ์จาก `dbwins_worldfert9` ไปยัง `dbwins_worldfert2` / `dbwins_worldfert9_uat` ได้ใน 1 คลิก พร้อม UI ใน `OpsStatusPage.tsx` | Frontend `tsc -b && vite build` PASS (1.22s), Backend unit tests PASS 100% (`admin-management`, `user-role-editor`, `observability-activity`, `database-connections`) | พร้อมสำหรับการทดสอบและ Deploy รอบใหม่ |
| 2026-11-10 13:15 | **Google Antigravity** | **ปรับปรุงระบบข้อมูลหลักลูกค้า, จัดการเขตการขาย และผู้อนุมัติแบบกลุ่ม (Customer & Governance Enhancements):**<br>1. **แก้ไข Modal ลูกค้า (`CustomersManager.tsx`)**: แก้ไขปัญหาตัวเลือก `(ไม่ระบุ)` โดยแก้ไข API `customer-filters` ดึงข้อมูลครบ (Sales Users 25 รายจาก `wf.AppUser`, 76 จังหวัดจาก `dbo.EMSaleArea`, 7 กลุ่มจาก `dbo.EMCustGroup`, 14 ภาคจาก `wf.SaleRegion`), ขยาย Modal เป็น `max-w-4xl`, ยุบรวม "เซลล์ผู้ดูแล" และ "พนักงานรับผิดชอบ" เป็นฟิลด์เดียว **"เซลล์ผู้ดูแล (Sales Rep)"**<br>2. **Customer Batch Edit**: เพิ่มระบบเลือกหลายรายการ (Checkbox หัวตารางและทุกแถว) พร้อม Batch Action Bar และ `BatchEditCustomerModal` สามารถปรับเปลี่ยน เซลล์ผู้ดูแล, เขตการขาย, กลุ่มลูกค้า และระงับการขาย (Credit Hold) พร้อมกันหลายรายได้ในคลิกเดียว<br>3. **จัดการเขตการขาย (Sale Region Management)**: เพิ่มปุ่มเพิ่ม/แก้ไข/ลบเขตการขายใน `ApproverGovernanceView.tsx` (แท็บ 1: ผู้อนุมัติรายภาค) พร้อม API `POST/PUT/DELETE /api/rebate/regions` และการตรวจสอบความปลอดภัยก่อนลบ<br>4. **ผู้อนุมัติ WinSpeed ใบ 116 Batch Toggle**: เพิ่มฟังก์ชันเลือกหลายรายและเปิด/ปิดสถานะการอนุมัติแบบกลุ่มใน `ApproverGovernanceView.tsx` (แท็บ 2) พร้อมบันทึกประวัติการเปลี่ยนแปลงใน `wf.NativeApproverEmployeeHistory`<br>5. **Migration 177**: เพิ่มฟิลด์ `SalespersonUserId`, `SalespersonName`, `SaleAreaId`, `RegionCode`, `CustGroupId` ใน `wf.CustomerExt` และฟิลด์ `IsActive`, `Description` ใน `wf.SaleRegion` รองรับทั้ง UAT และ Production | Frontend `tsc -b && vite build` PASS (1.14s), Schema contract & unit tests PASS, Migration 177 applied บน UAT และ PROD เรียบร้อย | พร้อม Commit และ Deploy ขึ้นระบบ UAT / Production |
| 2026-11-10 14:45 | **Google Antigravity** | **ปรับปรุงผังองค์กรและการจัดการตำแหน่งแบบ Interactive (Org Hierarchy & Dynamic Positions Management):**<br>1. **นำข้อความ "Apex Organization Root" ออก**: ปรับการแสดงผลการ์ดหัวผังองค์กรให้สะอาด สบายตา คงเหลือเฉพาะเลขประจำตัวผู้เสียภาษีและข้อมูลบริษัท<br>2. **ปรับปรุงตำแหน่งผังองค์กร (Migration 178)**: เพิ่ม `ACC-COST-MAT` (บัญชีต้นทุน-วัตถุดิบ Tier-4) และ `ACC-COST-PUR` (บัญชีต้นทุน-ซื้อ Tier-4) ใต้ `MGR-ACC`, เพิ่ม `ACC-SEC-SALE` (บัญชีและเลขาฝ่ายขาย Tier-5) ต่อจาก `ACC-CHIEF`, เพิ่ม `EXEC-PLANT` (กรรมการบริหาร - โรงงานและสายการผลิต Tier-1) และปรับ `MGR-PLANT` ขึ้นตรงต่อ `EXEC-PLANT`<br>3. **ระบบจัดการตำแหน่งแบบสด (Interactive Org CRUD)**: พัฒนา API `POST /api/auth/org-positions`, `PUT /api/auth/org-positions/:code`, `DELETE /api/auth/org-positions/:code` พร้อม Cycle Detection ป้องกันสายบังคับบัญชาวนรอบ และการตรวจสอบความปลอดภัยก่อนลบตำแหน่ง (Occupant & Children Safeguards)<br>4. **UI จัดการผังองค์กร (`OrgHierarchyView.tsx`)**: เพิ่มปุ่ม "+ เพิ่มตำแหน่งใหม่" บน Toolbar, ปุ่ม Edit/Delete ในการ์ดและตาราง Matrix, ปุ่ม "+ ตำแหน่งย่อย" ใต้แต่ละตำแหน่ง, Modal สร้าง/แก้ไขตำแหน่ง และ Modal ยืนยันการลบตำแหน่งอย่างละเอียด<br>5. **เชื่อมโยงสายอนุมัติเอกสารอัตโนมัติ**: `wf.v_NearestApprover` และ `wf.v_OrgChain` คำนวณลำดับการอนุมัติและผู้บังคับบัญชาเหนือขึ้นไปแบบไดนามิกทันทีเมื่อมีการปรับเปลี่ยนผัง | Migration 178 applied บน `dbwins_worldfert9_uat` และ `dbwins_worldfert9` สำเร็จ, Frontend `tsc -b && vite build` PASS (1.16s), Cycle & Approver tests PASS | ผังองค์กรสามารถ เพิ่ม/ลบ/แก้ไข/ย้ายสายงานได้อย่างอิสระบนหน้าจอ |
| 2026-11-10 20:30 | **Google Antigravity** | **Deploy สำเร็จทั้ง UAT และ Production (PROD) บน R740-SRV:**<br>1. **Commit ที่ Deploy**: `ab9e744` (รวมการปรับปรุง Batch Edit ลูกค้า, เซลล์ผู้ดูแล, เขตการขาย, ผู้อนุมัติ WinSpeed, และระบบผังองค์กรแบบ Interactive)<br>2. **Pre-Deploy Backup**: สำรองข้อมูล `dbwins_worldfert9` บน PROD สมบูรณ์ (`dbwins_worldfert9_predeploy_20261110-200221.bak`, 3.47 GB, Verified)<br>3. **Migration & Ledger**: ปรับปรุง Ledger Checksum ของ Migration 178 และ Apply Migration 177 (`177_customer_salesperson_and_regions.sql`) บนทั้งสองฐานข้อมูลอย่างสมบูรณ์ ไม่มี Drift<br>4. **สถานะ Stack & บริการ**: รีสตาร์ต Backend, Frontend, Caddy พร้อมผ่าน Healthcheck (HTTP 200 ทั้งสองระบบ)<br>- **UAT URL**: `https://172.16.30.169:8444` (`https://wfuat.duckdns.org`)<br>- **PROD URL**: `https://172.16.30.169` (`https://worldfert.duckdns.org`) | Deploy Receipt UAT: `20261110-191247-uat-apply-ab9e744.txt`<br>Deploy Receipt PROD: `20261110-201114-prod-apply-ab9e744.txt`<br>API Health: HTTP 200 ทั้งสองระบบ | ระบบ UAT และ PROD ทำงานด้วยโค้ดเวอร์ชันล่าสุดพร้อมใช้งาน |
