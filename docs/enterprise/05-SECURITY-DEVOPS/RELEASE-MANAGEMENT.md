---
documentId: "WF-OPS-005"
title: "Release Management, Change Control and Rollback"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Release Manager / Product Owner"
normative: true
---
# Release Management, Change Control and Rollback

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-OPS-005` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Release Manager / Product Owner |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Release classes

| Class | Example | Approval |
|---|---|---|
| Emergency | breach/critical outage | incident commander + emergency CAB |
| Hotfix | production defect | product + IT + QA |
| Standard | planned feature/fix | normal release gate |
| Major | workflow/data/boundary change | executive + accounting + IT |

## Release checklist

- [ ] CR/issue linked
- [ ] scope/risk classified
- [ ] ADR updated where needed
- [ ] migration reviewed/dry-run
- [ ] QA evidence
- [ ] security/dependency scan
- [ ] backup checkpoint
- [ ] rollback/forward-fix plan
- [ ] version/tag/artifact digest
- [ ] monitoring and alert checked
- [ ] stakeholder communication
- [ ] reconciliation owner

## Change freeze

Define freeze around financial month-end, high-volume events and factory peaks. Emergency override requires written justification and post-change review.

## Post-release review

Compare error/latency, validate critical workflow/reconciliation, review support tickets, update notes/known issues, close CR after evidence complete.
