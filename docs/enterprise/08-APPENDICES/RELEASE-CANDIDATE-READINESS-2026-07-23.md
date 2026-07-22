---
documentId: WF-RC-001
title: Release Candidate Readiness and Approval Packet
version: 1.0-draft
status: Draft
owner: Release Manager / QA Lead / Solution Architect
normative: false
runtimeVersion: 1.0.0
sourceMigrationSequence: 55
auditedCommit: 5916788c5150ecb70dba970c5742d56f33b76e2b
sourceRefs:
  - test-results/e2e-evidence.json
  - test-results/playwright-results.json
  - package.json
  - package-lock.json
  - backend/package.json
  - backend/package-lock.json
  - WSSale-App/package.json
  - WSSale-App/package-lock.json
  - run-e2e.ps1
  - e2e/evidence.config.json
  - docs/enterprise/pipeline/source-alignment.config.json
  - sql/fix-winspeed-legacy-raiserror.sql
  - docs/enterprise/pipeline/reports/source-alignment-report.json
  - docs/enterprise/pipeline/reports/document-validation-report.json
outputs:
  - release-readiness-review-packet
---

# Release Candidate Readiness and Approval Packet

วันที่จัดทำ: 23 กรกฎาคม 2026 เวลา 02:02 น. (Asia/Bangkok)
ขอบเขต: repository `winspeed-frontend`, runtime v1.0.0, local SQL Server/MySQL test environment และเอกสารภายใต้ `docs/enterprise`
สถานะ: **engineering review candidate เท่านั้น — ไม่ใช่ production release approval, business UAT sign-off, ISO certification หรือ accepted baseline**

## 1. Executive outcome

ชุด source, dependency, migration runner, Full E2E และ document-control pipeline ผ่าน technical checks ที่ทำได้โดยอัตโนมัติ ณ snapshot นี้ โดย Full E2E ผ่านครบ 10/10 และ source ไม่เปลี่ยนระหว่างทดสอบ อย่างไรก็ตาม release gate ยังไม่ปิดเพราะ worktree มีการเปลี่ยนแปลงที่ยังไม่ได้จัดชุด/commit, accepted source/document baselines ยังไม่มี, normative documents 38 ฉบับยังรอผู้มีอำนาจอนุมัติ และ migration incident/data-recovery disposition ยังต้องตัดสินโดยเจ้าของข้อมูลกับ DBA

หลัก `latest-document-wins` ใช้กับการ merge เนื้อหาเมื่อพบ conflict แต่ไม่แทนการ review/approval: หากเอกสารขัดกับ source หรือ evidence ล่าสุด ให้ยึด source/evidence ล่าสุดและเปิดรายการให้ reviewer ตัดสินก่อนรับ baseline

## 2. Controlled snapshot

| รายการ | หลักฐานล่าสุด |
|---|---|
| Git commit | `5916788c5150ecb70dba970c5742d56f33b76e2b` |
| Worktree | dirty — เป็น candidate changes ที่ยังไม่ควรถูกตีความเป็น released baseline |
| Source inventory | 214 files |
| Source SHA-256 | `DD5919B298128637E2FCEF56A2B663F0B09EE94206349E3B28C61E27569BE49F` |
| Source scan | stable; 0 errors; 2 warnings หลัง sync |
| API/UI/migration facts | 17 mounts / 160 endpoints; 22 portals / 8 roles; latest migration sequence 55 |
| Review mapping | 40/40 source-sensitive review candidates mapped |
| Pre-packet document inventory | 80 documents / 29 control files; SHA-256 `CAD413D6A78B7A27FB167B02324A1FA7231644EF41D3A72D6763050F0F7DD1CF` |
| Post-packet document inventory | ให้ยึดค่าจาก `pipeline/reports/document-validation-report.json` เพื่อหลีกเลี่ยง self-referential hash |

## 3. Verification evidence

