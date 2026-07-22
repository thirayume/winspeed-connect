---
documentId: "WF-SAL-003"
title: "Commercial Proposal Scope Template"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Approved"
sourceStatusDetail: "Reusable Commercial Template"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Sales / Solution Architect"
normative: false
---
# Commercial Proposal Scope Template

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-SAL-003` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Sales / Solution Architect |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Proposal objective

เสนอการพัฒนา/ปรับใช้ WS-Sale-App เพื่อยกระดับ Sales Execution, Rebate Control, Warehouse/Weighing Evidence และการเชื่อมต่อ ERP เดิม ภายใต้ขอบเขตที่ตรวจสอบได้

## Included scope checklist

- [ ] Discovery/workshop/process confirmation
- [ ] Sales Order + Verification Gate
- [ ] Paper Trail / QR / document print
- [ ] Warehouse + mother/baby sequence
- [ ] TruckScale controlled integration (completed-weigh read-only; `tbl_keyone` pre-weigh queue only)
- [ ] Price Book / Rebate Plan / FIFO / Claim
- [ ] Giveaway / Control Ticket
- [ ] Dashboard/report/Excel export
- [ ] RBAC/audit/security hardening
- [ ] UAT/training/hypercare
- [ ] Documentation package

## Assumptions

1. Client owns WINSpeed license, DBA access, accounting posting rules and legacy backup.
2. Any `dbo` direct write requires approved contract/risk acceptance.
3. TruckScale connectivity/canonical source is confirmed by client IT/factory.
4. Hardware/scale serial protocol replacement is excluded unless stated.
5. Historical migration/report scope is quantified in discovery.
6. Pricing/timeline/SLA/warranty are completed in commercial schedule, not inferred here.

## Deliverables

Approved requirements/decisions, configured/developed artifact, contracted source/deployment instructions, documentation pack, test/UAT evidence, training, and Go-Live/handover pack.

## Acceptance basis

Acceptance is against named requirements, tests, data/reconciliation criteria and signed UAT — not screen appearance alone.
