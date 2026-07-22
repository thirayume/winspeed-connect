---
documentId: "WF-BAD-004"
title: "Stakeholder Map, RACI และ Approval Authority"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Project Sponsor / BA"
normative: true
---
# Stakeholder Map, RACI และ Approval Authority

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-BAD-004` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Project Sponsor / BA |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Roles

| Role | Responsibility |
|---|---|
| SALES | สร้าง SO, rebate/claim, request unlock |
| COUNTER_SALES | verify SO, print/control documents |
| WAREHOUSE | picking/load sequence |
| WEIGHBRIDGE | weight/source validation/ship |
| APPROVER | unlock/exception/plan approval |
| ACCOUNTING | claim/CN/reconciliation |
| ADMIN | users/master/configuration |
| MANAGER | plan/budget/report policy |
| IT/DBA | infrastructure/security/backup |
| EXECUTIVE | scope, high-risk change, go-live |

## RACI

| Activity | Sales | Counter | Warehouse | Weigh | Accounting | Admin/IT | Manager | Exec |
|---|---|---|---|---|---|---|---|---|
| Create SO | R | A/C | I | I | I | I | I | I |
| Verify SO | C | A/R | I | I | I | I | I | I |
| Confirm/exception | R | C | I | I | C | I | A | I |
| Pick/load | I | C | A/R | C | I | I | I | I |
| Weigh/ship | I | I | C | A/R | I | I | I | I |
| Rebate Plan | C | I | I | I | C | I | A/R | I |
| Claim/CN | R | I | I | I | A/R | I | C | I |
| Security/backup | I | I | I | I | I | A/R | C | I |
| Go-live | I | C | C | C | C | C | R | A |

R=Responsible; A=Accountable; C=Consulted; I=Informed

## Approval baseline

| Scenario | Required approval |
|---|---|
| Unlock after Picking | authorized Approver |
| Sell above set price | named authority by policy |
| Sell below allowed threshold | authorized manager matrix |
| Price activation | Manager + Accounting review |
| Rebate plan activation | Manager/Approver |
| Overbudget giveaway | manager/delegate + reason |
| Manual weight override | Weighbridge + supervisory review |
| Direct dbo exception | IT/DBA + Accounting + delegated Executive |
