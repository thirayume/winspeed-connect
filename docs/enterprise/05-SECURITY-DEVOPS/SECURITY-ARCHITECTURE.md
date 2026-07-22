---
documentId: "WF-SEC-001"
title: "Security Architecture and Hardening Standard"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "IT Security / Solution Architect"
normative: true
---
# Security Architecture and Hardening Standard

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-SEC-001` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | IT Security / Solution Architect |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Security objectives

Protect credentials, business data, operational continuity and accounting integrity while remaining practical for factory users.

## Mandatory P0 controls before Full Production

- rotate all SQL Server, MySQL, JWT, seed-user and provider credentials exposed in history/defaults
- remove runtime use of `sa`, `root` or equivalent superuser
- create least-privilege identities:
  - `wf_owner`: schema deployment/control only
  - `wf_app`: wf write + only approved external rights
  - `ws_reader`: approved WINSpeed readonly views
  - `truckscale_bridge`: SELECT on completed-weigh/reference tables + INSERT/DELETE only on `tbl_keyone`
- store secrets only in approved secret manager/platform environment
- block `.env` in source and enable secret scanning
- enforce CORS allowlist, login rate limit, security headers, TLS and health
- retain structured audit logs

## Access control model

| Layer | Control |
|---|---|
| Browser | no secret; role-aware UX only |
| API | token, RBAC, object/state authorization |
| Database | least privilege/separate identities |
| Infrastructure | private endpoint/VPN/allowlist/MFA |
| Admin | privilege approval and review |
| Audit | append-only business/security events |

## Data classification

| Class | Example | Controls |
|---|---|---|
| Restricted | password, token, connection credential | secret store; never log |
| Confidential | price/rebate/customer commercial data | role access/encrypted transport |
| Personal | driver/contact | minimize/mask/retention policy |
| Internal | operating status/report | authorized access |
| Public | approved marketing | publication approval |

## Secure development

- dependency and vulnerability scan
- SAST/lint/type check
- secret scan pre-commit/CI
- parameterized SQL/input validation
- no raw error stack to client
- negative role/security tests
- restore and incident exercises

## Security incident response

Detect → Triage → Contain → Eradicate → Recover → Notify by policy → Post-incident corrective action
