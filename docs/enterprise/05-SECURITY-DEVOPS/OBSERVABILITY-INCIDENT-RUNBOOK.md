---
documentId: "WF-OPS-002"
title: "Observability, Alerting and Incident Runbook"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "IT Operations / DevOps"
normative: true
---
# Observability, Alerting and Incident Runbook

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-OPS-002` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | IT Operations / DevOps |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Required telemetry

| Signal | Required fields |
|---|---|
| Application log | time, level, correlation, actor/role pseudonym, endpoint, duration, outcome |
| Business audit | actor, action, entity, before/after pointer, IP/device, time |
| Integration event | dependency, operation, idempotency, retry, external ref, outcome |
| Metric | request/latency/error/queue/dependency health |
| Release | version, build digest, migration set, deploy actor/time |
| Security | auth result, privilege change, denied action |

## Dashboard minimum

- API health/latency/error rate
- SQL and TruckScale state
- integration/reconciliation exception backlog
- critical workflow counts
- Paper Trail aging/lost
- backup age/last restore test
- current application/release version

## Severity

| Severity | Example | Response |
|---|---|---|
| SEV-1 | breach, financial corruption, full outage | immediate containment/executive notify |
| SEV-2 | ship/confirm unavailable/no safe fallback | critical business response |
| SEV-3 | report slow/non-critical degraded | planned fix |
| SEV-4 | cosmetic/minor | backlog |

## Runbook A — SQL/wf unavailable

1. Check health/connectivity.
2. Do not repeatedly retry high-risk writes.
3. Declare degraded operation; use approved WINSpeed/manual fallback.
4. Preserve correlation IDs.
5. restore/failover per DR plan.
6. reconcile partial actions before closure.

## Runbook B — TruckScale unavailable

1. Verify network/read-only user/health.
2. Never modify TruckScale.
3. Use manual WeighTicket fallback only if authorized.
4. Open reconciliation case for manual shipment.
5. Backfill source ref after recovery.

## Runbook C — WINSpeed integration failure

1. mark `PENDING_RECONCILIATION`
2. check idempotency/external ref before retry
3. do not issue duplicate import
4. escalate DBA/Accounting
5. reconcile/record resolution

## Runbook D — suspected credential leak

1. revoke/disable
2. rotate secret/update runtime
3. redeploy/restart
4. review access scope
5. record incident without exposing new secret
