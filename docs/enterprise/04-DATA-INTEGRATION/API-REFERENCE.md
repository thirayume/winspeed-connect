---
documentId: "WF-INT-004"
title: "API Reference — Current Source Contract"
version: "v1.0"
status: Review
statusDetail: "Source-derived endpoint surface; DTO, authorization and E2E verification remain under review"
sourceVersion: "v8.0"
sourceStatus: "Approved"
sourceStatusDetail: "Historical Contract Baseline — superseded where current source differs"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
sourceGeneratedSection: "SOURCE-API-INVENTORY"
owner: "Tech Lead"
normative: true
---
# API Reference — Current Source Contract

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-INT-004` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 22 กรกฎาคม 2569 (22 July 2026) |
| Owner | Tech Lead |
| Status | Review — source-derived endpoint surface; E2E deferred |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance:** เอกสาร contract เดิม v8.0 ถูกเก็บเป็น provenance; method/path ด้านล่างยึด Express route source ปัจจุบันตามนโยบาย `latest-document-wins`.

## API conventions

- Base path: `/api`
- Route parameters use Express notation เช่น `:id`; client ต้องแทนด้วยค่าจริง
- Protected routes use bearer authentication and route-level authorization ตาม implementation ของแต่ละ module
- ตารางนี้รับรองเฉพาะ method/path/source evidence; DTO, roles, error shape และ idempotency ต้องตรวจต่อจาก route/schema/test ก่อนยกระดับเป็น Approved contract

## Current source-derived endpoint inventory

<!-- BEGIN GENERATED:SOURCE-API-INVENTORY -->
> ส่วนนี้สร้างจาก Express route source โดยอัตโนมัติ ห้ามแก้ตารางด้วยมือ; ให้รัน `../pipeline/source.ps1 sync-api` หลัง route เปลี่ยน

- Source inventory: `12B9F964C7C90341859EDD6CDDE9B92BA35D797347F2AA64A1134E1E885FC343`
- Route modules: 17
- Endpoints: 160

| Method | Current path | Source evidence |
|---|---|---|
| POST | `/api/auth/access-as` | `backend/routes/auth.js:408` |
| GET | `/api/auth/access-as/candidates` | `backend/routes/auth.js:383` |
| POST | `/api/auth/access-as/stop` | `backend/routes/auth.js:436` |
| GET | `/api/auth/line/callback` | `backend/routes/auth.js:243` |
| POST | `/api/auth/line/link` | `backend/routes/auth.js:308` |
| GET | `/api/auth/line/start` | `backend/routes/auth.js:229` |
| GET | `/api/auth/line/status` | `backend/routes/auth.js:377` |
| POST | `/api/auth/login` | `backend/routes/auth.js:202` |
| GET | `/api/auth/me` | `backend/routes/auth.js:454` |
| PUT | `/api/auth/profile` | `backend/routes/auth.js:468` |
| PUT | `/api/auth/profile/password` | `backend/routes/auth.js:489` |
| POST | `/api/auth/profile/signature` | `backend/routes/auth.js:511` |
| GET | `/api/auth/users` | `backend/routes/auth.js:552` |
| POST | `/api/auth/users` | `backend/routes/auth.js:526` |
| DELETE | `/api/auth/users/:id` | `backend/routes/auth.js:610` |
| PATCH | `/api/auth/users/:id` | `backend/routes/auth.js:571` |
| GET | `/api/credit` | `backend/routes/credit.js:12` |
| GET | `/api/credit/:custId` | `backend/routes/credit.js:23` |
| PUT | `/api/credit/:custId` | `backend/routes/credit.js:32` |
| GET | `/api/giveaway/available-lenders` | `backend/routes/giveaway.js:153` |
| GET | `/api/giveaway/borrow-requests` | `backend/routes/giveaway.js:199` |
| POST | `/api/giveaway/borrow-requests` | `backend/routes/giveaway.js:175` |
| PATCH | `/api/giveaway/borrow-requests/:id/resolve` | `backend/routes/giveaway.js:217` |
| GET | `/api/giveaway/budget-lines` | `backend/routes/giveaway.js:36` |
| POST | `/api/giveaway/budgets` | `backend/routes/giveaway.js:118` |
| GET | `/api/giveaway/items` | `backend/routes/giveaway.js:66` |
| GET | `/api/giveaway/my-quota` | `backend/routes/giveaway.js:141` |
| GET | `/api/giveaway/regions` | `backend/routes/giveaway.js:15` |
| GET | `/api/giveaway/withdrawals` | `backend/routes/giveaway.js:50` |
| POST | `/api/giveaway/withdrawals` | `backend/routes/giveaway.js:77` |
| POST | `/api/line/notify` | `backend/routes/line.js:42` |
| GET | `/api/line/status` | `backend/routes/line.js:52` |
| POST | `/api/line/webhook` | `backend/routes/line.js:14` |
| GET | `/api/master/aging` | `backend/routes/master.js:835` |
| GET | `/api/master/aging/search` | `backend/routes/master.js:909` |
| GET | `/api/master/control-tickets` | `backend/routes/master.js:576` |
| GET | `/api/master/control-tickets/:docuNo` | `backend/routes/master.js:662` |
| GET | `/api/master/control-tickets/:docuNo/draws` | `backend/routes/master.js:702` |
| GET | `/api/master/customer-filters` | `backend/routes/master.js:64` |
| GET | `/api/master/customer-requests` | `backend/routes/master.js:124` |
| POST | `/api/master/customer-requests` | `backend/routes/master.js:145` |
| PATCH | `/api/master/customer-requests/:id/review` | `backend/routes/master.js:172` |
| GET | `/api/master/customers` | `backend/routes/master.js:78` |
| DELETE | `/api/master/customers/:id` | `backend/routes/master.js:236` |
| PATCH | `/api/master/customers/:id` | `backend/routes/master.js:200` |
| GET | `/api/master/employees` | `backend/routes/master.js:371` |
| GET | `/api/master/giveaway-goods` | `backend/routes/master.js:352` |
| GET | `/api/master/goods` | `backend/routes/master.js:247` |
| DELETE | `/api/master/goods/:id` | `backend/routes/master.js:341` |
| PATCH | `/api/master/goods/:id` | `backend/routes/master.js:306` |
| GET | `/api/master/invoices` | `backend/routes/master.js:809` |
| GET | `/api/master/prices` | `backend/routes/master.js:386` |
| PATCH | `/api/master/prices` | `backend/routes/master.js:417` |
| POST | `/api/master/prices` | `backend/routes/master.js:457` |
| POST | `/api/master/prices/bulk-extend` | `backend/routes/master.js:512` |
| GET | `/api/master/transports` | `backend/routes/master.js:281` |
| GET | `/api/master/truck-plates` | `backend/routes/master.js:723` |
| GET | `/api/master/truck-types` | `backend/routes/master.js:1018` |
| POST | `/api/master/truck-types` | `backend/routes/master.js:1031` |
| DELETE | `/api/master/truck-types/:id` | `backend/routes/master.js:1074` |
| PUT | `/api/master/truck-types/:id` | `backend/routes/master.js:1051` |
| GET | `/api/master/trucks-stats` | `backend/routes/master.js:740` |
| GET | `/api/master/trucks/:plate/history` | `backend/routes/master.js:778` |
| GET | `/api/ops/errors` | `backend/routes/ops.js:25` |
| GET | `/api/ops/outbox` | `backend/routes/ops.js:38` |
| GET | `/api/ops/status` | `backend/routes/ops.js:14` |
| POST | `/api/ops/test-alert` | `backend/routes/ops.js:48` |
| GET | `/api/papertrail/:soId/copies` | `backend/routes/papertrail.js:156` |
| POST | `/api/papertrail/:soId/print` | `backend/routes/papertrail.js:168` |
| GET | `/api/papertrail/board` | `backend/routes/papertrail.js:26` |
| GET | `/api/papertrail/document/:soId` | `backend/routes/papertrail.js:136` |
| GET | `/api/papertrail/lost` | `backend/routes/papertrail.js:253` |
| POST | `/api/papertrail/scan` | `backend/routes/papertrail.js:206` |
| GET | `/api/papertrail/scan/:qrNonce` | `backend/routes/papertrail.js:238` |
| GET | `/api/pdpa/dsar` | `backend/routes/pdpa.js:34` |
| POST | `/api/pdpa/dsar/export` | `backend/routes/pdpa.js:43` |
| GET | `/api/pdpa/policies` | `backend/routes/pdpa.js:14` |
| PUT | `/api/pdpa/policies/:id` | `backend/routes/pdpa.js:22` |
| POST | `/api/pdpa/retention/run` | `backend/routes/pdpa.js:71` |
| GET | `/api/policy` | `backend/routes/policy.js:13` |
| POST | `/api/policy` | `backend/routes/policy.js:37` |
| DELETE | `/api/policy/:id` | `backend/routes/policy.js:82` |
| PUT | `/api/policy/:id` | `backend/routes/policy.js:60` |
| GET | `/api/policy/resolve` | `backend/routes/policy.js:28` |
| GET | `/api/pricebook` | `backend/routes/pricebook.js:22` |
| POST | `/api/pricebook` | `backend/routes/pricebook.js:54` |
| GET | `/api/pricebook/:id` | `backend/routes/pricebook.js:40` |
| POST | `/api/pricebook/:id/activate` | `backend/routes/pricebook.js:132` |
| POST | `/api/pricebook/:id/approve` | `backend/routes/pricebook.js:131` |
| POST | `/api/pricebook/:id/archive` | `backend/routes/pricebook.js:133` |
| POST | `/api/pricebook/:id/lines` | `backend/routes/pricebook.js:90` |
| GET | `/api/quotation` | `backend/routes/quotation.js:888` |
| POST | `/api/quotation` | `backend/routes/quotation.js:1069` |
| GET | `/api/quotation/:id` | `backend/routes/quotation.js:1005` |
| POST | `/api/quotation/:id/convert` | `backend/routes/quotation.js:1417` |
| PATCH | `/api/quotation/:id/status` | `backend/routes/quotation.js:1341` |
| PATCH | `/api/quotation/:id/valid-until` | `backend/routes/quotation.js:1399` |
| POST | `/api/quotation/from-so-trip` | `backend/routes/quotation.js:1118` |
| GET | `/api/rebate/claims` | `backend/routes/rebate.js:67` |
| POST | `/api/rebate/claims` | `backend/routes/rebate.js:93` |
| PATCH | `/api/rebate/claims/:id/approve` | `backend/routes/rebate.js:151` |
| GET | `/api/rebate/cn-detail/:soInvId` | `backend/routes/rebate.js:681` |
| GET | `/api/rebate/cn-list` | `backend/routes/rebate.js:645` |
| GET | `/api/rebate/cn-summary` | `backend/routes/rebate.js:616` |
| GET | `/api/rebate/coupons` | `backend/routes/rebate.js:728` |
| GET | `/api/rebate/coupons/:custId` | `backend/routes/rebate.js:755` |
| GET | `/api/rebate/ledger` | `backend/routes/rebate.js:42` |
| POST | `/api/rebate/migrate-legacy` | `backend/routes/rebate.js:329` |
| GET | `/api/rebate/plans` | `backend/routes/rebate.js:196` |
| POST | `/api/rebate/plans` | `backend/routes/rebate.js:215` |
| PATCH | `/api/rebate/plans/:id` | `backend/routes/rebate.js:250` |
| POST | `/api/rebate/plans/:id/allocate` | `backend/routes/rebate.js:277` |
| GET | `/api/rebate/pools` | `backend/routes/rebate.js:12` |
| GET | `/api/rebate/summary` | `backend/routes/rebate.js:167` |
| POST | `/api/rebate/sync-mirror` | `backend/routes/rebate.js:703` |
| GET | `/api/rebate/voucher-summary` | `backend/routes/rebate.js:309` |
| GET | `/api/rebate/wf-trail-detail/:soId` | `backend/routes/rebate.js:521` |
| GET | `/api/rebate/wf-trail-list` | `backend/routes/rebate.js:463` |
| GET | `/api/rebate/wf-trail-summary` | `backend/routes/rebate.js:424` |
| POST | `/api/recon/:soId/resolve` | `backend/routes/recon.js:169` |
| GET | `/api/recon/cases` | `backend/routes/recon.js:160` |
| GET | `/api/recon/summary` | `backend/routes/recon.js:143` |
| GET | `/api/reports/:type` | `backend/routes/reports.js:134` |
| GET | `/api/reports/:type/export` | `backend/routes/reports.js:143` |
| GET | `/api/reports/types` | `backend/routes/reports.js:121` |
| GET | `/api/so` | `backend/routes/so.js:475` |
| POST | `/api/so` | `backend/routes/so.js:958` |
| DELETE | `/api/so/:id` | `backend/routes/so.js:1745` |
| GET | `/api/so/:id` | `backend/routes/so.js:889` |
| PUT | `/api/so/:id` | `backend/routes/so.js:1149` |
| PATCH | `/api/so/:id/cancel` | `backend/routes/so.js:1710` |
| PATCH | `/api/so/:id/confirm` | `backend/routes/so.js:1389` |
| PATCH | `/api/so/:id/giveaway-lines/:lineNum/approve` | `backend/routes/so.js:922` |
| PATCH | `/api/so/:id/load` | `backend/routes/so.js:1637` |
| PATCH | `/api/so/:id/picking` | `backend/routes/so.js:1575` |
| PATCH | `/api/so/:id/ship` | `backend/routes/so.js:1661` |
| PATCH | `/api/so/:id/sync-imported` | `backend/routes/so.js:1705` |
| PATCH | `/api/so/:id/unlock` | `backend/routes/so.js:1586` |
| POST | `/api/so/:id/unlock-request` | `backend/routes/so.js:1606` |
| PATCH | `/api/so/:id/verify` | `backend/routes/so.js:1378` |
| GET | `/api/so/:id/weigh` | `backend/routes/so.js:880` |
| GET | `/api/so/debug-sohd` | `backend/routes/so.js:767` |
| GET | `/api/so/rebate-balance/:custId` | `backend/routes/so.js:751` |
| GET | `/api/so/shipped-today` | `backend/routes/so.js:776` |
| GET | `/api/so/stats` | `backend/routes/so.js:328` |
| DELETE | `/api/so/stats/cache` | `backend/routes/so.js:323` |
| GET | `/api/so/unlock-reasons` | `backend/routes/so.js:801` |
| GET | `/api/so/unlock-requests` | `backend/routes/so.js:820` |
| PATCH | `/api/so/unlock-requests/:reqId/resolve` | `backend/routes/so.js:837` |
| GET | `/api/stock` | `backend/routes/stock.js:12` |
| PUT | `/api/stock` | `backend/routes/stock.js:23` |
| GET | `/api/truckscale/for-so/:soId` | `backend/routes/truckscale.js:75` |
| GET | `/api/truckscale/inbox` | `backend/routes/truckscale.js:130` |
| POST | `/api/truckscale/inbox/:id/match/:soId` | `backend/routes/truckscale.js:168` |
| POST | `/api/truckscale/ingest` | `backend/routes/truckscale.js:16` |
| GET | `/api/truckscale/ping` | `backend/routes/truckscale.js:35` |
| GET | `/api/truckscale/scale/:sequence` | `backend/routes/truckscale.js:59` |
| POST | `/api/truckscale/sync/run` | `backend/routes/truckscale.js:124` |
| GET | `/api/truckscale/sync/status` | `backend/routes/truckscale.js:114` |
| GET | `/api/truckscale/weigh` | `backend/routes/truckscale.js:45` |

<!-- END GENERATED:SOURCE-API-INVENTORY -->

## Verification status

- Endpoint inventory: generated from current Express route mounts
- Source snapshot: embedded in the generated block and checked by source preflight
- Automated E2E evidence: **PASSED_COMPLETE (10/10)** และ source-bound ตาม `test-results/e2e-evidence.json`; อย่างไรก็ตาม endpoint presence และ automated flow ไม่ใช้แทน security test หรือ business UAT sign-off
- Release use: ต้องผ่าน source alignment, document validation, accepted baselines และ full test loop ก่อน
