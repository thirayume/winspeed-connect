# R740 deployment and business acceptance

Operational snapshot: **24 November 2026 (ICT)**. This page records observed results;
current source and the latest successful server receipts determine the running release.
See [deployment guide](README.md), [release 2.0.0](RELEASE-2.0.0.md), [public ingress](DUCKDNS-PUBLIC-INGRESS.md) and
[company PKI / ACME guide](TLS-DNS-PKI-ACME.md).

**24 November — the remaining three reports are implemented and rehearsed; release not yet deployed.**
The running UAT/PROD release remains `422818d`. This candidate makes all 37 report
implementations available, retaining the existing role, visible-scope and ADMIN
publication/ISO/template controls. No schema migration is introduced.

- AR receipt history reads native `ARReceHD` documents 206/108 once per header.
  Invoice allocations and cheque references are read separately; cheque linkage
  uses `CQCheqList.FromID = ARReceHD.PostID`. It excludes 106 Rebate returns and
  does not label receipt totals as sales or outstanding receivables.
- Received-cheque register reads native paper cheques and their valid movement
  history **as of the selected end date**, as confirmed by the owner. Future
  movements and replacements do not rewrite a historical report. Initial status
  is H when no prior valid movement exists. Native H/S/B/R/C/P meanings and
  replacement amounts were checked against the current WinSpeed report source.
  Earlier cheques are opening aggregates with document/customer/bank identities
  redacted. Unknown states or invalid replacement balances suppress outstanding
  totals and explain the incomplete result.
- Sales versus target reads native `EMSalePeriod`/`EMSaleTarget`; actuals are
  signed 107/108 less 109 returns/credits plus 110 debits, excluding VAT, on each
  document's own date. A full matching target period is required; no daily
  proration, fixed invented targets or percentages for missing/duplicate targets.
  UAT has no native target rows, so actuals render with a missing-target label.
  A positive configured-target case passed SQL Server 2008 table-variable proof.

Validation: backend 1,385/1,385; report browser/PDF 14/14; frontend typecheck/build
and deploy-config 31/31 passed. CI now includes the report browser suite. Final
candidate ran in a separate UAT process using the existing app SQL identity and
an actual password login for an audited synthetic C_LEVEL user; the running
server route was not replaced. October receipts: 348 headers, native header sum
difference 0 cents. Sales actual sum versus native invoice/adjustment headers:
difference 0 cents. Cheque report: 9 rows including redacted opening groups;
sales target report: 13 employee rows, all target/percentage cells null because
native targets are absent. Native SQL fixtures proved historical status,
cancelled-movement exclusion, replacement cutoff and opening redaction without
persistent schema or business-table writes.