| Gate | ผล | หลักฐาน/หมายเหตุ |
|---|---:|---|
| Full Playwright E2E | PASS | 10 passed, 0 failed/flaky/skipped/not-run; 3 required specs ครบ |
| Evidence completeness | PASS | `PASSED_COMPLETE`, `complete=true`, run `2026-07-22T18-57-48-900Z` |
| Source stability during E2E | PASS | start/end commit ตรงกัน; `changedFiles=[]`; 211 evidence file hashes; actual/expected hash set 211/211 รวม consolidated operational SQL 1 ไฟล์ |
| Test environment health | PASS with caveat | frontend `5174`, API `3100`, SQL Server `up`; MySQL `down` และไม่ใช่ required gate ตาม policy ปัจจุบัน |
| Production frontend build | PASS | Vite 8.1.5; 2,280 modules transformed |
| Document pipeline tests | PASS | 23/23 |
| Migration runner tests | PASS | 5/5 |
| Local migration plan | PASS | active 54, excluded 2, unchanged 54, pending 0, drift 0; read-only |
| Operational SQL traceability | PASS | source inventory และ E2E completeness gate ครอบคลุม consolidated `sql/fix-winspeed-legacy-raiserror.sql`; hash set 211/211 |
| npm audit — root | PASS | 0 vulnerabilities / 72 dependencies |
| npm audit — backend | PASS | 0 vulnerabilities / 241 dependencies |
| npm audit — frontend | PASS | 0 vulnerabilities / 249 dependencies |
| SheetJS export smoke | PASS | version 0.20.3; XLSX ZIP header `504b`; 15,884-byte workbook |
| Source preflight | PASS with warnings | 0 errors; baseline missing + dirty worktree |
| Document preflight | PASS with warnings | 0 errors; 40 warnings before packet |

### E2E isolation and reliability correction

รอบวิเคราะห์แรกพบ `Query timeout expired` ที่ขั้น WAREHOUSE และพบ process tree `npm run dev:e2e` เก่าค้าง 9 roots รวม 116 process targets ขณะที่ dev server ของผู้ใช้บน `3000/5173` ยังทำงานอยู่ การทดสอบจึงถูกแยกไปใช้ `3100/5174`, ปิดเฉพาะ process ทดสอบเก่า และปรับ `run-e2e.ps1` ให้ terminate process tree ของตนเองใน `finally` หลังแก้ไข Full E2E ผ่าน 10/10 และไม่เหลือ `dev:e2e` process ค้าง โดย dev server เดิมของผู้ใช้ไม่ถูกหยุด

### TruckScale availability caveat

E2E รอบ `2026-07-22T18-57-48-900Z` บันทึก MySQL `down` ตั้งแต่ environment snapshot และพบ `GET /api/truckscale/ping` ตอบ 500 จำนวน 4 ครั้ง; UI แสดง “เชื่อมต่อไม่ได้” ตรงกัน หลัง observability patch รายการทั้ง 4 ถูกบันทึกใน API audit และ `wf.ErrorLog` ชุดทดสอบยังผ่านตาม policy ปัจจุบันซึ่งบังคับ frontend/API/SQL Server แต่ไม่บังคับ MySQL ข้อนี้เป็น operational availability caveat ไม่ใช่หลักฐานว่า TruckScale พร้อมใช้งาน

### WINSpeed trigger maintenance evidence

- Commit `c249bd7855c13c57a0174b380c138e4448538372` consolidate apply/rollback dumps เป็น `sql/fix-winspeed-legacy-raiserror.sql` ไฟล์เดียว
- สคริปต์ระบุผล REMOTE: user triggers 1,289, new syntax 1,283, legacy 0 และ `wf.LegacyTriggerBackup` 1,283 rows
- Read-only query ที่ `\.\SQLEXPRESS` local พบ 1,289 / 1,283 / 0 เช่นกัน แต่ `wf.LegacyTriggerBackup` ไม่มีอยู่ จึงห้ามนำผลของ REMOTE และ LOCAL มาปะปนกัน
- ต้องให้ DBA ยืนยัน connection target, backup-table evidence และ rollback disposition ราย environment; migration ledger plan ไม่ครอบคลุม out-of-band trigger ALTER นี้

### Dependency disposition

- ลบ root-level `xlsx` ที่ซ้ำซ้อน เพราะ source ที่ใช้งานจริง import จาก backend package เท่านั้น
- backend ใช้ SheetJS 0.20.3 จาก official CDN tarball ตาม [SheetJS NodeJS installation guidance](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)
- frontend อัปเดต Vite เป็น 8.1.5; root ใช้ `concurrently` 9.2.4; transitive fixes ปิด advisory ของ `brace-expansion`, `body-parser` และ `qs`
- ต้องรัน audit/build/export smoke ซ้ำเมื่อ package manifest หรือ lockfile เปลี่ยน

