---
documentId: "WF-SAD-002"
title: "C4 Architecture Views"
version: "v1.0"
truckScaleWriteTargets: "tbl_keyone"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect"
normative: true
---
# C4 Architecture Views

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-SAD-002` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Level 1 — System Context

```mermaid
flowchart LR
  Sales[Sales / Counter / Warehouse / Accounting] --> App[WS-Sale-App]
  App --> WS[Prosoft WINSpeed v9.0]
  App --> TS[TruckScale]
  App --> Print[Browser / Printer / QR Scanner]
  IT[IT / DBA / DevOps] --> App
```

## Level 2 — Containers

```mermaid
flowchart TB
  B[Browser / React SPA] --> API[Express API]
  API --> DB[(SQL Server wf)]
  API --> WSD[(SQL Server dbo)]
  API --> TSD[(MySQL TruckScale)]
  API --> LOG[Telemetry / Logs / Alerting]
  API --> OBJ[Protected document storage]
```

## Level 3 — Backend components

| Component | Responsibility | Boundary |
|---|---|---|
| Auth middleware | token/RBAC/context | protected endpoints |
| Sales service | lifecycle, verification, audit | wf + controlled contract |
| Rebate service | plan/pool/ledger/FIFO/claim | wf |
| Weigh service | lookup/normalize/ticket persistence | TruckScale read + wf |
| Paper service | copies/QR/scans/custody | wf/storage |
| Integration service | outbox/import/reconcile/idempotency | WINSpeed + wf |
| Reporting service | read models/export | views/read models |
| Admin service | users/roles/policy/master | wf/contracts |
| Health/telemetry | dependency status/error metrics | runtime |

## Level 4 — Code constraints

- routes must not hold financial/business rules that belong in services
- every mutable workflow emits audit event through shared service
- parameterized SQL only
- cross-database calls require timeout and explicit contract
- write operations support idempotency where retry can duplicate outcome
