---
documentId: "WF-GOV-002"
title: "ทะเบียนหลักฐานและเอกสารต้นทาง"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect / BA·SA"
normative: true
---
# ทะเบียนหลักฐานและเอกสารต้นทาง

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-GOV-002` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect / BA·SA |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## หลักการ

เอกสาร v7 แยก “ข้อเท็จจริงที่ยืนยันแล้ว” ออกจาก “เป้าหมายสถาปัตยกรรม/ข้อเสนอแนะ” เพื่อไม่ให้ baseline implementation ถูกตีความเกินหลักฐาน

| ID | เอกสารต้นทาง | ใช้ยืนยันเรื่อง | สถานะ |
|---|---|---|---|
| EV-001 | `WorldFert_SRS_v6_0.docx` | Process, FR/NFR, data model, WINSpeed flow | Verified baseline |
| EV-002 | `WorldFert_Presentation_v6.pptx` | Executive narrative, UI/UX, dashboard visualisation | Supporting |
| EV-003 | `WorldFert_Diagrams_v6.drawio` | AS-IS/TO-BE, ER/DFD/UML | Supporting |
| EV-004 | `00-DATABASE-OVERVIEW.docx` | 3-database topology and mapping | Verified baseline |
| EV-005 | `01-PAGES-SQL-MAP.docx` | page/API/SQL/migration and direct-write exceptions | Verified baseline |
| EV-006 | `02-TEST-CASES.docx` | manual UAT/regression cases | Verified baseline |
| EV-007 | `03-USER-GUIDE.docx` | role workflows | Supporting |
| EV-008 | `04-SOP.docx` | SOP and evidence model | Supporting |
| EV-009 | `05-PRODUCTION-READINESS.docx` | P0/P1 security and operations gaps | Verified baseline |
| EV-010 | `06-FORMS.docx` | Test/UAT/CR forms | Supporting |
| EV-011 | `DOCKER-DEPLOY.docx` | deployment mechanics | Supporting |
| EV-012 | `SECURITY.docx` | secret rotation and least privilege | Verified baseline |
| EV-013 | `SQL-PERFORMANCE.docx` | SQL risk/tuning direction | Verified baseline |
| EV-014 | `test-results/e2e-evidence.json` | Automated E2E 10/10, environment health, per-test results and source/test hashes | Verified current-run evidence; business sign-off separate |
| EV-014 | `truckscale_db_analysis.md` | TruckScale MySQL tables and quality risks | Verified baseline |
| EV-015 | `ขั้นตอนการคีย์ใบสั่งจอง - ตัวอย่างรับชุดร.pdf` | current order/reservation form workflow | Supporting visual evidence |
| EV-016 | `ชุดเอกสารการทำคืนรีเบท.pdf` | promotion/NET price/rebate claim evidence | Supporting visual evidence |
| EV-017 | `ปัญหาและความต้องการ.pdf` | user pain points and requested capabilities | Verified requirement |
| EV-018 | `ข้อมูลเบื้องต้น.txt`, `ความต้องการ.txt` | observe notes, AS-IS workflow | Verified discovery record |
| EV-019 | `สรุปเบิกเสื้อ-กระเป๋า รายภาค.xls` | giveaway budget input | Source data; controlled import required |

## วิธีอ้างอิงใน v7

- **Confirmed** — DB/query หรือเอกสารทางการ
- **Observed** — workshop/observation/เอกสารผู้ใช้
- **Target** — v7 architecture target ต้อง implement/validate
- **Decision Gate** — ต้องอนุมัติก่อน Go-Live

## ข้อขัดแย้งที่ต้องควบคุม

| เรื่อง | วิธี v7 |
|---|---|
| WINSpeed write boundary | ADR-003 แยก target boundary กับ legacy exception |
| TruckScale location | ADR-004 บังคับเลือก canonical source ก่อน Go-Live |
| Credit limit | เป็น decision gate เพราะ WINSpeed master ไม่มีวงเงินที่ใช้ได้ |
| Stock availability | ต้องยืนยัน source-of-truth; ไม่ใช้ `ICStock` โดยอัตโนมัติ |
