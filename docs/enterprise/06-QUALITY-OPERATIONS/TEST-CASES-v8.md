---
documentId: "WF-QA-004"
title: "Test Cases v7 — Critical Journeys and Regression Baseline"
version: "v8.0"
status: Superseded
statusDetail: "Superseded by WF-QA-010; latest document wins"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: superseded-by-latest
supersededBy: "WF-QA-010"
mergedAt: "2026-07-21"
owner: "QA Lead"
normative: true
---
# Test Cases v7 — Critical Journeys and Regression Baseline

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-QA-004` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v8.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | QA Lead |
| Status | Superseded — latest document wins |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Superseded — 21 July 2026:** เอกสาร v8.0 นี้ถูกแทนที่ตามนโยบาย `latest-document-wins`; ให้ใช้ [WF-QA-010](./TEST-CASES-DETAIL.md) เป็นเอกสารหลัก.


---

## A. Authentication and RBAC

| ID | Scenario | Expected result |
|---|---|---|
| TC-AUTH-01 | valid login | session/token, correct role access |
| TC-AUTH-02 | invalid login | generic deny; audit/rate-limit; no data leak |
| TC-AUTH-03 | role deny | 403 and audit |
| TC-AUTH-04 | expired session | re-auth/refresh policy |
| TC-AUTH-05 | disabled user | immediate deny |
| TC-AUTH-06 | privilege removed | backend permission revoked |

## B. SO and Verification

| ID | Scenario | Expected result |
|---|---|---|
| TC-SO-01 | create valid DRAFT | ref, audit, lines saved |
| TC-SO-02 | missing mandatory field | validation; no partial SO |
| TC-SO-03 | rebate preview | correct active price/plan preview |
| TC-SO-04 | mother/baby sequence | persisted/printed/queued |
| TC-VER-01 | confirm unverified | blocked |
| TC-VER-02 | verify then confirm | actor/time recorded and confirm succeeds |
| TC-VER-03 | authorized bypass | only with policy/reason/audit |
| TC-SO-05 | confirm duplicate retry | no duplicate accrual/external op |
| TC-SO-06 | illegal state update | 409/no mutation |

## C. Warehouse, Weigh and Ship

| ID | Scenario | Expected result |
|---|---|---|
| TC-WH-01 | start picking | correct state and audit |
| TC-WH-02 | edit during picking | blocked unless unlock |
| TC-TS-01 | TruckScale health | state/latency with no secrets |
| TC-TS-02 | plate lookup | candidates and evidence |
| TC-TS-03 | movebill lookup | correct record/detail |
| TC-TS-04 | ambiguous candidate | human selection/reason audit |
| TC-TS-05 | manual fallback | role/reason/reconciliation case |
| TC-TS-06 | invalid values | gross<tare/net mismatch/outlier blocked |
| TC-WH-03 | ship | immutable ticket and `SHIPPED` |
| TC-WH-04 | duplicate ship | idempotent/blocked |

## D. Paper Trail and Unlock

| ID | Scenario | Expected result |
|---|---|---|
| TC-PAPER-01 | generate 4 copies | colors + unique QR |
| TC-PAPER-02 | scan custody | append-only history/state |
| TC-PAPER-03 | lost/aging | exception visible |
| TC-UNL-01 | short reason | blocked |
| TC-UNL-02 | pending request | one/SO |
| TC-UNL-03 | approve | compensation/reversal, not delete |
| TC-UNL-04 | reject | SO unchanged/audit |

## E. Rebate, Price, Giveaway and Ticket

| ID | Scenario | Expected result |
|---|---|---|
| TC-RB-01 | active plan | approved/versioned |
| TC-RB-02 | confirm eligible SO | correct ledger plan/pool/amount |
| TC-RB-03 | overlap | policy priority applies |
| TC-RB-04 | FIFO claim | oldest eligible consumed |
| TC-RB-05 | overclaim | blocked |
| TC-RB-06 | claim/CN | CN evidence/reconcile |
| TC-PRICE-01 | new-month clone | correct version/effective approval |
| TC-GW-01 | issue giveaway | budget/SO link |
| TC-GW-02 | overbudget | warning/policy/audit |
| TC-CT-01 | ticket balance | total-draw correct |
| TC-CT-02 | partial draw | drill-down |
| TC-CT-03 | overdraw | blocked/approved exception |

## F. Integration, Security and Operations

| ID | Scenario | Expected result |
|---|---|---|
| TC-REC-01 | WINSpeed timeout | pending/retry/reconcile, no duplicate |
| TC-REC-02 | invoice/CN mismatch | exception owner/state |
| TC-SEC-01 | secret scan | no real secret source/artifact |
| TC-SEC-02 | least privilege | prohibited DB action denied |
| TC-OPS-01 | backup restore | target met |
| TC-OPS-02 | deploy rollback | previous artifact safe |
| TC-OPS-03 | alert simulation | correct channel/owner |
| TC-PERF-01 | control ticket query | target + correct output |
| TC-ENV-01 | environment context | no cross contamination |
