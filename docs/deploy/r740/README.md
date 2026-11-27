# Sale-App on R740-SRV (172.16.30.169): UAT and PROD deploys

Deploys run **from the dev PC** with `deploy.bat`, over SSH (dedicated key, no password),
into WSL Ubuntu on R740-SRV, where Docker CE (Linux engine) runs the stacks. The Windows
Docker engine and Docker Desktop on that server are not used.

> **Current status for all agents (Claude · Codex · Antigravity):**
> [GO-LIVE-STATUS.md](GO-LIVE-STATUS.md) — what is live vs pending, and the constraints to respect
> when working on deploy or the databases. Runbook refreshed 2026-11-27 (organization scope, direct116 and reports, migrations through 289;
> older release 2.0.0 notes cover migrations through 253 on UAT,
> PROD and `dbwins_worldfert2`; see [RELEASE-2.0.0.md](RELEASE-2.0.0.md)). Database care: [sql/maintenance](sql/maintenance/README.md).

| | UAT | PROD |
|---|---|---|
| Git branch | `uat` | `main` |
| Server folder | `D:\SaleApp\uat` | `D:\SaleApp\prod` |
| Database (R740-SRV\SQL2008) | `dbwins_worldfert9_uat` (restored from PROD every night at 21:00) | `dbwins_worldfert9` |
| SQL logins | `wf_r740_uat_app_v2` / `wf_r740_uat_migrator_v2` | `wf_r740_prod_app` / `wf_r740_prod_migrator` |
| Public URL | `https://wfuat.duckdns.org` | `https://worldfert.duckdns.org` |
| LAN URL | `https://172.16.30.169:8444` (HTTP 8091 redirects) | `https://172.16.30.169` (HTTP 80 redirects) |
| Compose project / images | `saleapp-uat` / `worldfert-saleapp-uat-*` | `saleapp-prod` / `worldfert-saleapp-prod-*` |
| Native WinSpeed writers (AI/104/116/107) | v3 active on the clone, audited contract and bridge | v3 active on company 9, audited contract and bridge; company 2 remains excluded |

The public hostnames have Let's Encrypt certificates through Caddy (DNS-01 with DuckDNS); see
[DuckDNS public ingress](DUCKDNS-PUBLIC-INGRESS.md). The LAN IP endpoints still use Caddy's
internal CA, so a device that uses the IP address must trust the Caddy root certificate once.
[DNS, PKI and ACME preparation](TLS-DNS-PKI-ACME.md) covers the remaining options for a company
domain.

## Business setup at handover

The current release and physical UAT refresh pass do not create annual Budget
Plans or native sales targets. Assign those data to the business owners, verify
report ISO/template/publication and physical output, and follow the current
handover manual. Company-9 quota owners and current-year standing prices are set;
company 2 still requires its own operational setup and remains excluded from
native writer/bridge. See GO-LIVE-STATUS for the current read-only findings and
the scoped capture-time fix and its deployment status. VAT/GL continues in WinSpeed after the
app's 107 completion. Do not convert these setup items into an automatic Reset,
secondary activation or an unreviewed database sync.

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

## Writer v3 activation and restore

The candidate target files select the same v3/bridge and AI/104/116/107 flags in UAT
and PROD. This is source preparation, not evidence that a running stack was changed.
Migration 277 and a separate reviewed activation are required. Until the contracts
are approved, native writes and new native-coupon reservations fail closed; SQL
health alone is not business readiness.

Migration 277 exposes `wf.usp_ReadNativeDocumentMetadata`, a fixed SELECT-only
procedure bound to the verified migrator with EXECUTE AS SELF. The app receives no
additional dbo or VIEW DEFINITION permissions. The UAT principal script accepts
only the exact reviewed body and remaps its execution identity after restore.
It also creates protected activation history and prevents direct application
updates to the native-writer contract.

