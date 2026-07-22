---
documentId: "WF-QA-003"
title: "Test Strategy — Enterprise UAT, Regression and Operational Assurance"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "QA Lead"
normative: true
---
# Test Strategy — Enterprise UAT, Regression and Operational Assurance

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-QA-003` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | QA Lead |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Test levels

| Level | Objective | Owner |
|---|---|---|
| Unit | business-rule correctness | Developer |
| Integration | SQL/TruckScale/WINSpeed contract | Dev + QA |
| System | end-to-end behavior | QA |
| UAT | business acceptance | process owners |
| Regression | prevent recurrence | QA |
| Security | auth/RBAC/secret/dependency | IT/Security |
| Performance | SLO/historical data behavior | Tech/DBA |
| DR | backup/restore/fallback proof | IT/QA |

## Test data

Use synthetic/masked data in DEV/UAT where possible. Include duplicate plate, ambiguous weights, zero/negative/outlier weight, plan overlap, over-budget giveaway, partial control-ticket draw, stale token, denied role and dependency timeout.

## Risk priority

| Priority | Focus |
|---|---|
| P0 | security, financial boundary, SO state, ship/weigh, rebate/CN, backup |
| P1 | paper trail, reports, approval policy, master changes |
| P2 | layout, convenience, non-critical exports |

## Exit criteria

100% P0/critical pass; no Sev-1/Sev-2 open; UAT evidence signed; reconciliation sample passed; security P0 complete; restore test current.
