---
documentId: "WF-OPS-004"
title: "Performance Engineering and SQL Query Controls"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Tech Lead / DBA"
normative: true
---
# Performance Engineering and SQL Query Controls

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-OPS-004` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Tech Lead / DBA |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Principle

Operational screens use purpose-built views/read models; they must not run unbounded scans across legacy history on every interaction.

## Risk patterns

| Pattern | Risk | Control |
|---|---|---|
| correlated subquery | N× query | pre-aggregate/join once |
| OR join path | poor index use | split/union/deduplicate |
| unbounded Kanban | memory/UI freeze | pagination/limit/virtualization |
| broad search | table scan | selective indexes/windows |
| cross-DB per row | network amplification | batch/candidate query |
| no timeout | starvation | timeout/circuit breaker |

## Required controls

- indexes for high-volume document type/status/date/ticket/plate access
- pagination/`TOP` for UI lists
- export/report jobs separate from interactive paths
- performance budget/plan review for historical query
- parameterized SQL; use `NOLOCK` only under documented consistency decision
- slow query telemetry with endpoint/correlation/database target

## Test scenarios

1. control-ticket remaining at history scale
2. Paper Trail board high volume
3. Thai master lookup
4. rebate ledger drill-down
5. TruckScale plate lookup
6. concurrent dashboard polling
7. large report export

## Acceptance

Optimization is accepted only after output reconciles with reference result, including duplicate/dedup semantics.
