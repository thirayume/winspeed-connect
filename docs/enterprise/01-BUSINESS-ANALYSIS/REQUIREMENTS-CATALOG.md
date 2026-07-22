---
documentId: "WF-BAD-002"
title: "Requirement Catalog และ Product Backlog"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Product Owner / BA"
normative: true
---
# Requirement Catalog และ Product Backlog

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-BAD-002` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Product Owner / BA |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Priority

- **MUST**: ขาดไม่ได้สำหรับ commercial production baseline
- **SHOULD**: ต้องมีใน release ที่กำหนดหรือมี approved workaround
- **COULD**: เพิ่มมูลค่า ไม่ block Go-Live
- **DECISION**: ต้องยืนยันก่อนเปิดใช้

| ID | Capability | Priority | Source | Release |
|---|---|---:|---|---|
| FR-001 | SO lifecycle/state machine | MUST | workflow | Baseline |
| FR-002 | SO create/edit/validation/rebate preview | MUST | order forms | Baseline |
| FR-003 | Credit Hold | DECISION | Sales/Accounting | Phase 1B |
| FR-004 | 4-color documents + QR | MUST | factory flow | Baseline |
| FR-005 | Quotation lifecycle | SHOULD | existing map | Baseline |
| FR-006/007 | Unlock request/approval/reversal | MUST | pain point | Baseline |
| FR-008/009 | Rebate Plan/allocation | MUST | promotion approvals | Baseline |
| FR-010/011 | Accrual/FIFO/claim/CN evidence | MUST | rebate document | Baseline |
| FR-012/013 | Paper copy/scan/lost control | MUST/SHOULD | paper flow | Baseline |
| FR-014 | Read master from WINSpeed | MUST | DB analysis | Baseline |
| FR-015 | Controlled WINSpeed integration | MUST | financial boundary | DG-01 |
| FR-016 | LINE intake | COULD | sales intake | Phase 2 |
| FR-017 | Dashboard/reports/export | MUST | management | Baseline |
| FR-018 | RBAC/auth/audit | MUST | security | Baseline |
| FR-019 | Mother/baby sequencing | MUST | factory pain | Baseline |
| FR-020 | Giveaway budget/stock | MUST | business request | Baseline |
| FR-021 | Control ticket balance/report | MUST | business request | Baseline |
| FR-022 | Counter Sales Verification | MUST | business request | Baseline |
| FR-023 | Monthly NET Price Book | MUST | price sheets | Baseline |
| FR-024-026 | TruckScale health/lookup/weigh ticket | MUST | TruckScale analysis | Baseline |
| FR-027 | Reconciliation workbench | MUST | production safety | v7 uplift |
| FR-028 | Approval policy engine | SHOULD | governance | v7 uplift |
| FR-029 | Integration outbox/event log | SHOULD | reliability | v7 uplift |
| FR-030 | Observability/alerts | MUST | readiness | v7 uplift |
| FR-031 | Controlled migration/release | MUST | readiness | v7 uplift |
| FR-032 | Data retention/DSAR | SHOULD | PDPA | v7 uplift |

## Requirement attributes

ทุก requirement ต้องมี: ID, business objective, priority, roles, preconditions, main/exception flow, data/API impact, security class, acceptance criteria, test IDs, KPI และ compensation/rollback behavior

## Delivery waves

| Wave | Goal | Requirement group |
|---|---|---|
| 0 | Stabilise | FR-018, 027, 030, 031 |
| 1 | Operational core | FR-001,002,004,006,007,012,019,022,024-026 |
| 2 | Commercial control | FR-008-011,020,021,023 |
| 3 | Decision features | FR-003,016,028,032 |
