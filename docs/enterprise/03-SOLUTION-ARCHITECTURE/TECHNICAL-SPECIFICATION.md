---
documentId: "WF-TECH-001"
title: "Technical Specification — Runtime 1.0.1 Candidate"
version: "v1.0"
runtimeVersion: "1.2.0"
sourceMigrationSequence: 55
sourceInventorySha256: "12B9F964C7C90341859EDD6CDDE9B92BA35D797347F2AA64A1134E1E885FC343"
truckScaleWriteTargets: "tbl_keyone"
status: Review
statusDetail: "Source-aligned technical candidate; technical review, security review and approval required"
owner: "Solution Architect / Technical Lead"
normative: true
sourceRefs:
  - "backend/server.js"
  - "backend/routes/"
  - "backend/services/"
  - "backend/migrations/"
  - "WSSale-App/src/"
  - "deploy/"
  - "docs/enterprise/04-DATA-INTEGRATION/API-REFERENCE.md"
  - "docs/enterprise/04-DATA-INTEGRATION/DATABASE-OVERVIEW.md"
  - "docs/enterprise/04-DATA-INTEGRATION/TRUCKSCALE-INTEGRATION-CONTRACT.md"
  - "docs/enterprise/04-DATA-INTEGRATION/WINSPEED-INTEGRATION-CONTRACT.md"
