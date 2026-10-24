# Sale-App on R740-SRV (172.16.30.169): UAT and PROD deploys

Deploys run **from the dev PC** with `deploy.bat`, over SSH (dedicated key, no password),
into WSL Ubuntu on R740-SRV, where Docker CE (Linux engine) runs the stacks. The Windows
Docker engine and Docker Desktop on that server are not used.

> **Current status for all agents (Claude · Codex · Antigravity):**
> [GO-LIVE-STATUS.md](GO-LIVE-STATUS.md) — what is live vs pending, and the constraints to respect
> when working on deploy or the databases. Updated 2026-10-25.

| | UAT | PROD |
|---|---|---|
| Git branch | `uat` | `main` |
| Server folder | `D:\SaleApp\uat` | `D:\SaleApp\prod` |
| Database (R740-SRV\SQL2008) | `dbwins_worldfert9-uat` | `dbwins_worldfert9` |
| SQL logins | `wf_r740_uat_app` / `wf_r740_uat_migrator` | `wf_r740_prod_app` / `wf_r740_prod_migrator` |
| URL | `https://172.16.30.169:8444` (HTTP 8091 redirects) | `https://172.16.30.169` (HTTP 8090 redirects) |
| Compose project / images | `saleapp-uat` / `worldfert-saleapp-uat-*` | `saleapp-prod` / `worldfert-saleapp-prod-*` |
| Status | enabled | **disabled until go-live approval** |

Port 80 stays with IIS and SSRS. TLS uses Caddy's internal CA for the IP address until a
domain exists; each browser device must trust the Caddy root certificate once.

## Branches and release flow

| Branch | Environment | Who moves it |
|---|---|---|
| work branches (e.g. `feature/...`, `fix/...`) | none | developers |
| `uat` | UAT, `D:\SaleApp\uat` | Actions "1. Promote branch to UAT" (or "3. Hotfix") |
| `main` | PROD, `D:\SaleApp\prod` | Actions "2. Promote UAT to PROD" (or "3. Hotfix") |

The three workflows run only when started from **Actions > workflow > Run workflow**. Each one
merges or fast-forwards in the runner, runs the CI checks (backend tests, frontend build,
batch/script/secret checks) on that exact tree, then pushes. `dry_run` checks without pushing.
GitHub cannot reach R740-SRV, so deploying stays a separate, manual step.

1. Normal change: finish the work branch, then **1. Promote branch to UAT** (`source` = the
   branch). Deploy UAT and test.
2. UAT passed: **2. Promote UAT to PROD** with `uat_commit` = the commit you tested (from the UAT
   deploy receipt). It refuses if `uat` moved since, or if `main` has commits `uat` lacks.
   Then deploy PROD.
3. Hotfix: branch from `main`, then **3. Hotfix to UAT and PROD** (`source` = the hotfix
   branch). It fast-forwards `main`, merges into `uat`, tests both, and pushes them together.
   It refuses a branch cut from `uat`. Then deploy with `hotfix`.

Deploy, from the dev PC (over SSH) or on R740-SRV (local WSL; one-click files in `D:\SaleApp`):

| | Dev PC | On R740-SRV |
|---|---|---|
| UAT | `docs\deploy\r740\deploy.bat uat` | `D:\SaleApp\Deploy-UAT.bat` |
| PROD | `docs\deploy\r740\deploy.bat prod` | `D:\SaleApp\Deploy-PROD.bat` |
| Hotfix (UAT then PROD) | `docs\deploy\r740\deploy.bat hotfix` | `D:\SaleApp\Deploy-HOTFIX.bat` |

Each environment shows the commit it will deploy and asks for `YES`, then shows the migration
plan and asks for `APPLY` (PROD: the database name). Add `-PlanOnly` to stop after the plan.
The server files come from [`server/`](server) and run the driver kept current in the UAT clone.

## Server layout

```text
D:\SaleApp\
  uat\app\            clone of origin/uat, created by the first deploy (do not edit)
  uat\config\         .env and .env.migrator.local (secrets, never in Git)
  uat\deploy-logs\    one receipt per plan/apply run
  prod\...            same for production
  tools\              host checks and one-time host setup
```

## One-time setup

1. **Host** (owner, on R740-SRV, elevated PowerShell). The scripts in [`host/`](host) live in
   `D:\SaleApp\tools` on the server:
   - `Check-SaleAppHost.ps1` (+ `wsl-check.sh`): read-only report of Docker, WSL, ports, SQL network.
   - `Enable-SaleAppSsh.ps1 -AllowFrom <VPN range>`: OpenSSH + the dev PC deploy key (done 2026-10-23).
   - `Set-SaleAppHost.ps1 -Apply`: `.wslconfig` idle timeouts, the startup task running
     `SaleApp-KeepAlive.ps1` (keeps WSL/Docker up and retries if WSL is not ready at boot,
     rebinds portproxy if IP Helper started before the LAN address), portproxy
     172.16.30.169:<port> -> WSL, and firewall rules (existing scopes are kept unless
     `-AllowFrom` is given). The keep-alive logs to `D:\SaleApp\tools\out\keepalive.log`.
   - `docker ps` in Windows PowerShell shows the unused Windows engine; inspect the stacks
     with `wsl -d Ubuntu -u root docker ps`.
2. **SQL logins** (IT, SSMS on R740-SRV\SQL2008): create `wf_r740_uat_app` and
   `wf_r740_uat_migrator` (SQL authentication, two different passwords, no server roles,
   no user mapping), then run [`sql/r740-uat-principals.sql`](sql/r740-uat-principals.sql).
   Its last result must show `OK` for both logins. It never touches `dbwins_worldfert9`.