The post-restore principal check normalizes catalog leading/trailing LF and the
expected literal's CRLF before its exact binary comparison. A leading catalog LF
caused the 23 November refresh to roll back remapping and leave UAT SQL unavailable.
The correction accepts the reviewed body with CREATE/ALTER or the isolated UAT
execution identity only; changed statements and appended text remain rejected.
Rehearse this SQL check on the actual restored catalog before relying on nightly
refresh. Do not edit immutable migration 277 or weaken the body allowlist.
Windows PowerShell treats a child process's stderr as ErrorRecords. Node's
TLS deprecation warning must be retained as a diagnostic, not treated as a failed
native refresh by itself. The wrapper captures the native result under a locally
restored error preference, requires exit code zero and exactly one stdout payload,
and still requires the audited completion marker. The host refresh checks the
child wrapper's exit separately. Nonzero exit, missing/duplicate proof or a marker
sent only on stderr remains rejected; no TLS, SQL or metadata guard is disabled.
Windows PowerShell regression tests exercise the actual two script boundaries.

The release template must also bind commands to its local transaction (`$tx`).
Nightly refresh invokes it in a child ScriptBlock; `$script:tx` resolves to the
wrapper file and leaves commands unbound. A real SqlClient negative control
reproduced the old failure; the corrected full 49-fingerprint plan passes inside
the nested transaction and rolls back without writes.

Use the official wrapper from the developer PC after the authorized deployment
has installed the same reviewed commit and migration 277. Keep affected writers
in a maintenance window until activation and business smoke tests finish.
Read-only activation planning requires active ADMIN approver/actor IDs in that
database, a meaningful reason and a clean local source matching the deployed SHA:

```powershell
# Set these IDs from the reviewed accounts in the selected environment.
docs/deploy/r740/deploy-r740.ps1 -Environment uat -NativeWriterAction PlanEnable -NativeWriterApproverId $reviewerId -NativeWriterActorId $actorId -NativeWriterEvidence $reviewReason
# Review the returned plan; a later apply must use its exact hash.
docs/deploy/r740/deploy-r740.ps1 -Environment uat -NativeWriterAction Enable -NativeWriterApproverId $reviewerId -NativeWriterActorId $actorId -NativeWriterEvidence $reviewReason -NativeWriterPlanHash $reviewedHash
```

Repeat explicitly with `-Environment prod` only after UAT acceptance and the
owner's deployment decision. Company 2 remains excluded from operational writer
targets. Do not run the QA installer against live databases.

The activation plan checks migration checksums, all 49 trigger definitions/states,
the fixed reader body, current ADMIN identities, pending permits/requests/holds
and trigger ordering. Apply rechecks the plan under SERIALIZABLE and a bounded
application lock. It changes only four existing Sale-App hooks, keeps all native
WinSpeed hooks intact, binds both contracts and writes release/business audit in
one transaction. A used or changed plan is rejected. Approver, actor, SQL login
and the restored original custom-hook definitions are retained in the audit.

Before activation, independently compare the local reviewed HEAD with the actual
server checkout HEAD over SSH, not merely the remote branch ref. The developer-PC
activation path's Git helper reads the local checkout; that comparison does not
itself prove the server checkout SHA. This independent check was performed for
the current rollout and its release audit matches both running checkouts.

Keep application readers quiescent while altering hooks. PROD's first activation
attempts returned SQL 1222 because a background Rebate SELECT held a compatible
read lock that prevented hook DDL. The unchanged plan proved complete rollback.
Inspect blockers without SQL text or user-session termination; after confirming
no application transaction writes, pause only the backend for the authorized
maintenance window, use the official activation action and exact reviewed plan,
and restart that same container in a `finally` block. Verify health and metadata
afterward. Do not increase the ten-second timeout or disable WinSpeed triggers.
Native WinSpeed 116 create/edit/cancel operations need their approved Sale-App
bridge permit; incomplete saves remain held for review/recovery.

The uncommitted Direct116 candidate changes that last rule only after its own
acceptance and reviewed activation. The running release above remains governed
by its existing protocol. Candidate migrations 281 and 283–289 provide scoped
authority, connection staging, audit admission, metadata order and recovery.
`-NativeWriterDirect116 -NativeWriterProgramName <reviewed-name>
-NativeWriterLoginSidHex <reviewed-sid>` selects the direct plan for both planning
and apply. Keep these exact values from the verified native client; the recorder
employee is not a substitute for the authenticated native audit operator.

