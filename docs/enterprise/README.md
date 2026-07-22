---
documentId: "WF-README-001"
title: "World Fert · WS-Sale-App — Enterprise Documentation v1.0"
version: "v1.0"
status: Released
statusDetail: "Released — Single Source of Truth"
owner: "Documentation Owner"
normative: false
---
# World Fert · WS-Sale-App — Enterprise Documentation **v1.0**

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-README-001` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate/Coupon Management |
| Client | World Fert Co., Ltd. |
| Version | **v1.0** (enterprise consolidated) |
| Date | 21 กรกฎาคม 2569 (21 July 2026) |
| App build อ้างอิง | 1.0.0 (unified 21 ก.ค. 2569) |
| Status | Released — Single Source of Truth |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **เอกสารชุดนี้คือฉบับสมบูรณ์ชุดเดียว** ของระบบ WS-Sale-App — รวมโครงเอกสารระดับองค์กร (จาก v8) เข้ากับเนื้อหาปฏิบัติการเชิงลึก (ชุด 00–12 ที่ตรวจสอบกับฐานข้อมูลจริง) รองรับมาตรฐาน ISO 9001 (document & records control) พร้อมไดอะแกรม (drawio) และ appendix ครบ

---

## โครงสร้าง

| โฟลเดอร์ | เนื้อหา |
|---|---|
| `00-GOVERNANCE/` | Document Control, Document Index, **Records Register (ISO)**, Glossary, Source Evidence |
| `01-BUSINESS-ANALYSIS/` | BAD, Business Rules, RACI, Requirements Catalog |
| `02-REQUIREMENTS/` | SRS, Acceptance, NFR/SLO/DR, Traceability, Implementation Status, **Source Alignment** |
| `03-SOLUTION-ARCHITECTURE/` | SAD, C4, ADR-001..005, **Workflow Diagrams** |
| `03-DRAWIO/` | ไฟล์ไดอะแกรมต้นฉบับ `.drawio` (WorldfertFlow 1/4/8-6-69) |
| `04-DATA-INTEGRATION/` | Data Design, API, WINSpeed/TruckScale Contract, Data Quality + **Database Overview, Pages-SQL Map, WINSpeed SO Flow, ★ Rebate/Coupon System** |
| `05-SECURITY-DEVOPS/` | Security, Performance, Deploy/CI-CD, Backup/DR, Observability, Release + **Security Ops, SQL Performance, Docker Deploy** |
| `06-QUALITY-OPERATIONS/` | SOP, Test Strategy, UAT, Training, Go-Live + **Test Cases, Automated QA, User Guide, SOP, Production Readiness, Forms (ฉบับเชิงลึก)** |
| `07-SALES-ENABLEMENT/` | Product Overview, Implementation Plan, Proposal Template |
| `08-APPENDICES/` | Changelog (app), Commercial & Support Assumptions |
| `09-ROADMAP-AND-BACKLOG/` | ★ Roadmap (วางแผนแล้วยังไม่พัฒนา), Pending Issues, Open Decisions, Risk Register, legacy open items |
| `01-DOCX/` | **1 ไฟล์รวมสมบูรณ์** `WorldFert-Enterprise-Documentation-v1.0.docx` (สร้างจาก pipeline `-Render`) |
| `02-PPTX/` | 7 สไลด์เดค (Sales/Progress/Training×4/Architecture) — ตามกลุ่มผู้ฟัง |
| `03-DRAWIO/` `04-DIAGRAMS-PNG/` `05-UI-SCREENSHOTS/` | ไดอะแกรมล่าสุด + ภาพ diagram/UI |
| `_archive/` | **บันทึก/ประวัติเพื่อ ISO**: records, srs-history, sales-comments, sql-reference, reference-src, superseded-binaries (docx v8/pptx เก่า/drawio เก่า), wf-out-ki, qa-rendered-v8 |

> ★ = เอกสารเด่น/ใหม่ในรุ่นนี้ · เอกสารที่ลงท้าย `-DETAIL` คือฉบับปฏิบัติการเชิงลึก (authoritative) ที่นำเข้าจากชุด 00–12

## ลำดับการอ่านที่แนะนำ

- **ผู้บริหาร/ขาย:** `07-SALES-ENABLEMENT/PRODUCT-OVERVIEW` → `01-BUSINESS-ANALYSIS/BAD-v8` → `IMPLEMENTATION-PLAN`
- **ทีมพัฒนา:** `02-REQUIREMENTS/SRS-v8` → `03-SOLUTION-ARCHITECTURE/SAD-v8` + `ADR-*` → `04-DATA-INTEGRATION/*`
- **Rebate/Coupon:** `04-DATA-INTEGRATION/REBATE-COUPON-SYSTEM.md` (ครบทั้ง WFCoupon/RBT/CN/wf engine + design เชื่อม)
- **QA/Go-Live:** `06-QUALITY-OPERATIONS/PRODUCTION-READINESS-DETAIL` → `TEST-CASES-DETAIL` → `UAT-AND-SIGNOFF`
- **ใช้งานประจำวัน:** `06-QUALITY-OPERATIONS/USER-GUIDE-DETAIL` → `SOP-DETAIL`

## เกี่ยวกับรุ่น v1.0

รุ่นนี้รวมและแทนที่เอกสารเดิมทั้งหมด (operational 00–12, v7, v8, wf/out KI) ไว้ที่นี่ที่เดียว — ดูรายละเอียดการเปลี่ยนแปลงใน [`00-GOVERNANCE/DOCUMENT-CONTROL.md`](00-GOVERNANCE/DOCUMENT-CONTROL.md), ดัชนีเต็มใน [`DOCUMENT-INDEX.md`](DOCUMENT-INDEX.md) และทะเบียนบันทึกใน [`00-GOVERNANCE/RECORDS-REGISTER.md`](00-GOVERNANCE/RECORDS-REGISTER.md)
