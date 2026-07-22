---
documentId: "WF-DOC-INDEX-001"
title: "Document Index and Navigation Guide"
version: "v1.0"
status: Released
statusDetail: "Released — Single Source of Truth"
owner: "Solution Architect / PM"
normative: false
---
# Document Index and Navigation Guide

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-DOC-INDEX-001` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate/Coupon Management |
| Client | World Fert Co., Ltd. |
| Version | **v1.0** (enterprise consolidated) |
| Date | 21 กรกฎาคม 2569 (21 July 2026) |
| Owner | Solution Architect / PM |
| Status | Released — Single Source of Truth |
| Classification | Confidential — Client / Authorized Partner Use Only |

> เอกสาร v1.0 เป็นชุดรวมฉบับสมบูรณ์ชุดเดียว — โครง enterprise (สืบทอด v8) + เนื้อหาปฏิบัติการเชิงลึก (ชุด 00–12) ที่ตรวจสอบกับฐานข้อมูลจริง

---

## เอกสารที่นำเข้าใหม่ใน v1.0 (Integrated authoritative detail — ตรวจกับ DB จริง)

| Path | Purpose |
|---|---|
| `04-DATA-INTEGRATION/REBATE-COUPON-SYSTEM.md` | ★ ระบบ Rebate/Coupon เต็มระบบ (WFCoupon/WFRedemtion, RBT, CN, wf engine + design เชื่อม dbo↔wf) |
| `04-DATA-INTEGRATION/DATABASE-OVERVIEW.md` | ฐานข้อมูล 3 layer + Data Dictionary |
| `04-DATA-INTEGRATION/PAGES-SQL-MAP.md` | ทุกหน้า → API → SQL → migration |
| `04-DATA-INTEGRATION/WINSPEED-SO-FLOW.md` | Flow Draft→Confirm→Picking→Shipped→Invoice + DocuType |
| `03-SOLUTION-ARCHITECTURE/WORKFLOW-DIAGRAMS.md` | ไดอะแกรม workflow (ต้นฉบับ `.drawio` ใน `03-DRAWIO/`) |
| `02-REQUIREMENTS/SOURCE-ALIGNMENT.md` | จับคู่เอกสาร↔source code + backlog |
| `06-QUALITY-OPERATIONS/TEST-CASES-DETAIL.md` | กรณีทดสอบเชิงลึก |
| `06-QUALITY-OPERATIONS/AUTOMATED-QA.md` | Automated smoke + manual retest |
| `06-QUALITY-OPERATIONS/USER-GUIDE-DETAIL.md` | คู่มือผู้ใช้รายหน้า |
| `06-QUALITY-OPERATIONS/SOP-DETAIL.md` | SOP-01..08 |
| `06-QUALITY-OPERATIONS/PRODUCTION-READINESS-DETAIL.md` | Go-Live checklist (P0/P1/P2) |
| `06-QUALITY-OPERATIONS/FORMS-DETAIL.md` | แบบฟอร์ม ISO |
| `05-SECURITY-DEVOPS/SECURITY-OPERATIONS.md`, `SQL-PERFORMANCE.md`, `DOCKER-DEPLOY.md` | เอกสารเทคนิคเชิงลึก |
| `08-APPENDICES/PENDING-ISSUES.md` | ประเด็นค้าง/known issues |
| `00-GOVERNANCE/RECORDS-REGISTER.md` | ทะเบียนบันทึกคุณภาพ (ISO) |
| `05-SECURITY-DEVOPS/DOC-SYNC-PIPELINE.md` | ★ กระบวนการ sync เอกสาร↔markdown↔source (major version / prod deploy) |
| `pipeline/build-docs.ps1` | สคริปต์ pipeline: cleanup + version stamp + align check + render docx + manifest |
| `06-QUALITY-OPERATIONS/TEST-CATALOG-CURRENT.md` | ★ Test catalog ตามหน้าจอปัจจุบัน (source-aligned, 40+ screens) |
| `06-QUALITY-OPERATIONS/TEST-LOG-TEMPLATE.md` | แบบฟอร์ม Test Log ผูก TC-ID + app version |
| `09-ROADMAP-AND-BACKLOG/` | ★ Roadmap + Pending/Open items + Risk (วางแผนแล้วยังไม่พัฒนา) |

## การรวม binary รุ่น v1.0 (21 ก.ค. 2569)

- **01-DOCX** → รวมเป็นไฟล์เดียว `WorldFert-Enterprise-Documentation-v1.0.docx` (pipeline `-Render`); 49 ชิ้นรุ่น v8 ย้ายไป `_archive/superseded-binaries/docx-v8-fragments/`
- **02-PPTX** → คง 7 เดคตามกลุ่มผู้ฟัง; ตัด `~$` junk + `WorldFert_Presentation_v8` (เก่า) → `_archive/superseded-binaries/pptx-old/`
- **03-DRAWIO** → คง `worldfertflow8-6-69.drawio` (ล่าสุด); 2 เวอร์ชันเก่า → `_archive/superseded-binaries/drawio-old-versions/`
- **04-DIAGRAMS-PNG** → renders (png+svg) คงไว้; `.dot` source ย้ายเข้า `src/`
- **05-UI-SCREENSHOTS** → 21 ภาพ v1.0 (capture จากแอปจริง)

## Doc-Gen Matrix (v1.0) — สร้างจาก markdown + mermaid (pipeline ที่ 2)

สร้างด้วย `pipeline/docgen/build-all.ps1` (ดู `pipeline/docgen/README.md`) — ฝัง diagram ให้ตรงกันทั้ง DOCX/PPTX

**DOCX** (`01-DOCX/generated/`): `SRS` · `Technical-Spec` · `User-Guide-Full` · `User-Guide-Brief` · `User-Guide-Combined-Summary` · `User-Guide-{Sales,Warehouse,Weighbridge,Accounting,Admin}`
**PPTX** (`02-PPTX/generated/`): `Training-Overview` · `Training-{Sales,Warehouse-Weigh,Accounting,Admin}` · `Support-Maintenance`
**Diagrams** (`pipeline/diagrams/*.mmd → *.png`): architecture · so-lifecycle · rebate-coupon-flow · rebate-sequence · erd · rbac · swimlane-order-to-cash · uml-rebate-domain

---

## Complete index

| # | Path | Purpose |
|---:|---|---|
| 1 | `README.md` | entry point, usage, Go-Live position |
| 2 | `00-GOVERNANCE/DOCUMENT-CONTROL.md` | version/change governance |
| 3 | `00-GOVERNANCE/SOURCE-EVIDENCE-REGISTER.md` | evidence and evidence status |
| 4 | `00-GOVERNANCE/GLOSSARY.md` | shared vocabulary |
| 5 | `01-BUSINESS-ANALYSIS/BAD-v8.md` | context, AS-IS, pain points, TO-BE |
| 6 | `01-BUSINESS-ANALYSIS/REQUIREMENTS-CATALOG.md` | prioritised backlog |
| 7 | `01-BUSINESS-ANALYSIS/BUSINESS-RULES.md` | operational/business rules |
| 8 | `01-BUSINESS-ANALYSIS/RACI-AND-STAKEHOLDERS.md` | owner/approval model |
| 9 | `02-REQUIREMENTS/SRS-v8.md` | functional baseline |
| 10 | `02-REQUIREMENTS/NFR-SLO-DR.md` | quality, SLO and resilience |
| 11 | `02-REQUIREMENTS/ACCEPTANCE-CRITERIA.md` | Done/release acceptance |
| 12 | `02-REQUIREMENTS/TRACEABILITY-MATRIX.md` | requirement-to-proof map |
| 12a | `02-REQUIREMENTS/IMPLEMENTATION-STATUS.md` | FR→build status (v4.2.24) + feature-gap backlog |
| 12b | `02-REQUIREMENTS/CURRENT-SYSTEM-STATE.md` | modules + data dictionary + API + TruckScale pull-back (v8) |
| 13 | `03-SOLUTION-ARCHITECTURE/SAD-v8.md` | overall solution architecture |
| 14 | `03-SOLUTION-ARCHITECTURE/C4-ARCHITECTURE.md` | context/container/component views |
| 15–19 | `03-SOLUTION-ARCHITECTURE/ADR-*` | material design decisions |
| 20 | `04-DATA-INTEGRATION/DATA-DESIGN.md` | ownership/logical data model |
| 21 | `04-DATA-INTEGRATION/WINSPEED-INTEGRATION-CONTRACT.md` | ERP contract |
| 22 | `04-DATA-INTEGRATION/TRUCKSCALE-INTEGRATION-CONTRACT.md` | weigh contract |
| 23 | `04-DATA-INTEGRATION/API-REFERENCE.md` | API contract baseline |
| 24 | `04-DATA-INTEGRATION/DATA-QUALITY-AND-MIGRATION.md` | quality/migration/reconciliation |
| 25–30 | `05-SECURITY-DEVOPS/*` | hardening/deploy/incident/DR/performance/release |
| 31–38 | `06-QUALITY-OPERATIONS/*` | QA/UAT/SOP/user/training/Go-Live |
| 39–41 | `07-SALES-ENABLEMENT/*` | commercial materials |
| 42–43 | `08-APPENDICES/*` | risks/delta/support assumptions |
| 44 | `CHANGELOG-v8.md` | version changes |

## Suggested reading sequence

### Executive / commercial
`README` → `PRODUCT-OVERVIEW` → `BAD-v8` → `IMPLEMENTATION-PLAN` → `PROPOSAL-SCOPE-TEMPLATE`

### Delivery team
`BAD-v8` → `SRS-v8` → `SAD-v8` → `ADR-*` → `DATA-INTEGRATION` → `TEST-STRATEGY`

### Go-Live
`PRODUCTION-READINESS-GATE` → `SECURITY-ARCHITECTURE` → `BACKUP-DR-BCP` → `UAT-AND-SIGNOFF` → `RELEASE-MANAGEMENT`

### Daily operation
`USER-GUIDE-v8` → `SOP-v8` → `OBSERVABILITY-INCIDENT-RUNBOOK`