The direct plan verifies 50 fingerprints, head FIRST DELETE, audit LAST INSERT,
coupon consume FIRST UPDATE, current migration hashes and the five reviewed hook
bodies stored in the default-off contract. It explicitly recognizes only the
reviewed legacy four-hook upgrade. App readers/reservations stop on unfinished
native stages or attestation drift. New native cuts use free quantity; reductions
and cancellation return only that document's allocations through immutable return
entries. Expired tickets warn and remain usable under the owner's policy.

An incomplete native autocommit save is never declared successful just because
WinSpeed opens a print selector or writes an audit attempt. Review the completed
receipt, physical document, balances and reservations. Admin's native recovery
panel first shows a fresh preview. Close the original WinSpeed connection before
confirming a reasoned restore of the exact pre-save header, all detail columns
and coupon balances. A session-owned lease proves closure without granting the
app VIEW SERVER STATE. Changed sources, invoiced/admitted documents, stale proof
or an active original connection keep the hold. Recovery records its own actual/
effective administrator; it never manufactures the original native operator,
approval or audit. History-aware pause retains the guards; nightly restore must
preserve the same audited protocol and native policy. See GO-LIVE-STATUS for the
remaining physical gate; direct mode is currently enabled only on the v3 copy.

For controlled deactivation, use `PlanDisable` then `Disable` with a fresh hash.
It refuses unfinished native work and outstanding reservations. With business
history, it pauses the native-writer contract while retaining the bridge/hooks:
WinSpeed must not bypass historical settlement/return controls during a pause.
Only a pristine target with no business history may restore the original four
custom hooks and disable both contracts. Before/after state is audited as JSON.
The v3 app rejects new coupon reservations while the writer contract is off.
This is not a schema down or a reversal of completed business documents.

After nightly UAT restore, principal remapping precedes deployment as before.
`Refresh-UAT.ps1` then invokes the wrapper's UAT-only `-NativeWriterRefresh`.
The read-only proof accepts only an enabled Production approval copied inside
that same restored database, matching the exact deployed source SHA in its
business audit as well as current native modules and ledger. A different UAT
candidate needs a new explicit approval instead of borrowing the old one. The
administrator transaction rechecks active reviewers, the copied parent release,
metadata and unfinished work, adds a UAT contract binding and links its audit to
the copied approval. It does not query/write Production or reinstall native
hooks. Missing/disabled approval, changed metadata, inactive reviewers or
unfinished copied work stops the refresh with native writers fenced for review.
It never resets Rebate, removes a hold or discards native/settlement history.
The first UAT pilot may need manual activation until Production has an approved
v3 release to copy.

ZERO ticket lines in a normal Sale-App bill reserve tickets at 103, with state
RESERVED then FINAL after 116. The separate configured `tickets/redeem` endpoint
requires an already posted, single-line 104/202 with net/VAT/receivable zero.
DISCOUNT uses the normal line price and an equal plain footer discount.
Do not weaken that posted-sale proof to make a pre-104 rehearsal pass. The QA
profile supports ZERO or DISCOUNT on its one isolated database, with workers off.
Its supplementary DISCOUNT fixture explicitly simulates WinSpeed booking input;
it is not evidence of a frontend footer-discount editor. VAT-positive/GL posting
remains accounting's WinSpeed work.

Before a year's first approved Rebate conversion, the selected product needs
its Oct-31 reference in `wf.Oct31StandingPrice`. Authorized users can capture it
from WinSpeed's general announced prices effective on that date in the Rebate
page. Inspect missing/ambiguous sources first; never invent a value or substitute
a later price. The current 2026 references were empty before rollout acceptance;
both primary environments now contain 71 verified source-matching references.
This capture does not reset balances or change WinSpeed pricing. The legacy
capture-time display currently adds seven hours; raw SQL local timestamps are
the verification source until the presentation correction is reviewed.

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

Migrations 163–164 (1.0.0):

- 163: the booking (103) that Sale-App confirms carries the customer's default contact
  (`EMCustContact.IsDefault='Y'`) in `SOHD.ContactName`, as WinSpeed does; the 104, its 202 and
  the 107 writers copy it down. This one edit reaches Production, because confirming a booking
  is live there (the 104/107 writers stay off). No dbo structure change.
