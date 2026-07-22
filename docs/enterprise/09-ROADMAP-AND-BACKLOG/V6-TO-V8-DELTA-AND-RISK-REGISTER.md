---
documentId: "WF-APP-001"
title: "v6 → v7 Delta, Risk Register and Finalisation Notes"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect"
normative: false
---
# v6 → v7 Delta, Risk Register and Finalisation Notes

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-APP-001` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## v7 uplift

| v6 strength | v7 uplift |
|---|---|
| SRS/UI/workflow | BAD → SRS → Architecture → Operations lifecycle |
| DB overview/Pages-SQL Map | ownership, contracts and write-boundary governance |
| Test/forms | risk-based test strategy, DoD, RTM |
| Docker/security/readiness | CI/CD, observability, DR/BCP, release |
| TruckScale integration | canonical-source, normalization/matching/fallback |
| feature documents | commercial enablement/implementation plan |

## Consolidated risk register

| Risk ID | Risk | Severity | Mitigation | Gate |
|---|---|---:|---|---|
| R-001 | credential exposure/default secret | Critical | rotate/secret store/scan | P0 |
| R-002 | dbo writes affect WINSpeed | Critical | ADR-003/dual-run/reconcile | P0 |
| R-003 | TruckScale source ambiguity | High | environment register/contract | P0 |
| R-004 | backup restore unproven | Critical | DR test | P0 |
| R-005 | monitoring insufficient | High | telemetry/alert proof | P0 |
| R-006 | plate/date/customer mismatch | High | normalize + human resolution | P1 |
| R-007 | credit source unavailable | Medium | decision gate | Decision |
| R-008 | physical giveaway mismatch | Medium | periodic count | P1 |
| R-009 | legacy performance scale | High | indexed view/page/perf test | P1 |
| R-010 | adoption/bypass | High | training/hypercare/audit | P1 |

## Finalisation

v8.0 is final as documentation baseline. It intentionally exposes unresolved production gates. Closing a gate creates new evidence/release notes, not a rewrite of the entire package.
