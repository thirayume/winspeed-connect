---
documentId: "WF-CHG-008"
title: "Changelog — Documentation v8.0"
version: "v8.0"
status: Superseded
statusDetail: "Superseded by WF-REL-001; latest document wins"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: superseded-by-latest
supersededBy: "WF-REL-001"
mergedAt: "2026-07-21"
owner: "Solution Architect"
normative: false
---
# Changelog — Documentation v8.0

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-CHG-008` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v8.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect |
| Status | Superseded — latest document wins |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Superseded — 21 July 2026:** เอกสาร v8.0 นี้ถูกแทนที่ตามนโยบาย `latest-document-wins`; ให้ใช้ [WF-REL-001](./08-APPENDICES/CHANGELOG-APP.md) เป็นเอกสารหลัก.


---

## v8.0 — 1 July 2026 (UAT Demo Baseline · build v4.2.24)

ทุก backlog P0 + P1 + P2 จาก v7 implement + deploy ครบ และเพิ่มการเชื่อม TruckScale แบบดึงกลับ

### Added (ตรงกับโค้ด build v4.2.24, migration 001–029)
- **P0:** Reconciliation Workbench (FR-027), Observability + alerting (FR-030), Migration ledger (FR-031)
- **P1:** Approval policy engine (FR-028), Integration outbox (FR-029), Price Book workflow (FR-023), TruckScale candidate ranking (FR-025)
- **P2:** Credit Hold (FR-003), PDPA retention/DSAR (FR-032), Operational stock (DG-04), LINE intake/notify scaffold (FR-016)
- **TruckScale pull-back:** Weigh Inbox + sync worker (s_id watermark + refresh OPEN) + SO auto-match + push ingest API
- เอกสารใหม่ `CURRENT-SYSTEM-STATE.md` (modules/data dictionary/API) · `IMPLEMENTATION-STATUS.md` (FR↔build)

### Changed
- Roadmap (Thai localization) แยกออกจากชุดหลัก → `_ROADMAP/` (markdown + docx/pptx แยก)
- docx render เป็น house-style แบรนด์ World Fert (cover/TOC/header-footer/ตารางสี)

### Note
- สถานะ: ✅ P0+P1+P2 ครบ · 🟡 LINE = scaffold (รอตั้ง channel จริง) · DG-04 ยัง open decision

## v8.0 baseline (carried from v7) — 28 June 2026

### Added
- BAD, requirements catalog, business rules and RACI
- enterprise SRS with critical journey acceptance
- C4 views and ADRs
- explicit WINSpeed write-boundary decision
- TruckScale source/matching/data-quality contract
- data ownership/reconciliation/API contract
- hardening/CI-CD/monitoring/DR/release controls
- test/UAT/SOP/training/production gate
- commercial product/proposal/implementation templates
- consolidated v6→v7 risk register

### Changed
- repositions WS-Sale-App as Sales Execution & Control Layer
- separates legacy observed behavior from target production architecture
- introduces reconciliation/environment controls

## v8.0.1 — 28 June 2026 (addendum)

### Added
- `02-REQUIREMENTS/IMPLEMENTATION-STATUS.md` — FR→build status (v4.2.18) + prioritized feature-gap backlog (living document)
- `08-APPENDICES/THAI-LOCALIZATION-ROADMAP.md` — Thai accounting/RD/e-Tax + Thai business org localization roadmap (future scope, not implemented)

### Note
- IMPLEMENTATION-STATUS maps which SRS-v7 FRs are Implemented / Partial / Planned against code baseline build v4.2.18 to drive the next implementation phase
- THAI-LOCALIZATION-ROADMAP enables future commercial sale to other Thai businesses (documentation only)

### Compatibility
v7 is compatible with v6 functional scope/evidence but does not claim P0 production gaps are closed.