Bounded HTTP downloads replaced the failed browser download-event capture.
Nine actual XLSX files were parsed and verified (numeric cells, string identifiers,
row values, workbook headers and matching SHA256 after copying privately to the
owner's PC), including public PriceList/CostList/annual budget and six candidate
exports. This proves HTTP file retrieval, not the browser's save dialog or a
physical printer. Candidate receipt/cheque print references use continuation rows;
physical multipage PDF counts, horizontal bounds and ISO stamps passed.
All four synthetic UAT logins are disabled, authentication versions revoked and
create/close audits retained. No business test documents, Reset, Rebate flag
change, PROD write or company-2 write occurred in this rehearsal.

Private proof: `scratch/report-completion-20261124/` (final candidate HTTP/SQL
logs, downloaded workbooks and hashes, QA cleanup and local test logs). These
files contain private operational evidence and are not part of the release.
Next: exact-commit public publication approval, hosted CI, official UAT rollout
and authenticated acceptance, then PROD promotion/rollout and postchecks. Renew
the primary native-writer source bindings through the official wrapper for the
new SHA; do not install QA hooks or change company-2 writer scope.

The following deployment and earlier unavailable-report statements are historical.

**24 November — owner-approved hotfix `422818d` deployed to UAT and PROD.**
The owner authorized public publication and UAT→PROD deployment of this functional
fix. Both exact-release CI promotions passed: UAT `45305561596`, PROD `45308556484`.
The official wrapper verified unchanged 274 / pending 0 / drift 0 on each primary
database. No migration was applied in this hotfix rollout. Company 2's official
read-only plan also has pending 0 / drift 0; no company-2 writes were performed.
Apply receipts:

- UAT: `D:\SaleApp\uat\deploy-logs\20261124-083733-uat-apply-422818d.txt`.
- PROD: `D:\SaleApp\prod\deploy-logs\20261124-103641-prod-apply-422818d.txt`.

Public main/uat and both running server checkouts are `422818d`. Four running
backend file hashes match that exact tree, public frontend assets match their
containers, and both health endpoints return HTTP 200 / SQL up. Both primary
native-writer audit bindings were renewed with 49 matching metadata fingerprints,
unfinished work 0 and active app writes 0 before the brief backend-only pauses;
both backends restarted in finally. Native target/bridge remain enabled on the
two primary databases and disabled on company 2. Feature/worker flags are unchanged.
All three participant fences retain generation 1 / READY and their prior ResetId.
No Reset, new business test document or secondary business write was performed.

Authenticated UAT screens now render successfully: default giveaway table
(6 columns / 54 table rows including headers and total), PriceList, CostList,
Daily Invoice (24 columns / 17 invoice groups), adjusted net sales, annual budget
and selected budget approval. The 31 October Daily Invoice filter gives J=9 groups
and N=8 groups with the expected book labels. Future-year synthetic UAT budget
2642 remains readable: caps and estimates are separate; selected plan 1 has
three item rows and three workflow signatories. Annual and approval print previews
open using their assigned templates. No production plan was created for acceptance.

Browser Excel-event capture failed twice and reset the browser-control runtime;
even the retry with explicit timeout did not return within that bound. These are
failed tool attempts, not passed download checks or demonstrated application
errors. No more download-event retries were made. Workbook/export acceptance from
the backend/driver rehearsals remains separate; physical printing is not certified.
The application tab stayed intact. PROD deployment was still waiting at its normal
restart confirmation during the second tool stall; it was resumed through the
official wrapper and completed successfully afterwards. The PROD admin session
expired during that stall. The owner subsequently renewed the ADMIN login, and
**authenticated PROD report-screen review has now passed** for the supported
screens in this smoke test: default giveaway, PriceList, CostList, Daily Invoice,
adjusted net sales, annual budget and Budget Plan. Both price sheets render 82
table rows across their paired-column sections, with print/Excel controls enabled.
Daily Invoice shows 24 columns / 17 groups; J=9 and N=8 correctly filter by book.
Net sales shows 16 columns / 44 table rows including group headings and totals.
No new fatal column/iterability error appears in the reviewed browser error log.
The annual 2569 report correctly displays an empty-period message and opens its
assigned print template. The 2569 Budget Plan selector has no saved plan choice.
The approval memo requires a plan ID before printing, as designed; completed
memo content/signatures were verified on the existing synthetic UAT plan only.
No plan was created in PROD to force a populated result.

Private evidence: `scratch/report-release-20261124/hotfix-postdeploy-integrity.json`,
`hotfix-native-audit.json`, `hotfix-browser-review.json`,
`hotfix-prod-browser-review.json`, official receipts and CI logs.
The three intentionally unavailable reports, next scheduled physical UAT restore,
existing employee signoff and physical-printer acceptance remain the boundaries
listed below. The following prepared/not-deployed statements are historical.

**24 November earlier post-deploy admin review — report rendering hotfix prepared.**
After the owner renewed both ADMIN sessions, Budget Plan opened on both websites.
The report catalog then exposed a real rendering failure: plain node-mssql
recordset arrays have a `.columns` metadata map. `runReport` incorrectly treated
that map as the report's typed column array, causing `TypeError: e is not iterable`
and a blank report page. The earlier 34-report inventory verified HTTP status and
row arrays only; it did not validate column-array contracts or establish that
these reports rendered successfully. Those earlier counts must not be read as
screen acceptance. The failure has been recorded and is not a passed check.

The source fix allows column overrides only from structured report results;
native recordset arrays use the configured typed columns. It preserves dynamic
annual-budget region columns. Tests now model driver metadata on populated and
empty recordsets, and feed a real backend-generated payload into the browser.
Backend **1,370/1,370** and the report browser suite **9/9** pass. A read-only probe
using the actual UAT app SQL driver reproduces the old failure, passes the fixed
path and validates typed columns plus rows for all **34 supported reports**.
The candidate was evaluated in a separate process from private temporary files;
the running route was not overwritten and no business data was written.
Existing publication authorization names `01a5da4` and necessary CI fixes. This
new functional hotfix needs its own public-release approval before CI and the
official UAT→PROD rollout. Administrator report-screen acceptance remains open.

**24 November — report release `01a5da4` deployed to UAT and PROD.**
The owner explicitly approved public release publication and UAT→PROD deployment.
Promotion CI passed on the exact release: UAT run `45232996814`, PROD run
`45236362069`. Both server checkouts, running report/budget backend file hashes and
public frontend assets match that release. Both public health endpoints return
HTTP 200 with SQL up. The official wrapper produced these apply receipts:

- UAT: `D:\SaleApp\uat\deploy-logs\20261124-010530-uat-apply-01a5da4.txt`.
- PROD: `D:\SaleApp\prod\deploy-logs\20261124-012409-prod-apply-01a5da4.txt`.

Verified COPY_ONLY/CHECKSUM/RESTORE VERIFYONLY backups preceded migration 278.
Only 278 was pending: it is now applied on primary UAT, primary PROD and company 2;
the three new report tables and EditVersion column exist on all three. Final
official PROD/company-2 plans have pending 0 / drift 0; UAT's apply receipt also
verified pending 0 / drift 0. Company 2 was migrated first, schema only; its native
writer target and bridge remain off. No company-2 business data was written.

Deployed UAT acceptance passed **43 checks** using five synthetic roles with real
HTTP login/JWT/role profiles. Five competing request pairs each produced one
successful action and one 409, with exactly five corresponding workflow audits.
The tests cover submit/review/approve, role and same-person restrictions,
reject/resubmit/cancel, assigned reviewers, approved-only annual reports,
allocation versus estimate and numeric XLSX output. The report inventory loaded
**34/34 supported reports**; the three intentionally unavailable reports below
were skipped and are not counted as passes. PriceList and CostList each loaded
159 rows. This is deployed automated acceptance with synthetic identities,
not personal acceptance by existing employees or an authenticated administrator
screen review. The latter is pending renewed login on both public websites.

Both primary native-writer approvals have been renewed against `01a5da4`: all
49 metadata fingerprints matched, unfinished native work was zero and active app
writes were zero before the brief backend-only pause. Each backend restarted in
`finally`. The resulting ChangeEvent records bind writer and bridge enabled to
the exact release. No native business document was created for this report rollout.
Rebate/worker flags match the pre-deploy baseline; all three participant fences
remain generation 1 / READY, with the existing ResetId. **No Reset was run.**
The fixed nightly-principal reader and nested-transaction helper are deployed;
the next scheduled physical restore has not yet run and is not claimed as passed.

Full-October and YTD (1 January–23 November) read-only reconciliation on all three
databases found zero net/VAT/daily arithmetic differences and no missing details.
YTD document counts were 9,912 / 9,912 / 10,397 (UAT / PROD / company 2).
This verifies period-report arithmetic, not opening AR balances, independent
accountant signoff or positive-VAT GL posting. VAT/GL remains accounting work in
WinSpeed after Sale-App completes the 107s covering its 116s.

Remaining handover boundaries: `sales-target-comparison`, `ar-receipt-history`
and `cq-cheque-register` still have no complete native implementation and must not
be represented as working reports. No live catalog publication, ordering or ISO
value was changed by this release; ADMIN can configure supported reports. Staff
signoff and physical-printer checks remain separate from the passed automated
checks. The disposable report-QA database/login have been removed. The five
deployed UAT fixture users were disabled and their authentication versions revoked;
their future-year test plans and audit history remain until normal UAT restore.
Private evidence is under `scratch/report-release-20261124/` on the owner machine.

The following dated investigations are historical pre-deployment evidence. Their
pending/not-deployed statements describe those earlier checkpoints, not the current
live release recorded above.

**23 November — report handover extension was a source candidate at this checkpoint.**
The owner identified missing annual promotion-budget forms, Daily Invoice transport
references, adjusted net sales, ISO control and broken PriceList/CostList projections.
The earlier document-writer rollout below does **not** establish that this report scope
is ready for full handover. This extension has not been committed, pushed or deployed;
migration 278 has not been applied to either live environment. It was committed only
in the owner-authorized disposable QA database, which was subsequently dropped. No
live settings, Rebate reset or secondary business writes were performed for this work.

**24 November pre-deploy finding:** both server checkouts still report `830553e`.
PROD SQL is up; the 23 November 21:00 UAT refresh rolled principal remapping back
because the native metadata reader's catalog body starts with LF. Its statements
match immutable migration 277. The principal helper now normalizes leading LF and
expected CRLF before the same exact binary comparison. Eight real-SQL read-only
cases accept only reviewed formatting/identity variants and reject changed body,
extra text or a missing reader. Following a verified UAT COPY_ONLY/CHECKSUM backup,
the corrected official principal script recovered app/migrator access and proves
zero UAT-login access to either PROD database. This is UAT prerequisite recovery,
not a report deployment or native-writer activation. The report release and this
correction must pass CI and the staged UAT→PROD gates together.
The subsequent copied native approval refresh exposed a second prerequisite bug:
the release template's `$script:tx` addresses the wrapper scope when invoked in a
child ScriptBlock. SqlClient commands therefore lacked the pending transaction.
Use the template's local `$tx`; no native SQL/guard or migration is changed.
Real SqlClient negative/positive controls reproduce the old failure and corrected
binding. The complete 49-fingerprint plan also passes inside the corrected nested
transaction with apply forced false and rollback. A large-stdin/WSL transport attempt
timed out; the bounded file-based proof passed and its owned temporary files were
removed. This proof does not claim native activation succeeded on the running UAT.
Interim recovery subsequently used the ordinary official Enable action, from the
exact already-deployed `830553e` checkout and reviewed plan hash, rather than the
broken copied-refresh path. After verifying no app write transaction, only UAT's
backend was paused and restarted in finally. UAT native target is now 1 with its
release audit; official post-restore Rebate adopt completed, generation 1 READY,
without reset or switch changes. Both public health checks report SQL up. This
recovers the existing release only; the new report release is **not deployed**.
Final candidate `01a5da4` includes both restore corrections. Local gates pass:
backend 1367, extra groups 132/61/424, offline 99, browser 60+3+9+6, build,
deploy-config 31, shell parsing and batch ASCII. October and year-to-23-Nov
arithmetic reconciles across three databases (YTD documents 9912/9912/10397), with
zero net/VAT/Daily differences and no missing lines. Publication to the configured
public GitHub remote still awaits the owner's response for this new release;
previous public approvals were commit-specific. No hosted CI/promotion or report
migration 278 has run on live databases in this phase.

| Candidate scope | Implemented behavior | Acceptance boundary |
| --- | --- | --- |
| PriceList / CostList | Read `Note` as Remark; derive special-price status from actual approval columns | Actual read-only UAT loads: 159 rows each, no invalid-column error |
| Annual Budget Plan | Draft, submit, assigned Manager review, assigned C_Level approval, reject/resubmit/cancel; own-plan access, both identities, edit-version checks and atomic audit | Real SQL-password login, actual app pools, independent SQL races and real HTTP/browser workflow with synthetic roles pass; real staff acceptance pending |
| Annual estimate | Any supported year, Jan 1–Dec 31, approved plans, region/item matrix; annual allocation separate from estimated item spend | Real-source SQL on temporary fixtures validates allocation, estimate and three signatures; warns if old plans lack detail rather than treating them as zero |
| Daily Invoice | 107 rows grouped by J/N book and invoice; 103/104/202/ticket/116 references with dates and plates, without multiplying sales | Actual UAT sample: 17 invoices / 24 lines, 24 matched / 0 ambiguous / header totals reconcile |
| Cost and profit | Native PowerBuilder basis: ICStockDetail → ICCostDetail.PayAmnt. Profit uses net sales excluding VAT after allocated bill discount, less that posted stock cost | Same 24 UAT lines fully costed; incomplete costs stay unknown, with no cost/profit total until complete |
| Adjusted net sales | 107/108 sales, 109 monetary credit or physical return, 110 debit; adjustment-document date | Actual UAT samples cover 3 debit, 5 monetary-credit and 3 physical-return lines; 202 debt and 106 RB are excluded |
| Catalog and output | ADMIN order/publication/ISO per report, transactional audit, template assignment for new keys, configured paper size, Excel and print filter context | Real XLSX and eight browser regressions, including multipage PDF; no live catalog setting changed |

Financial allocation is performed across the complete invoice before product/plate
filtering, with cent rounding reconciled on the last line. Physical returns reduce
quantity; monetary credits/debits do not invent transported tons. Business cutoff
applies to document selection and hides older source document numbers/dates in the
trace. These are period transaction reports, not opening AR balances. Invoice-to-116
`MATCHED` describes that linkage; it is not an accounting signoff of every upstream
document. Trace queries are batched separately because coupon indexes are absent.
Preview caps at 1,000 complete documents, Excel at 50,000; truncation is explicitly
flagged. A capped period must not be signed off as a complete year.

Regression evidence is local, not hosted CI or an authenticated deployed Full Loop.
Latest backend suite passed **1,367/1,367**, frontend TypeScript/build passed and the
browser regression suite passed **8/8** (synthetic HTTP fixtures for that suite). Read-only source-query inventory covered all
37 catalog keys: **32 loaded**, three intentionally unavailable and two new budget
reports awaiting migration 278. The first inventory had one timeout and two test
transport date-conversion failures; targeted retries with correctly typed SQL
parameters loaded AR aging (153 rows), GL sales journal (30) and customer dispatch
(18). Keep both attempts; these counts are not full-period financial signoff.
The new tests cover cent allocation, partial/full discounts, credit/return signs,
multi-slip nonduplication, incomplete costing, preview/export caps, ISO preservation
and clearing, audit rollback, budget separation of duties, stale versions and
resubmission. The browser fixture exercises real components with synthetic API data,
including every Daily Invoice column on A3 landscape. This is distinct from using
three real accounts and reconciling a full accounting period.

Migration 278 rehearsed twice idempotently, with down refusing business history and
then succeeding after fixture removal, inside an outer rollback on the UAT v3 copy.
Postflight found no fixture users/plans/new schema or remaining QA SQL session;
native trigger metadata and migration ledger stayed unchanged. Identity counters
may advance even when SQL data is rolled back. The first real-service transport
attempt hung and was stopped by its exact owned process; it is a failed attempt,
not a pass. Automatic approval review initially rejected the replacement rehearsal;
the owner then explicitly authorized temporary schema/test identities/plans on
`dbwins_worldfert9_uat_v3`, with whole-transaction rollback and session cleanup.
That bounded real-source SQL rehearsal has now **passed**: save → submit → review
→ approve; SQL-raised audit failure rolls the edited plan and details back; stale
versions, out-of-order approval and SALES approval are rejected. Exactly four
temporary ChangeEvents correspond to the four successful actions. The annual
report distinguishes a synthetic 1,000 allocation from a 110 item estimate, and
the selected approval report resolves all three synthetic signatories correctly.

The first adapter pass exercises actual service SQL and SQL Server through savepoints inside
one SERIALIZABLE outer transaction. It uses the QA Windows-integrated principal,
not the deployed application login. It is **not** an authenticated browser test,
an app-login permission test, or a race between independent SQL transactions.
Intermediate transport/session-option attempts remain failures, with successful
cleanup checks. The final adapter retains sequenced responses so a failed SSH
read can retrieve the previous result without re-executing a SQL operation; its
ARITHABORT/ANSI_WARNINGS settings match the application connection settings.
SQL lock waits remain bounded at five seconds, commands at fifteen seconds.

**Follow-up acceptance, 23 November:** the full source service workflow and reports
also pass under `EXECUTE AS USER` for the existing QA application database
principal. It has no db_owner, database CONTROL or dbo.SOHD ALTER permission.
A separate read-only `EXECUTE AS LOGIN` inspection confirms that the QA login is
enabled, is not sysadmin/db_owner and cannot open either PROD database or the
primary UAT database. This checks the security context, not a SQL-password/TCP
authentication handshake.

A real loopback HTTP/browser rehearsal then passed with three separate synthetic
SALES/MANAGER/C_LEVEL accounts: real password login, JWT validation, database role
profiles, prepare → submit → review → approve → print, four ChangeEvents, and
whole-transaction rollback. No API response was mocked. The connection adapter
uses the QA application database principal; it serializes entire HTTP requests
inside one outer SQL transaction so savepoints cannot cross request boundaries.
It is not an independent-transaction race, a deployed-environment test or signoff
by existing staff. The ADO bridge's unzoned DateTime DTOs also do not establish
production-driver timestamp parity; the final print fixture separately verifies
UTC-to-Bangkok formatting.

The browser found and fixed a real loading race: selecting a plan left the reason
input editable, then cleared text typed before the load completed, so review was
never submitted. Plan/year selection and the reason input now wait while busy.
Saved/opened plan years stay aligned and legacy CE years display as BE. Budget
menus follow assigned/revoked permissions, including a custom reviewer. Budget
approval printing no longer repeats generic warehouse signature boxes below its
three workflow signatories. Current regression is **backend 1,366/1,366**, frontend
build passed, **six mocked browser cases passed**. The successful real HTTP case
preceded the print-only signature correction; that correction has separate visual
and browser acceptance. Earlier failed transport/encoding/timeout/UI attempts
remain evidence, not passes. Final postflight again confirms zero fixture
accounts/plans/new schema/sessions and an unchanged rollback baseline.

After final rollback the baseline matches: application-user/plan/audit/permission
row counts, migration-ledger count/checksum, BudgetPlan column metadata, absence
of all three new tables and SHA-256 of dbo trigger definitions/disabled state.
Temporary worker files were removed. An independent read-only postflight confirms
zero fixture users, fixture plans, new schema and remaining owned QA SQL sessions.
Evidence is private under `scratch/report-readiness-20261123/`, including
`budget-source-sql.json`, `qa-postflight.json` and failed-attempt logs. Migration
278 remains unapplied persistently everywhere; no deployment or live flag change
was made. Identity counters may still advance after a rollback.

Read-only inventory of the supplied Reports folder found 231 PBD and 19 PBL
PowerBuilder libraries; original files were not modified. Static extraction located
the native Daily Invoice cost expression. Inventory and selected expressions do not
mean every legacy form, filter and print layout has been ported or accepted.
The print preview no longer presents an unsigned title/timestamp QR as report
verification; there is no signed report-verification endpoint. Company footer
comes from the selected header rather than a fixed company name.

**Remaining handover gates:** obtain real staff acceptance, reconcile complete
selected periods and legacy budget details with the report owners, and confirm
official ISO codes/templates and physical print output against native forms.
Actual app pools and independent transactions now pass in the isolated rehearsal
below; synthetic long/multipage Thai PDFs pass but do not replace owner signoff;
review the final combined commit and migration permissions, then use the official
release/deploy gates. The three existing unavailable reports — AR receipt history,
cheque register and sales-vs-target — should remain unpublished until their native
sources and acceptance exist. Their APIs remain unavailable; this task did not
change live publication. Do not describe all reports, all APIs or all roles as fully
accepted from the previous sales-document Full Loop.

**Isolated committed rehearsal completed, 23 November (owner approved separate DB/login):**
The earlier rollback-only schema probe returned SQL 1222 and could not establish
independent transactions. The owner then explicitly authorized a disposable database
and limited SQL login. A fresh COPY_ONLY/CHECKSUM backup of v3 was verified and
restored to `dbwins_worldfert9_uat_reportqa`, without replacing an existing database.
Migration 278 and synthetic fixtures were committed only there. The runtime used
unmodified `backend/db.js` and the production `mssql`/tedious path with real SQL
password authentication over TCP, not the file-RPC/savepoint adapter.

- Restricted login: no sysadmin/db_owner/database CONTROL, no native ALTER/UPDATE,
  and no access to either PROD database or primary UAT. Both actual app pools pass
  their startup identity checks; no staff password was used.
- Independent SQL transactions overlapped on two distinct SPIDs. Duplicate create
  (CE/BE same year), same-version save, submit, review and approve each yield exactly
  one success and one 409, with one corresponding ChangeEvent per successful action.
- A real SQL audit-failure trigger rolls the plan header/version, lines, allocations
  and audit back together. Wrong-role and out-of-order approval are blocked.
- Three synthetic accounts in separate browser contexts pass real LoginPage/JWT/
  RoleProfile/API and prepare → submit → Manager review → C_Level approval → print.
  An additional five competing HTTP action pairs each have one success and one 409;
  five successful actions produce five audits. Requests are not serialized by a QA
  middleware. Actual driver timestamps are UTC Date objects/JSON with `Z`, and the
  Thai print shows the same Bangkok time as the browser clock.
- Annual report and real XLSX distinguish allocation 1,000 from estimate 110 and
  remaining 890. Fixed XLSX allocation summaries from concatenated text into labelled
  numeric cells so users can calculate with them; regression covers the actual file.
- Same driver/login validates Daily Invoice 17 documents/24 lines, reconciled header
  amounts/cost arithmetic, J/N and combined document/customer/plate filters, including
  an absent plate; net sales 17/24, 110 (3 lines), 109 monetary credit (5), physical
  return (3), PriceList/CostList 159 each, and exclusion before the configured cutoff.
  This is sample acceptance, not a full-period accounting reconciliation or opening AR.
- A new long-print test exposed an extra nearly empty PDF page caused by context
  pushing ISO/footer past a fixed row count. Pagination now measures content, including
  wrapped rows, summary and footer, before assigning page rows. Final annual fixture
  has 80 distinct rows/9 regions across 8 physical/logical pages; Daily Invoice has
  14 distinct invoices across 6 pages. Every physical page contains details and ISO;
  totals and global row numbers survive repagination. Poppler renders were inspected.
  These are synthetic A3 regressions, not a physical printer/native-form signoff.

Cleanup is complete: disposable DB/login/SQL sessions all zero; protected generated
credentials, owned backup/data files and remote QA working directory removed. Source
v3 users/plans/ledger count+checksum and BudgetPlan schema baseline match; native
trigger definitions/state and SystemSetting checksums match the untouched copy.
No deploy, public push, existing-database restore, native guard disable, user-session
kill, Rebate setting/reset or secondary business write occurred. Intermediate failed
harness assertions remain recorded: trigger error-chain handling, reused fixture year,
and the numeric-Excel finding. The initial sandboxed unit run could not fetch loopback;
its unsandboxed localhost rerun passed all 1,367 tests. Final source hashes and private
results are in `scratch/report-readiness-20261123/report-readiness-final-acceptance.json`.
The final frontend-only pagination change is separately covered by build, 8 browser
regressions and PDF verification; SQL/API acceptance precedes that print-only change.

**Prepared real-user report UAT (not yet executed on a deployed candidate):**

| Case | Participants / action | Required acceptance |
| --- | --- | --- |
| BP-01 | Actual preparer → assigned Manager → assigned C_Level | Separate identities; save/submit/review/approve and audit match; draft/rejected plans excluded from annual approved totals |
| BP-02 | Two browsers repeat save/review/approve; unauthorized staff try another plan | One successful change, stale/duplicate 409, denied access leaves no mutation/audit |
| BP-03 | Reject → change → resubmit; cancel unapproved draft; print selected plan | Re-review required; preserved history; correct three signatories and Bangkok times |
| RP-01 | Accounting chooses a complete agreed period; compare J/N and native invoices | Native header totals, discounts, costs/profit, linked 103/104/202/tickets/116 and plates reconcile without fanout |
| RP-02 | Credit/debit/physical return in a later month; choose cutoff boundaries | Adjustment counted on its own date; quantity only changes for physical return; period flow not mistaken for opening AR |
| RP-03 | Marketing owns annual plan/legacy details; ADMIN configures official ISO/template/publication | Jan–Dec year and allocation/estimate distinct; missing historical detail explicit; official codes and paper selected; numeric Excel/physical print approved |

The owner authorized acceptance and UAT/PROD deployment on 24 November 2026.
Proceed UAT first, then PROD only after its gates pass. This authorization is distinct
from the earlier isolated-test permission; no report release receipt exists yet.
Review the combined commit and migration 278 permissions/down behavior before the
normal release gates. Keep the three unavailable reports unpublished until their
own sources and acceptance are complete.

**23 November — UAT and PROD are now on `830553e`, v3/bridge active.**
The owner authorized the exact public release and UAT-first rollout, followed by
PROD after acceptance. [UAT promotion CI](https://github.com/thirayume/winspeed-connect/actions/runs/45142999229)
and [PROD promotion CI](https://github.com/thirayume/winspeed-connect/actions/runs/45147843473)
both passed. The tested backend tree remains `bd3ab1e7159a80067a61a74f4ac3347509630bd6`.
Both remote branch heads, both deployed checkouts and both healthy backends use
`830553ed568e9c60bc305c068b15d9f009691a1c`. Public HTTPS health is 200 with normal
certificate validation. The served frontend index artifacts match exactly.

| Final database | Applied in rollout | Final ledger | Native writer / bridge |
| --- | ---: | --- | --- |
| UAT | 18: 260–277 | 273 entries; pending 0 / drift 0 | Active, four reviewed custom hooks, one release audit |
| PROD main | 23: 255–277 | 273 entries; pending 0 / drift 0 | Active, four reviewed custom hooks, one release audit |
| PROD company 2 | 23: 255–277 | 273 entries; pending 0 / drift 0 | Inactive; no writer binding or native business-write activation |

COPY_ONLY/CHECKSUM backups for all three databases passed RESTORE VERIFYONLY
before their migration applies. All live operations used the official deploy
wrapper and the documented company migration helper. Main PROD receipts are
`20261123-163812-prod-apply-830553e.txt` and the final configuration reload
`20261123-165718-prod-apply-830553e.txt`; UAT receipt is recorded below.

Both primary application logins passed the fixed 49-hook metadata check,
including the 39 unchanged WinSpeed-native hooks. Neither login is sysadmin or
db_owner, sees native definitions directly, or can write the protected contract
or release journal. Both native contracts are bound to the actual release SHA.
SALES cannot issue new 104 tickets; its existing-ticket request and own-customer
Rebate permissions remain available. Counter ticket sale permission is enabled.

Initial PROD activation attempts hit SQL 1222 and rolled back completely: the
fresh plan retained the exact baseline hash and no release row. A bounded,
activation-only exception trace identified the timeout; read-only lock inspection
identified a Sale-App Rebate SELECT with zero transaction log writes. The new
backend was paused for activation, then restarted in `finally`; WinSpeed sessions
were not killed. Activation succeeded, with exactly one committed release audit.
The observer was stopped and its trace handle removed. Keep the ten-second lock
timeout; arrange application quiescence for future hook DDL.

Final functional environment flags match, including v3, bridge, all four stages,
Rebate approval/conversion/preview/reset controls/discovery and active workers.
PROD's two remaining differences (`REBATE_CONVERSION_ENABLED` and
`REBATE_RESET_ADMIN_ENABLED`) were aligned to UAT with a protected config backup
and an official wrapper reload. The old one-step conversion endpoint still
refuses with `REBATE_CONVERSION_APPROVAL_REQUIRED`; it cannot bypass the approved
request workflow. Enabling the Admin reset control did **not** execute a reset.
All current coordinator/participant generations remain 1 / READY.

Authenticated ADMIN browser smoke passed on both environments: sales/trip setup,
Paper Trail, Rebate requests/evidence, giveaway quota loans and settlement/bridge
queues. PROD also exposed the reset settings tab without submitting its protected
confirmation. No console error remained after the final reload. These are
read-only rollout checks, separate from QA ZERO 402/402, exact-source DISCOUNT
441/441 and the earlier real WinSpeed GUI concurrency acceptance. No live sales
documents or reset were created for acceptance; VAT-positive/GL posting remains
accounting's WinSpeed work.

Nightly task inspection resolved the apparent helper discrepancy: the actual
backup task invokes the reviewed helper **inside the UAT checkout**, whose
SHA-256 is `134e066640a56deef0b00ae2d2a4696cc0bedf335b5ed54e6cc4609176fd45ea`.
The older `tools` copy is not the action used by that task and was left untouched.
No real nightly restore/rebind was invoked during rollout. Future restore still
requires a copied enabled PROD approval with the exact source SHA and no
unfinished work, as described in the runbook.

Post-rollout data readiness found zero stored 2026 Oct-31 reference prices in
both primary environments. Read-only WinSpeed inspection found 71 unique
general announced-price products effective on that date, with zero ambiguous
latest-date groups. Authenticated ADMIN used the existing snapshot screen in
each environment; both transactions saved 71 references. Actual app-login SQL
verification found all 71 matched their source price-list ID, product, value
and effective date, with the authenticated recorder captured. No WinSpeed price
or secondary-company business record was changed.

**Known nonblocking display issue:** snapshot `CapturedAt` is a legacy SQL
`GETDATE()` local-time field, while the browser renders its driver timestamp as
UTC, adding another seven hours. Raw SQL capture times and the immutable
Oct-31 reference date were verified; price values and Rebate amounts are not
affected. Correct the response/display timezone in a separately reviewed code
change, with a regression against the raw SQL local timestamp. Do not rewrite
stored capture history to disguise the display issue. This is not a claim that
every historical API presentation issue has been eliminated.

**23 November, UAT rollout stage — `830553e` deployed and activated; PROD pending.**
Historical intermediate state; superseded by the final rollout above.
The owner approved public release publication and UAT-first rollout, with PROD
conditional on all gates. [Promotion CI 45142999229](https://github.com/thirayume/winspeed-connect/actions/runs/45142999229)
passed in 5m6s and fast-forwarded `uat` to the exact reviewed release. A fresh
COPY_ONLY/CHECKSUM backup of UAT passed RESTORE VERIFYONLY before deployment.
The official wrapper applied migrations 260–277 (18), verified pending 0/drift 0,
and returned healthy HTTP 200. Receipt: `20261123-160618-uat-apply-830553e.txt`.

The separate UAT activation plan verified all 49 metadata fingerprints, the
reviewed active ADMIN identities, exact ledger and no unfinished operations.
Its hash-approved ENABLE completed through the official wrapper. An actual
application-login read-only acceptance then passed: target and bridge ready,
49 reviewed hooks including all 39 unchanged native hooks, neither sysadmin nor
db_owner, zero direct native definitions, and no direct contract/release DML.
SALES ticket-sale denial, SALES draw/Rebate permissions and Counter ticket-sale
permission passed the deployed policy checks. UAT's reset epoch remains
generation 1 / READY; no reset was performed.

Authenticated browser acceptance is **pending the owner's UAT login**. Opening
and reloading the public page showed the login form, not an authenticated test.
Do not treat SQL/policy checks as a new browser or new WinSpeed GUI Full Loop.
PROD is still running `fbbc139`; neither PROD promotion/deployment/activation nor
company-2 migration has started. Both company databases have new verified
COPY_ONLY/CHECKSUM backups, whose 120-minute freshness must be rechecked before
apply. The installed `tools/Refresh-UAT.ps1` differs from this release's reviewed
helper; updating and verifying that copy remains a rollout gate before relying
on nightly v3 rebind. No secondary business write or Rebate reset occurred.

**23 November — readiness gaps implemented, isolated QA accepted; not deployed.**
This preparation snapshot predates the UAT rollout recorded above; PROD remains pending.
The source candidate is `7889f938458e9705a7fce6782eeef894af54c272`
(backend tree `bd3ab1e7159a80067a61a74f4ac3347509630bd6`). Final acceptance
`R740V3-20261123-16` repeated DISCOUNT against all 1,220 files from its Git archive,
with the nine original migration byte pins separately verified: **441/441,
15 phases, zero failed, closed**. Git-declared archive EOL filters were respected;
applied SQL and ledger bytes were not rewritten. The earlier ZERO run remains
402/402. This candidate has not been pushed or run through hosted CI.

The new source pins v3, the bridge and all four native document functions equally
for UAT/PROD, and Compose/its validator carry the bridge flag. Migration 277 adds
the fixed SELECT-only metadata reader and protected activation history. It was
backed up with COPY_ONLY/CHECKSUM/VERIFY, rehearsed up twice plus down refusal and
successful down in outer rollback, then applied only to the isolated QA copy.
The app there now has zero direct native trigger definitions visible and reads
all 49 through the fixed reader. No dbo/VIEW DEFINITION grant was added to live
application logins. Original applied migrations and their ledger hashes remain unchanged.

The official deploy wrapper now has separate read-only activation plans and
hash-approved enable/disable actions. It validates the deployed source, migration
bytes, live ADMIN identities, metadata, pending work and ordered locks. Contracts,
four existing custom hooks and business/release audit commit together; plan replay
is refused. New coupon reservations fail closed during activation gaps. A
history-bearing disable **pauses while retaining guards**, rather than reopening
a native bypass; actual QA API and WinSpeed-style SQL debit attempts were blocked
and the balance was unchanged. Resume passed. Only a pristine target can restore
the exact original four custom hooks. All 39 WinSpeed-native hooks remain intact.

UAT restore remaps only the exact reader body. The new restore rebind accepts an
already copied Production approval only when its audit names the exact deployed
source SHA, metadata/ledger and active reviewers still match, and unfinished work
is absent. It links the new binding to that copied approval without querying or
writing Production. A different release, missing approval or retained hold stops
the refresh for review. Unit cases and a copied-approval SQL simulation passed
inside QA rollback; the simulation substitutes only the target constant in an
ignored test copy. **No real UAT nightly restore/rebind was run.**
Fresh QA bootstrap also passed without an app-owned contract write; its extra
reviewer was immediately retired and its private password removed.

| New isolated acceptance | Result | Boundary |
| --- | --- | --- |
| ZERO, `R740V3-20261123-13` | 402/402, 15 phases, zero failed, closed | Normal mixed bill reserves at 103 and finalizes through 116/107; the incompatible legacy endpoint cannot debit it again |
| DISCOUNT, `R740V3-20261123-15` | 441/441, 15 phases, zero failed, closed | Normal ZERO bill still works with the live-style DISCOUNT setting; a separately labelled WinSpeed-shaped single-line fixture proves the configured posted-sale endpoint |
| Exact candidate DISCOUNT, `R740V3-20261123-16` | 441/441, 15 phases, zero failed, closed | Same flow repeated after checking all archived backend files against candidate `7889f93`; users retired and passwords removed |
| DISCOUNT financial chain | 104/202 before redemption; 500 gross / 500 footer discount; AR, net and VAT zero in 202/107; 107 book N; GL not posted | Fixture setup is SQL on QA, not a frontend footer editor or a positive-VAT/GL acceptance |
| Competing valid cut requests | Exactly one competing request succeeds, the other revalidates/refuses; remaining quantity closes once and concurrent 107 gives one invoice | Real authenticated API/SQL concurrency; prior actual WinSpeed GUI acceptance remains separate |
| Cleanup | All seven users retired and private passwords removed from each finished run, including failed trials | Trial runs 11, 12 and 14 retain their failures and are not clean acceptance |

Fresh read-only live plans now show UAT 18 pending (260–277), PROD main and
company 2 each 23 pending (255–277), zero drift and no orphan ledger entries.
Their migrator rights remain wf-only; no dbo ALTER grant was added.
Final read-only health checks still show UAT `9b42bdd` and PROD `fbbc139`
healthy with their previous container start times. QA has zero remaining owned
loop users, unreleased native saves or copied-approval simulation rows. Its app
is neither sysadmin nor db_owner and cannot access the three live databases.

Backend 1346/1346, runner 14/14, focused 19/19 and deployment configuration 31/31
passed. Frontend source is unchanged; its prior build/browser results remain
separate. Final live migration plans and the immutable candidate SHA are recorded
with the private evidence and final handover. Hosted CI, fresh live predeploy
backups, authorized rollout/activation and post-deploy business smoke remain
deployment gates. No push, live deployment, live migration/grant/flag/reset or
secondary business write occurred.

**23 November — read-only release review of `805fb71`: not yet a go-live approval.**
The following is the historical baseline review. Its source gaps are addressed
by the candidate and isolated acceptance above; live activation remains pending.
The exact candidate contains both running releases and the observed remote main head.
Previously recorded isolated QA acceptance remains valid, but deploying this commit unchanged
will not activate the tested unified writer. No live checkout, image, service, permission,
migration ledger, feature flag, reset or secondary business data was changed in this review.
The deployment wrapper's `-PlanOnly` was deliberately not run: it synchronizes the
server checkout and builds images. Instead, the exact hash-checked candidate runner
ran with `plan:true` in disposable read-only containers using the appropriate migrators.

| Read-only plan, 23 November | Running checkout | Unchanged | Pending | Drift |
| --- | --- | ---: | ---: | ---: |
| UAT | `9b42bdd` | 255 | 17: 260–276 | 0 |
| PROD main | `fbbc139` | 250 | 22: 255–276 | 0 |
| PROD company 2 | PROD stack | 250 | 22: 255–276 | 0 |

All three databases were ONLINE at compatibility 80, both live backends healthy and
their checkouts clean. No orphan ledger filenames were reported. All 22 candidate
migrations have an up transaction marker and a corresponding down script. Planning
does not execute their SQL against live data and is not live migration acceptance.
Migrators have wf schema control and the required CREATE permissions without db_owner;
they have no dbo ALTER permission. That separation is retained.

**Release blockers and acceptance gaps:**

- Both target files still pin `NATIVE_DOCUMENT_WRITER_VERSION=legacy`; the four
  native writer flags remain true in UAT and false in PROD. The root Compose backend
  does not forward `NATIVE_COUPON_BRIDGE_ENABLED`. A private-env change alone cannot
  activate the tested bridge.
- Migrations 263 and 270 leave the operational writer/bridge contracts disabled.
  The four-hook installer and contract bootstrap are QA-only. A reviewed,
  environment-pinned activation/deactivation path with current metadata hashes,
  real audit identities, partial-save holds and nightly UAT refresh handling is
  still needed. Do not point the QA installer at live databases or widen dbo rights
  on the application login.
- Actual application logins on all three databases can see the 49 trigger rows but
  **zero trigger definitions**. Candidate `verifyOperationalMetadata` requires all
  reviewed definitions; enabling v3 with current rights would fail closed. Supply
  a narrowly scoped reviewed metadata reader or exact object permissions and prove
  the actual app login passes before writer activation.
- The Rebate-on QA profile enforces ZERO treatment; live runtime is configured
  DISCOUNT. Since migration 258, ticket lines in a normal bill deliberately use
  ZERO independently of the separate redemption endpoint. Generic discount SQL
  tests do not certify the full live DISCOUNT endpoint plus the new bridge.
  Confirm the intended endpoint/UI policy and rehearse that exact configuration
  on a fresh copy, including legacy document financial-shape/adoption limits.
- No hosted CI run exists for exact `805fb71`; the candidate is not the remote
  release branch head. Local equivalent checks are recorded separately. Publishing,
  promotion and deployment have not been performed.
- Observed full backups were from 22 November around 21:00 ICT, approximately
  935–941 minutes old when inspected. They are not fresh predeploy acceptance.
  Take new COPY_ONLY/CHECKSUM backups and verify them in the authorized deployment
  window; retain distinct files/receipts for UAT and both PROD companies.

Migrator read-only checks matched all 49 expected trigger definitions/states in
each database. No active old native authorization or unreleased edit hold was found.
No PENDING/APPROVED legacy 104/116 request rows were found at inspection. Recheck
that state, outstanding permits/reviews and actual runtime flags at cutover;
these observations expire as users continue working.

**Proposed order after the blockers are resolved and deployment is authorized:**

1. Freeze one reviewed release SHA, verify immutable migration bytes, rerun CI and
   rehearse the activation/rollback kit plus the exact intended Rebate treatment
   on a fresh UAT copy. Preserve the prior 391-check QA result as separate evidence.
2. Arrange a bounded writer maintenance window, fresh verified backups and a new
   immutable plan. Use only `deploy-r740.ps1` and its reviewed company-migration
   procedure; do not execute pending SQL ad hoc or repair ledger checksums.
3. UAT applies 260–276 in order, then must report pending/drift zero. Apply approved
   metadata access/contracts/hooks separately with audit; verify native trigger
   hashes/states and run authenticated App + WinSpeed acceptance before PROD.
4. PROD main and company 2 each need 255–276 with their own backup, plan and ledger
   verification. The company migration uses the UAT backend image: verify that it
   contains the same reviewed release SHA, not the old running UAT image. They are
   separate transactions/databases: a successful main plan does not certify company 2.
   Hold affected cross-database mutations until both schemas and checks are complete.
   Company-2 schema migration does not authorize its
   business writers; v3 currently allows only primary PROD/UAT/QA.
5. Verify role ceilings, Access As, multi-line/partial cuts, both concurrency orders,
   recovery/release, invoice completion, balances/opening cutoff and business audit.
   Preserve issued tickets and the existing Rebate epoch; do not reset.
6. Keep forward recovery available. Down scripts intentionally refuse after native,
   loan, ticket or bridge history exists; for example 255, 258, 261, 263 and 270.
   Application rollback is not a safe schema/history rollback. Do not delete history
   to force a down script or restore over subsequent business transactions.

Local checks on this candidate passed: the three additional backend CI groups
132 + 61 + 424, offline rehearsal 99, frontend typecheck/build, browser resilience
52, date-window 3, admin 9, trip 6, deployment-config 31, three deploy-shell syntax
checks and tracked-file hygiene. These suites overlap the previously recorded
1341 backend/14 runner tests; do not add them into a distinct-test total. The first
browser attempt stalled at sandbox dev-server startup and was terminated; the
localhost-permitted repeat completed all four suites. No hosted CI result is claimed.

Private evidence: `scratch/codex-readiness-805fb71-20261123/` (ignored; no credentials).


**23 November — unified 116 bridge, isolated QA acceptance:** migrations 270–276 are applied only on the isolated QA copy, each after COPY_ONLY/VERIFY and migration rollback rehearsal. The final read-only plan reports 272 unchanged, zero pending and zero drift. Four existing Sale-App hooks are enabled there; the 39 native WinSpeed trigger definitions/states are preserved. The protocol retains explicit permits, current source/scope proofs, reservation holds, additive settlement returns, reviewed recovery and release. Bridge-on now requires the recorded native connection, final-detail, legacy SET-options and ID non-reuse protocols.

Actual WinSpeed initially exposed two different paths: a partial autocommit save, then a fresh edit with a single explicit transaction. Transaction-owned application locks cannot prove the first path. Protocol 273 binds it to the real connection GUID, login SID/time and SPID; another connection is rejected. Incomplete commits remain held. Protocol 274 can write the exact approved balance vector only when the whole physical 116 is complete, with settlement and audit in that last statement's transaction. It does **not** pretend the client's earlier autocommit statements roll back together. Protocol 275 sets required SQL options inside wf execution scope only. The owner then saved a freshly loaded two-line WinSpeed document successfully: seven callbacks shared one transaction, quantities/balances were unchanged, exactly one completion audit, and explicit review/release passed. SQL autocommit tests separately proved reduction/restoration, connection rejection, baseline/NET recovery, legacy caller option preservation, and cancellation with exact reservation returns. Legacy adoption observes current facts and never invents historical consumption or operators.

**Clean Rebate-on Full Loop round 10: 391/391 checks, 14 phases, zero failed checks; all seven owned test users retired and their private passwords removed.** Both books, distinct products, mixed C/D partial cuts, concurrent API apply, 202/107, report/Excel/print/trace, roles/Access As, giveaway loans/repayments, accrual, approval, conversion and ticket use passed. Round 09 remains the earlier clean baseline. Rounds 07/08 retain their failures and are not presented as clean acceptance. Final QA summary: no unreleased STARTED/COMPLETE native saves, no active loop users, no temporary pause objects and seven bridge migrations recorded. Backend 1341/1341 and migration-runner tests 14/14 passed. Earlier offline 98/98, UI regression 6/6 and frontend build results remain separate evidence for unchanged code.

**Direct WinSpeed acceptance now includes actual mixed C/D creation, quantity reduction, repeated save and deletion.** Each completed save has one completion audit and one transaction for its native callbacks. Reducing one line returned exactly 0.05 tonne; deletion returned the remaining 0.15 tonne. The additive return ledger retains the original settlements. Both coupons then had three tonnes available, original consumed quantities were zero, and all owned rehearsal reservations were cancelled through the API. Authenticated list/reconcile reads agreed and did not mutate the ledger. The bridge driver recorded 59 successful checks; these are separate from the 391 App Full Loop checks.

Both real-client concurrency orders passed. Native-first rejects an overlapping reservation with `COUPON_BRIDGE_REVIEW_REQUIRED` until explicit review/release; retry and replay then create one reservation/audit. App-first has measured `LCK_M_U` waiting behind the API transaction, after which both valid operations complete once. The bounded wf-only pause triggers were removed. Earlier missing-marker, unchanged-form and failed-activation attempts remain recorded as non-acceptance evidence. A missing error code in the reserve route was repaired and retested before the successful repeat.

The final artifact check exposed nine originals whose installed bytes had been normalized by a Git archive. Their unchanged local originals matched both ledger hashes exactly; normalized SQL text also matched the previous Git content. Explicit `-text` attributes and `immutable-artifact-bytes.json` now preserve those exact original blobs, including mixed endings. No SQL statements, schema or ledger checksums were changed. The staged archive passed all nine byte checks and the restored QA source reports **272 unchanged, zero pending/drift**.

**No UAT/PROD deployment, push, live feature/reset change or secondary business write occurred.** These are isolated QA simulations with synthetic transport evidence; VAT/GL remain accounting's WinSpeed work. Promotion still requires review of the combined release and its live migration/target plan, including legacy 104 financial-shape/adoption limits. Private logs/state and acceptance summaries remain on the isolated QA host and in the ignored local evidence directory. This is not a claim of 100% live parity.

**Observed on R740, 22 November:** UAT checkout `9b42bdd`, healthy backend, migration 259 applied;
Production checkout `fbbc139`, healthy backend, migration 254 applied on `dbwins_worldfert9`.
The second company's migration level was not rechecked in this review. Rebate Pool is already enabled on both stacks;
Production's Rebate reset admin and native 107 writer remain off. Production stays in mixed mode: AI, 104, 116 and 107
are issued in WinSpeed. No Production data, switches or deployment were changed in this review.

**Rebate ticket acceptance on UAT:** continued the existing price-zero ticket rehearsal through 107 from the browser.
The invoice date matches its 116; the 202 and 107 amounts and VAT are zero. One invoice receipt and one stock deduction
were found, the Rebate ticket remains FINAL with no remaining quantity, and reopening Post Invoice returns the same
invoice. The document-stage badge reads “ออกครบแล้ว · ปิดงานขาย”. VAT/GL accounting remains in WinSpeed; this case
does not establish positive-VAT or GL acceptance. Identifiers and screenshots stay in the private evidence folder
`scratch/codex-uat-review-20261122/`.

**Source fixes pending deployment:** remove the unavailable legacy Ledger/alert controls from the current Rebate Pool
screen, refresh customer/FIFO balances after evidence or conversion decisions, and harden the settlement worker against
returning tickets while a native delivery remains usable, overcuts and inconsistent balances. Mismatch incidents use
the business transaction; polling rotates through waiting receipts separately for each database. Local tests and UAT
SQL reads/incident-rollback checks cover these changes; the running UAT bundle does not yet contain them.
**Owner target and gaps, reviewed 22 November:** both environments must offer the same business functions and role rules.
Read-only runtime checks still find AI/104/116/107 switches true on UAT and false on PROD; direct conversion is true on
UAT and false on PROD, while Rebate conversion approval and evidence discovery are true on both. The current native
writers also pin the UAT database, require simulation evidence and support a restricted single-line case. Removing
those controls or switching PROD flags alone is not a Production implementation. The common release needs native
Production contracts and multi-line/mixed-ticket acceptance first.

**Further source work, not deployed:** migrations 260–262 separate `coupon.request116` from approval/recording,
enforce the ticket-sale role ceiling in JavaScript and SQL even for stale/custom grants, and add individual giveaway
quota loans and partial/full repayments. The requester may be SALES; the approved 116 is recorded by a different
authorized employee, with that recorder in WinSpeed and the approval audit. Native document actions now check both
Access As scopes. Role Management labels and the client follow the same permissions.

Individual quota transfers support the same region, conserve the two budgets' total, use SERIALIZABLE transactions
and ordered budget locks, and audit primary/business real/effective IDs. Pending requests move no quota. Approval
rechecks the lender's available quota; repayments cannot exceed the outstanding or unused quota. Mutations recheck
live account permissions inside the transaction. Linked budget identities and history cannot be deleted/reassigned;
quantity adjustments remain available. Legacy regional requests and their history are preserved. The Rebate history
tab no longer offers new legacy claims; existing claim details remain available, and the legacy server workflow has
not been retired without reviewing its outstanding obligations.

SQL UAT rehearsals passed migration up/down, service execution/audit rollback and history-preserving down refusal,
all inside an outer rollback. Separate simultaneous SQL connections passed duplicate requests/repayments, competing
approvals/returns and a withdrawal-lock case using uniquely named temporary tables only. These are integration
checks, not a real-user Full Loop or Production acceptance. No migration ledger entry, native document, business
quota, deployment, switch or secondary database was changed.

The Full Loop runner now uses a distinct listed AI employee, Counter for 104, SALES requests and a different 116
recorder, concurrent replay checks and an additional individual-quota loan/repayment phase. It creates seven isolated
accounts on an explicitly selected UAT target and disables its own accounts on close. Its new live phases have not
yet been executed against the proposed release. The old UAT invoice result above cannot certify these changes.

**Operational writer v3 candidate, isolated QA only:** the shared engine now has explicit primary PROD/UAT contracts,
multi-line 104/202, partial mixed C/D 116 and cumulative partial 107 allocation. These are source capabilities, not
live activation. `NATIVE_DOCUMENT_WRITER_VERSION=legacy` remains pinned in both release targets. No live deployment,
Rebate switch, reset or company-2 business write was performed. Migrations 260–268 were applied only to the isolated
`dbwins_worldfert9_uat_v3` copy through the runner; applied 263–267 were not edited. Migration 268 corrects future
audit associations: a 116 customer ID and a 107 delivery ID must resolve to the affected original bookings.

The QA app uses its own non-admin login, JWT and one-database allowlist. Actual access checks to PROD, company 2 and
live UAT return zero. The original QA profile keeps workers and Rebate off; the separate Rebate-on rehearsal below
explicitly opts in on this same isolated database. Hashes and enabled states of all 49
triggers on the affected native tables match across PROD, UAT and QA; that is metadata evidence, not a concurrency
or financial sign-off. Native triggers were neither changed nor disabled for these rehearsals.

| Candidate acceptance | Observed result | Limit |
| --- | --- | --- |
| Real authenticated Sale-App chain, both books | Run `R740V3-20261122-04`: 12 phases, 280/280 checks; two distinct products, quotation, Sale Trip, 103/AI, 104/202, four partial 116s including mixed C/D, 107 J/N, print/trace, report/Excel, role denials, Access As, individual quota loan/partial/full return, account cleanup | VAT 0; synthetic QA users; WinSpeed UI and Rebate workers were not participants |
| Same-key and competing-key submissions | One native ID and at most one create per same-key pair; an additional real API run allowed one of two approved competing cuts, rejected the other and preserved the exact balance | Does not prove a direct WinSpeed save honors an app reservation |
| SQL rollback integration | Actual QA app login: partial and full footer discount, two partial invoices, exact final amounts, reservation settlement/replay, changed-source/finance-hold rejection, expired-ticket warning plus one incident per cut, current cutoff replay rejection and booking-root audit | Outer rollback; fixture procedure is DBA-installed on QA only, not a real-user acceptance path |
| Migration 268 | Up twice, history-protecting down refusal and definition restoration after outer rollback; applied through ledger afterwards | No historical audit rows rewritten |
| Regression | Backend 1324, three CI groups 617, offline 98, frontend build; browser resilience 48, date-window 3, admin 9, trip 6; actual QA browser four roles plus exact ticket lookup | Local/mock suites are distinct from the authenticated QA run |

The final parent-document fingerprint/report-schema hardening also passed focused SQL/unit checks after the
authenticated run. The next release rehearsal must use the exact reviewed commit. Private run state and document
identifiers remain in the QA state directory and `scratch/codex-uat-review-20261122/`, never in reusable source.
All four runs' seven synthetic accounts were disabled; copied staff accounts were not altered.

**23 November QA checkpoint, not deployed:** migration 269 moves consumption of this request's own reservation,
settlement and audit before the native coupon debit, inside the same transaction. The unchanged reservation floor
can then validate the remaining holds. It does not enable native hooks. Up twice/down-history refusal/outer rollback
passed before applying 269 through the QA runner; final plan: 265 unchanged, zero pending/drift. Applied migrations
263–269 are immutable. Actual app-login SQL tests passed partial and full header discounts through 202/two partial
107s with the shared floor enabled transactionally; rollback restored its disabled state. A changed recipient on a
recorded 116 is now rejected before 107 by recomputing the whole cut's physical proof. All SQL fixture mutations
were rolled back, including that source-change test.

The isolated Rebate-on runtime validates the exact QA database/server, a one-database reset manifest, disabled
connection profiles/background workers, and actual non-owner/non-sysadmin SQL access with zero access to the three
live databases. The copied current coordinator/participant manifest was explicitly rebound to QA after a rollback
rehearsal, with an audit; no balance reset, ticket change or historical reset-journal rewrite was performed by that
preparation. The separate runtime uses only loopback ingress. This is not a live feature-switch change.

Run `R740V3-20261123-06` passed **391/391 checks, 14 phases** on the latest cut-proof service: two products, both
document books, quotation/Trip/103/AI/credit approval/104/202, mixed four-line C/D 116 and partial draws, 107 J/N,
application closure, trace/print/report/Excel, Access As, role denials and individual giveaway loans/repayments.
Ten reviewed simulated transport lines totaling 12 tonnes accrued exactly 2,400 baht from the 103 pricing
snapshots. SALES requested conversion, Manager approved, and the resulting ticket was used on a bill alongside
a paid product. Two simultaneous Trip confirmations deducted it once; subsequent partial 116s/107 completed it
as FINAL with one allocation to that newly issued ticket. Background workers remained off; the actual settlement
implementation was invoked explicitly for QA. These are simulated shipments, not real scale evidence.

An earlier Rebate-on run passed the same workflow with 399 recorded successful checks after fixing a runner
dispatch error; it is not the clean acceptance run. Its failed attempt is retained privately. Backend regression:
1328/1328. The first sandboxed run could not reach local HTTP stubs; the localhost-only rerun passed.
The real WinSpeed client opened the earlier mixed four-line receipt and displayed transport amounts matching SQL;
no native Save/Delete was performed in that check. All six runs' 42 accounts are disabled, private run passwords
removed, and their database password hashes replaced by a non-login sentinel with exact-fixture cleanup audit.
The private reviewer and QA schema remain for unfinished bridge work. Live deployment/switches/secondary writes
were untouched.

**Promotion gate:** the complete bridge and two concurrency orders have now passed isolated QA as recorded above.
Four reviewed bridge hooks are enabled only there; six superseded hooks remain disabled. Do not enable the old
hooks independently. The shared protocol uses the owner's warning-only expiry rule. Positive VAT still needs
the reviewed accounting mapping; VAT/GL work continues in WinSpeed after Sale-App closes at complete 107.
Existing cost/unsupported-shape guards remain. A v3 107 requires v3 delivery and cut receipts; arbitrary
old native deliveries/cuts need reviewed adoption or completion in WinSpeed. Existing pilot receipts remain
verifiable/replayable; new pilot writes are closed when v3 is selected, so pending pilot work must be resolved
before transition. Review company 2 before any role/schema migration there. The owner requires the remaining
combined-release readiness review before deployment; isolated QA acceptance does not establish 100% live parity.
See [current approval rules](../../sale-app/handover/APPROVAL-POLICIES.md).

Older paragraphs below are history.

**Bill-to-invoice rehearsal on UAT, 3 November 2026.** Bills were made in Sale-App and carried through WinSpeed over
Remote Desktop on `dbwins_worldfert9_uat`: AI, 104 with ticket, 116 and 107. Production still has every defect below.
Found and fixed in 1.0.6:

- A bill with a giveaway could not be approved in WinSpeed, which refuses a line with no quantity, and the piece count
  was lost at confirm. No real WinSpeed sales document has ever carried a giveaway line, so a giveaway now stays out of
  `dbo.SODT`; `wf.SalesOrderLineExt` keeps the item and pieces, numbered after the sale lines, and the booking remark
  names it (migration 165). Verified: the approval form shows the sale lines only, the Description tab names the
  giveaway with its pieces, Approve & Save passes, and the screens, delivery slip and booking print show pieces.
- A bill read CONFIRMED after WinSpeed had issued its 104, 116 and 107, and could still be cancelled or rewritten from
  the app. Every path now refuses and names the 104. Verified against a real chain on UAT.
- A booking cancelled after AI approval stayed in the lookup used to issue a 104 (migration 166). Verified: a booking
  cancelled after the fix is no longer offered. A booking with a live 104 is never touched.
- The warehouse could not record shipping for seven hours after a truck left the scale, because `WGHD.DateOut` is local
  time and was compared with UTC. On Production data every truck out in the previous seven hours failed that check.
  Verified with one test scale row on UAT: the warehouse role shipped with no exception and the weight came from the row.
- A salesperson could not open the document chain of their own ticket once it was cut.
- Also fixed earlier the same day: quotation save, credit days on a bill from a direct quotation, re-confirming an
  edited bill, an approved cancel request that left the bill live, and numbers bound to text parameters.

Passed with no change: quotation to bill, K and I bills, control ticket, partial trip confirm, draft edit and cancel,
prints, warehouse picking, load and acknowledgement, manager ship exception, 29 report types, a 40-route scope check as
SALES, and the rebate plan chain to tier 4, allocation and an accounting claim through tier 2. Claim tier 3 needs a
C_LEVEL account, closed on UAT until the 21:00 restore.

Owner decisions this rehearsal left open:

- Mixed mode keeps a bill open in Sale-App until the warehouse records shipping there, even after WinSpeed issues the
  107, and rebate accrual runs at that step. Either the warehouse records every truck, or a sync closes the bill.
- A salesperson can file a rebate claim only against accrual from bills shipped in the app with a NET price in effect.
  An allocated plan amount does not raise that cap and an allocation-only pool is hidden. Older deliveries go through
  accounting.
- Weight tolerance is set to +2% to +5%. In Production weighings since September, 85% fall between 0% and +1%, and the QA
  guides say plus or minus 2%. The status only labels a report and blocks nothing.
- WinSpeed's Post Invoice issues from whichever book is active. Accounting must keep I to J and K to N; the rehearsal
  got an N on an I bill by not switching. The 104 number follows the letter typed in its number field.

**Production check by role, 3 November 2026 00:40.** Six accounts were opened for a few minutes from the
owner's administrator session, with no password set, and closed again. Through Access As, the main read API of
every menu answered as each role's menu says, for SALES, WAREHOUSE, ACCOUNTING, MANAGER and C_LEVEL, and a sales
account saw only its own bills. The two refusals seen are by design: the rebate total for SALES and the
ADMIN-only report templates. No COUNTER_SALES, WEIGHBRIDGE or APPROVER account exists on Production. Two faults
came out: Access As into an account that must still change its password left the operator stuck on that account's
password screen, and the reconciliation list had no role check. Both are fixed in 1.0.4, on Production since 01:07
(receipt `20261103-010705-prod-apply-c04119a.txt`). The reconciliation list now answers 403 to SALES and WAREHOUSE.
The five roles were then walked on screen on UAT and on Production: 76 menus opened on each, with no failed request,
no script error, no write and no return trip stuck on the password screen. The first sign-in was checked on UAT with
a throwaway account: forced change, writes blocked until then, new token works. The check's administrator-reset step
could not run because UAT has no e2e account.

**Release 1.0.5 and rehearsal, 3 November 2026 05:47.** A bill was rehearsed on screen on UAT through Access As: sales
created it, a manager approved the price and verified it, sales confirmed the trip, and the 103 matched in the
tables. It was not opened in WinSpeed's own screens and the AI approval was not run. 1.0.5 limits today's shipments
to the Accounting menu's roles and the rebate accrual list to own and team records, removes a leftover debug route,
and uses the date in Thailand for defaults that lagged until 07:00. Receipt:
`20261103-054637-prod-apply-8333828.txt`. WinSpeed has no price list valid today, so every bill needs a manager's
price approval until prices are entered.

**Staff accounts, 3 November 2026 04:55.** The owner opened the 62 staff accounts on Production with the private
script. Read-only check: all active, each with its own password hash and the forced change still set, and Access As
works into every role. UAT's accounts stay closed until the owner opens them there or the 21:00 restore copies Production's.

**Native writers, 3 November 2026.** The owner asked to open real document issuing for 06:00, then chose mixed mode
after reading why it is not a switch: setting the flags only makes the buttons appear and fail on the target guards, and opening them means changing the guards that protect live accounting and building
multi-line, partial and other-tax support. Under half of the last 90 days' 104s are single-line, which is all the
current contract covers. `wf.sp_ConfirmSalesOrder` is identical on UAT and Production and has no target guard, so
bills and 103s are not blocked; a real one has still never run on Production.

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

Closed by the owner on 3 November 2026: the real-paper 104 (tested, use it as it is for now; Claude has not seen the
sheet), the off-host backup copy and the nightly job's sign-in (both stay as they are).

Deferred by the owner to after 1.0.0 (decision of 1 November 2026). Apart from stock case SO-19 below, none of these is software work; scale
tolerance and the exception approver were settled by the owner on 31 October:

| Owner | Item |
|---|---|
| Accounting | Countersign the checks Claude ran for them on UAT (below): the Post GL trial, the AR report, the 107 title and the RB series. The owner expects this to take a long time, so it comes back later as a filled-in workbook, kept privately |
| Warehouse | Accept stock case SO-19 during training: enter a figure for one product, then check the badge and the warning on the bill screen |
| Factory | The two blocked scale cases (SO-17, SHP-05) and physical shipment evidence |
| QA | Dry-run the three QA guides after the Production deploy: they need several roles, so staff accounts must be open first |
| Owner | Trim the approver list; say which document MO weighings belong to; decide when the native writers go live |
| Staff | Close the stale bookings listed in the private register |
| IT | SSRS report list |

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

**Production took 1.0.3 on 3 November 2026 at 00:07, on the owner's order** (receipt
`20261103-000634-prod-apply-a3643aa.txt`, 162/0/0), with CI passing on `main` and the same bundle as UAT. Read only: the
five writer flags are false, `ALLOW_TEST_NATIVE_WRITEBACK` is unset, the target guard returns 0, the checked APIs answer
401 without a login, no RB codes are assigned, the stock recheck queries show zero differences, and the receivable source
equals GL 112100 with zero difference. In the owner's signed-in session every one of the 24 menus opened with no failed
request, no script error and no write, the stock menu among them. Other roles on Production were not opened, because
their accounts are closed.

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
