---
documentId: "WF-SAL-002"
title: "Implementation Plan and Delivery Model"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Project Manager / Solution Architect"
normative: false
---
# Implementation Plan and Delivery Model

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-SAL-002` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Project Manager / Solution Architect |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Phase model

| Phase | Objective | Deliverables | Exit |
|---|---|---|---|
| 0. Discovery/decisions | verify source/process/policy | BAD validation, access, profiling, DG decisions | signed scope |
| 1. Foundation/hardening | secure/operable platform | env, RBAC, audit, CI/CD, monitoring | P0 technical gate |
| 2. Sales execution | SO/verify/paper/load | core workflow + UAT | journey pass |
| 3. Commercial control | Price/Plan/FIFO/claim/giveaway/ticket | modules + Accounting UAT | reconcile pass |
| 4. Weigh/integration | TruckScale + ship/reconcile | contract/fallback | weigh acceptance |
| 5. Pilot/full production | controlled rollout | training, hypercare, Go-Live pack | sign-off |
| 6. Improve | later backlog | agreed releases | governance cadence |

## Governance cadence

- daily build/QA during active delivery
- weekly business/technical steering
- weekly risk/decision register
- UAT checkpoint per module
- Go/No-Go before Pilot and Full Production

## Client responsibilities

Nominate owners, provide controlled access, confirm approval/price/rebate policy, provide UAT users/evidence, own WINSpeed posting/accounting decisions, and support factory/TruckScale networking.

## Supplier responsibilities

Deliver contracted scope/documentation, maintain secure engineering/release process, provide test evidence/training, disclose assumptions/risks, and support pilot/hypercare under commercial terms.
