---
documentId: "WF-ADR-003"
title: "ADR-003 — WINSpeed Write Boundary and Financial Safety"
version: "v1.0"
truckScaleWriteTargets: "tbl_keyone"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Approved"
sourceStatusDetail: "Approved Target Architecture — legacy exceptions require signed risk acceptance"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect / Accounting / DBA"
normative: true
---
# ADR-003 — WINSpeed Write Boundary and Financial Safety

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-ADR-003` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect / Accounting / DBA |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Problem

Existing implementation evidence includes direct writes to selected WINSpeed objects for SO/picking/ship/price. The target production safety model requires WINSpeed to own invoice/CN/GL and its posting/import process.

## Decision

### Immutable financial boundary

WS-Sale-App MUST NOT directly insert/update:
- `SOInvHD`, `SOInvDT`
- `GLHD`, `GLDT`
- other financial-posting objects not explicitly approved by WINSpeed DBA and Accounting

### Approved write paths

| Use case | Preferred path | Temporary fallback | Required controls |
|---|---|---|---|
| Create/Update SO 104 | WINSpeed import or approved stored procedure | legacy direct write only with signed exception | idempotency, transaction, audit, dual-run |
| Picking status | approved interface/SP | signed direct-update exception | audit/state validation |
| Ship/export state | controlled interface/import | signed direct-update exception | weigh evidence/reconcile |
| Price Book | approved maintenance contract | direct `EMSetPrice*` under policy | dual approval/effective date/audit |
| Invoice/CN/GL | WINSpeed UI/import/post | none | Accounting owns posting |

### Legacy exception exit plan

1. Inventory direct writes.
2. Risk-classify by object/consumer.
3. Create import/SP contract.
4. Dual-run/reconcile 2–4 weeks.
5. Disable direct write via feature flag.
6. Retain evidence.

## Go-Live criterion

No production release uses undocumented direct `dbo` write. A temporary exception lists object, columns, role, approver, expiry, rollback and reconciliation query.
