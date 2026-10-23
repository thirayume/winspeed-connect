# Sale-App on R740-SRV (172.16.30.169): UAT and PROD deploys

Deploys run **from the dev PC** with `deploy.bat`, over SSH (dedicated key, no password),
into WSL Ubuntu on R740-SRV, where Docker CE (Linux engine) runs the stacks. The Windows
Docker engine and Docker Desktop on that server are not used.

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

Flow: develop on a branch, merge into `uat`, run `deploy.bat uat`, test. When UAT passes,
fast-forward `main` to the tested `uat` commit and (after go-live approval) `deploy.bat prod`.

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

1. **Host** (owner, on R740-SRV, elevated PowerShell): `D:\SaleApp\tools\Enable-SaleAppSsh.ps1`
   (done 2026-10-23), then `D:\SaleApp\tools\Set-SaleAppHost.ps1 -Apply`. That keeps WSL
   running, forwards the stack ports from 172.16.30.169 into WSL and opens the firewall.
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

## Guards worth knowing

- The app and migrator refuse to run if their login can open `dbwins_worldfert9`, is in an
  elevated role, or the connection is not TCP to `R740-SRV\SQL2008` 10.50.x.
- Target values live only in `targets/*.env` (reviewed in Git); `config\.env` holds secrets.
- PROD needs a reviewed production profile before `SALEAPP_DEPLOY_ENABLED=true`: the
  guard above blocks the production database by design, and a backup step must precede
  migrations.
