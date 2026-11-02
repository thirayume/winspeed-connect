# R740 deployment and business acceptance

Operational snapshot: **2 November 2026 22:19 (ICT)**. This page records observed results;
current source and the latest successful server receipts determine the running release.
See [deployment guide](README.md), [public ingress](DUCKDNS-PUBLIC-INGRESS.md) and
[company PKI / ACME guide](TLS-DNS-PKI-ACME.md).

**Running release: 1.0.3 (`ab6cc0e`) on UAT, 1.0.2 (`d74dfe1`) on Production, 162 migrations. The owner holds Production
until the bugs below are fixed. All native writers stay off on Production until QA passes (owner, 2 November 2026).**
Older paragraphs below are history.

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

**116 number = transport slip (owner decision 31 October; migrations 161 and 162).** With
the booking's completed scale record the 116 takes its MoveBill and vehicle; net weight
within 2% of the coupon is normal, outside 2% is an exception. Without a scale record the
requester types the 7-digit slip number, always an exception. Exceptions need a MANAGER,
C_LEVEL or ADMIN approver other than the requester. The writer no longer advances the stale
`redemption` counter. Migration 162 lets the ACCOUNTING-only 107 accept exactly the scale
record a 116 was numbered from. UAT deployed `fdb9f76` (161) at 00:45 and `06af2ea` (162)
at 00:55 on 31 October; both plans applied one migration with health 200.

Run `R740UAT-20261031-02` found the 107 gap (the I chain stopped at 107 preview). Run
`R740UAT-20261031-03` then passed every phase for both chains. Line I ran on one labelled
simulated scale record inserted on UAT only (test vehicle, test slip range, 1 004 kg for a
1-ton coupon); its 116 took the MoveBill with ACCOUNTING self-approval. Line K had no scale
record; the typed slip became an exception, the requester's self-approval was refused, and
a MANAGER approved. Both 107s posted. The audit additionally asserts that each 116 number
equals the slip, with the expected slip source and exception flag. The redemption counter
was unchanged. The test accounts were disabled.

The owner promoted `06af2ea` to `main` and deployed Production on 31 October 01:05 behind a
fresh verified copy-only backup (2 minutes old at apply; receipt
`20261031-010457-prod-apply-06af2ea.txt`): 158 unchanged, 161 and 162 applied, health 200.
Production carries the slip writer and the scale-slip 107 writer; the native target guard
returns 0 there and all five native writer flags remain false.

**W1-a native document log (`d4c83c3`, no migration).** Reports > ตรวจสอบ/Audit gains
"บันทึกเอกสาร WinSpeed ที่ Sale-App ออก": one row per app booking with its AI, 104 and
credit approval, 116 with slip number, slip source and exception flag, recorder/approver
employees and 107, showing the effective user and, under Access As, the real actor (ACCOUNTING,
MANAGER, C_LEVEL, ADMIN with company-wide scope; Excel export). Its SQL was checked against the
UAT chains first. When a dispatch of the promotion workflow left no run, the owner allowed a
direct fast-forward of `uat` to `d4c83c3` (the workflow's CI step was skipped; the same backend
and frontend checks had passed locally). UAT deployed at 09:00 on 31 October (receipt
`20261031-090032-uat-apply-d4c83c3.txt`, 160/0/0, health 200). The owner promoted it with run
#5 and deployed Production at 09:12 (receipt `20261031-091258-prod-apply-d4c83c3.txt`, 160/0/0,
no backup required, health 200); writer flags remain false.

**W2 WinSpeed prints (`dccfd71` + `92114ab`, no migration).** `GET /api/native-print/116|107/:docuNo`
reads dbo only and returns a 116 slip (ใบขน / ใบตัดตั๋วปุ๋ย: receiver, plate, recorder, approver,
coupon lines, the scale record when exactly one matches) or a 107 delivery note (ใบส่งของ:
Header Master company header, customer, terms, lines with the 104 reference, linked slips,
amount in words). Duplicate numbers return 409. Roles come from the capability map
(`native.print-116`, `native.print-107`); team-scoped users see only their team's documents.
Paper Trail has a "พิมพ์เอกสาร WinSpeed" launcher, and the 116/107 dialogs get a print button
once the document exists. Every 2026 native 107 is VATType 3 (fertilizer is VAT-exempt), so the
form is titled ใบส่งของ, not ใบกำกับภาษี, and the VAT row appears only when there is VAT; accounting
to confirm. The owner promoted `dccfd71` with the workflow and UAT deployed at 09:37 on
31 October (receipt `20261031-093754-uat-apply-dccfd71.txt`, 160/0/0, health 200). The
deployed loaders, run inside the UAT backend container against the round-3 test documents,
returned complete 116 and 107 data, but showed that `VATType` arrives as text, which hid the
VAT-exempt line; `92114ab` compares it as a number. The owner promoted `ebe3214` and UAT
deployed at 09:46 (receipt `20261031-094604-uat-apply-ebe3214.txt`, 160/0/0, health 200; the
UAT bundle compares `VATType` as a number). The owner promoted `ebe3214` to `main` and
deployed Production at 09:54 (receipt `20261031-095440-prod-apply-ebe3214.txt`, 160/0/0, no
backup required, health 200). Verified read-only: the Production bundle has the launcher and
the VAT fix, `/api/native-print` answers 401 without a login, the target guard returns 0 and
all five native writer flags are false.

