# Local UAT2 deployment brief

This procedure deploys Sale-App to the local UAT clone on `AMYOU-YOGA7\V2008R2`. The pinned database is `dbwins_worldfert9_uat2`; it is a writable copy restored from backup, not the production database. The first successful deployment can apply pending migrations to this UAT2 copy. It does not start Full Loop UAT by itself.

## 1. Prepare the clone and local settings

Use the existing clone at `C:\MyWork\WorldFert\Web-SaleApp-UAT`; do not clone over it or overwrite its local environment files. For a new clone:

```powershell
git clone --branch codex/onprem-wsl-deploy-review https://github.com/thirayume/winspeed-connect.git C:\MyWork\WorldFert\Web-SaleApp-UAT
cd C:\MyWork\WorldFert\Web-SaleApp-UAT
if (!(Test-Path .env)) { Copy-Item .\docker.env.example .\.env }
notepad .env
& .\docs\deploy\onprem\deploy-wsl.bat
```

Keep `.env` and `.env.migrator.local` in the repository root beside `docker-compose.yml`. Never commit, paste, or screenshot their values. Use distinct strong passwords; quote a password containing `$` with single quotes in the env file. The app password belongs only in `ONPREM_DB_PASSWORD`; the migrator password belongs only in `ONPREM_MIGRATOR_PASSWORD` in `.env.migrator.local`. The BAT's option 2 creates that local file from the example if needed and opens it in Notepad without replacing an existing file; enter the exact password assigned to `wf_local_uat_migrator` in SSMS.

Retain the pinned settings: SQL host `AMYOU-YOGA7\V2008R2`, TCP port `51433`, blank instance name, database `dbwins_worldfert9_uat2`, app login `wf_local_uat_app`, HTTP/HTTPS ports `8081`/`8444` for this machine, `APP_DOMAIN=localhost`, `CORS_ORIGIN=https://localhost:8444`, and `VITE_API_BASE_URL=/api`. The template defaults to HTTP `8080`; this machine uses `HTTP_PORT=8081` because an existing service owns `8080`. With Docker Desktop, set `ONPREM_DB_SERVER=host.docker.internal` so containers reach SQL on Windows. A separate native Docker Engine inside WSL needs the verified Windows gateway IPv4 address instead; a gateway that works from Ubuntu is not proof that Docker Desktop containers can reach it. Generate a new private `JWT_SECRET`. A successful TCP check alone does not prove SQL login/TLS success; the plan and API SQL health checks must also pass. If changing back to ports 80/443, first resolve the listeners shown below, then set CORS origin to `https://localhost`.

