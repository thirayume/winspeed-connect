# R740 go-live status

Operational snapshot: **29 October 2026 (ICT)**. Current code and the latest successful
server receipt determine the running release. See [README](README.md) and [TLS guide](TLS-DNS-PKI-ACME.md).

## Corrected UAT deployment verified at 20 52 ICT

Commit `8f1bd694884bd8dd4afd566dd089aaa761265cfc` passed
[promotion CI attempt 2](https://github.com/thirayume/winspeed-connect/actions/runs/40652678803).
The first attempt was cancelled after an npm ECONNRESET and stalled dependency install.
The retry passed in 44 seconds and promoted that exact tree.

Receipt: `D:\SaleApp\uat\deploy-logs\20261028-205154-uat-apply-8f1bd69.txt`.
The approved plan was 152 unchanged, 5 pending, drift 0; apply committed 155-159 and the
final plan is **157 unchanged, 0 pending, 0 drift**. Backend running/healthy, restarts 0.
HTTPS API returns 200 and SQL up; `/api/dbinfo` identifies `dbwins_worldfert9_uat`.
TLS certificate chain and IP validation passed against the existing public Caddy root.

The owner opened WinSpeed UAT on R740 RDP. Persistent Full Loop creation is held until after
the scheduled 21:00 restore. The active refresh script and SQL remapping use the
underscore clone and v2 identities. That scheduled run subsequently **passed at 21:02:12**,
Task Scheduler result 0. Receipt `20261028-210151-uat-apply-8f1bd69.txt` confirms 155-159
reapplied to the restored clone and the final plan 157/0/0. A read-only equality check proved
the restored active admin verifier matches Production; no password or hash was printed or reset.
The post-refresh Full Loop baseline copy-only backup was checksum-verified at
`D:\MSSQL\MSSQL10_50.SQL2008\Backup\dbwins_worldfert9_uat_pre-full-loop_20261028_210313.bak`.

A separate read-only preflight found both Production application SQL logins could open the
UAT clone. The owner explicitly approved clone-only CONNECT denials for those two identities.
They are now applied and verified: UAT access 0, Production access 1. Their existing company-2
access and all live Production permission rows were compared before/after and remain unchanged.
The principal script repeats the two denials after each restore and proves UAT access 0.
The earlier approval rejection is resolved by the owner's explicit authorization.

Current runtime intentionally supports switching between allowlisted live company databases,
as confirmed in `backend/onprem-target.js` and its tests. The first private approval-helper
attempt incorrectly required zero access to every other company database; it rolled back.
Its corrected verification preserves existing company access while enforcing the exact approved
UAT denial. No runtime guard or Production permission was weakened to satisfy this check.

## Owner-corrected UAT target

At 01:55 on 29 October, UAT redeployed commit `806e4080f3c25d9678a63cd449ecb1b8da7fb5ce`
after [CI 40749160774](https://github.com/thirayume/winspeed-connect/actions/runs/40749160774).
Receipt `20261029-015510-uat-apply-806e408.txt` verifies 157/0/0 with no migration apply.
HTTPS API/SQL and the underscore database were reverified. The active nightly principal
script SHA-256 is `5B2350632D69483019C66603EE4945CD9D53466BFDEDBA96D66F339B33E83ACB`,
matching the approved script actually applied. The next nightly restore has not yet been observed.

The owner changed UAT to **R740-SRV\SQL2008 / dbwins_worldfert9_uat / DB ID 10**.
Read-only SQL verified it ONLINE and restored from Production backup
`D:\MSSQL\MSSQL10_50.SQL2008\Backup\dbwins_worldfert9_20261027_210002.BAK`.
The former hyphenated database is no longer present. Its receipts are historical and do not
prove this replacement clone migrated.

At the corrected-clone checkpoint: 152 ledger rows; no prior temporary fixture accounts;
no initial-native target function. The backend configured for the removed database was stopped
before retargeting. No business test documents had been created by this run.

## Isolated UAT SQL identities approved and created

The old `wf_r740_uat_app` login was verified able to open both UAT and Production. The owner
selected two NEW clone-only identities instead of weakening the existing isolation check:

- `wf_r740_uat_app_v2`
- `wf_r740_uat_migrator_v2`

Setup passed: Production access 0, other user-database access 0, elevated roles 0. Existing
logins and Production permissions were not modified. Separate random passwords are stored only
in protected UAT settings; recovery copies are under `D:\SaleApp\uat\config\before-isolated-20261028-142724`.
Do not copy their contents off the server. UAT JWT sessions were rotated for the changed database
identity; no web-user password was changed. UAT users must sign in again with the restored
Production account policy selected by the owner.

The reviewed UAT runtime allowlist contains only `dbwins_worldfert9_uat`. Production work uses
the separate Production web app. The nightly principal script retains and strengthens its zero
Production/other-database access proof for these new logins.

## Migration 159 and current validation

Migration 158 remains byte-identical after its historical apply. It introduced a shared target
predicate while preserving all nine procedure business bodies. New migration 159 corrects only
that predicate to local UAT2/10 or the verified R740 underscore clone/10. The old R740 hyphenated
identity and both live company databases are rejected by the current JavaScript target checks.
All original migration 152/153/155/156/157 hashes remain unchanged.

On the corrected clone, migrations 155-159 (37 batches) compiled under the isolated migrator
inside a transaction. The app identity evaluated the target predicate and read 26 native trigger
rows through the fixed metadata reader. Rollback restored the WF catalog and ledger completely;
no native writer procedure executed. This validates SQL compatibility and permissions, not a
persistent business Full Loop.

Final local checks passed: backend 156/156, deployment configuration 23/23 and selected
migration-runner safety checks 34/34. The stricter idempotent principal script was rerun on
the corrected clone and again proved zero Production/other-database access and no db_owner.

Next: CI and guarded deploy to the corrected clone, then separate I/C/J and K/D/N test chains
and WinSpeed read-back against that exact database. Current contracts remain restricted to
single-line, whole-coupon, zero-VAT simulation. They do not prove physical weighing/shipment,
partial or multi-line coupons, other tax cases, AR reports, GL or approved print forms.

## Nightly restore and account policy

Task `AUTO Backup SQL2008` runs the existing backup/restore batch at 21:00 and then
`Refresh-UAT.ps1` from the UAT checkout. Its SQL target declaration was corrected from hyphen
to underscore with a **one-byte diff**, preserving file encoding and every Production backup
command. No restore was triggered during this correction.

Backup of that SQL script:
`D:\SaleApp\tools\out\daily-backup-restore-before-underscore-20261028-142039.sql`.
New script SHA-256: `F67DBAF8571B4700A2FB3C028D7C1DCEB22E73576094FE2DA0493AC0BA57750A`.
The next release updates the refresh default and principal remapping to the same underscore
clone and v2 logins. The next scheduled run has not been observed yet.

The owner selected Production web accounts after restore. Do not preserve a separate UAT admin
hash. The five temporary app accounts created earlier existed only in the former database;
read-only inspection proved zero of them in the replacement clone. The earlier cleanup command
could not reach the removed database; do not describe that as a successful account-disable run.

## Ports and TLS

- UAT uses HTTPS 8444 and HTTP 8091. Production reserves HTTPS 443 and HTTP 80.
- Windows IP Helper owns the portproxy listeners: 172.16.30.169 -> 127.0.0.1 on the same ports.
  Do not stop IP Helper. A proxy listener alone is not a working HTTPS application.
- Port 80 firewall scope matches 443: `172.16.0.0/16,192.168.2.0/24`.
- The running keepalive task uses ports 80,443,8444,8091. Its prior script and proxy table are
  backed up in `D:\SaleApp\tools\out\*before-port80-20261028-012242*`. The older 8090 rule remains.
- SSRS is running with reserved URLs on 8888 for ReportServer_SQL2008 and Reports_SQL2008.
  Local HTTP reaches it with 401; a report user must verify authenticated report access.
- DNS/PKI have not started. The owner selected temporary IP HTTPS with the existing Caddy CA.
  IT must distribute the verified public root. Company PKI and universal client trust are not proven.
- Prior UAT TLS checks passed chain and IP validation with the exported public root, TLS 1.3.
  Windows Schannel reported unknown revocation status for the private CA. Do not disable
  certificate/revocation validation globally to hide it.

## Historical recovery receipts

- a1060b6 repaired migration 157's metadata-reader principal using a R740-only, hash-pinned
  EXECUTE AS SELF artifact; original migration hashes and writer restrictions were preserved.
- ba6b673 deployed successfully at 01:35 with 155/0/0 and all four native flags pinned false.
  Receipt: `D:\SaleApp\uat\deploy-logs\20261028-013528-uat-apply-ba6b673.txt`.
- 13603b5 stopped before candidate DDL because the legacy write guard confused a hyphenated
  clone name with the exact Production name. Exact-name regression tests preserve live-write denials.
- 2498c2b then applied 158 to the former clone and started healthy.
  Receipt: `D:\SaleApp\uat\deploy-logs\20261028-083601-uat-apply-2498c2b.txt`.
  That database was subsequently replaced/removed; this is not acceptance of the underscore clone.

## Production and business acceptance remaining

After the 21:00 restore, both restricted I/C/J and K/D/N chains completed quotation,
booking 103, AI, complete 104, manual simulation 116 and ACCOUNTING-only 107 on the corrected
R740 clone. Concurrent apply produced one creation and one replay at 104/116/107. Negative
role/date tests passed; physical shipment remained held. ACCOUNTING created and self-approved
116 on one chain; WAREHOUSE created and MANAGER approved the other. SQL verified the actual
actor identities, one receipt per stage, packaging/quantity, native audit rows and one stock
row per invoice. Document Trace Flow resolved both exact coupon IDs and expected typed edges.

One private test assertion initially expected ACCOUNTING shipping to reach the downstream
guard; the route correctly returned 403 first. The corrected test verifies this role denial
and separately verifies the WAREHOUSE downstream hold. No application code or document was
changed to satisfy the assertion; the same 116 replayed successfully.

All five owned temporary app accounts were disabled after API/SQL verification. Each then
returned login 401, and their generated passwords were removed from the private fixture file.
Operational document IDs and detailed logs remain local on R740, outside the public repo.

WinSpeed read-back remains pending: opening Sale Order after the nightly restore showed
`DataCache error !! [dg_icoption]`. The owner was asked to reopen and authenticate the UAT
session. No WinSpeed Save/Post or native-data repair was performed.

Production database is `dbwins_worldfert9`; no saleapp-prod stack has started. The candidate
enables the owner-authorized technical deploy gate for ports 80/443. All four native simulation
writer flags remain false, and the JavaScript/SQL target guards still reject live databases.
This is not full business go-live acceptance. A read-only forecast before the
latest target correction showed 152 unchanged, 3 pending, drift 0. The current release adds
158/159 and requires a fresh guarded Production plan and verified pre-deploy backup.

UAT2 previously exercised restricted I/K paths through 107. Still unverified: AR report
reconciliation (owner deferred), GL, approved forms and physical scale/shipment. ACCOUNTING
self-approval for manual 116 now passes live R740 API/SQL checks, with WinSpeed acceptance pending.
The illustrated local-only question brief is
`docs/sale-app/current/UAT2-FullLoop-Questions-20261027.docx` (four workflow screenshots).
WinSpeed must connect to the underscore R740 UAT clone before read-back; the visible old sessions
were local UAT2 and R740 Production. No Save/Post was performed through those sessions.

Never commit secret files, private keys, password hashes or operational screenshots to the public repo.