**W2 WinSpeed form alignment (`18e6281`, `ac38952`, `7a8c191`, no migration).** The default print
forms were read from WinSpeed's form registry (`dbo.SMForm`) and form libraries, which the owner
copied read-only to the server (kept out of git). 107 now follows the default "ใบส่งของ" form
(header blocks, reference row, seven columns, plate / coupon / transport-slip footer, remarks,
retention clause, five signatures). 103 adds the delivery date and the customer's billing terms
in the form's wording, and the signature titles พนักงานขาย / ผู้จัดการฝ่ายขาย / พนักงานคลังสินค้า. 104
is new: `GET /api/native-print/104/:docuNo` (capability `native.print-104`) and a print that places
each value at the WinSpeed pre-printed form's positions on Letter paper (owner: same pre-printed
stock, check with a PDF printer); Chrome print-to-PDF gives one Letter page. 102 was left as is
(6 WinSpeed quotations since August). The owner promoted `7a8c191`; UAT deployed at 13:48 on
31 October (receipt `20261031-134810-uat-apply-7a8c191.txt`, 160/0/0, health 200). The deployed
104 and 107 loaders returned complete data for the UAT test documents. A UAT 104 printed from
WinSpeed (default form, Microsoft Print to PDF) was then compared with the Sale-App print of the
same document by text-run position: the detail band is `height.autosize`, so lines are 104 units,
not 96, and the amount in words keeps WinSpeed's padding. After `154eb65` every matched value is
within 0.4 pt of WinSpeed. WinSpeed logs each print in `SMAudit` (action P, form name); Sale-App
prints do not. The promotion dispatch left no run, so the owner allowed a direct fast-forward of
`uat` to `154eb65`; UAT deployed at 21:45 (receipt `20261031-214512-uat-apply-154eb65.txt`,
160/0/0, health 200). A Production promotion dispatch also left no run; at the owner's request
Claude fast-forwarded `main` to `154eb65` and deployed Production at 21:57 (receipt
`20261031-215747-prod-apply-154eb65.txt`, 160/0/0, no backup required, health 200). Verified
read-only: the Production bundle carries the 103/104/107 prints, the target guard returns 0 and
all five native writer flags are false. Still open: one print on the real pre-printed stock.

**W1-b/W1-c audit reports and W5 docs (`f322520`, `f380fc8`, no migration).** Reports > ตรวจสอบ/Audit
gains policy history, sequence counters, truck-hold log and control-ticket alert history (read-only,
Thai time, ACCOUNTING/MANAGER/C_LEVEL/ADMIN). The R740 runbook, the role guide (section 0 generated
from the capability map) and the changelog (Unreleased since 1.0.0-beta.6) were refreshed. The
promotion dispatch again left no run, so the owner allowed a direct fast-forward of `uat` to
`f380fc8`; UAT deployed at 23:19 on 31 October (receipt `20261031-231920-uat-apply-f380fc8.txt`,
160/0/0, health 200). In the deployed backend the reports returned 19 policy changes and 2 counters;
the truck-hold and alert tables are still empty. At the owner's request Claude then fast-forwarded
`main` to `f380fc8` and deployed Production at 01:52 on 1 November (receipt
`20261101-015255-prod-apply-f380fc8.txt`, 160/0/0, no backup required, health 200). Verified
read-only: Production serves the same bundle as UAT, the four reports run against
`dbwins_worldfert9` (19 policy changes, 2 counters, empty hold and alert history), the report API
answers 401 without a login, the target guard returns 0 and all five native writer flags are false.