The current machine showed existing listeners on ports 80, 443, and 8080. The clone now uses 8081/8444. Before deployment, check the ports currently selected in `.env` (the command below checks this clone's settings):

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8081,8444 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

If a non-UAT service owns either selected port, select another free port in `.env` or resolve the conflict with its owner. Do not terminate an unidentified process. The wrapper validates that the published ports, Caddy listeners, and CORS origin agree. If you change the ports in `.env`, rerun the same check with those values.

## 2. Create the two SQL logins once

In SSMS, connect to `AMYOU-YOGA7\V2008R2` as the SQL administrator. Under **Security → Logins**, confirm `wf_local_uat_app` is enabled and create `wf_local_uat_migrator` if it is missing. Use SQL Server authentication and set or reset separate strong passwords in the SSMS login UI. Do not add either login to a server role. Store each password only in its matching local env file.

Run `deploy-wsl.bat` and choose option 1 to open the complete [`local-uat2-principals.sql`](sql/local-uat2-principals.sql) file; run the whole file once in SSMS. It selects the pinned UAT2 database, then checks the server, engine, target, required legacy tables/columns, and existing principals before changing anything. Its transaction sets both login default databases to UAT2, enables password policy with expiration disabled, creates/maps the dbo-owned `wf` schema, and grants the reviewed database permissions. It also creates an empty dbo-owned `wf_reader` database role required as a grantee by immutable migration 002; this role has no login or members. Password creation or reset remains in the SSMS login UI; the script does not create server logins, set passwords, assign server roles, or run migrations. If it stops, do not bypass its checks; review the reported prerequisite first.

## 3. Check WSL and deploy

In Windows PowerShell, check the WSL distribution name and version:

```powershell
wsl -l -v
```

Confirm the intended Ubuntu distribution appears in the output and is version 2. A Start-menu Ubuntu app alone does not prove that a WSL distribution is registered: if none is listed, open Ubuntu from Start once and complete first-run setup, then run `wsl -l -v` again. With Docker Desktop, enable **Settings → Resources → WSL Integration → Ubuntu**; do not select its internal `docker-desktop` distribution and do not install a second Docker Engine inside Ubuntu. The BAT prints the registered distro names and asks you to enter the exact one; it starts that distro once, as root, with the clone directory as its working directory. `WSL_STAGE=DEPLOY_SCRIPT_STARTED` confirms Bash reached the deploy script. In the Ubuntu shell, `docker info --format '{{.OSType}}'` must print `linux`, and `docker context show` should be `default`. The deploy checks the default Linux daemon reached from Ubuntu; Docker Desktop shows the containers when Ubuntu's WSL integration points there.

After the SQL login setup, correct target settings, and port check, double-click `C:\MyWork\WorldFert\Web-SaleApp-UAT\docs\deploy\onprem\deploy-wsl.bat` or invoke it from PowerShell. Choose option 1 to open the SQL setup file, option 2 to create/edit the local migrator settings, or option 3 to deploy/redeploy. The SQL file is never executed by the BAT:

```powershell
Set-Location C:\MyWork\WorldFert\Web-SaleApp-UAT
& .\docs\deploy\onprem\deploy-wsl.bat
```

Option 3 runs the guarded sequence: validate local settings and target, build Linux images, make a read-only migration plan, apply pending migrations to UAT2 only, verify the ledger with another read-only plan, then start the API and wait for HTTP plus SQL-ready health before starting the frontend and Caddy. Migrations already recorded are skipped on later deploys. If the target, access guard, plan, apply, post-apply verification, or health check fails, the stack stops; a failure after an apply is not a database rollback. Stop and inspect before another run.

Failed plan/apply/verification commands print a fixed `MIGRATION_DIAGNOSTIC` category and recognized error codes while keeping raw logs and credentials out of the terminal.

## 4. Create an application administrator

The SQL service logins are separate from accounts used to sign into the website. After deploying the backend, choose BAT option 4 to generate an application administrator SQL file. Enter the application username (default `admin`) and type the password normally at the hidden prompt. The tool creates bcrypt cost-12 hashes using local Node.js dependencies, or the running UAT backend container in Docker Desktop. It does not connect to SQL or create the account itself.

To supply the username as a parameter instead:

```powershell
$Username = 'admin'
$Password = Read-Host 'New app password' -AsSecureString
& .\docs\deploy\onprem\New-Uat2AdminSql.ps1 -Username $Username -Password $Password
```

The `Password` parameter accepts a `SecureString`; omitting it prompts privately. The generated Git-ignored `docs\deploy\onprem\sql\local-uat2-create-admin.local.sql` contains `@Username`, `@PasswordHash`, and `@DisplayName` parameters. It contains no plaintext password. SQL Server 2008 R2 does not provide the bcrypt function used by this app, so changing a plaintext SQL variable or using `HASHBYTES` cannot replace this generation step. Regenerate the file whenever you choose a different password.

Run the complete generated file in SSMS against the pinned UAT2 instance, then sign into the app with the username and password you entered. Its first batch enables the SET options required by filtered indexes, including `ARITHABORT ON`; `GO` separates that setup from the INSERT batch. Do not run only the INSERT selection. The script inserts only an `ADMIN` app account, requires a password change before app writes, and stops if that username already exists without resetting its password or role. Change the password in the app profile after login. Keep the generated file private.

## 5. Verify and keep scope clear

In Ubuntu WSL, inspect container status and the public health route:

```bash
docker compose ps
curl -kfsS https://localhost:8444/api/health
```

Require the backend to be healthy and the API health JSON to report SQL up. Review the plan summary for zero pending migrations and zero drift. A working health endpoint is still not Full Loop UAT evidence; migrations change the UAT2 backup copy, and the UAT run remains a separate step.

Verified on 23 October 2026: the guarded deploy completed with 149 unchanged migrations, zero pending migrations, and zero drift. The backend was healthy; both `https://localhost:8444/` and `/api/health` returned HTTP 200, with SQL `up`. A redeploy skipped all recorded migrations. This is deployment evidence for UAT2 only.

## Production isolation

The migration runner is pinned by the wrapper to `dbwins_worldfert9_uat2`. The on-prem SQL identity guard requires the app and migrator logins to have no direct access to `dbwins_worldfert9`, rejects elevated roles, and the SQL 2008 profile excludes migration 074. The runner also blocks an explicit cross-database production write in a migration batch. The UAT2 copy is expected to change; the original production database should not be targeted. These source checks do not prove that no trigger, stored procedure, linked server, or other indirect mechanism could produce side effects. If the production-access check is nonzero or unknown, deployment stops; do not remove the guard or change target names to proceed.
