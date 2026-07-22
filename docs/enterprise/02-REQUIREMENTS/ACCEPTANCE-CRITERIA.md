---
documentId: "WF-QA-001"
title: "Acceptance Criteria and Definition of Done"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "QA Lead / Product Owner"
normative: true
---
# Acceptance Criteria and Definition of Done

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-QA-001` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | QA Lead / Product Owner |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Definition of Ready

Requirement ต้องมี business owner, acceptance criteria, role, data impact, exception handling และ test reference ก่อน development

## Definition of Done

- code review ผ่าน
- static analysis/type/lint ผ่าน
- test ที่เกี่ยวข้องผ่าน
- migration มี forward/rollback หรือ forward-fix statement
- API/data contract update
- audit/security impact reviewed
- test case update
- UAT evidence สำหรับ business impact
- release note/monitoring update
- ไม่มี critical/major defect ค้างโดยไม่มี risk acceptance

## Critical journey acceptance

| Journey | Minimum acceptance |
|---|---|
| J-01 SO lifecycle | create → verify → confirm → pick → weigh → ship audit ต่อเนื่อง |
| J-02 Unlock | pending/approve/reject, compensation and re-entry correct |
| J-03 Rebate | plan → allocate → accrual → FIFO claim → CN trace |
| J-04 Control Ticket | balance/partial draw/drill-down correct |
| J-05 TruckScale | health, lookup, manual fallback, immutable source ref |
| J-06 Security | unauthorised block, least privilege, secret scan |
| J-07 Recovery | restore proof within RTO test |
| J-08 Reconcile | sampled SO/shipment/claim/CN reconcile with WINSpeed |

## Release acceptance

Full Production requires: 100% critical pass, all P0 closed, P1 named/accepted, current restore proof, rotated least-privilege credentials, approved reconciliation dual-run, signed business/accounting/IT approval
