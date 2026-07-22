---
documentId: "WF-ADR-002"
title: "ADR-002 — Three-Database Topology and Environment Control"
version: "v1.0"
truckScaleWriteTargets: "tbl_keyone"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Approved"
sourceStatusDetail: "Accepted — subject to environment register verification"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect / DBA"
normative: true
---
# ADR-002 — Three-Database Topology and Environment Control

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-ADR-002` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect / DBA |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Context

The solution uses SQL Server WINSpeed `dbo`, SQL Server `wf` schema, and TruckScale MySQL. Evidence shows `wf`/`dbo` share SQL Server while TruckScale is logically separate.

## Decision

- `wf` is write-owned operational schema
- `dbo` is legacy/external schema controlled by ADR-003
- TruckScale uses a dedicated service/pool: completed-weigh/reference tables are read-only and pre-weigh queue writes are restricted to `tbl_keyone`
- environment selection propagates through explicit request context
- production environment register names host, DB, runtime identity, owner, backup policy and data class for each source

## Consequences

No cross-engine join is assumed at runtime. Cross-source correlation is resolved through application/service logic or an approved read model.
