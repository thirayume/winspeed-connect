---
documentId: "WF-ADR-001"
title: "ADR-001 — Layered Non-Invasive Integration"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Approved"
sourceStatusDetail: "Accepted — v7 Architecture Principle"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect"
normative: true
---
# ADR-001 — Layered Non-Invasive Integration

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-ADR-001` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Context

WINSpeed is business-critical and owns historical master, finance and GL. Replacement creates unacceptable operating/accounting risk.

## Decision

WS-Sale-App operates as operational extension:
- workflow/audit/rebate/paper/weigh data in `wf`
- WINSpeed `dbo` through approved read contracts
- external writes under ADR-003
- fallback remains available through WINSpeed/manual procedure

## Consequences

**Positive:** lower replacement risk, direct data visibility where permitted, faster operational improvements.

**Negative:** contracts/reconciliation mandatory; legacy data quality remains visible; raw table access is not a design substitute.

## Guardrails

- no schema modification to WINSpeed
- no direct GL/invoice/CN posting
- coexistence/reconciliation test at release gate
