---
documentId: "WF-QA-005"
title: "UAT, Sign-off and Evidence Pack"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "QA Lead / Business Owner"
normative: true
---
# UAT, Sign-off and Evidence Pack

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-QA-005` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | QA Lead / Business Owner |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## UAT approach

UAT validates business scenarios, not buttons only. Each run records environment/data source, version, tester/role, outcome, evidence (screenshot/document/correlation), defect reference, date and reviewer.

## UAT scenario pack

1. Normal sale: create → verify → confirm → pick → weigh → ship → reconcile
2. multi-location load and mother/baby
3. control-ticket partial/full draw
4. rebate plan/claim/CN
5. giveaway/over-budget warning
6. four-color paper trail/lost exception
7. unlock after picking
8. TruckScale outage/manual fallback/reconcile
9. admin price/role
10. backup/restore/degraded-operation tabletop

## Sign-off rule

| Decision | Rule |
|---|---|
| Accept | all critical pass; no P0/P1 without approved mitigation |
| Conditional | named low-risk defect/owner/due/risk acceptance |
| Reject | critical workflow/security/accounting integrity fails |

## Required signatures

Sales, Counter/Factory, Warehouse/Weighbridge, Accounting, IT/Developer and Business Sponsor.

## Automated E2E evidence — 2026-07-22

| Item | Recorded result |
|---|---|
| Status | `PASSED_COMPLETE` |
| Scope | 10/10 passed; 3 required specs; 0 failed/flaky/skipped/timed-out/interrupted/not-run |
| Business flow | Multi-bill verification gate + SALES → MANAGER/ADMIN → COUNTER SALES → WAREHOUSE → Paper Trail |
| Role navigation | ADMIN, SALES, COUNTER_SALES, WAREHOUSE |
| Environment | Frontend 200, API health 200, SQL Server up; TruckScale MySQL down and degraded UI state verified |
| Evidence | `test-results/e2e-evidence.json`, `playwright-report/index.html`, JSON/JUnit reports and test attachments |
| Source binding | SHA-256 recorded for Playwright config, specs/helpers, fixtures, runner and affected runtime files |

Automated E2E นี้เป็น system/UAT-supporting evidence ที่ตรวจซ้ำได้ แต่ไม่แทนลายเซ็น Business Owner, security/performance testing, production reconciliation หรือ TruckScale integration test ใน environment ที่ MySQL online.

## Evidence retention

Store controlled UAT pack with immutable version/reference. Avoid open storage of screenshots with unnecessary PII.