## 4. Open release gates

| Gate ที่ยังเปิด | ผู้ตัดสินที่ต้องการ | หลักฐาน/การดำเนินการ |
|---|---|---|
| Dirty worktree | Repository maintainer | review diff, แยก unrelated changes, commit ด้วยข้อความที่ตรวจสอบได้ |
| Accepted source baseline missing | Technical approver / Configuration manager | รับด้วย actor + reason หลัง commit ที่เลือกแล้วและ source preflight ผ่าน |
| Normative documents 38 ฉบับยังไม่ Approved | Document owners / QA / Business / Security / Operations | ตรวจ checklist ด้านล่างและลง decision รายฉบับหรือเป็นชุดที่มีขอบเขตชัดเจน |
| Accepted document baseline missing | Configuration manager | รับหลัง source baseline และ normative approvals เท่านั้น |
| Migration incident disposition | Solution architect / DBA / Data owner | ยืนยันผลกระทบ migration history และบันทึก decision |
| Trigger maintenance environment evidence | DBA / Configuration manager | reconcile REMOTE backup-table claim กับ LOCAL read-only result และบันทึก out-of-band change/rollback evidence |
| Data recovery disposition | Data owner / DBA | หากต้องกู้ ให้ restore backup แบบ side-by-side แล้ว compare/export; ห้าม restore ทับ active database |
| Business UAT sign-off | Business process owners | ใช้ automation เป็น supporting evidence แต่ต้องมี UAT actor/date/decision จริง |
| Artifact release | Document owner / QA | สร้าง DOCX/PDF/PPTX/drawio หลัง approved Markdown baseline แล้วทำ render/visual QA |

## 5. Normative document approval checklist

ช่อง Decision/Approver/Date ต้องกรอกโดยผู้มีอำนาจจริง ห้าม pipeline เติมค่า Approved อัตโนมัติ

