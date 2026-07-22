---
documentId: "WF-ADR-004"
title: "ADR-004 — TruckScale Controlled Pre-Weigh Integration and Matching Policy"
version: "v1.0"
truckScaleWriteTargets: "tbl_keyone"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Approved"
sourceStatusDetail: "Accepted — canonical source selection is a Go-Live gate"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect / Factory IT"
normative: true
---
# ADR-004 — TruckScale Controlled Pre-Weigh Integration and Matching Policy

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-ADR-004` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect / Factory IT |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Context

TruckScale records pre-weigh, completed weighing and product detail, but has Thai string/serial dates, mixed charsets, no enforced FK, inconsistent customer codes and imperfect truck-plate values.

## Decision

1. TruckScale completed-weigh and reference records are read-only; WS-Sale-App may INSERT/DELETE only `tbl_keyone` for the pre-weigh queue lifecycle.
2. Dedicated connection/service has timeout, health and charset handling.
3. Candidate match uses normalized plate as primary; movebill, document/invoice and time window corroborate.
4. Candidate evidence/confidence is visible; ambiguity requires user selection.
5. Selection is copied as immutable reference metadata to `wf.WeighTicket`.
6. Production environment register declares canonical source: local, cloud replica, or managed integration DB.

## Matching policy

| Step | Rule |
|---|---|
| Normalize | trim spaces/punctuation; preserve raw |
| Filter | same normalized plate + date window |
| Rank | completed record > matching movebill > matching source doc > closest time |
| Validate | net>0, gross≥tare, capacity sanity, no duplicate ref |
| Resolve | ambiguous candidate selected by user + audit |
| Fallback | manual entry authorized + reason + later reconcile |

## Non-goal

WS-Sale-App does not control COM ports/hardware or alter completed TruckScale source records; the controlled `tbl_keyone` queue lifecycle is the only write exception.
