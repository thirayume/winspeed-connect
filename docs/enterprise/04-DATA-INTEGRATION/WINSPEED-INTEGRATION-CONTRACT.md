---
documentId: "WF-INT-002"
title: "WINSpeed Integration Contract"
version: "v1.0"
truckScaleWriteTargets: "tbl_keyone"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Integration Lead / DBA / Accounting"
normative: true
---
# WINSpeed Integration Contract

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-INT-002` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Integration Lead / DBA / Accounting |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Purpose

กำหนดการอ่าน การเขียน และ reconciliation ระหว่าง WS-Sale-App กับ WINSpeed เพื่อป้องกันเอกสาร/ผลบัญชีซ้ำหรือผิด

## Read contracts

| Capability | Source | Contract |
|---|---|---|
| Customers | `EMCust` / approved view | readonly, parameterized, paginated |
| Goods | `EMGood` / view | readonly, classification explicit |
| NET price | `EMSetPriceHD/DT` / view | effective period/version |
| Sales/Reservation | `SOHD/SODT` / view | DocuType/status explicit |
| Invoice/CN | `SOInvHD/SOInvDT` / view | doc-type mapping explicit |
| GL evidence | `GLHD/GLDT` / view | documented safe join only |
| Sales employee | `EMEmp` | controlled mapping |

## Write contract

See ADR-003. Every write operation requires:
- input schema/validation
- authorization
- idempotency
- expected external reference
- timeout/retry policy
- reconciliation query
- compensation/rollback behavior
- owner/support path

## Controlled SO import target

| Data | Mapping concept |
|---|---|
| Header | branch, document, date, customer, ship date, sales/transport, totals, VAT type, sale area, doc type |
| Detail | good, inventory/location, UOM, quantity, price, discount, amount |
| Giveaway | separate zero-price line only when approved |
| Reference | app SO/ref and correlation/idempotency retained |

## Financial safety

- no direct GL insert/update
- invoice/CN posting stays in WINSpeed-authorized process
- app request is not financial success until external reconciliation passes
- mismatch has owner, state, time and resolution evidence

## Prohibited assumptions

- do not join GL/invoice by coincidental numeric ID
- do not assume stock table represents physical availability without signed decision
- do not infer CN link from a nullable field without DocuType logic
