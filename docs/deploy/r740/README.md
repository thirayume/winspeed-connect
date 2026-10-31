# Sale-App on R740-SRV (172.16.30.169): UAT and PROD deploys

Deploys run **from the dev PC** with `deploy.bat`, over SSH (dedicated key, no password),
into WSL Ubuntu on R740-SRV, where Docker CE (Linux engine) runs the stacks. The Windows
Docker engine and Docker Desktop on that server are not used.

> **Current status for all agents (Claude · Codex · Antigravity):**
> [GO-LIVE-STATUS.md](GO-LIVE-STATUS.md) — what is live vs pending, and the constraints to respect
> when working on deploy or the databases. Runbook refreshed 2026-10-31 (160 migrations).

| | UAT | PROD |
|---|---|---|
| Git branch | `uat` | `main` |
| Server folder | `D:\SaleApp\uat` | `D:\SaleApp\prod` |
| Database (R740-SRV\SQL2008) | `dbwins_worldfert9_uat` (restored from PROD every night at 21:00) | `dbwins_worldfert9` |
| SQL logins | `wf_r740_uat_app_v2` / `wf_r740_uat_migrator_v2` | `wf_r740_prod_app` / `wf_r740_prod_migrator` |
| Public URL | `https://wfuat.duckdns.org` | `https://worldfert.duckdns.org` |
| LAN URL | `https://172.16.30.169:8444` (HTTP 8091 redirects) | `https://172.16.30.169` (HTTP 80 redirects) |
| Compose project / images | `saleapp-uat` / `worldfert-saleapp-uat-*` | `saleapp-prod` / `worldfert-saleapp-prod-*` |
| Native WinSpeed writers (AI/104/116/107) | on, for Full Loop simulation on the clone | off; Production prints WinSpeed documents read-only |

The public hostnames have Let's Encrypt certificates through Caddy (DNS-01 with DuckDNS); see
[DuckDNS public ingress](DUCKDNS-PUBLIC-INGRESS.md). The LAN IP endpoints still use Caddy's
internal CA, so a device that uses the IP address must trust the Caddy root certificate once.
[DNS, PKI and ACME preparation](TLS-DNS-PKI-ACME.md) covers the remaining options for a company
domain.

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

Practical notes from October 2026:

- `source` takes a **branch name**. A commit hash fails at the fetch step ("couldn't find
  remote ref", exit 128).
- After **Run workflow**, check that a new run appears in the list within a few seconds. On
  31 October two dispatches (UAT and PROD) were accepted in the browser but created no run, so
  the branch never moved and the following deploy would have redeployed the old commit.
- If a dispatch leaves no run, the owner may allow a direct **fast-forward** push of the tested
  commit (`git push origin <commit>:refs/heads/uat`, or `main` for PROD). Never force; confirm
  `git merge-base --is-ancestor origin/<branch> <commit>` first, note that the workflow's CI step
  was skipped (the same backend tests and frontend build must have passed locally), and record it
  in [GO-LIVE-STATUS.md](GO-LIVE-STATUS.md).
- Before recording a PROD release as done, check `origin/main`, the new `prod-apply-<commit>`
  receipt in `D:\SaleApp\prod\deploy-logs`, health and the bundle — not only the person's report.

Deploy, from the dev PC (over SSH) or on R740-SRV (local WSL; one-click files in `D:\SaleApp`):

| | Dev PC | On R740-SRV |
|---|---|---|
| UAT | `docs\deploy\r740\deploy.bat uat` | `D:\SaleApp\Deploy-UAT.bat` |
| PROD | `docs\deploy\r740\deploy.bat prod` | `D:\SaleApp\Deploy-PROD.bat` |
| Hotfix (UAT then PROD) | `docs\deploy\r740\deploy.bat hotfix` | `D:\SaleApp\Deploy-HOTFIX.bat` |

Each environment shows the commit it will deploy and asks for `YES`, then shows the migration
plan. With pending migrations it asks for `APPLY` (PROD: the database name, and a fresh backup is
required); with none pending it asks for `YES` to restart the stack on the new commit. Answering
`APPLY` to the restart prompt stops without changes. Add `-PlanOnly` to stop after the plan.
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
2. **Isolated UAT SQL logins**: first copy the UAT templates into the private config paths
   described below. The owner selected two new clone-only logins on 28 October,
   because the old UAT application login can also open Production. On R740, after preparing
   the private config files below, run
   [`host/Initialize-R740UatIsolated.ps1`](host/Initialize-R740UatIsolated.ps1) without `-Apply`
   for its read-only plan, then with `-Apply` for the approved setup. It refuses existing login
   names, creates `wf_r740_uat_app_v2` / `wf_r740_uat_migrator_v2`, generates separate passwords
   on the server, applies the existing reviewed UAT grants, and proves zero access to Production
   or any other user database. It retains the original isolation check. Existing logins and
   Production permissions are unchanged. UAT JWT sessions are rotated; app-user passwords are
   not changed. Recovery copies are restricted to SYSTEM and Administrators in the UAT config
   directory. Do not copy them off the server.
   The owner also approved clone-only CONNECT denials for `wf_r740_prod_app` and
   `wf_r740_prod_migrator`. The principal script repeats them after every restore and
   proves those two identities cannot open UAT. Their live Production permissions stay unchanged.
3. **Private config paths** (IT or owner, on R740-SRV): copy [`uat.env.example`](uat.env.example) to
   `D:\SaleApp\uat\config\.env` and [`uat.migrator.env.example`](uat.migrator.env.example)
   to `D:\SaleApp\uat\config\.env.migrator.local` before step 2. The isolated setup helper
   fills the generated SQL passwords and UAT JWT secret; these are not web-admin passwords.
   Keep both files and their recovery copies on the server.

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
`D:\SaleApp\uat\deploy-logs`. Each migration and its ledger row commit together. Earlier
successful migrations remain committed if a later migration fails; inspect a fresh read-only
plan before retrying. Receipts preserve only fixed diagnostic categories, SQL numbers and
migration filenames. Raw connection errors and credentials are not written to receipts.

Migration 157 has a hash-pinned compatibility artifact for the verified SQL server identity
`R740-SRV\SQL2008`. Its fixed trigger-metadata reader uses `EXECUTE AS SELF`, binding to the
dedicated login that the runner has already verified. The original migration remains unchanged
for UAT2, including deployments using the `onprem` profile. All native writer target guards
remain pinned to the previously tested UAT2 target; applying this artifact does not enable
104/116/107 business writes on R740.

After restoring a Production backup, `sql/r740-uat-principals.sql` also remaps that
reader to the existing isolated `wf_r740_uat_migrator_v2` database user. Otherwise
the copied SELF binding points at the Production migrator, whose UAT CONNECT is
intentionally denied, and Invoice 107 preview fails. The remap accepts only the
exact reviewed SELECT-only body, handles SQL2008 CREATE/ALTER catalog headers,
and rolls back principal setup if the body differs. Repeating it is idempotent.
It never removes the Production users' clone-only denials or changes a writer body.
When installing this correction on an already-restored clone, run the reviewed
principal setup once after updating the UAT checkout; a normal code redeploy alone
does not perform the administrator principal remapping. Subsequent nightly refreshes do.

Migration 158 separately extends the restricted simulation to the exact verified R740 UAT
tuple originally used on this server. It preserves the prior business
bodies of nine procedures and replaces only their target predicate; the JavaScript services
also check an independent static allowlist. Both live company databases remain denied.
The UAT target enables AI/104/116/107 for Full Loop simulation; Production flags stay false.
This does not support physical shipment, multi-line/partial coupons or other tax contracts.
Use the current deployment receipt and [status](GO-LIVE-STATUS.md) to distinguish the running
commit from a candidate that has only passed rollback validation.

Migration 159 moves that predicate to the owner-corrected underscore clone
(`R740-SRV\SQL2008`, `dbwins_worldfert9_uat`, DB ID 10), retaining the original local UAT2 tuple
and retiring the old R740 hyphenated tuple. Migration 158 remains byte-identical. UAT now has
an allowlist containing only the underscore clone and uses the isolated v2 logins. Production
work belongs in the separate Production web app.

Migrations 160–162 (applied on UAT and PROD on 30–31 October) change only the restricted
simulation writers, which stay off in Production:

- 160: a native 116 records the requester's WinSpeed employee as recorder (`SaveEmpID`) and
  leaves the WinSpeed approver empty; the approver is kept in `wf.NativeDocumentApproval`, and
  the approver list (`wf.NativeApproverEmployee` + history) is maintained in Master Data.
- 161: the 116 number is the transport slip: the booking's scale `MoveBill` when there is one
  (within ±2% of the coupon tons, otherwise an exception), or a typed 7-digit slip number as an
  exception approved by a manager, executive or administrator other than the requester.
- 162: the 107 writer accepts the scale record that a 116 slip came from.

The owner selected Production app accounts for UAT after the nightly restore (27 October 2026).
Do not preserve or overwrite the restored `admin` password hash with a separate UAT hash.

The owner corrected UAT to `dbwins_worldfert9_uat`, verified DB ID 10, restored from
`dbwins_worldfert9_20261027_210002.BAK`. It starts with 152 ledger rows. Inspect the fresh
plan; the former hyphenated clone and its deployment receipts do not prove this copy migrated.

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

## Production

Public domain ingress: [DuckDNS ports, routing, ACME and rollback](DUCKDNS-PUBLIC-INGRESS.md).
Both hostnames use one Caddy on 80/443, with separate app/database routes; UAT's IP
endpoint stays on 8444. The public edge never uses the unrelated service on 8443.

PROD uses the same images, Compose file and scripts as UAT. What differs is pinned in
[`targets/prod.env`](targets/prod.env): `dbwins_worldfert9`, `ONPREM_TARGET_KIND=production`,
ports 80/443, a backup gate, the UAT Caddy root and the four AI/104/116/107 writer flags set to
`false`. Production has been live since 30 October 2026. The web stack, reports and read-only
WinSpeed prints are in use; the native writers, AR reports, GL posting and physical
weighing/shipment are still business acceptance items, not certified by a deploy.

### Routine release (owner)

1. UAT passed on a commit (from the UAT deploy receipt).
2. **2. Promote UAT to PROD** with `uat_commit` = that commit; check that the run appears and
   passes (see the practical notes above).
3. Only if the plan has pending migrations: a verified copy-only backup with
   [`sql/r740-prod-backup.sql`](sql/r740-prod-backup.sql) in SSMS (younger than 120 minutes).
4. `docs\deploy\r740\deploy.bat prod`: `YES` for the commit, then the database name
   `dbwins_worldfert9` when migrations are pending, or `YES` to restart when none are.
5. Verify, read-only: the `prod-apply-<commit>` receipt, `https://worldfert.duckdns.org/api/health`,
   the frontend bundle, `wf.fn_IsInitialNativeUatTarget()` = 0 on `dbwins_worldfert9`, and all
   writer flags false in `saleapp-prod-backend-1` (the four pinned flags plus
   `COUPON_NATIVE_POSTING_ENABLED`; `ALLOW_TEST_NATIVE_WRITEBACK` unset).

### First go-live (done 30 October 2026, kept for reference)

UAT sign-off; `SALEAPP_DEPLOY_ENABLED=true` in `targets/prod.env`; IT created
`wf_r740_prod_app` / `wf_r740_prod_migrator` and ran
[`sql/r740-prod-principals.sql`](sql/r740-prod-principals.sql) (both rows `OK`); secrets from
[`prod.env.example`](prod.env.example) and [`prod.migrator.env.example`](prod.migrator.env.example)
in `D:\SaleApp\prod\config`; `deploy.bat prod -PlanOnly`; backup; `deploy.bat prod`; first admin
with `New-R740AdminSql.ps1 -Environment prod`, run by IT in SSMS.

If an apply fails: stop the `saleapp-prod` stack first. The migrations add only `wf`
objects (no `dbo` writes at migration time), so WINSpeed keeps working. Restore the backup only
for real damage; a restore also discards WINSpeed entries made after it, so apply in a quiet
window right after the backup.

## Guards worth knowing

- The env-file source guard is tested with Docker Compose 5.6.1 on R740 and in CI.
  An implementation that omits `env_file` from `config --no-env-resolution --format json`
  fails closed; never replace that check with the resolved environment alone.
- The UAT app and migrator enforce the UAT target isolation rules. The Production target
  requires the live database and its dedicated logins. Both enforce their reviewed roles,
  TCP and SQL server/version identity.
- The four native AI/104/116/107 feature flags are pinned in `targets/*.env` and checked in
  the resolved Compose model (UAT `true`, PROD `false`). `COUPON_NATIVE_POSTING_ENABLED` is not
  pinned and defaults to `false`; check it after each PROD deploy. The SQL writers also refuse
  any database other than the UAT clone (`wf.fn_IsInitialNativeUatTarget()` returns 0 on PROD).
- Target values live only in `targets/*.env` (reviewed in Git); `config\.env` holds secrets.
- Background workers are on in both R740 targets (`DISABLE_BACKGROUND_WORKERS=false`): the
  5-second polling that refreshes open screens (read-only on `dbo.SOHD`) and the outbox
  worker (marks `wf.OutboxEvent` done). Neither writes `dbo`. Local UAT2 keeps them off.
- Migration 154 locks employee accounts still on the shared default password from 049;
  an administrator re-enables a person by activating the account with a temporary password.
- `ONPREM_TARGET_KIND` (pinned per target): `uat` refuses `dbwins_worldfert9` and any login
  that can open it; `production` accepts only `dbwins_worldfert9` and refuses a login that
  can open any other user database.