3. **Secrets** (IT or owner, on R740-SRV): copy [`uat.env.example`](uat.env.example) to
   `D:\SaleApp\uat\config\.env` and [`uat.migrator.env.example`](uat.migrator.env.example)
   to `D:\SaleApp\uat\config\.env.migrator.local`; fill in the two SQL passwords and a new
   JWT secret. Nobody else needs to see them.

## Deploy

```bat
docs\deploy\r740\deploy.bat uat
```

1. Shows the `origin/uat` commit and asks for `YES`.
2. **Plan** on the server: syncs `D:\SaleApp\uat\app` to that exact commit, checks the
   resolved Compose model against [`targets/uat.env`](targets/uat.env) (server, database,
   logins, ports, safety flags, separate passwords), builds the images, and runs the
   read-only migration plan.
3. Lists the pending migrations and asks for `APPLY` (or `YES` if none are pending).
4. **Apply**: repeats the checks, refuses if the plan changed, applies the migrations,
   verifies the ledger (pending 0, drift 0), starts the backend, waits for a healthy SQL
   check, then starts the frontend and Caddy.

`deploy.bat uat -PlanOnly` stops after step 2. Each run leaves a receipt in
`D:\SaleApp\uat\deploy-logs`. A failed apply is not rolled back: restore the UAT database
from its backup or inspect it before running again.

Before the first apply, the plan is expected to list most migrations as pending because
`dbwins_worldfert9-uat` was restored from Live Production (data of 2026-10-23 18:00).

## After the first UAT deploy

- **First app administrator:** on the dev PC run
  `powershell -NoProfile -ExecutionPolicy Bypass -File docs\deploy\r740\New-R740AdminSql.ps1`,
  type a username and password (hidden), and give IT the generated, Git-ignored
  `docs\deploy\r740\sql\r740-uat-create-admin.local.sql` to run in SSMS. It holds only a
  bcrypt hash; the account must change its password at first sign-in.
- **Browser trust:** each deploy copies the stack's public Caddy root certificate to
  `D:\SaleApp\uat\caddy-root.crt` (SHA-256 `372F3202…1D0FA8`). Never copy anything else
  from Caddy's data. Clients trust it once:
  - Domain PCs: Group Policy, Computer Configuration > Policies > Windows Settings >
    Security Settings > Public Key Policies > Trusted Root Certification Authorities >
    Import `caddy-root.crt`.
  - Other PCs: [`client/Install-SaleAppCert.bat`](client/Install-SaleAppCert.bat) next to the
    certificate on the share; double-click, accept UAC. It refuses a file whose fingerprint
    differs, so a swapped file on the share is never trusted.

## PROD go-live (prepared, not started)

PROD uses the same images, Compose file and scripts as UAT. What differs is pinned in
[`targets/prod.env`](targets/prod.env): `dbwins_worldfert9`, `ONPREM_TARGET_KIND=production`,
ports 443/8090, a backup gate and the UAT Caddy root. Until the steps below, nothing touches
`dbwins_worldfert9`.

1. **UAT sign-off**, then the owner approves fast-forwarding `main` to the tested `uat` commit.
2. **Go-live switch**: a reviewed commit sets `SALEAPP_DEPLOY_ENABLED=true` in
   `targets/prod.env` (through `uat`, then `main`).
3. **SQL logins** (IT, maintenance window): create `wf_r740_prod_app` / `wf_r740_prod_migrator`
   (new passwords, no server roles, no mapping), run
   [`sql/r740-prod-principals.sql`](sql/r740-prod-principals.sql); both rows must be `OK`
   (they cannot open `dbwins_worldfert9-uat` or any other user database).
4. **Secrets**: [`prod.env.example`](prod.env.example) -> `D:\SaleApp\prod\config\.env`,
   [`prod.migrator.env.example`](prod.migrator.env.example) -> `.env.migrator.local`.
5. `docs\deploy\r740\deploy.bat prod -PlanOnly` (read-only): expect 151 pending, drift 0.
6. **Backup** (IT, SSMS): [`sql/r740-prod-backup.sql`](sql/r740-prod-backup.sql), a verified
   copy-only backup in `D:\MSSQL\MSSQL10_50.SQL2008\Backup`.
7. `deploy.bat prod`: confirm the commit, then type `dbwins_worldfert9` to apply. The server
   refuses without that backup (younger than 120 minutes) or if the plan changed, applies the
   migrations, verifies, starts the stack at `https://172.16.30.169` and reuses the UAT root,
   so clients need no new certificate.
8. First admin: `New-R740AdminSql.ps1 -Environment prod`, run by IT in SSMS.

If an apply fails: stop the `saleapp-prod` stack first. The migrations add only `wf`
objects (no `dbo` writes at migration time), so WINSpeed keeps working. Restore the step 6
backup only for real damage; a restore also discards WINSpeed entries made after it, so
apply in a quiet window right after the backup.

## Guards worth knowing

- The app and migrator refuse to run if their login can open `dbwins_worldfert9`, is in an
  elevated role, or the connection is not TCP to `R740-SRV\SQL2008` 10.50.x.
- Target values live only in `targets/*.env` (reviewed in Git); `config\.env` holds secrets.
- Background workers are on in both R740 targets (`DISABLE_BACKGROUND_WORKERS=false`): the
  5-second polling that refreshes open screens (read-only on `dbo.SOHD`) and the outbox
  worker (marks `wf.OutboxEvent` done). Neither writes `dbo`. Local UAT2 keeps them off.
- Migration 154 locks employee accounts still on the shared default password from 049;
  an administrator re-enables a person by activating the account with a temporary password.
- `ONPREM_TARGET_KIND` (pinned per target): `uat` refuses `dbwins_worldfert9` and any login
  that can open it; `production` accepts only `dbwins_worldfert9` and refuses a login that
  can open any other user database.
