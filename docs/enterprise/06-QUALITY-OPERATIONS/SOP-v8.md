---
documentId: "WF-OPS-008"
title: "Standard Operating Procedures — v7"
version: "v8.0"
status: Superseded
statusDetail: "Superseded by WF-QA-013; latest document wins"
sourceVersion: "v8.0"
sourceStatus: "Approved"
sourceStatusDetail: "Controlled SOP Baseline"
mergePolicy: latest-document-wins
mergeDisposition: superseded-by-latest
supersededBy: "WF-QA-013"
mergedAt: "2026-07-21"
owner: "Sales / Factory / IT"
normative: true
---
# Standard Operating Procedures — v7

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-OPS-008` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v8.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Sales / Factory / IT |
| Status | Superseded — latest document wins |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Superseded — 21 July 2026:** เอกสาร v8.0 นี้ถูกแทนที่ตามนโยบาย `latest-document-wins`; ให้ใช้ [WF-QA-013](./SOP-DETAIL.md) เป็นเอกสารหลัก.


---

## SOP-01 — SO Lifecycle

Sales creates DRAFT → Counter verifies → authorized user confirms → Warehouse picks/follows sequence → Weighbridge attaches evidence/ships → WINSpeed financial process posts → reconciliation resolves exception.

**Controls:** state validation, Verification Gate, audit, no historical direct mutation.

## SOP-02 — Rebate

Manager creates/activates plan and allocation → eligible confirm creates accrual → Sales claims → Accounting validates/approves and records WINSpeed CN → periodic reconcile.

**Controls:** FIFO, effective NET snapshot, no hard delete.

## SOP-03 — Weigh-Out/Shipping

Valid warehouse state → search TruckScale by plate/movebill → select verified candidate or authorized manual fallback → validate → persist ticket → ship → reconcile fallback.

**Controls:** TruckScale read-only; source reference immutable.

## SOP-04 — Paper Trail

Generate 4-color copies → hand over by custody design → scan custody/status → review lost/aged daily → escalate/resolve.

## SOP-05 — Unlock

Request with policy reason → Approver review → approve/reject → approved action creates compensation/reversal → reverify/reconfirm if needed.

## SOP-06 — Price/Master

Request change → review price/rebate effect → approve/activate effective period → audit/version. Never overwrite historical confirmed snapshot.

## SOP-07 — Release/DB

CR → migration test → backup → immutable deploy → health/smoke/reconcile → monitor → release record/rollback if needed.

## SOP-08 — Access

approved role request → named account/map → periodic review → disable on exit/change → audit privileges.