- 164: `wf.NativePrintLog`, one row per press of the print button for a 104/116/107 (WinSpeed
  writes SMAudit action P for its own prints). wf only.

### Full Loop on UAT

[`backend/scripts/uat-full-loop.cjs`](../../../backend/scripts/uat-full-loop.cjs) runs the native
chain through the real API inside `saleapp-uat-backend-1`, for both book lines, one phase at a
time (usage and fixtures at the top of the file). It refuses anything but a `_uat` database with
the native flags on. Before `I-116`, insert the labelled scale record with
[`sql/uat-simulated-scale-record.sql`](sql/uat-simulated-scale-record.sql); the nightly restore
removes it and the test documents. Stop at the first failed check and run `close` only after
everything passed. Keep the document numbers it prints out of this repository.

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
ports 80/443, a backup gate and the UAT Caddy root. Both targets now pin v3, the
bridge and all four AI/104/116/107 writer flags on; both were activated with the
reviewed release on 23 November 2026. Company 2 receives schema updates only and
is excluded from operational native writer activation. Sale-App completion ends
when 107 covers its 116s; subsequent VAT/GL work belongs to accounting in WinSpeed.
Physical weighing hardware and VAT-positive GL posting are not certified by a deploy.

### Routine release (owner)

For the first installation of immutable migration284, run the reviewed
[readiness-owner prerequisite](sql/one-off/2026-11-27-native116-readiness-owner.sql)
as the approved SQL administrator in the exact selected database, before the
official migration apply. It creates only a false-returning `wf` function stub
when absent, checks its exact body/owner/object grants, assigns that one function
to the existing migrator and records an audit. The restricted migrator can then
apply284's `EXECUTE AS OWNER` without permission to impersonate dbo. Applied
migration files and their ledger hashes remain unchanged. Repeat separately for
UAT and each approved live company; this does not activate company2 writers.

