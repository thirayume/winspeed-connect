---
documentId: "WF-OPS-003"
title: "Backup, Disaster Recovery and Business Continuity Plan"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "IT Manager / DBA"
normative: true
---
# Backup, Disaster Recovery and Business Continuity Plan

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-OPS-003` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | IT Manager / DBA |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Objectives

- RTO <4h for critical operational service
- RPO <1h for approved wf production data
- WINSpeed/TruckScale source backup ownership jointly agreed with source owners

## Backup baseline

| Source | Backup | Frequency | Owner | Validate |
|---|---|---|---|---|
| SQL Server WINSpeed + wf | full + log/differential | full daily; log/hourly target | DBA | restore quarterly |
| Application documents | versioned storage | daily/provider | IT | restore sample quarterly |
| TruckScale MySQL | snapshot + logical export where permitted | daily minimum | Factory IT | restore quarterly |
| config/secrets | non-secret config version + recovery procedure | on change | DevOps | access drill |
| release records | repo/tag/artifact retention | every release | DevOps | release drill |

## Recovery order

1. contain and rebuild clean infra
2. restore SQL/wf isolated validation
3. validate schema/checksum/audit count/health
4. restore artifact/config with rotated credentials
5. verify TruckScale or fallback
6. smoke critical journey
7. reconcile external actions
8. business/IT approve resumption

## BCP fallback

| Process | Fallback |
|---|---|
| SO | approved WINSpeed/manual |
| Verification | checklist/signature |
| Pick/load | factory paper flow |
| Weigh | TruckScale native/manual record |
| Rebate | suspend automated claim; retain evidence |
| Invoice/CN | WINSpeed authorized process |
