# Local UAT2 deployment brief

Current UAT2 restriction (25 October 2026): native flags default to false. Migration155 and the restricted complete104 API checks have passed on the pinned local UAT2 target; only that reviewed test stack may enable `NATIVE_DELIVERY_104_ENABLED`. Keep `COUPON_NATIVE_POSTING_ENABLED=false`. The confirmed chains are account1 I booking → I sales order → C coupon → J invoice, and account2 K → K → D → N. Migration155 replaces the incomplete153 writer with a separate book-aware contract that issues a numbered coupon and establishes the202 receivable in the same transaction. It does not repair earlier pilot documents. Keep those documents for audit; do not edit applied153 or run a bulk coupon repair. SQL2008 rollback rehearsals are separate evidence from deployment and API acceptance.

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

The deploy wrapper also builds the UAT Caddy image with its public `Caddyfile.uat` inside. This avoids stale WSL file bind mounts after Docker Desktop restarts. Only the Dockerfile and Caddyfile enter that build context; local settings and generated SQL are excluded. Certificates remain in the existing named Caddy volumes. After changing Caddy configuration, use the same deployment menu to rebuild and redeploy it.

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

The optional `NATIVE_BOOKING_AI_ENABLED=true` pilot requires migration 152 and is
restricted in both service and procedure to the pinned local UAT2 instance/database/DBID.
Its default is false. It supports only the unchanged initial, single-line, zero-tax,
zero-discount app-origin booking without references, descendants, coupons, picking
or weighing. Enabling it captures a native fingerprint during each new confirmation;
bookings created before this capture cannot be adopted automatically. The booking
detail and Paper Trail offer the separate AI approval action for authorized mapped
employees. Number, approval, durable request receipt and both audits commit together.
Retry the same request to recover its receipt; changing the request conflicts. This
pilot does not enable 104, native 116, invoice posting or production deployment.
Its approved bookings remain blocked from shipment until the downstream 104/116
contract is implemented and verified; disabling the pilot flag does not remove this hold.

The separate `NATIVE_DELIVERY_104_ENABLED=true` pilot requires migration 155 and
an initial app-origin AI receipt. Its default is false. It supports only one full
line with matching stock/sale units, zero VAT/discount and the observed UAT2
credit-warning profile: zero credit limit, no unsettled or unknown remaining debt,
no active temporary/approved credit and the verified native deduction/warning modes.
Fully settled historical invoices are allowed. Other credit profiles and partial
quantities stop without guessing their calculation or native effects. Packaging
must come from the product master and resolve to whole bags in tonnes. A unique
open native accounting period and the supported I/K plus C/D counter formats are
required. It preserves the source shipment date and advances the relevant active
or inactive book without switching WinSpeed's active book.

On booking details or Paper Trail, the requester selects **ออกใบสั่งขาย 104** and
requests over-credit approval. An `ACCOUNTING` user reviews it through
**อนุมัติเกินวงเงิน 104** on Paper Trail and enters a reason. Account may approve its
own request under the Owner decision; actual and effective requester/approver are
recorded. Approval lasts 30 minutes and is bound to the current document/credit
fingerprint. The same requester then issues the full 104. A new request supersedes
only that requester's earlier pending/approved decision; another operator cannot
take it over. Senior roles can use authorized Access As to work as Account, but
their own role is not itself a credit-approval capability.

Native104, its numbered C/D coupon, source remaining balance, document/ID books,
Define_104,202 SOInvHD/DT, SMSat/SMReserveSat, zero-tax VTVAT, SMAudit, SMEvent,
wf audit and durable v2 receipt commit together. VAT and SAT IDs use separate
application-owned native ID blocks; the SAT block uses native Type2 allocation.
Retry the same request after an uncertain response; a completed receipt is verified
against source, delivery and finance fingerprints and exact typed references. Old
v1 or cross-account receipts are rejected. The native document-number identity is
branch + document number + document type. This contract does not post stock,116
or107, or remove the AI shipment hold. Later lifecycle changes need their own
verified continuation contract. Never sum raw202 and coupon107 balances as two
receivables. Production remains excluded.

The migration runner is pinned by the wrapper to `dbwins_worldfert9_uat2`. The on-prem SQL identity guard requires the app and migrator logins to have no direct access to `dbwins_worldfert9`, rejects elevated roles, and the SQL 2008 profile excludes migration 074. The runner also blocks an explicit cross-database production write in a migration batch. The UAT2 copy is expected to change; the original production database should not be targeted. These source checks do not prove that no trigger, stored procedure, linked server, or other indirect mechanism could produce side effects. If the production-access check is nonzero or unknown, deployment stops; do not remove the guard or change target names to proceed.