The UAT principal script validates the same immutable boolean body after restore
and remaps this function's owner to the UAT migrator. It restores only its public
boolean `EXECUTE` grant: ownership transfer removes object permissions, as
[documented by Microsoft](https://learn.microsoft.com/en-us/sql/t-sql/statements/alter-authorization-transact-sql).
Unknown owners, changed bodies and unexpected explicit grants stop the setup.
Rehearse the prerequisite, restricted migration apply and restore remap inside
an outer rollback before using it. Do not grant migrators dbo impersonation.

1. UAT passed on a commit (from the UAT deploy receipt).
2. **2. Promote UAT to PROD** with `uat_commit` = that commit; check that the run appears and
   passes (see the practical notes above).
3. Only if the plan has pending migrations: verified copy-only backups with
   [`sql/r740-prod-backup.sql`](sql/r740-prod-backup.sql) and
   [`sql/r740-company-backup-dbwins_worldfert2.sql`](sql/r740-company-backup-dbwins_worldfert2.sql)
   (SSMS or `sqlcmd -E`, younger than 120 minutes), then migrate the second company database first:
   `migrate-company.sh dbwins_worldfert2 plan` and `apply` in WSL as root. The PROD deploy migrates only
   `dbwins_worldfert9`. Check company-2 data before any data migration: it can differ from company 9.
4. `docs\deploy\r740\deploy.bat prod`: `YES` for the commit, then the database name
   `dbwins_worldfert9` when migrations are pending, or `YES` to restart when none are.
5. Verify, read-only: the `prod-apply-<commit>` receipt, `https://worldfert.duckdns.org/api/health`,
   the frontend bundle, and the separate reviewed activation with
   `wf.fn_IsNativeDocumentTarget()` = 1 on company 9. Both primary environments
   use v3, bridge and the four stage flags on. Company 2's native target/bridge
   remain off. The separate legacy `COUPON_NATIVE_POSTING_ENABLED` remains false;
   do not use `ALLOW_TEST_NATIVE_WRITEBACK` for operational v3 activation.

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

## Enable Rebate after deployment

The operational native v3 writer was activated in both primary environments on
23 November; see [acceptance and release evidence](GO-LIVE-STATUS.md). Both reviewed
targets pin `NATIVE_DOCUMENT_WRITER_VERSION=v3`, bridge and the four stage flags,
validated in the resolved Compose model. The existing pilot writers keep their
narrow target guard. In v3 mode their verified receipts remain replayable, but
they cannot create new documents. Resolve pending pilot requests before a version transition.

V3 activation additionally requires the exact server/database `wf.NativeWriterContract`, reviewed native metadata,
and the actual runtime login's read-only definition visibility on the parent tables listed in
`backend/services/native-document-metadata.json`. Migrations do not seed an enabled contract. The SQL predicate's
reviewed base hash and the application's full 49-trigger check are both required; do not grant impersonation of an
old environment's migrator to make metadata readable. The isolated QA contract is not a Production approval.

Do not change the target version/flags or enable native hooks until the outstanding WinSpeed, Rebate-on, legacy
document and financial-shape acceptance gates have passed on the reviewed release. No activation follows merely
from deploying schema. Use only the normal R740 deploy kit for the eventual authorized promotion.

The R740 backend reads the `REBATE_*` switches and `REBATE_TICKET_REDEMPTION_TREATMENT` from that stack's `config/.env`. The switches default to `false`. The migration service does not receive them. `REBATE_RESET_DATABASES` remains pinned by the reviewed target file.

Verify the schema and participant access in every configured reset database before activation. Prepare the generation-0 reset coordinator and participants before directing sales traffic to a backend with `REBATE_POOL_103_ENABLED=true`. An administrator initializes the coordinator with the exact environment and database through `POST /api/rebate-pool/reset/initialize`. Initialization preserves balances. The administrator's separate confirmation in App Settings starts balances at zero.

For full discount on exempt bills, set `REBATE_TICKET_REDEMPTION_TREATMENT` to `dbwins_worldfert9_uat:DISCOUNT` in UAT or to the reviewed company database followed by `:DISCOUNT` in Production. A single database is selected per stack. Verify that only eligible VAT-0 transactions with the full line covered can use the ticket.

## Guards worth knowing

- The env-file source guard is tested with Docker Compose 5.6.1 on R740 and in CI.
  An implementation that omits `env_file` from `config --no-env-resolution --format json`
  fails closed; never replace that check with the resolved environment alone.
- The UAT app and migrator enforce the UAT target isolation rules. The Production target
  requires the live database and its dedicated logins. Both enforce their reviewed roles,
  TCP and SQL server/version identity.
- The four native AI/104/116/107 feature flags, v3 and bridge are pinned in
  `targets/*.env` and checked in the resolved Compose model (on in both primary
  environments). `COUPON_NATIVE_POSTING_ENABLED` belongs to the older posting path
  and stays false. Operational v3 also requires the exact approved database
  contract and metadata; company 2 is not an operational native writer target.
- Target values live only in `targets/*.env` (reviewed in Git); `config\.env` holds secrets.
- Background workers are on in both R740 targets (`DISABLE_BACKGROUND_WORKERS=false`): the
  5-second polling that refreshes open screens (read-only on `dbo.SOHD`) and the outbox
  worker (marks `wf.OutboxEvent` done). Neither writes `dbo`. Local UAT2 keeps them off.
- Migration 154 locks employee accounts still on the shared default password from 049;
  an administrator re-enables a person by activating the account with a temporary password.
- `ONPREM_TARGET_KIND` (pinned per target): `uat` refuses `dbwins_worldfert9` and any login
  that can open it; `production` accepts only `dbwins_worldfert9` and refuses a login that
  can open any other user database.

## Emergency password reset for one app account

In User Management an administrator can use the reset button for another account. Use
a distinct temporary password and ask the user to sign out and sign back in. The existing
session may remain valid until its token expires. Forced change on the next sign-in uses
the existing backend ENFORCE_PASSWORD_CHANGE setting.

If the web UI is unavailable, run docs/deploy/onprem/New-Uat2AdminSql.ps1 with -HashOnly
and the backend bcrypt module. It prompts for the password without echoing it and returns
a bcrypt cost-12 hash. Open sql/reset-app-user-password.example.sql in SSMS connected to
R740-SRV\SQL2008. Select the intended database, set its name and the exact username,
and run the whole file in Preview mode first. Supply the generated hash and set
@Apply = 1 after confirming the account. Preserve the template without the hash.

## Acceptance history and owner setup

The owner accepted the baseline as of 31 October 2026 and requested removal of the
**ผลตรวจรับงาน** screen. It is retired; do not instruct users to complete that screen.
Historical database evidence stays retained. This does not mark new trainee cases or
unperformed physical-printer checks as passed. Accounting continues VAT/GL in WinSpeed
after Sale-App completes 107 for the eligible 116 quantities.

Per the owner's 24 November instruction, each department enters its real Budget Plans,
reviewers/approvers and sales targets later. Empty plan/target reports are not permission
to invent business data. Keep the current Rebate generation, balances and switches.

## Verified nightly backups and UAT recovery

[`host/Invoke-NightlyBackup.ps1`](host/Invoke-NightlyBackup.ps1) replaces the old
credential-bearing batch plus unchecked restore chain. It plans without `-Apply`.
It uses Windows integrated SQL authentication, unique full-backup files, `CHECKSUM`,
`RESTORE VERIFYONLY WITH CHECKSUM` and SHA256 manifests. Both company backups are
attempted even if one fails; any failure gives the task a nonzero result. `-BackupOnly
-CopyOnly -Apply` rehearses backup creation without pausing/restoring an application.
No existing backups are deleted. Under the selected SIMPLE recovery model, the recovery
point is the completed full backup, not point-in-time recovery between backups.

The full cycle requires matching UAT/PROD source revisions. It pauses only the UAT
backend after checking active writes, refuses external sessions, creates a verified
pre-refresh UAT recovery file, restores only UAT ID 10, then invokes the official
checked-out `Refresh-UAT.ps1` and its deploy wrapper. It checks health/native target
and the relabelled UAT Rebate state. Failure after restore attempts recovery of the
pre-refresh UAT file/config through the official wrapper. No session KILL, forced
rollback, PROD restore, Rebate Reset or secondary business write is performed.

Host logs/manifests: `D:\SaleApp\backup-logs\verified-*.log` / `*.json`.
Backups: `D:\MSSQL\MSSQL10_50.SQL2008\Backup`. A successful local manifest explicitly
records whether an off-host destination was configured and each copy verified.
`VERIFYONLY` is a media check, not a substitute for an isolated restore and DBCC.
Inspect task LastTaskResult, the latest manifest's run/time/success, all database
entries, refresh/recovery results and current free disk space; a Ready task alone
does not demonstrate a successful backup. Retention deletion needs a separate
approved policy; this runner refuses to start below 15 GiB free.

After an exact-runner `-BackupOnly` rehearsal under the intended task identity,
review and apply [`host/Set-NightlyBackupTask.ps1`](host/Set-NightlyBackupTask.ps1)
on R740 with `-RehearsalManifest <verified JSON path>` (add `-Apply` only after review).
It preserves the existing 21:00 trigger, selects the tested Windows account with
S4U/highest privileges so it runs without an interactive logon, and installs one
checked runner action. The test identity must also demonstrate WSL/Docker access.
It protects the old task/batch rollback copy with SYSTEM/Administrators ACLs and
removes the SQL password from the active legacy entrypoint. Do not print/export
that rollback material. Credential rotation requires an IT dependency inventory;
replacing this batch does not rotate a shared SQL login.

The owner selected local D: retention on24November: daily21:00 backups and
Friday21:00 cleanup of files older than15days, without an extra weekly backup.
That policy is already configured; this release does not change its schedule.
Off-host copies are not configured under that local policy. If later requested,
provision and test a separate approved destination; the older network share denied
access during the24November audit. S4U does not carry reusable network credentials.
IT must approve/provision the backup identity/share access and test it under the
actual unattended identity; do not save a network password in scripts or treat a
mapped drive visible in a desktop session as unattended proof. The runner accepts
an optional approved `-OffHostDirectory` UNC, verifies copy hashes and fails the
cycle on copy errors. The installer leaves this unset until that gate passes.

## Reviewed secondary Budget Plan and report access

Budget Plan CRUD/workflow and report reads/template resolution/Excel can use a
selected secondary database only through reviewed bindings of both the effective
user and the Access As actor. Identity remains anchored to the primary database;
these modules additionally intersect current target-account role permissions.
Database role restrictions and the deployment allowlist still apply. Team-scoped
users do not acquire company-wide reports from a broader identity in either
company. Unreviewed administrative/report-configuration writes stay fenced.

Prepare explicit account bindings using the existing ADMIN identity-registry
screen/API. Equal IDs or usernames alone do not establish identity. Annual plans
need separate active preparer/Manager/C_Level accounts with current permission in
the selected company; do not automatically create/reactivate real staff accounts.
The Budget Plan list returns mapped user/action context. Writes carry the
database captured when the form was opened and a current EditVersion; reload
after switching databases or losing permission. The target ChangeEvent uses
business IDs, while a primary admission audit retains both identity namespaces.

Schema279 must exist in every selected budget/report database (already applied
in both live companies and UAT). No new migration, Rebate Reset, flag change or
company2 native writer activation is needed. UAT remains limited to its clone;
cross-company acceptance uses isolated copies and a login without live access.
See GO-LIVE-STATUS for candidate versus actual deployed results.

The current direct candidate also rejects native I/U/D audits when no observed
save stage exists. WinSpeed can otherwise continue to print after an earlier
statement was rejected. Print audits remain allowed. The reviewed release plan
accepts only the exact previous direct module/fingerprints for this upgrade;
unknown drift still blocks activation. Migration 288 preserves legacy caller
SET options, and 289 rotates only an exhausted native SMID block while retaining
all cancelled-document history. Down migration does not restore a retired block.
These changes passed v3 acceptance and are deployed on both primary environments;
follow GO-LIVE-STATUS for the exact revision, receipts and remaining operational setup.

After a native save error, WinSpeed may still open its print selection window.
Close that window, reopen the document and verify its persisted quantities; do
not infer success from the print dialog or repeatedly press Save. The direct
protocol requires a completed native audit receipt. A failed increase against an
App reservation must preserve the prior saved document and balances.

For future organization changes, apply reviewed private setup separately in
UAT before PROD: validate unique native Employee codes and existing account
links; use the ADMIN native-Employee editor for names/supervisors; create each
promotion position directly below its actual manager; and assign SALE and
PROMOTION territories independently in the territory editor. Province overlap
is permitted across the two types, but not between active territories of the
same type. Preserve existing document owners and historical keys. The reserved
App admin uses a system Employee metadata record, never a fabricated native
login. Re-review cross-company identity bindings after either Employee link
changes. Missing secondary-company staff/accounts need explicit setup; do not
copy passwords or activate inactive accounts automatically. Annual plans and
sales targets remain business-owner setup after rollout.


## Native116 numbering and input validation (migrations290–291)

Deploy this source with the normal CI/promotion flow and `deploy-r740.ps1`.
The approved primary native target must remain reviewed; a verified fresh
backup is required before apply. Rehearse under the actual restricted migrator
and prove the app cannot call counter maintenance directly. Renew the exact-SHA
native activation through the same official wrapper after deployment.

290 aligns the single reviewed `redemption` branch counter for format
`yy010000` with retained same-year native documents, bridge/receipt history and
native audit numbers. It preserves all document numbers and advances only.
Completed native/app saves maintain alignment; backdated or synthetic number
series do not rewind or switch its year. Unsupported formats and exhausted
sequences require review. Company2 remains excluded from native writes and
counter repair. Down removes only the wf hooks/procedure and retains the
advanced counter and its audit, preventing number reuse.

291 keeps the prior transaction, native identity, scope, invoice, reservation
and quantity checks. It reports the particular incomplete field rather than
one combined database message, and rejects duplicate business numbers under
the shared native transaction lock. Check every populated line and Check All;
confirm each transport quantity and the header total before Save. App routes
preserve typed business conflicts hidden behind a driver's rollback message;
unrelated SQL failures remain unavailable and never expose query text.

For acceptance, test automatic numbering, a two-ticket partial save, edit and
cancel/return, denied duplicate/invoiced/unchecked inputs, and counter history.
Compare balances and COMPLETE audit rather than treating Select Form as proof.
Keep WinSpeed's separate number-gap policy. The vendor documents its three
settings (allow, warn, refuse) in [number-gap options](https://www.prosoftwinspeed.com/Faq/Detail/1437).
No duplicate-check bypass, Rebate Reset or historical renumbering is required.
