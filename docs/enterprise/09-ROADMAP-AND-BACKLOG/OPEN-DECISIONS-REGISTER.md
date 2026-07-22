---
documentId: "WF-APP-003"
title: "Open Decisions Register"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Review"
sourceStatusDetail: "Controlled — Decisions must be closed before applicable release"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Project Sponsor / Solution Architect"
normative: false
---
# Open Decisions Register

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-APP-003` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Project Sponsor / Solution Architect |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

| ID | Decision | Why it matters | Proposed v7 position | Owner | Due/Gate |
|---|---|---|---|---|---|
| DG-01 | WINSpeed direct-write vs import/SP | accounting/data integrity | import/SP is target; legacy direct write is temporary approved exception only | IT + Accounting | P0 |
| DG-02 | Canonical TruckScale production source | correct weigh evidence | designate local or replica and test private connectivity | Factory IT | P0 |
| DG-03 | Credit Hold | sales risk | defer until wf credit master/policy approved | Sales + Accounting | Phase 1B |
| DG-04 | Operational stock source | prevent wrong availability promise | wf operational stock or approved warehouse source; do not assume ICStock | Warehouse + Finance | before stock feature |
| DG-05 | Approval authority and thresholds | prevents ad hoc override | controlled policy table with effective dates | Executive | P1 |
| DG-06 | Retention/PDPA policy | audit/privacy | 7-year audit target; confirm legal scope for PII | QMR/Legal | P1 |
| DG-07 | Document colors/custody | paper-trail implementation | finalize document recipients and scan points | Factory + Security | before rollout |
| DG-08 | Price Book ownership | promotion accuracy | effective price owner and dual approval | Sales + Accounting | before price changes |
| DG-09 | Reconciliation operating cadence | close external mismatch | daily pilot then agreed BAU cadence | Accounting + IT | P0 |
| DG-10 | Monitoring/on-call coverage | incident response | named support coverage/SLA in contract | Executive + IT | P0 |