| # | Document ID | Controlled path | Current | Decision / Approver / Date |
|---:|---|---|---|---|
| 1 | WF-GOV-003 | `00-GOVERNANCE/GLOSSARY.md` | Review |  |
| 2 | WF-GOV-002 | `00-GOVERNANCE/SOURCE-EVIDENCE-REGISTER.md` | Review |  |
| 3 | WF-BAD-001 | `01-BUSINESS-ANALYSIS/BAD-v8.md` | Review |  |
| 4 | WF-BAD-003 | `01-BUSINESS-ANALYSIS/BUSINESS-RULES.md` | Review |  |
| 5 | WF-BAD-004 | `01-BUSINESS-ANALYSIS/RACI-AND-STAKEHOLDERS.md` | Review |  |
| 6 | WF-BAD-002 | `01-BUSINESS-ANALYSIS/REQUIREMENTS-CATALOG.md` | Review |  |
| 7 | WF-QA-001 | `02-REQUIREMENTS/ACCEPTANCE-CRITERIA.md` | Review |  |
| 8 | WF-REQ-STATE-008 | `02-REQUIREMENTS/CURRENT-SYSTEM-STATE.md` | Review |  |
| 9 | WF-REQ-IMPL-008 | `02-REQUIREMENTS/IMPLEMENTATION-STATUS.md` | Review |  |
| 10 | WF-NFR-008 | `02-REQUIREMENTS/NFR-SLO-DR.md` | Review |  |
| 11 | WF-REQ-010 | `02-REQUIREMENTS/SOURCE-ALIGNMENT.md` | Review |  |
| 12 | WF-SRS-008 | `02-REQUIREMENTS/SRS-v8.md` | Review |  |
| 13 | WF-QA-002 | `02-REQUIREMENTS/TRACEABILITY-MATRIX.md` | Review |  |
| 14 | WF-ADR-001 | `03-SOLUTION-ARCHITECTURE/ADR-001-LAYERED-NONINVASIVE.md` | Review |  |
| 15 | WF-ADR-002 | `03-SOLUTION-ARCHITECTURE/ADR-002-DATABASE-TOPOLOGY.md` | Review |  |
| 16 | WF-ADR-003 | `03-SOLUTION-ARCHITECTURE/ADR-003-WINSPEED-WRITE-BOUNDARY.md` | Review |  |
| 17 | WF-ADR-004 | `03-SOLUTION-ARCHITECTURE/ADR-004-TRUCKSCALE-INTEGRATION.md` | Review |  |
| 18 | WF-ADR-005 | `03-SOLUTION-ARCHITECTURE/ADR-005-REBATE-FIFO.md` | Review |  |
| 19 | WF-SAD-002 | `03-SOLUTION-ARCHITECTURE/C4-ARCHITECTURE.md` | Review |  |
| 20 | WF-SAD-001 | `03-SOLUTION-ARCHITECTURE/SAD-v8.md` | Review |  |
| 21 | WF-INT-004 | `04-DATA-INTEGRATION/API-REFERENCE.md` | Review |  |
| 22 | WF-INT-001 | `04-DATA-INTEGRATION/DATA-DESIGN.md` | Review |  |
| 23 | WF-INT-005 | `04-DATA-INTEGRATION/DATA-QUALITY-AND-MIGRATION.md` | Review |  |
| 24 | WF-INT-003 | `04-DATA-INTEGRATION/TRUCKSCALE-INTEGRATION-CONTRACT.md` | Review |  |
| 25 | WF-INT-002 | `04-DATA-INTEGRATION/WINSPEED-INTEGRATION-CONTRACT.md` | Review |  |
| 26 | WF-OPS-003 | `05-SECURITY-DEVOPS/BACKUP-DR-BCP.md` | Review |  |
| 27 | WF-OPS-001 | `05-SECURITY-DEVOPS/DEPLOYMENT-AND-CI-CD.md` | Review |  |
| 28 | WF-SEC-013 | `05-SECURITY-DEVOPS/DOC-SYNC-PIPELINE.md` | Review |  |
| 29 | WF-OPS-002 | `05-SECURITY-DEVOPS/OBSERVABILITY-INCIDENT-RUNBOOK.md` | Review |  |
| 30 | WF-OPS-004 | `05-SECURITY-DEVOPS/PERFORMANCE-ENGINEERING.md` | Review |  |
| 31 | WF-OPS-005 | `05-SECURITY-DEVOPS/RELEASE-MANAGEMENT.md` | Review |  |
| 32 | WF-SEC-001 | `05-SECURITY-DEVOPS/SECURITY-ARCHITECTURE.md` | Review |  |
| 33 | WF-EVD-001 | `05-UI-SCREENSHOTS/README.md` | Review |  |
| 34 | WF-QA-003 | `06-QUALITY-OPERATIONS/TEST-STRATEGY.md` | Review |  |
| 35 | WF-TRN-008 | `06-QUALITY-OPERATIONS/TRAINING-AND-ADOPTION.md` | Review |  |
| 36 | WF-QA-005 | `06-QUALITY-OPERATIONS/UAT-AND-SIGNOFF.md` | Review |  |
| 37 | WF-PIPE-001 | `pipeline/DOC-CONTROL.md` | Draft |  |
| 38 | WF-PIPE-002 | `pipeline/docgen/README.md` | Draft |  |

## 6. Sign-off record

| Decision scope | Decision | Actor / role | Reason | Date/time | Evidence reference |
|---|---|---|---|---|---|
| Engineering verification reviewed |  |  |  |  |  |
| Migration incident/data recovery disposition |  |  |  |  |  |
| Source baseline acceptance |  |  |  |  |  |
| Normative document approval |  |  |  |  |  |
| Document baseline acceptance |  |  |  |  |  |
| Business UAT sign-off |  |  |  |  |  |
| Production release decision |  |  |  |  |  |

## 7. Required sequence after review

1. Review repository diff and select the exact commit candidate.
2. Close migration incident/data-recovery disposition without mutating the active database unless separately authorized.
3. Re-run Full E2E, audits, build, migration plan, source sync and combined preflight if source or dependency manifests change.
4. Approve normative Markdown with named actors and dates.
5. Accept source baseline first, then document baseline, each with actor and reason.
6. Run strict release-check.
7. Generate DOCX/PDF/PPTX/drawio/PNG from the approved baseline and perform render/visual QA using Kanit or Prompt for Thai text.
8. Complete business UAT sign-off, User Manual, User Guide and Training Resources before production release approval.
