---
documentId: "WF-ADR-005"
title: "ADR-005 — Rebate Ledger, FIFO and Compensation Model"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Approved"
sourceStatusDetail: "Accepted"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect / Accounting / Sales"
normative: true
---
# ADR-005 — Rebate Ledger, FIFO and Compensation Model

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-ADR-005` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect / Accounting / Sales |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Decision

Rebate is represented as immutable ledger events, not one mutable aggregate balance.

- confirmed eligible SO line creates accrual using effective plan/NET snapshot
- pool is controlled aggregation, not sole source of truth
- claim consumes eligible accrual FIFO
- unlock/reversal creates compensating event/flag, never deletion
- claim approval links actual WINSpeed CN evidence
- price-difference return and sales rebate are distinct types

## Benefits

Every claimed amount can trace to SO line, plan, price and date. This supports audit and prevents unexplained remaining-pool behavior.