**1.0.0-beta.7 on UAT (`0f3a231`, migrations 163 and 164).** UAT deployed at 09:48 on 1 November
(receipt `20261101-094805-uat-apply-0f3a231.txt`, 160 unchanged, 2 applied) and again after that
evening's restore (`20261101-210202-uat-apply-0f3a231.txt`). Run `R740UAT-20261101-01` then passed
every phase for both chains, 207 checks, with new ones proving the customer's default contact on the
103, 104, 202 and 107 (and on the 107 print), the 104/116/107 prints with one log row per press, the
denials for a sales user, and both audit reports. `R740UAT-20261101-02` repeated the whole loop with
the private harness's replacement, `backend/scripts/uat-full-loop.cjs` (224 checks including
prepare and close), so the loop no longer depends on a private copy. Line I again ran on one labelled
simulated scale record. All test accounts were disabled. WinSpeed was not open, so this run was
checked by API and SQL, without a GUI read-back.

**1.0.0 on UAT and Production (`966f1ab`, owner decision of 1 November).** The system code is the same
as `0f3a231`. UAT deployed at 22:45 (receipt `20261101-224544-uat-apply-966f1ab.txt`, 162/0/0, health
200), and run `R740UAT-20261101-03` passed every phase on that image, 225 checks. The owner allowed the
direct fast-forward of `uat` and `main` (this token cannot dispatch the promotion workflows); CI on
`main` passed for `966f1ab`, and the same checks passed locally before the push. Claude took the
COPY_ONLY/CHECKSUM/VERIFYONLY backup `dbwins_worldfert9_predeploy_20261101-224858.bak` and deployed
Production at the owner's request (receipt `20261101-225030-prod-apply-966f1ab.txt`): 160 unchanged,
163 and 164 applied, verify 162/0/0, health 200 reporting 1.0.0. Verified read-only: the Production
bundle equals UAT's, the target guard returns 0, all five native writer flags are false,
`ALLOW_TEST_NATIVE_WRITEBACK` is unset, the live confirm procedure carries the contact edit, no `dbo`
object changed, Production holds no test accounts or simulated scale records, and the checked routes
answer 401 without a login. No booking was confirmed on Production, so the contact on a real 103 is so
far proven on UAT only.

The backend test list grew from 38 to 90 files (`npm test` 473 tests, also passing in a Linux Node 22
container); 51 of them had never run in CI, and three needed test-only fixes. Ten database-backed
files stay outside the list.

Read-only on Production, 1 November: staff accounts are still locked since migration 154 (only the
owner's administrator is active), there were no drafts or confirmations in the last 7 days, and the
approver list is still fully enabled. **The website is deployed, but no staff use it yet.**

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
- **GL:** WinSpeed posts every native coupon finance document (202) and every native 107,
  each as one two-line voucher with the document's number, date and amount: 202 moves the
  amount from the pending-delivery receivable to the customer receivable, and 107 moves it
  from pending-delivery to credit sales. Auto-post on save is off for 107. The app's 202
  and 107 are still unposted. Recommendation: the app keeps creating both unposted and
  accounting uses WinSpeed's own Post GL step, tried first on UAT with the latest test chain
  before that evening's restore; a read-only check of the resulting vouchers is prepared.
- **Print forms:** WinSpeed's form registry names a default form per document type (103,
  104, 107, receipts, credit notes); 116 has none. The company forms live on a file share
  that the R740 session cannot read, which explains the empty UAT preview.
- **AR report:** still deferred. The ledger shows the customer receivable is raised once,
  by the 202; the 107 only clears pending-delivery into sales. In the AR sub-ledger,
  however, every native 107 keeps its full amount outstanding and receipts settle only the
  202, so a report that adds both would double the balance; the correct report follows the
  202 (or excludes coupon 107s). App-created documents match the native fields. The form
  registry shows two company AR reports to confirm with accounting.
- **SSRS:** the R740 report server has no reports or data sources and no runs in 30 days,
  so there is nothing yet to accept with real users; the report list must come first.

Deferred by the owner to after 1.0.0 (decision of 1 November 2026). Apart from stock case SO-19 below, none of these is software work; scale
tolerance and the exception approver were settled by the owner on 31 October:

| Owner | Item |
|---|---|
| Accounting | Countersign the checks Claude ran for them on UAT (below): the Post GL trial, the AR report, the 107 title and the RB series |
| Warehouse | One 104 printed on the real pre-printed stock: needs a person, the paper and a printer, nothing else is open on it |
| Warehouse | Accept stock case SO-19 during training: enter a figure for one product, then check the badge and the warning on the bill screen |
| Factory | The two blocked scale cases (SO-17, SHP-05) and physical shipment evidence |
| QA | Dry-run the three QA guides on UAT: they need several roles, so staff accounts must be open first |
| Owner | Enable staff accounts in Production; trim the approver list; say which document MO weighings belong to; decide when the native writers go live |
| Staff | Close the stale bookings listed in the private register |
| IT | SSRS report list; an off-host copy of the backups; move the nightly job to Windows authentication |

