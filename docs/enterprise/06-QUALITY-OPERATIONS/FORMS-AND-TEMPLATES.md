---
documentId: "WF-QA-006"
title: "Forms and Templates — Quality and Operations"
version: "v8.0"
status: Superseded
statusDetail: "Superseded by WF-QA-015; latest document wins"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: superseded-by-latest
supersededBy: "WF-QA-015"
mergedAt: "2026-07-21"
owner: "QMR / QA Lead"
normative: true
---
# Forms and Templates — Quality and Operations

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-QA-006` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v8.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | QMR / QA Lead |
| Status | Superseded — latest document wins |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Superseded — 21 July 2026:** เอกสาร v8.0 นี้ถูกแทนที่ตามนโยบาย `latest-document-wins`; ให้ใช้ [WF-QA-015](./FORMS-DETAIL.md) เป็นเอกสารหลัก.


---

## FM-01 — Test Execution Log

| Field | Value |
|---|---|
| System/version | |
| Environment/data source | |
| Cycle | UAT / Regression / Smoke / Performance |
| Tester/reviewer | |
| Evidence location | |

| TC ID | Module | Result | Evidence/Correlation ID | Defect/note | Tester/date |
|---|---|---|---|---|---|
| | | PASS / FAIL / BLOCKED / SKIPPED | | | |

## FM-02 — UAT Sign-off

| Field | Value |
|---|---|
| Scope/version | |
| Critical passed/total | |
| Open P0/P1/P2 | |
| Reconciliation result | |
| Decision | Accept / Conditional / Reject |
| Conditions/owners | |

| Role | Name | Signature/approval ref | Date |
|---|---|---|---|
| Sales | | | |
| Factory | | | |
| Accounting | | | |
| IT/Developer | | | |
| Executive | | | |

## FM-03 — Change Request

CR number, requestor/date, type, business reason, requirement/ADR, data/API/security impact, risk class, test/rollback, approval.

## FM-04 — Reconciliation Case

Case ID, source entity/ref, correlation/idempotency, expected/actual, dependency, severity/owner, resolution/approval.

## FM-05 — Manual Weigh Exception

SO/plate, reason, tare/gross/net/scale, operator/supervisor, later source reconcile, evidence.

## FM-06 — Release Approval

Release/tag, changes, migration checksum, backup, test/UAT, security scan, rollback, Go/No-Go decision.
