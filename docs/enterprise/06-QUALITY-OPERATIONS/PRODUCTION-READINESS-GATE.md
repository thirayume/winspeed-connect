---
documentId: "WF-QA-008"
title: "Production Readiness Gate — Full Production Approval"
version: "v8.0"
status: Superseded
statusDetail: "Superseded by WF-QA-014; latest document wins"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: superseded-by-latest
supersededBy: "WF-QA-014"
mergedAt: "2026-07-21"
owner: "Solution Architect / IT / Business Sponsor"
normative: true
---
# Production Readiness Gate — Full Production Approval

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-QA-008` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v8.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect / IT / Business Sponsor |
| Status | Superseded — latest document wins |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Superseded — 21 July 2026:** เอกสาร v8.0 นี้ถูกแทนที่ตามนโยบาย `latest-document-wins`; ให้ใช้ [WF-QA-014](./PRODUCTION-READINESS-DETAIL.md) เป็นเอกสารหลัก.


---

## Verdict model

Pilot/Soft Launch is allowed only with passing critical workflow and named residual risks. Full Production requires every P0 closed.

## P0 — mandatory

| ID | Gate | Evidence |
|---|---|---|
| P0-01 | secrets rotated | checklist/scan/health |
| P0-02 | least privilege DB users | grants review/deny proof |
| P0-03 | WINSpeed boundary approved | ADR-003 sign-off/direct-write inventory |
| P0-04 | dual-run/reconcile | Accounting approved report |
| P0-05 | backup/restore | actual RTO/RPO report |
| P0-06 | monitoring/alert | dashboard/test alert |
| P0-07 | critical UAT | signed test log |
| P0-08 | TruckScale canonical source | environment register/connectivity/fallback |
| P0-09 | incident/on-call ownership | contact matrix/tabletop |
| P0-10 | version/release trace | artifact/migration/release approval |

## P1 — Pilot/scale-out

central log, approval configuration, automated tests, data masking, period-end reconciliation, giveaway physical count, capacity test.

## Go/No-Go output

| Item | Result |
|---|---|
| P0 | |
| P1 risk acceptance | |
| UAT score | |
| Accounting reconciliation | |
| DR proof date | |
| Decision | GO / CONDITIONAL GO / NO-GO |
| Approvers | |
