---
documentId: "WF-INT-003"
title: "TruckScale Integration and Data Quality Contract"
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
owner: "Integration Lead / Factory IT"
normative: true
---
# TruckScale Integration and Data Quality Contract

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-INT-003` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Integration Lead / Factory IT |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Source profile

TruckScale is MySQL-based. Core evidence includes `tblscale` (completed weighing), `tbl_keyone` (pre-weigh), `tblproduct_detail` (product detail), and customer/product/driver/store/type reference tables.

## Write boundary

- Allowed target: `tbl_keyone` only.
- Allowed lifecycle: parameterized INSERT when confirming a pre-weigh ticket; parameterized DELETE by `one_App` when the queue ticket must be removed.
- `tblscale`, `tblproduct_detail` and reference tables remain read-only.
- Any additional table/operation requires an approved contract change and least-privilege credential update.

## Required read operations

| Operation | Input | Output |
|---|---|---|
| Health/Ping | none | state, latency, record/version summary |
| Search plate | normalized plate + window | candidates with in/out/net/movebill |
| Search movebill | movebill | exact/near record and detail |
| Get source record | source `s_id` | header + item detail |
| Find for SO | SO, plate, ship date | ranked candidates + match reason |

## Canonical mapping

| App field | TruckScale source | Rule |
|---|---|---|
| `TruckPlateRaw` | `tblscale.one_car_regis` | retain raw |
| `TruckPlateNormalized` | derived | normalize punctuation/space |
| `Movebill` | `tblscale.movebill` | retain exact |
| `TareKg` | `weight_in` | validate >=0 |
| `GrossKg` | `weight_out` | gross>=tare |
| `NetKg` | `weight_net` | calculate/check |
| `WeighInAt` | `Date_In2` + `Time_In` | serial conversion; preserve raw |
| `WeighOutAt` | `Date_Out2` + `Time_Out` | serial conversion; preserve raw |
| `ScaleNo` | `Computer_w` | map physical scale |
| Product evidence | `tblproduct_detail` | support/reconcile, not blind SO match |
| Source key | `s_id` | immutable external reference |

## Data quality controls

| Risk | Control |
|---|---|
| Thai string vs serial dates | prefer serial, retain raw, flag mismatch |
| UTF-8/TIS620 mix | charset test and decode-error telemetry |
| No FKs | join documented keys; validate multiplicity |
| Inconsistent plates | normalize/rank/user confirm |
| Default/test weights | sanity rule/outlier alert |
| Customer inconsistency | customer code not sole final match |
| Multi-trip/duplicates | one source ref per ticket; duplicate detection |

## Manual fallback

Allowed only when TruckScale is unavailable/ambiguous and user is authorized. Reason, supervisor policy, values and later reconciliation are mandatory.

## Security

Read and Write privilege on `tbl_keyone` (Pre-weigh); Read-only for `tblscale` and others; private network/VPN/allowlist; secret-managed credentials.

## Operational Workflow (Physical vs Digital)

### Sequence Loading & Interim Weighing
- **App Capability:** WS-Sale-App supports Sequence Loading via the `LoadSequence` field, directing the warehouse team on the exact order of goods to load.
- **TruckScale Capability:** The integration only tracks the **Tare Weight** (`weight_in`) and the **Final Gross Weight** (`weight_out`).
- **Physical Workflow:** For multi-step loading (วนชั่งทีละสูตร), the scale operator manually observes the interim weight delta on the live indicator to verify line-by-line correctness. The "Save (ชั่งออก)" action in TruckScale is executed *only* when the final product is loaded. The App captures this final result without needing interim data points.

### In-Progress SO Editing
- **App Behavior:** If a Sales Order requires modification after the truck has already weighed in (record moved to `tblscale`), the user can request an "Unlock" in the App to revert the SO to DRAFT status.
- **TruckScale Safety Check:**
  - Upon unlocking, the App issues a `DELETE` command to `tbl_keyone` (which safely affects 0 rows if the truck is already in `tblscale`).
  - Upon re-confirming the modified SO, the App executes a safety check: `SELECT s_id FROM tblscale WHERE weight_in > 0 AND (weight_out = 0 OR weight_out IS NULL)`. If an active session exists for the truck plate, the App gracefully skips re-inserting into `tbl_keyone` to prevent duplicate queue tickets.
  - The truck proceeds to weigh out using its existing `tblscale` session.
- **Data Integrity:** The App's modified `wf.SalesOrderLine` acts as the definitive Source of Truth for invoicing and inventory deduction, regardless of the outdated product text residing on the physical TruckScale ticket.
