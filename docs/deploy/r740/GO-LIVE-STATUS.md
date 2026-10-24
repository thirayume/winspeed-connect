# R740 go-live status (shared: Claude · Codex · Antigravity)

A snapshot of what is **live** and what is **pending** on R740-SRV, so every agent working this
repo shares the same picture. Keep it current: update this file in the same change that moves the
deploy state. For *how* to do each step, see [README.md](README.md).

**Authoritative as of 2026-10-25**, `origin/uat` = `cc30edf`.

## Done & verified (2026-10-25)

### UAT — live and healthy
- `origin/uat` deployed to `D:\SaleApp\uat`; backend healthy, `api/health` HTTP 200 at
  `https://172.16.30.169:8444`.
- `dbwins_worldfert9-uat` ledger: pending 0, drift 0 (152 migrations). First admin created; owner signed in.

### Both LIVE company databases migrated
`dbwins_worldfert9` (company 9) **and** `dbwins_worldfert2` (company 2) now carry the `wf` schema.
Run by the owner/IT through the per-DB runbook — Claude is classifier-blocked from production DB
writes, so the owner/IT executes them. Verified read-only:

| | dbwins_worldfert9 | dbwins_worldfert2 |
|---|---|---|
| `wf` schema objects | 582 | 582 |
| migration plan | pending 0, drift 0 | pending 0, drift 0 |
| `wf_r740_uat_app` DB user (switch access) | yes | yes |
| first app admin | created (SSMS) | created (SSMS) |
| `dbo` data / schema | untouched | untouched |

Per-DB runbook (files in this folder): `sql/r740-company-backup-<db>.sql` (SSMS, copy-only →
`<db>_predeploy_*.bak`) → `server/Migrate-Company.bat <db>` (plan 152 → apply → verify, backup-gated)
→ `New-R740AdminSql.ps1 -Database <db>` (IT runs the generated SQL in SSMS) → IT
`sql/r740-grant-app-access.sql` for `wf_r740_uat_app`.

### Database switcher (shipped on `uat`)
Topbar DB switcher + admin system-default setting; the green bar shows the database name. Roles with
`database.switch` = ACCOUNTING / COUNTER_SALES / C_LEVEL / ADMIN; `database.set-system` = ADMIN.
Allowlist pin `ONPREM_SWITCHABLE_DATABASES` (uat = `*`, prod = `dbwins_worldfert9,dbwins_worldfert9-uat,dbwins_worldfert2`).
A switched session gets full read/write and reverts to the system default on logout/timeout.

### Nightly self-heal wired
Task `AUTO Backup SQL2008` (daily 21:00, `Administrator` / Limited) now has **2 sequential actions**:
1. `D:\MSSQL\MSSQL10_50.SQL2008\Backup\run_backup.bat` — backup + restore `dbwins_worldfert9-uat`.
2. `host/Refresh-UAT.ps1` — re-map the uat principals, then unattended redeploy (`deploy-r740.ps1 -Auto`).

Because 9 now carries `wf` + migrations, the nightly restore copies them into `-uat`, so Refresh-UAT
step 2 just verifies + restarts. First real run: **tonight 21:00**. Log: `D:\SaleApp\uat\deploy-logs\refresh-*.log`.

## Pending — PROD app go-live
The company DB `dbwins_worldfert9` is **already migrated**, so the PROD **app-stack** go-live is now
mainly: a reviewed commit sets `SALEAPP_DEPLOY_ENABLED=true` (through `uat` → `main`) + prod secrets in
`D:\SaleApp\prod\config` (IT reports filled) → `deploy.bat prod` (the plan should be **pending 0**, since
the DB is migrated) → start `saleapp-prod` at `https://172.16.30.169`. Still open: version bump to 1.0.0;
enable employee accounts with a temporary password (handled server-side, **never in the repo**); a
non-dry-run test of the promotion workflows; a real TLS certificate once a domain exists.

## Constraints for concurrent / hotfix work — read before touching deploy or DB
- **`dbwins_worldfert9` and `dbwins_worldfert2` are LIVE production data.** Never change their `dbo`
  schema or data except through the already-granted, reviewed app columns (see
  `sql/r740-grant-app-access.sql`). Migrations add only `wf`; there are no `dbo` writes at migration time.
- Migrations on the live company DBs go **only** through `server/Migrate-Company.bat` (backup-gated),
  executed by the owner/IT. Do not run ad-hoc DDL/DML against 9 or 2.
- **Backup-gate change (`cc30edf`):** `migrate-company.sh` no longer refuses a backup under 60 s old
  (that floor false-stopped a go-live when the bat ran right after the backup; `RESTORE VERIFYONLY` in
  the backup SQL already proves completeness). It keeps the 120-minute ceiling + non-empty check and
  clamps a negative age for WSL/NTFS clock skew.
- **Branches:** push work to `uat`, not `main`; promote with the Actions workflows. Hotfixes branch from
  `main` and use "3. Hotfix to UAT and PROD". `origin/main` currently trails `origin/uat` — the recent
  r740 script commits (`cc1af76` admin `-Database`, `cc30edf` backup-gate) are on `uat`; promote when ready.
- Public repo: **no secrets, no `.env`, no PII, no real employee names** in tracked files.

## Watch-points
- **Tonight 21:00** — first Refresh-UAT run under the task's `Administrator` / Limited run level; it
  rebuilds images via docker-in-WSL. If it fails on elevation, set the task's RunLevel to Highest. Check
  `D:\SaleApp\uat\deploy-logs\refresh-*.log`.
