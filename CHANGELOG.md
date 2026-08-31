# Changelog — WorldFert WS-Sale-App

> ⚠️ **ไฟล์นี้ไม่ใช่ทะเบียนรุ่นฉบับจริงแล้ว — อย่าเพิ่มรุ่นใหม่ที่นี่**
>
> ทะเบียนรุ่นฉบับจริงคือ [docs/enterprise/08-APPENDICES/CHANGELOG-APP.md](docs/enterprise/08-APPENDICES/CHANGELOG-APP.md)
> ซึ่งอยู่ภายใต้การควบคุมเอกสาร มีประวัติต่อเนื่องครบทุกรุ่น และตรงกับ `backend/package.json`
>
> **ที่มาของปัญหา:** ไฟล์นี้เดินเลขคู่ขนานกับไฟล์นั้นโดยไม่รู้กัน
> จึงบันทึก `[1.7.0]` ไว้ที่ 30/08/2569 ทั้งที่ **1.7.4 ออกไปแล้วตั้งแต่ 23/08/2569**
> เลขจึงเดินถอยหลัง งานชุดนั้นถูกตั้งเลขใหม่เป็น **1.8.0** ในทะเบียนฉบับจริง
>
> รายการข้างล่างคงไว้เพื่อการสืบย้อน ไม่ลบ แต่ **เลขรุ่นในนี้เชื่อถือไม่ได้**

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.7.0] - 2026-08-30 — *ตั้งเลขใหม่เป็น [1.8.0]*

### 🚀 Added
- **Sale Trip Logistics Management (`wf.SalesTrip`):**
  - Database table `wf.SalesTrip` for grouping multiple Sales Orders into a single truck trip.
  - API endpoints `/api/trips` for trip creation, order assignment, dynamic capacity configuration, and status tracking.
  - UI component `SaleTripManager` featuring interactive tonnage capacity bars, real-time load percentage, and threshold warnings.
  - Paper Trail Kanban board updated to group orders by `DeliveryDate` + `TruckPlate` (Sale Trip) with multi-destination badges.

- **Rebate Ratio & Self-Claim System (`wf.RebateClaim`):**
  - Database schema extension adding `CustomerRatio`, `CompanyRatio`, `CustomerAmount`, `RetainedAmount`, and `IsSelfClaim`.
  - Refactored `RebateClaimForm` with an interactive HSL-styled ratio slider (0-100%), `IsSelfClaim` toggle for 100% company retention, real-time customer vs company retained amount breakdown, and unlocked formula selection.

- **Global Export Utility (`useExport` & `exportUtils`):**
  - Added UTF-8 BOM CSV & HTML-styled Excel export functionality with native Thai character encoding support.
  - Export buttons integrated across `SalesPortal` (SO List), `SaleTripManager` (Trips), `RebatePage` (Claims), and `CnRebatePage` (Rebate Trail).
  - Published WINSpeed Crystal Reports customization guide (`docs/WINSPEED-RPT-REVIEW-V1.7.0.md`) for `WFR68-019` and `WFT68-002`.

- **Automated Verification & UAT Documentation (Phase 5):**
  - Developed Playwright E2E test suite (`e2e/salestrip-and-rebate.spec.ts`) covering Sale Trip API endpoints, Rebate Claim ratio, and Report navigation.
  - Published UAT Full Loop Manual Test Guide (`docs/UAT-FULL-LOOP-MANUAL-TEST-V1.7.0.md`) with 5 core business scenarios and sign-off table.

- **Advanced Reporting & Observability Modules:**
  - `IncentiveReport` (`IncentiveReport.tsx`): Dedicated dashboard for tracking customer-earned rebates vs company-retained funds with search, filter, and KPI summary cards.
  - `BudgetExpenditureReport` (`BudgetExpenditureReport.tsx`): Promotional budget tracking module displaying allocated vs spent amounts per region/plan section with visual progress bars.
  - API endpoints `/api/budget/expenditure` and `/api/budget/plans` for marketing budget analytics.

- **Enhanced TruckScale Integration:**
  - Multi-pass sequential weighing support (`logItemWeighPass`) for multi-product trucks.
  - Automated Tare weight calculation and net tonnage validation against WINSpeed invoice limits.
  - Enhanced Weigh Inbox auto-matching and manual reconciliation workflows.

### 🎨 Changed
- **Modernized Dashboard UI (`DashboardPage.tsx`):**
  - Applied modern HSL color palettes, glassmorphism card styling, subtle hover micro-animations, and dynamic metric badges.
- **Sales Order Entry (`CreateSODialog.tsx`):**
  - Redesigned header and truck info sections to separate customer/document data from vehicle/transport details.
  - Allowed saving draft orders without a vehicle plate, while strictly enforcing vehicle assignment upon order confirmation (`PATCH /api/so/:id/confirm`).

### 🔧 Fixed & Security
- Strict confirmation gate on backend preventing SO confirmation without assigned truck plate or `noTruckRequired` flag.
- Ensured strict backwards compatibility for existing WINSpeed DB migrations (001-101 sequence).

---

## [1.6.0] - 2026-08-05

### 🚀 Added
- Legacy WINSpeed coupon migration into `wf.RebatePlan`.
- 4-Tier Rebate Claim approval workflow (Sales -> Region -> Marketing -> Executive).
- PriceBook special pricing approval workflow.

---

## [1.1.0] - 2026-07-24

### 🚀 Added
- Multi-environment deployment architecture (Coolify/Hetzner, Vercel, Railway).
- E2E automated test suite using Playwright.
