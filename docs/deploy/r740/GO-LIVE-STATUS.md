# R740 deployment and business acceptance

Operational snapshot: **31 October 2026 00:10 (ICT)**. This page records observed results;
current source and the latest successful server receipts determine the running release.
See [deployment guide](README.md), [public ingress](DUCKDNS-PUBLIC-INGRESS.md) and
[company PKI / ACME guide](TLS-DNS-PKI-ACME.md).

## Production and UAT websites

Both stacks deployed DNS-01 release `cad0d542c78adfb97164bd774a638e50c309e474`:

- Production: https://worldfert.duckdns.org -> `dbwins_worldfert9`, DB ID 7.
- UAT: https://wfuat.duckdns.org -> `dbwins_worldfert9_uat`, DB ID 10.
- SQL instance: `R740-SRV\SQL2008`. The former hyphenated clone is retired.

UAT [promotion CI](https://github.com/thirayume/winspeed-connect/actions/runs/40857534673)
and Production [promotion CI](https://github.com/thirayume/winspeed-connect/actions/runs/40858332158)
passed on 29 October. Receipts:
`20261029-172817-uat-apply-cad0d54.txt` and
`20261029-173501-prod-apply-cad0d54.txt`, in each stack's deployment-log directory.
Both final migration plans were **157 unchanged, 0 pending, 0 drift**.
The earlier Production schema apply had a COPY_ONLY/CHECKSUM/VERIFYONLY backup and
committed 155-159; no schema migration was needed for DNS-01.

Trusted public TLS, hostname/chain/expiry checks, nonempty HTML and nine referenced
JS/CSS assets, HTTP redirects, CORS, SQL-ready health, exact database routing,
Socket.IO polling and WebSocket upgrade/welcome passed for both names. An intentionally
invalid nonexistent-user login returned 401; this is not acceptance of a real user's login.
Both login pages rendered in the browser without a certificate-warning bypass.
Public certificates expire on 27 January 2027 and are managed by Caddy automatic renewal.
Certificate keys and token values stay on R740; the protected token is mounted read-only
only in edge Caddy, outside Docker environment metadata and app/migrator containers.
The `/data` certificate volume persists across redeploys.

UniFi's incoming Thailand-only regional policy remains enabled. DNS-01 avoids incoming
CA validation without weakening that policy. LAN/VPN checks passed; the owner independently
confirmed both login pages open on Thai mobile data without certificate warnings.
Only edge Caddy joins both app networks.
Windows IP Helper's TCP portproxy remains in place; original WAN client-IP preservation
for audit/rate limiting has not been established. Unrelated Caddy ports 8080/8443 remain
untouched. SSRS is on 8888; authenticated report-user acceptance remains outstanding.

## Nightly restore, isolation and the Invoice metadata correction

The 29 October restore completed at 21:00:29 and unattended refresh at 21:02:18,
Task Scheduler result 0. Receipt `20261029-210205-uat-apply-cad0d54.txt` verifies
157/0/0 without migration apply. Both stacks remained healthy afterward.

The two isolated UAT v2 SQL logins can open only the UAT clone. Both Production
SQL identities retain their live-company permissions and have UAT-only DENY CONNECT.
These access results were rechecked after that scheduled restore. Production web-account
credentials intentionally replace UAT web accounts after refresh, as selected by the owner.
Do not preserve or reset a separate UAT admin password to hide this expected refresh behavior.

That first restore of the fully migrated Production database exposed a separate problem:
migration 157's copied metadata reader retained the Production migrator's resolved SELF
binding. The approved CONNECT denial correctly prevented this principal entering UAT;
Invoice 107 preview failed before any Invoice apply. The corrected UAT principal script
rebinds only the exact reviewed SELECT-only reader to the existing UAT migrator.
It normalizes the SQL2008 CREATE/ALTER catalog-header difference, rejects any body drift,
and leaves immutable migration bytes, native writer bodies and Production denials intact.

Live SQL rollback tests verified 26 nonempty metadata rows through the app identity,
unchanged other WF modules/permissions, idempotency, drift rejection and complete rollback.
The correction was then applied to UAT and both existing test chains resumed successfully.
The nightly principal setup contains the same repair. UAT was redeployed at `e9326e3` on
30 October 05:23 (receipt `20261030-052345-uat-apply-e9326e3.txt`, 157/0/0, health 200), so
the 21:00 refresh read the repaired principal script. **Observed on 30 October:** restore
21:00:30 from that evening's Production backup, principals re-mapped (both UAT identities OK,
both Production identities still denied), unattended deploy of `1e59a3d` with 157/0/0 and
health 200, and the Invoice metadata reader rebound to the UAT migrator automatically; called
as the UAT app identity it returned the expected 26 non-empty rows.

UAT was then deployed at `5f2116a` on 30 October 23:45 (receipt
`20261030-234503-uat-apply-5f2116a.txt`): 157 unchanged, migration 160 applied, health 200.
The UAT clone now has 158 migrations, the new 116 writer and the approver list (62 of 62
enabled).

The owner promoted `5f2116a` to `main` and deployed Production on 31 October 00:08 with a
fresh COPY_ONLY/CHECKSUM/VERIFYONLY backup (4 minutes old at apply; receipt
`20261031-000829-prod-apply-5f2116a.txt`): 157 unchanged, migration 160 applied, health 200.
Production now has 158 migrations and the approver list (62 of 62 enabled); the native
target guard returns 0 there and all five native writer flags remain false. From the next
nightly restore, UAT inherits Production's approver list, so the owner filters it in
Production.

## Restricted Full Loop evidence

**Run of 31 October 00:14–00:25 (after migration 160 on UAT and Production).** A separate
dated copy of the private harness (new run label, user namespace and state folder) passed
every phase for both chains: prepare, booking/AI, 104, 116, 107, audit and close. The five
test accounts mapped to a general-staff (type-G) employee, as the owner decided. Besides
all earlier checks, the audit now asserts that each 116 carries that employee in
`SaveEmpID`, leaves `AppvEmpID` empty, and has exactly one matching
`wf.NativeDocumentApproval` row (requester, approver, real actors, self-approval); both
chains passed. Both 107 previews worked on the restored clone, confirming the metadata
reader repair in a real run. All five accounts were disabled afterwards and returned login
401/403. No backup was taken first because the clone is replaced every night. **WinSpeed
read-back (31 October 00:23, session verified on `dbwins_worldfert9_uat`, view only):** both
new 116s open in "ตัดตั๋วปุ๋ย (WF)" with the recorder showing the type-G employee's code and
name and the approver field blank, plus the expected slip, receiver, vehicle, coupon, 104,
product, warehouse and quantity; the native display gap is closed. No WinSpeed audit row was
written during the read-back.
The 116 numbers still come from the stale `redemption` counter (an old month range), while
real slips since mid-October use the scale's `MoveBill`; aligning app 116 numbers with the
transport slip is an open design item before live use.

The run of 30 October after the restore completed both I -> I/C/J and K -> K/D/N:
quotation, booking 103, AI, complete 104/coupon, manual simulation 116 and ACCOUNTING-only
107. It used a fresh COPY_ONLY/CHECKSUM/VERIFYONLY UAT backup, five separately generated
role-specific test accounts and existing master data. No Production business test document
was created. Operational document identifiers and screenshots stay in the private handoff.

API/SQL/Document Trace checks verified quantities, references, one receipt per stage,
concurrent create/replay behavior, credit approval's actual actor including Access As,
ACCOUNTING 116 self-approval, WAREHOUSE creation with MANAGER approval, forbidden role/date
requests, and one 107 stock row. Both 202 and 107 retain the expected coupon flags/amounts;
this is not a substitute for reconciliation against the accounting team's AR report.
All five test accounts were disabled and returned login 401; their generated passwords
were removed from the private fixture. Physical shipping remains held.

Native WinSpeed read-back of the fresh run is **complete** (30 October, WinSpeed session
verified on `dbwins_worldfert9_uat`; view only — no Save, Post or repair). Both 104s, both
116s and both 107s open with the expected references, coupon, receiver, vehicle, product,
warehouse, quantity, amount, date and credit terms. Each 107 shows `Post Invoice`, cites its
own 104, carries 0% VAT, and has no GL lines (Post GL unticked) — consistent with GL mapping
still being outstanding.

The one native-display gap is on both 116s: the recorder field is blank and the approver
shows a raw numeric ID. Read-only profiling of the restored clone explains both:

- **Recorder:** WinSpeed fills `WFRedemtionHD.SaveEmpID` with the operator's employee on
  virtually every native 116; the manual-116 procedure (migrations 156/158) never writes
  `SaveEmpID`, so the field is blank.
- **Approver:** native 116s almost never use `AppvEmpID` (two rows in the whole history).
  The procedure writes the approver's verified employee there, but the employee mapped to
  the Full Loop test accounts is a salesperson-type record (`EmpType` S, no group), while
  every employee WinSpeed itself uses on 116 is a general-staff type (`EmpType` G). The WF
  form's approver list most likely excludes type S, so it shows the raw ID. To be confirmed
  with the WinSpeed administrator.

App audit and `SMAudit` keep the actual actors.

**Owner decision, 30 October:** write `SaveEmpID` from the requester's own employee; stop
writing `AppvEmpID`; keep the approver in the app; map future test accounts to a type-G
employee. Migration 160 (`160_native_116_recorder_approver.sql`) implements it:

- the 116 writer body is migration 158's plus six exact edits (pinned by a test): it
  records `SaveEmpID`, never writes `AppvEmpID`, and refuses a requester without an
  employee (`MR_RECORDER_MAPPING_REQUIRED`) or an approver not enabled in the list
  (`MR_APPROVER_NOT_LISTED`);
- `wf.NativeDocumentApproval` keeps one row per native document: requester and approver
  users, both real actors (Access As), both employees, self-approval and time;
- `wf.NativeApproverEmployee` is seeded with every WinSpeed employee; ADMIN/C_LEVEL disable
  entries in Master Data > "ผู้อนุมัติ WinSpeed", with history in
  `wf.NativeApproverEmployeeHistory`.

It is portable to Production, where the writer stays held by the target guard and flags.
Verified on local SQL Server 2008 R2 in a rolled-back transaction. Until Production carries
160, each nightly refresh re-applies it to UAT and re-seeds the list, so the owner's
filtering only persists once Production has it. The next Full Loop must map its test
accounts to a type-G employee (the private harness still uses the earlier mapping).

## Business go-live limits

The Production website is deployed. **AI/104/116/107 writer flags remain false in
Production**, and independent JavaScript/SQL target guards reject live databases.
The current downstream contracts are restricted single-line, whole-coupon, zero-VAT
UAT simulations. They do not certify physical dispatch, general partial/multi-line or
other-tax cases, or live accounting business writers.

Read-only findings on the restored clone, 30 October (details and recommendations in the
private brief dated 30 October):

- **Scale/transport:** the TruckScale tables carry live weighings since mid-September.
  For sales trucks since 15 October, the scale header points at the booking (103), its
  `MoveBill` is the transport-slip number that WinSpeed uses as the 116 number, nearly every
  native 116 has a matching completed weighing, and every net weight is within 2% of the
  ordered tonnage. `WGDTReport` stopped in September and is not evidence. The app's
  reconciliation already matches on `MoveBill`; acceptance tolerance and exception approver
  remain to be confirmed.
- **GL:** WinSpeed posts each native 107 as one two-line sales-journal voucher with the
  invoice's number, date and amount; auto-post on save is off. Recommendation: the app keeps
  creating 107 unposted and accounting uses WinSpeed's own Post GL step, tried first on UAT.
- **Print forms:** WinSpeed's form registry names a default form per document type (103,
  104, 107, receipts, credit notes); 116 has none. The company forms live on a file share
  that the R740 session cannot read, which explains the empty UAT preview.
- **AR report:** still deferred; the registry shows two company AR reports to confirm with
  accounting.
- **SSRS:** the R740 report server has no reports or data sources and no runs in 30 days,
  so there is nothing yet to accept with real users; the report list must come first.

Outstanding: the accounting team's accepted
AR report and non-duplication reconciliation (owner deferred), GL posting trial,
confirmation of print forms, scale tolerance/exception rules, and the SSRS report list.
The private illustrated stakeholder brief lists these questions with WinSpeed menu
references and clearly labelled original video images.
No version 1.0.0 or unrestricted business go-live acceptance is asserted.

Never commit secret files, password hashes, private keys, customer records or operational
screenshots to the public repository.