**Stock case SO-19 was a software gap, not factory work (found 2 November 2026).** In 1.0.0 the stock
screen is hidden, the bill screen's badge reads field names the API does not return, and the reserved
figure hides about four fifths of the open tons, because it matches invoices to bookings by number while
the 103 and 104 counters overlap. The fix adds a stock screen for WAREHOUSE, MANAGER, ADMIN and C_LEVEL,
the badge, a shortage warning, and WinSpeed's own open quantity (`SODT.RemaQty`). It needs no migration.
Three limits remain: the warehouse types the figure until the owner decides
DG-04; a shortage warns but does not block a bill; and stale bookings count as reserved until staff close
them, so many goods will read short until then. The credit and PDPA tabs of the old screen stay hidden.

The fix is on UAT since 2 November 2026 12:09 (`45f5358`, receipt `20261102-120947-uat-apply-45f5358.txt`,
162/0/0) and is not on Production. A check in the UAT container ran the deployed route on the UAT database
with sign-in replaced: bad input and a SALES save were refused, reserved tons matched a separate query, all
four stock states read correctly, and the one test row was removed. UAT serves the new screens.

Claude then walked the screens at 16:30 on the same day, on real goods, in a session the owner signed in as
UAT Administrator. The stock screen saved a figure and its reserved tons matched a separate query. The bill
screen showed the badge, warned above the available figure, summed the same good across two bills, kept the
save button enabled, and read short once the figure fell below the reservations. No bill was saved. This
exercised the ADMIN role only and does not replace the warehouse's acceptance, so the case stays open. One
test figure and one empty draft trip remain on UAT until the 21:00 restore.

The warehouse was not ready to test, so the reserved figure was checked against documents WinSpeed has already
issued. On every open or closed booking line since 2019 the open quantity equals the ordered quantity less the 104s
that refer to it. That check found a defect in `45f5358`: a truck the scale had weighed out stayed reserved until its
104 was issued, about a fifth of the trucks and of the reserved tons. Release 1.0.1 drops those bookings; the old,
current and corrected routes were compared on the UAT database, and the corrected one matches a separate calculation
on every good. Fertilizer coupons sold but not drawn are still not netted, equal to about a
third of the reserved tons, and the stock screen says so; whether to net them is the owner's decision. Most of the
trucks weighed out without a 104 are more than two weeks old, which accounting should review. The private
verification record holds the documents, figures and recheck queries.

1.0.1 is on UAT since 2 November 2026 17:53 (`39973bc`, receipt `20261102-175326-uat-apply-39973bc.txt`, 162/0/0)
and is not on Production. The deployed route matched the separate calculation on every good, and the stock screen in
the owner's signed-in session showed the same reserved tons as the recheck query. The recheck queries gave zero on the
two checks that must stay zero. The push went straight to `uat`, so the CI steps ran locally first: backend tests,
rehearsal, trace tests, frontend build, batch, shell, deployment-config and secret-file checks all passed. Integration
test file `integration-so-06-07` still has not run in full. Its test accounts are locked, and its safety guard accepts
only the `remote_b` target by design, so R740 UAT is refused. It also inserts scale rows directly, so running it here
would mean loosening that guard, which is the owner's decision.

**Accounting's checks, run by Claude at the owner's request on UAT, 2 November 2026 evening.** WinSpeed's own Post GL
(Batch) posted two test sets, four documents: the vouchers have the same shape as real October ones and no other
document moved. WinSpeed's aging and outstanding-delivery reports count each ticket once, from its 202. A real
customer's report total equals GL account 112100, and the whole company equals it with zero difference once the test
documents not yet posted are added, starting from the ledger's own 31 December 2018 balance voucher; year ends 2021 to
2025 also show zero, while 2018 to 2020 are off by about the same fixed amount until 2021. The 107 prints the same
title and data as WinSpeed's default form, with four small differences in layout text. Series S and T go clearly with
the people in the register once the salesperson is taken per year. SO-19 passes at the API and on screen, including a
real save above the available figure, as a draft with no WinSpeed document; the warehouse role was checked at the API
only, because every warehouse account on UAT is closed. Two fixes came out of this:
the Sale-App AR aging report summed bookings and sales orders with no receipts, and the RB code assignment left S and
T a few documents apart, close enough to swap. Accounting has not countersigned, and the real-paper 104 print is open.

