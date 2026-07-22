---
documentId: "WF-INT-005"
title: "Data Quality, Migration and Reconciliation Strategy"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Data Architect / QA / DBA"
normative: true
---
# Data Quality, Migration and Reconciliation Strategy

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-INT-005` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Data Architect / QA / DBA |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Data quality policy

Data quality errors are exceptions, not silent coercions. Raw source, normalized value, transformation version and resolution actor are retained when a business decision depends on a match.

## Required normalization

| Domain | Raw | Normalized |
|---|---|---|
| Truck plate | punctuation/space/case variants | `plateNormalized` |
| Date | Thai string/serial | ISO timestamp |
| Money | legacy numeric | decimal |
| Customer | code/name variation | official ID when confirmed |
| Product | legacy code/formula | good ID + snapshot |
| Charset | TIS620/UTF-8 | UTF-8 app value |

## wf migration policy

1. Backup target.
2. Run migration in test.
3. Validate object/checksum.
4. Run UAT controlled.
5. Capture ID/checksum/operator/outcome.
6. Smoke test/reconcile.
7. Production after approval.
8. Rollback safely or forward-fix with incident/CR.

## Reconciliation schedule

| Reconciliation | Frequency | Owner | SLA |
|---|---|---|---|
| SO state vs WINSpeed reference | daily/pilot then daily | Counter/IT | same day |
| shipped weight vs TruckScale | daily | Weighbridge | same shift |
| rebate ledger vs claim | per claim/monthly | Accounting | before payout |
| CN evidence vs claim | daily/weekly | Accounting | before month close |
| Price Book vs source | monthly/before active | Admin/Manager | before use |
| Giveaway vs physical count | monthly | Warehouse/Sales | 5 days |
