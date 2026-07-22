---
documentId: "WF-OPS-006"
title: "User Guide — Role-Based Operational Manual"
version: "v8.0"
status: Superseded
statusDetail: "Superseded by WF-QA-012; latest document wins"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: superseded-by-latest
supersededBy: "WF-QA-012"
mergedAt: "2026-07-21"
owner: "Training Lead / Process Owner"
normative: true
---
# User Guide — Role-Based Operational Manual

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-OPS-006` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v8.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Training Lead / Process Owner |
| Status | Superseded — latest document wins |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Superseded — 21 July 2026:** เอกสาร v8.0 นี้ถูกแทนที่ตามนโยบาย `latest-document-wins`; ให้ใช้ [WF-QA-012](./USER-GUIDE-DETAIL.md) เป็นเอกสารหลัก.


---

## Before using

- confirm correct environment; production must be visibly marked
- use personal account only
- check TruckScale status when applicable
- do not bypass verification/manual weighing/approval; use exception workflow

## SALES — Create SO

1. open Sales Order
2. select customer and verify delivery/truck
3. add goods, tonnage, price and notes
4. set mother/baby/load sequence
5. review rebate preview/giveaway request
6. save `DRAFT`
7. coordinate Counter Sales verification

## COUNTER_SALES — Verify/confirm

1. open draft queue
2. check customer/formula/quantity/plate/date/sequence/ticket/notes
3. click Verify and correct issue in draft flow
4. confirm only after verify; bypass needs authority/reason
5. print/generate paper copies per SOP

## WAREHOUSE — Picking/load

1. open confirmed queue
2. start picking
3. follow sequence
4. do not change commercial line directly
5. request unlock if correction is needed

## WEIGHBRIDGE — Weigh/ship

1. open picking SO
2. select TruckScale candidate by plate/movebill and verify evidence
3. check tare/gross/net/time/scale
4. manual fallback only with authorization/reason
5. ship only when evidence complete
6. process paper copy per SOP

## SALES/ACCOUNTING — Rebate

1. confirm active plan/pool
2. create eligible claim
3. review FIFO/return type
4. submit/approve
5. record actual WINSpeed CN and close reconcile

## ADMIN

Maintain named user/role, controlled price/policy, release health/version. Never use direct DB edit as a routine correction.

## Quick troubleshooting

| Symptom | First action |
|---|---|
| cannot confirm | verify gate/state/role/required fields |
| TruckScale unavailable | check banner; authorized fallback |
| multiple records | compare plate/time/movebill; document decision |
| rebate unexpected | inspect price snapshot/plan/ledger |
| cannot edit | request unlock |
| paper missing | scan/report lost |
| invoice/CN mismatch | reconciliation case + Accounting/IT |