### Controlled manual116 simulation

The separate `NATIVE_MANUAL_116_ENABLED` flag defaults to false and requires
migration156. This contract is a local UAT2 simulation of a manual exception,
available from a confirmed booking on Paper Trail after complete104. Warehouse
and Account create a request with a reason and UAT receiver/vehicle details.
Managers, executives and administrators may approve another person; Warehouse
and Account may approve their own request. Actual actors determine self-approval
even during Access As. This permission does not grant credit approval or the
legacy expired-ticket override.

The request retains server-generated UAT document evidence and binds the
reason, receiver, vehicle and evidence when approved. Changed payloads or native
documents invalidate the decision. Approval lasts30minutes. The original
requester applies it; native116, one full coupon deduction, native counters and
ID blocks, typed audit/event and a durable before/after receipt commit together.
Existing104/202/VAT snapshots must remain exact except for the coupon remaining
quantity. The automatic document number skips existing numbers under locks;
operators do not provide a native number or approver ID.

The UI and receipts explicitly say UAT simulation. It creates no WGHD/WGDT,
weights, loaded/shipped state, stock107, receivable, GL or proof of physical
delivery. Existing reservations, overlays, partials, prior cuts and unsupported
lifecycle branches stop. Real TruckScale integration and the general manual
exception remain separate acceptance work. Do not enable the legacy native
coupon adapter to bypass these boundaries.

### Initial coupon Invoice107 simulation

`NATIVE_INVOICE_107_ENABLED=false` is the default. Enable only for the pinned
local UAT2 after migration157 and a reviewed rehearsal. Only ACCOUNTING may
preview or post. Existing Access As authorization still applies and both actual
and effective identities are recorded. Admin/Manager roles do not directly gain
the posting capability.

Paper Trail offers a Post Invoice preview after the complete104 and approved
manual116 simulation. The first supported contract posts one full zero-tax line,
preserves I/C/J or K/D/N, and uses the native116 date. It recalculates the due date
from the invoice date and credit days. A different invoice date is not yet
verified. Confirm the date and stock deduction before posting.

One transaction creates native107, its SAT identity and stock row, consumes the
pending116 quantity and104 remaining quantity, advances the appropriate invoice
counter, and stores the application audit and receipt. Repeated identical
commands verify the receipt and return the existing invoice. Original116
before/after hashes remain intact; only a verified application107 continuation
can advance the current state. External native changes are not adopted.

Document Trace displays the native116 number, quantity and unit from its typed
API fields. Financial documents keep their own202/107 labels; a202-only trace
does not claim an Invoice107 exists. The display never totals these rows into
customer debt.

The202 receivable and VAT snapshots remain unchanged, as observed in WinSpeed.
The raw202 and107 balances must not be summed as a customer debt report. Native
AR report reconciliation is still pending Accounting confirmation. No GL
posting or physical shipment acceptance is implied.

Native cost triggers stay enabled. The initial contract rejects existing future
cost-calculated stock or cost-detail rows for the product across all branches
and inventories. It verifies existing future stock/cost snapshots remain exact.
The application checks the reviewed trigger definitions through a fixed reader
procedure running as the existing dedicated migrator; no general metadata grant
is added to the application principal. Changed definitions or unsupported
period/counter/cost branches stop before a write.

### Account status after administrator changes

Authenticated requests verify that both the acting and effective accounts exist and are active. Deleted accounts receive `401 ACCOUNT_NOT_FOUND`; disabled accounts receive `401 ACCOUNT_DISABLED`; an unavailable account lookup returns `503 SERVICE_UNAVAILABLE`. A transient lookup failure is not cached. User deletion and activation changes clear the account status cache immediately. Direct SQL changes can take up to 60 seconds to invalidate a cached status.

Native ticket traces use the effective user's document scope too. A scoped user cannot receive another salesperson's connected source documents; ambiguous, truncated, or unverified source ownership fails closed. Existing roles with access to all records retain that access. Ticket line and draw reads also apply scope when an exact ID is supplied.

The weighing report follows the booking's typed source references to delivery
orders, including deliveries with different document numbers. When several delivery
orders reference one booking, it shows their count instead of selecting one.
The native 116 adapter's uninvoiced line quantity is the quantity cut in that
operation; the coupon's remaining balance is separate. This correction does not
enable native 116 posting on UAT2 or supply the missing physical shipment evidence.
