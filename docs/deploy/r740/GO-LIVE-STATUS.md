# R740 go-live status

Operational snapshot: **28 October 2026 (ICT)**. Current code and the latest successful
server receipt determine the running release. See [README](README.md) and [TLS guide](TLS-DNS-PKI-ACME.md).

## Owner-corrected UAT target

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

Production database is `dbwins_worldfert9`; no saleapp-prod stack has started. The tracked
Production deploy gate and native writer flags remain false. A read-only forecast before the
latest target correction showed 152 unchanged, 3 pending, drift 0. The current release adds
158/159 and requires a fresh guarded Production plan and verified pre-deploy backup.

UAT2 previously exercised restricted I/K paths through 107. Still unverified: AR report
reconciliation (owner deferred), GL, approved forms, physical scale/shipment, and live ACCOUNTING
self-approval for manual 116. The illustrated local-only question brief is
`docs/sale-app/current/UAT2-FullLoop-Questions-20261027.docx` (four workflow screenshots).
WinSpeed must connect to the underscore R740 UAT clone before read-back; the visible old sessions
were local UAT2 and R740 Production. No Save/Post was performed through those sessions.

Never commit secret files, private keys, password hashes or operational screenshots to the public repo.
