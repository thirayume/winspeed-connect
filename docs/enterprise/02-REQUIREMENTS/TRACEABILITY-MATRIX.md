---
documentId: "WF-QA-002"
title: "Requirements Traceability Matrix (RTM)"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "BA / QA Lead"
normative: true
---
# Requirements Traceability Matrix (RTM)

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-QA-002` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | BA / QA Lead |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

| Requirement | Business need | Design/contract | Test group | Operational evidence |
|---|---|---|---|---|
| FR-001 | control SO changes | state/audit | TC-SO, TC-VER, TC-UNL | SalesOrderAudit |
| FR-002 | accurate ordering | POS/API | TC-SO | creation metric |
| FR-004/012/013 | prevent paper loss | paper/QR | TC-PAPER | PaperCopy/PaperScan |
| FR-006/007 | controlled correction | unlock/compensation | TC-UNL | UnlockRequest/audit |
| FR-008-011 | traceable rebate | plan/pool/ledger/claim | TC-RB | ledger/CN reconcile |
| FR-019 | correct loading | load sequence | TC-WH | pick/load audit |
| FR-020 | giveaway control | budget/withdrawal | TC-GW | overrun report |
| FR-021 | ticket visibility | ticket contract | TC-CT | balance drill-down |
| FR-022 | counter check | verification | TC-VER | VerifiedBy/At |
| FR-023 | NET price accuracy | price version | TC-PRICE | snapshot/audit |
| FR-024-026 | safe weigh/ship | TruckScale/WeighTicket | TC-TS | source match |
| FR-027 | external reconciliation | case/workbench | TC-REC | exception queue |
| FR-018/030/031 | secure operation | security/release | TC-SEC/OPS | access/release logs |

## Test ID convention

`TC-AUTH`, `TC-SO`, `TC-VER`, `TC-WH`, `TC-TS`, `TC-RB`, `TC-CT`, `TC-GW`, `TC-PAPER`, `TC-REC`, `TC-SEC`, `TC-OPS`