**Release 1.0.1 on UAT and Production, 2 November 2026 evening, on the owner's order.** UAT took `e26ad67` at 19:20
(receipt `20261102-191945-uat-apply-e26ad67.txt`) and Production at 19:23 (receipt
`20261102-192224-prod-apply-e26ad67.txt`), both 162 migrations with none pending, and CI passed on `main`. Both serve
the same frontend bundle. On Production, read only: the five writer flags are false, `ALLOW_TEST_NATIVE_WRITEBACK` is
unset, the target guard returns 0, the three checked APIs answer 401 without a login, no RB codes are assigned yet, the
stock recheck queries show zero differences, and the receivable report's source equals GL account 112100 with zero
difference. On UAT, the deployed routes matched the recheck on every good, the AR report on screen equals WinSpeed's
total, and a SALES call to it is refused. Production's screens have not been opened with a real account. The 104 on
UAT matches WinSpeed's PDF on one Letter page, with every value within 0.9 pt and the same data; the print rule hides
the dashed guides. Nobody has printed it on the real paper, so that row stays open and needs a person.

**Release 1.0.2 on UAT and Production, 2 November 2026 night, on the owner's order.** It changes printing and test
files only, with no migration and no backend route change, so the stock and AR results above still hold. Comparing the
107 with WinSpeed line by line found more differences than first reported; the form now matches, except a stray `0`
WinSpeed prints under its title and the amount in words sitting on its own line. A real PDF from Edge found what the
screen hid. The small-screen table rule also applied on paper, because A4 is narrower than 1024 px, so every printed
table collapsed to about 60% of the page. The 107, 116, delivery note and weigh ticket printed the modal's dark
backdrop as a grey frame. Long 107s spilled onto a second page. The longest 107 is now one clean A4 page, and a 116
and a weigh ticket also came out clean in real PDFs. Three wide reports fit their pages as measured in the layout. The
quotation, four-copy delivery note and booking form were checked in code only, because UAT had no bills at the time. No
physical printer has been used.

Full Loop run `R740UAT-20261102-01` passed every phase on `f57ca2a` through the real API with its own test accounts,
then closed them; later commits changed print only. After the 21:00 refresh, UAT held no test data, the stock route
matched the recheck on all 77 goods, and the AR report equalled GL 112100 with zero difference. Production took
`d74dfe1` at 22:18 (receipt `20261102-221718-prod-apply-d74dfe1.txt`, 162/0/0) with the same bundle as UAT; its five
writer flags are false, the target guard returns 0, the checked APIs answer 401 without a login, and CI passed. Production
screens have not been opened with a real account. A run of `integration-so-06-07` with a temporary sign-in on UAT was
refused by the agent's safety check, so it has not run.

**Release 1.0.3 on UAT, 2 November 2026 night; Production not yet.** Opening Production's screens with the owner signed
in showed the stock menu missing for every fresh session, because the backend menu list never gained it. The owner asked
for everything found to be fixed before any deploy. Fixed: that menu; sessions keeping old menus until the next sign-in;
the dashboard blocked behind the full-screen loader by the open-order list; three lookups comparing ids as text, which
took the list from about 20 seconds to 0.24 and the warehouse list from about 12 to 3.6, returning the same rows; the
quotation, delivery note and booking form printing customer names without their title; an approver's dashboard calling
an API it may not use; and the Sale Trip board showing a raw deadlock error. Every menu was opened in all eight roles
through Access As, on Full Loop test accounts with a role change for the four roles the harness has no account for, with
no failed request and no script error after the fixes. All printed forms that can be reached were checked as real PDFs.
Full Loop `R740UAT-20261102-05` passed all 225 checks on `ab6cc0e` and closed its accounts. Still open: the recon page and
the sales lists take 3 to 5 seconds; `integration-so-06-07` has not run; nobody has followed the guides by hand; no
physical printer has been used.

The push
went straight to `uat`, so the promotion workflow's checks did not run; the backend tests, rehearsal, frontend
build and the batch, shell and secret-file checks passed locally first. Promoting to Production needs the
owner's request and a version decision; the changelog holds the fix under Unreleased.

Known limit: the original client IP is lost at the Windows portproxy, so audit and rate limits see
the Docker gateway. The private illustrated stakeholder brief lists the accounting questions with
WinSpeed menu references and clearly labelled original video images.
**Version 1.0.0 is the owner's release decision. It does not assert business acceptance of the deferred
items above or unrestricted go-live:** the native writers stay off in Production, and the downstream
contracts remain the restricted UAT simulations described above.

Never commit secret files, password hashes, private keys, customer records or operational
screenshots to the public repository.
