---
documentId: "WF-NFR-008"
title: "Non-Functional Requirements, SLO และ Service Resilience"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect / IT"
normative: true
---
# Non-Functional Requirements, SLO และ Service Resilience

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-NFR-008` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect / IT |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Service objectives

| ID | Dimension | Target / control |
|---|---|---|
| NFR-001 | API performance | general P95 <1s; report <3s; indexed master lookup <500ms |
| NFR-002 | Throughput | sustain >50 SO/min where infrastructure capacity supports |
| NFR-003 | Concurrency | capacity test at actual concurrent role usage |
| NFR-004 | Authentication | short-lived access + refresh/session policy; strong password hash |
| NFR-005 | Encryption | TLS 1.2+; encryption at rest/provider control; no secrets in source |
| NFR-006 | Audit | append-only; sensitive before/after; target retention 7 years |
| NFR-007 | Privacy | minimization, purpose control, access and incident handling |
| NFR-008 | Availability | 99.5% during defined business hours |
| NFR-009 | Recoverability | RTO <4h; RPO <1h target |
| NFR-010 | Fault tolerance | safe degraded operation/fallback |
| NFR-011 | Usability | tablet-first, Counter Sales role training validated |
| NFR-012 | Accessibility | Thai-first, touch target ≥44px |
| NFR-013 | Quality | type/lint/code review/automated test |
| NFR-014 | Observability | structured logs, metrics, health, alert routing |
| NFR-015 | Maintainability | versioned migrations/contracts/ADRs |
| NFR-016 | Browser | supported Chrome/Edge/Safari iPad baseline |
| NFR-017 | Security testing | dependency/secret/role tests every release |
| NFR-018 | WINSpeed coexistence | no schema changes; controlled DB load; fallback possible |
| NFR-019 | Data quality | normalize plate/date/charset; surface ambiguity |
| NFR-020 | Release | no production deploy without gate/rollback/release evidence |

## SLI and alerts

| SLI | Measurement | Alert |
|---|---|---|
| API success | successful requests/all | <99% for critical endpoint window |
| P95 latency | percentile by endpoint | breach target twice in 30min |
| Auth failure burst | failures/minute | policy threshold by user/IP |
| Integration success | success/attempt | <98% in agreed window |
| Reconciliation mismatch | unresolved cases | any critical mismatch |
| Backup validation | latest restore proof | older than 90 days |
| Paper exception | lost/aged copies | operational threshold |
| Critical test pass | passed/total | less than 100% at gate |

## Graceful degradation

| Dependency | Allowed | Prohibited |
|---|---|---|
| TruckScale | manual authorized capture + reconciliation | silent ship with no evidence |
| WINSpeed read | pause affected master/integration action | financial action from stale unknown data |
| WINSpeed write | queue/retry/reconcile | uncontrolled duplicate replay |
| App DB | documented WINSpeed/manual fallback | hidden local persistence |
| Monitoring | retain local logs and restore observability | discard audit/security events |
