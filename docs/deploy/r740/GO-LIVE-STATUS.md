# R740 go-live status

Shared operational snapshot, checked **28 October 2026 (ICT)**. Older snapshots in Git
history describe their observation dates; do not treat them as current deployment acceptance.
See [README.md](README.md) for the procedure and [TLS guide](TLS-DNS-PKI-ACME.md) for certificates.

## UAT deployment recovered and verified

| Item | Observed result |
|---|---|
| Host / SQL identity | `R740-SRV` / `R740-SRV\SQL2008` |
| Deployed origin/uat commit | `ba6b6739473fcfc4d4f738580d7d88434985d45a` |
| Stack / directory | `saleapp-uat` / `D:\SaleApp\uat` |
| Database | `dbwins_worldfert9-uat`, DB ID 8 |
| Migration plan after apply | 155 unchanged, 0 pending, 0 drift |
| API / SQL / frontend | HTTP 200 / up / HTTP 200 |
| Backend | running, healthy |
| UAT URL | `https://172.16.30.169:8444/` |
| HTTP redirect | port 8091 returns 308 to the UAT HTTPS URL |
| TLS check | TLS 1.3, certificate chain and IP verified using the exported public root |
| Production stack | not started; no saleapp-prod containers |

Successful promotion and checks:
[Actions run 40560919589](https://github.com/thirayume/winspeed-connect/actions/runs/40560919589).
Server receipt: `D:\SaleApp\uat\deploy-logs\20261028-013528-uat-apply-ba6b673.txt`.
The earlier a1060b6 run committed migration 157; the ba6b673 redeploy confirmed 155/0/0 with no apply.

### What failed and what fixed it

1. A single added blank line in the tracked server deploy driver blocked checkout. The exact
   edited file was backed up in `uat\deploy-logs\recovery-20261027-201228-deploy-r740.ps1`,
   confirmed to contain no other changes, then restored from its recorded Git commit.
2. The previous apply had committed 155 and 156, then stopped at 157. Its fixed metadata reader
   named the local UAT2 migrator. The R740-only, hash-pinned compatibility artifact uses
   `EXECUTE AS SELF`; SQL metadata now identifies `wf_r740_uat_migrator`. Original migrations
   and local UAT2 ledger hashes are unchanged.
3. A TLS warning had hidden the actual principal failure in the diagnostic classifier. The
   classifier now prioritizes the fatal migration error and preserves safe categories in receipts.
4. CI Compose did not preserve env_file source information. CI now uses the tested Compose
   5.6.1, keeping the source check enforced.

## Ports and report service

Windows portproxy now has `172.16.30.169:80 -> 127.0.0.1:80` and the existing
`172.16.30.169:443 -> 127.0.0.1:443`. The PID 2720 iphlpsvc listeners are the forwarding
service; do not stop it. A listener alone does not prove an HTTPS application is serving.
There is currently no Production Caddy behind those two forwarding ports.

Port 80 firewall scope matches the existing 443 rule: `172.16.0.0/16,192.168.2.0/24`.
The running `\SaleApp\SaleApp-WSL-KeepAlive` task uses the reviewed port set
`80,443,8444,8091`. The old script and portproxy table were backed up under
`D:\SaleApp\tools\out\*before-port80-20261028-012242*` before the change. The older 8090
forward and firewall rule were retained; their unrelated service was not changed.

SSRS service `ReportServer$SQL2008` is running. WMI reserved URLs use **8888** for both
ReportServer_SQL2008 and Reports_SQL2008. A local request reaches the endpoint and returns
401 (authentication required). A report user still needs to confirm report access at the new URL.

## UAT accounts and nightly refresh

The owner selected **Production accounts for UAT** after the daily 21:00 restore. Read-only SQL
comparison proved the active UAT admin verifier matches Production, without printing either
hash. MustChangePassword=1 was observed; the existing first-sign-in change policy still applies.
Do not reapply a separate UAT password after restore. Never store account passwords in this file.

Task AUTO Backup SQL2008 restores Production into dbwins_worldfert9-uat, then runs
Refresh-UAT.ps1. The 27 October run reached the old 157 failure. The fixed UAT branch is now
available to the next refresh, but that next scheduled run has **not yet been observed**. Do not
rerun the restore merely to test the scheduler: it discards current UAT changes.

## Native Full Loop remains a separate acceptance step

All four flags are false on the deployed R740 UAT: NATIVE_BOOKING_AI_ENABLED,
NATIVE_DELIVERY_104_ENABLED, NATIVE_MANUAL_116_ENABLED, NATIVE_INVOICE_107_ENABLED.
All four are now pinned in both reviewed target files; secret env files cannot override them.

The actual R740 UAT invoice trigger set has 26 enabled definitions. Its metadata fingerprint is
`1bdd47a6ee4e84662ed0b1979d32a628ac720fd6745e5839a0afb4b1987f6c8a`, matching the tested
UAT2 contract. This read-only match is useful evidence; it is **not** a complete native save test.
JavaScript and SQL writer guards still require `AMYOU-YOGA7\V2008R2` /
`dbwins_worldfert9_uat2` / DB ID 10. The compatibility repair did not enable business writes on R740.

### Next release candidate: R740 UAT simulation

Migration 158 adds a shared SQL target predicate and preserves all nine existing procedure
business bodies, changing only their target condition. The JavaScript services independently
check the same two exact tuples: original local UAT2/10 and R740 UAT/8. Neither live company
database is accepted. Original 152/153/155/156/157 migration bytes remain pinned and unchanged.
The candidate turns on all four flags for the reviewed R740 UAT target only; Production flags
and its deployment gate stay false.

Backend checks: 155/155. Configuration checks: 22/22. On R740 UAT the 12 candidate batches were
compiled as wf_r740_uat_migrator inside one transaction, and the function was evaluated as
wf_r740_uat_app. Rollback restored all nine prior module bodies, removed the new function and
left the ledger unchanged; no business procedure was executed. Stored CREATE headers were
normalized to ALTER only after a read-only diff proved that this was the sole source difference.
The candidate has not yet been applied or proven by a persistent Full Loop at this checkpoint.

The first guarded apply at 13603b5 stopped before candidate DDL: the legacy cross-database
regex treated the hyphenated UAT name as the exact Production database. SQL inspection proved
ledger=155, no 158 ledger row, and no new function. The correction distinguishes the hyphenated
clone while regression tests keep quoted/unquoted/dynamic writes to the exact live name blocked.
The migration artifact itself is unchanged. A fresh CI promotion and guarded plan/apply are required.
The UAT pre-test copy-only backup was checksum-verified at
`D:\MSSQL\MSSQL10_50.SQL2008\Backup\dbwins_worldfert9-uat_pre-full-loop_20261028_082515.bak` (3457.8 MB).

The owner confirmed WinSpeed connected to R740 UAT is available. Next: CI, guarded UAT deploy,
then both I/C/J and K/D/N test chains and WinSpeed read-back. This remains the restricted
single-line, whole-coupon, zero-VAT simulation. Existing UAT2 policy IDs and manual-evidence
labels remain unchanged; this candidate does not generalize physical shipping or Production writes.

UAT2 previously exercised the restricted single-line, full-coupon, zero-VAT I/K paths through
107. Remaining business evidence: AR report reconciliation (owner deferred), GL, approved print
forms, real weighing/shipment, and live ACCOUNTING self-approval for manual 116. The illustrated
question brief is local-only at `docs/sale-app/current/UAT2-FullLoop-Questions-20261027.docx`.

## Production work remaining

- Owner has authorized deployment to dbwins_worldfert9 on this host, using ports 80/443.
  The tracked SALEAPP_DEPLOY_ENABLED=false gate remains until the reviewed release is ready.
- A read-only forecast using the deployed, pinned UAT image succeeded on Production: 152
  unchanged, 3 pending (155-157), 0 drift. No schema/data/ledger changes were made. Migration 158
  is a newer candidate, so the final Production release still needs its own fresh guarded plan.
- Production config files, app/migrator principals and checkout exist. Validate the resolved
  model, credentials and isolation through the reviewed plan before any apply.
- DNS and company PKI have **not been started**, per the owner on 28 October. The owner chose
  temporary IP HTTPS with the existing internal CA. Company PKI is not installed and general
  client trust is not proven; IT must distribute the verified public root to client devices.
- Obtain a fresh verified pre-deploy backup, complete the native UAT acceptance above, promote
  the exact tested UAT commit through the release workflow, then run the guarded Production
  plan/apply. Migration failures can leave earlier migrations committed; inspect before retrying.

Production databases dbwins_worldfert9 and dbwins_worldfert2 contain live WINSpeed records.
No ad-hoc repair of their dbo data/schema was performed during this recovery. Never commit
secret settings, private keys, password hashes or operational screenshots to the public repository.