---
# Technical Specification — Runtime 1.0.1 Candidate

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-TECH-001` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 23 กรกฎาคม 2569 (23 July 2026) |
| Owner | Solution Architect / Technical Lead |
| Status | Review — source-aligned candidate; approval required |
| Classification | Confidential — Client / Authorized Partner Use Only |
| Source snapshot | runtime 1.0.1 · commit `79a10a28` · source SHA `12B9F964…FC343` · 220 files |

> เอกสารนี้สรุป technical contract จาก source code และ Markdown ล่าสุดตามนโยบาย `latest-document-wins`. ตัวเลข inventory เป็นผลตรวจอัตโนมัติ ไม่ใช่การอนุมัติ production, security หรือ external write boundary.

## 1. Scope and technical objectives

Technical specification นี้กำหนดขอบเขต runtime, component responsibilities, API/data/integration contracts, security controls, deployment/operations และ verification evidence ที่ใช้พัฒนา ทดสอบ ส่งมอบ และดูแล WS-Sale-App

- ควบคุม Sales Order, warehouse execution, weighing, rebate, giveaway, paper custody และ reconciliation โดยไม่แทนบทบาทบัญชีของ WINSpeed
- รักษา traceability จาก requirement → architecture/decision → source → test → retained evidence
- ทำให้การเปลี่ยน source หรือ Markdown ตรวจพบก่อนสร้างเอกสารและไม่ทำให้ candidate เก่าถูกมองเป็น baseline
- แยก automated development evidence ออกจาก manual UAT, production integration และ go-live acceptance อย่างชัดเจน

## 2. Runtime and source inventory

| Technical item | Current fact | Verification source |
|---|---|---|
| Package version | 1.0.1 across root, backend and frontend packages | source alignment report |
| Source inventory | 220 tracked source/runtime files | source alignment report |
| Frontend navigation | 22 portal keys | `WSSale-App/src/App.tsx` and portal components |
| Access roles | 8 roles: ADMIN, SALES, COUNTER_SALES, WAREHOUSE, ACCOUNTING, MANAGER, APPROVER, WEIGHBRIDGE | auth/permission source |
| API surface | 17 route mounts / 160 detected endpoints | `backend/server.js`, `backend/routes/` |
| Database migrations | 55 sequenced files through 055 | `backend/migrations/` |
| Deployment scope | root deployment files plus `deploy/coolify` compose and backup script | deployment source set |
| Current automated test | run `2026-07-23T09-56-59-217Z`, 10/10 passed, source stable | `test-results/e2e-evidence.json` |

## 3. Technology and component responsibilities

| Layer | Technology / component | Responsibility |
|---|---|---|
| Experience | React + TypeScript SPA | tablet-first role portals, validation, operational feedback, printing/scanning interaction |
| State/client integration | frontend stores, REST client, Socket.IO client | authenticated calls, client state, realtime refresh |
| API | Node.js + Express | route composition, validation, response/error contract |
| Security middleware | token authentication, RBAC/context and API audit | identity, authorization, deny/audit evidence |
| Domain/application services | sales, approval, outbox, weighing, observability, polling | state transitions, policy, idempotency, integration resilience |
| Operational data | SQL Server schema `wf` | app-owned workflow, audit, ledger, policies, outbox and reconciliation |
| Accounting/master integration | WINSpeed SQL Server `dbo` | approved read models and explicit controlled write contracts |
| Weighing integration | TruckScale MySQL | completed-weigh read/sync; pre-weigh queue write only to `tbl_keyone` |
| Deployment | container/compose, environment configuration | reproducible runtime, health checks, backup/restore and secret injection |

## 4. API contract

All protected endpoints must validate authentication, role/context and object-level permission. Mutable endpoints must validate state and payload, use parameterized queries, write audit evidence and apply idempotency where retry may duplicate outcomes.

| Route mount | Technical responsibility |
|---|---|
| `/api/auth` | login, session identity and user administration |
| `/api/so` | Sales Order CRUD, verification, lifecycle, unlock and ship |
| `/api/quotation` | quotation lifecycle and conversion linkage |
| `/api/master` | approved customer, goods, price, transport and aging read models |
| `/api/truckscale` | health, candidate search, sync status/run, inbox, match and controlled ingest |
| `/api/rebate`, `/api/giveaway`, `/api/pricebook` | commercial program, budget, accrual/claim and price workflow |
| `/api/papertrail` | four-copy generation, QR nonce, scan/custody and unlock evidence |
| `/api/recon`, `/api/reports` | cross-system reconciliation, operational reports and export |
| `/api/policy`, `/api/credit`, `/api/stock`, `/api/pdpa` | governed configuration and data controls |
| `/api/ops`, `/api/line` | health/telemetry/outbox/alert and signed notification integration |

The complete generated endpoint list and source locations are maintained in [API Reference](../04-DATA-INTEGRATION/API-REFERENCE.md).

## 5. Data and transaction design

- `wf` is the operational extension and owns application workflow/audit records.
- Migrations execute in numeric sequence and record checksum/application state; release procedures must not silently rewrite an applied migration.
- Financial values use decimal types and explicit rounding; quantities retain canonical unit and conversion.
- Cross-system references retain raw source identity, normalized match attributes, timestamps and reconciliation disposition.
- Mutable workflow operations use transaction boundaries appropriate to their invariants; an external-system call must not leave an untraceable partial success.
- Corrections use controlled compensation/unlock; shipped/audited evidence must not be hard-deleted.

## 6. Integration contracts

### 6.1 WINSpeed

WINSpeed remains system of record for accounting master, invoice, CN and GL. Read access uses approved contracts/views/queries. Any direct `dbo` write is an explicit exception subject to ADR-003, allowlist review, least-privilege credential, transaction/error handling, reconciliation and rollback/forward-fix evidence.

### 6.2 TruckScale

Completed-weigh data and reference tables are read-only. The application may insert/delete only the pre-weigh queue `tbl_keyone` under the controlled contract. Pull-sync uses watermark plus refresh of open records, idempotent upsert into `wf.WeighInbox`, matching by controlled rules and visible `MATCHED`, `MULTI` or `UNMATCHED` disposition.

### 6.3 Reliable event and notification

Business operations enqueue integration/outbox records with idempotency key and payload hash. Workers record attempt, result and retry state. Notification delivery failure must remain visible and must not change a failed external delivery into a successful business assertion.

## 7. Security and privacy controls

| Control area | Required implementation |
|---|---|
| Identity and access | named account, token validation, RBAC, context/object authorization, controlled Access As |
| Database access | parameterized SQL, scoped credentials, encrypted transport and no runtime `sa`/`root` |
| Secrets | environment/secret manager injection; no committed production secret |
| Audit | actor, action, target, correlation, before/after or evidence reference, timestamp and outcome |
| Privacy | classification, least disclosure, export authorization, retention policy and DSAR log |
| Interface protection | webhook signature/secret, replay/idempotency handling, rate/timeout limits |
| Operations | security logging, alert routing, backup protection, patch/vulnerability process |

## 8. Deployment and operational specification

- Frontend is built as immutable static assets and served through controlled hosting/CDN/Nginx.
- Backend is built as an immutable container with environment-specific configuration and health endpoint.
- SQL Server and TruckScale connectivity must use private network/VPN/allowlist appropriate to the environment.
- Coolify deployment source includes `deploy/coolify/docker-compose.yml`, database backup script and `backend/.env.coolify.example`; production values must be supplied from secrets.
- On-prem deployment source is `deploy/onprem/` — Caddy reverse proxy with automatic TLS, SQL Server, MySQL, backend and frontend in one compose, started by `up.ps1`/`up.sh` and initialised by `bootstrap.sh`.
- Preflight verifies required configuration/dependencies before deployment (`backend/scripts/preflight-check.js`).
- Schema migration targets `local`, `remote` and `remote_b` with **`all` as the default**, executed by `backend/scripts/migrate-targets.js`, which fails the release when any target fails.
- Go-live requires migration dry run, backup plus restore test, monitoring/alert delivery, rollback or forward-fix decision, capacity check and signed operational handover.

### 8.1 Mandatory first-run database sequence

The WINSpeed `.bak` carries `dbo` only — schema `wf`, its database users and all application accounts are created by the deployment pipeline, so the following order is normative and must not be reordered:

1. `migrations/000_logins.sql` — creates server logins `wf_reader` / `wf_owner` (sysadmin required; excluded from the migration policy by design).
2. `node run_migrations.js` — creates schema `wf`.
3. `GRANT CONTROL ON SCHEMA::wf TO wf_owner; GRANT SELECT ON SCHEMA::wf TO wf_reader;`
4. `node seed_admin.js` — creates the administrator and maps every employee from `dbo.EMEmp` to a role plus the `EmpId` link required to export sales orders back to WINSpeed.

`001_wf_schema.sql` guards its grants with `IF EXISTS (... sys.database_principals ...)`, so running migrations before step 1 **skips the grants silently without error** and leaves `wf_owner` unable to write schema `wf`. Omitting step 4 leaves only `SALES` accounts with no administrator, so every login is rejected.

Any full restore repeats steps 1–4 because `RESTORE ... REPLACE` drops schema `wf` and its database users. `deploy/coolify/refresh-data.sh` and `deploy/onprem/bootstrap.sh` implement the full cycle.

Default credentials issued by step 4 are shared across all seeded accounts and must be rotated before go-live; rotation is a release gate.

## 9. Observability and error behavior

| Signal | Minimum evidence |
|---|---|
| Health | runtime version, uptime and SQL Server/MySQL dependency status |
| Request/error | correlation, route, status, duration and sanitized error record |
| Business audit | actor, transition, target, reason and before/after evidence |
| Outbox/integration | pending/attempt/retry/succeeded/dead-letter or equivalent disposition |
| Reconciliation | expected/actual, severity, owner, decision and closure evidence |
| Release | commit/build/version, migration result, deployment timestamp and rollback point |

API errors use consistent HTTP semantics: 400 validation, 401 unauthenticated, 403 unauthorized, 404 absent resource, 409 state/idempotency conflict and 5xx unexpected/dependency failure. User-facing messages must state recovery action without leaking credentials, SQL or stack traces.

## 10. Verification strategy

| Verification level | Current/required evidence |
|---|---|
| Static source alignment | source inventory/hash, route/endpoint/role/portal/migration extraction and review mapping |
| Unit/component | service/rule/data behavior tests, including negative and boundary cases |
| API/integration | contract tests, database transaction/idempotency, WINSpeed/TruckScale failure and reconciliation |
| Automated E2E | current run passed 10/10 on stable source with both databases health `up` |
| Manual UAT | eight-role scripts, exception paths, print/scan/hardware, financial reconciliation and sign-off |
| Operational readiness | backup/restore, alert delivery, migration, performance, security and rollback evidence |

## 11. Standards alignment and document control

The solution-development information set is organized using ISO/IEC/IEEE 29148:2018 for requirements, ISO/IEC/IEEE 42010:2022 for architecture description, ISO/IEC/IEEE 12207:2026 for life-cycle processes, ISO/IEC/IEEE 15289:2019 for information items, ISO/IEC 25010:2023 for product quality and ISO/IEC/IEEE 29119-3:2021 for test documentation. Security, continuity, usability and quality-management controls reference ISO/IEC 27001:2022, ISO 22301:2019, ISO 9241-210:2019 and ISO 9001:2015 as applicable.

References provide structure and review criteria only. Conformance or certification requires organizational scope, implemented controls, objective evidence, audit and authorized approval.

## 12. Open gates before baseline

- Business owner approval of requirements and role/accountability.
- Technical/security approval of all direct WINSpeed write contracts.
- Production-like TruckScale sync, real device and network failure evidence.
- Printing, QR scanning, custody and retention validation.
- Performance/capacity and database query-plan evidence.
- Backup restore, deployment rollback/forward-fix and operational alert evidence.
- Manual UAT/defect disposition and signed release readiness.