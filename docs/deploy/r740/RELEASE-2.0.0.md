# Release 2.0.0 (hand-over release, November 2026)

Previous release: [1.2.0](RELEASE-1.2.0.md) (`e4e1028`, 20 November 2026). Migrations: through **253** (246 and 250
excluded in `backend/migration-policy.json`). WinSpeed native writers stay off in Production.

## What changed for users

**Owner decisions of 20 November 2026**
- **Menu switches (ADMIN):** App Settings > *เปิด/ปิดเมนูและรายงาน* switches any menu off for everyone except ADMIN, who
  still sees it marked "ปิดอยู่สำหรับผู้ใช้อื่น". Dashboard, App Settings and Users stay on. Each report is switched in the
  same page (report catalog).
- **Who approves a booking in the app:** COUNTER_SALES, ACCOUNTING, MANAGER, C_LEVEL and ADMIN (no longer SALES). The
  approver must be enabled on the WinSpeed approver list (Master data > native approvers), inside their org-chart scope,
  and never the seller of the bill. The in-app approval switch itself stays off in Production.
- **116 cut after the 104's ShipDate:** App Settings > ตั๋วคุม: 0 no check, 1 allow but warn and record a rule incident
  (default), 2 refuse. Accounting confirmed there is no haul deadline.
- **A 107 deleted and posted again in WinSpeed** (accounting's normal correction): Sale-App follows WinSpeed every hour and
  records an INVOICE_107_REPLACED incident; nothing is blocked or reversed.
- **Giveaway Set Zero (ADMIN):** App Settings > *Set Zero ของแถม*. Budgets stay; used quantities count again from that
  moment; history stays. Sale-App only, repeatable (planned again on 31/12/2569).
- **Acceptance record:** App Settings > *ผลตรวจรับงาน* is back for the hand-over sign-off.
- **Second company (`dbwins_worldfert2`):** giveaway quotas now equal company 9's (52 lines, goods matched by code).

## Quality

- Every CI verify step passes locally and on GitHub: backend suites, offline migration rehearsal, frontend build and the
  browser suites (resilience, data window, Users/Roles/App Settings, trip setup).
- Data migrations 251–253 rehearsed with their rollbacks inside rolled-back transactions on the UAT copy of Production.
- Load test of 1.2.0 (30 users, P95 1.6 s, 0 errors) still applies: 2.0.0 adds no heavy read.
- Repository: one deploy kit (`docs/deploy/r740`), one rulebook (`CLAUDE.md`), no ad-hoc files; old branches kept as
  `archive/*` tags.

## Deploying 2.0.0

As [README.md](README.md) "Routine release": backups of both company databases, `migrate-company.sh dbwins_worldfert2`
(plan, apply), fast-forward `main`, `deploy.bat prod` (`YES`, then `dbwins_worldfert9`). Migrations 252 and 253 are
pending on every database. After deploy: Rebate reset and giveaway Set Zero are run from App Settings by an ADMIN; the
data start date stays 01/01/2569.
