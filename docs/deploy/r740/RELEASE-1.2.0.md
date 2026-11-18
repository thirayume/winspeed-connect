# Release 1.2.0 (18 November 2026)

Previous release: 1.1.0 (`1f7dbea`, 9 November 2026). Migrations: 170 → 251 (246 and 250 are excluded in
`backend/migration-policy.json`; 251 replaces 250). WinSpeed native writers stay off in Production.

## What changed for users

**Selling and prices**
- Every bill uses the discount bands: up to 200 baht per ton needs no approval, up to 300 needs approval, over 300 is
  refused. Prices move in steps of 100 baht (buttons ±100 in the bill form). The two limits are App Settings values.
- Rebate Pool (103), FIFO ticket conversion with approval, Rebate Plan with annual budget; the Rebate reset tab shows
  only when the Pool switch is on.
- Fertilizer tickets: standard life 90 days. An expired ticket stays usable but is warned and recorded as an incident.

**Lists, dashboard and accounting**
- One pagination bar on every paged screen: rows per page, first/last and jump to page.
- Aging lists a bill only while WinSpeed still has goods to ship (a 107 issued and the sale closed is no longer
  outstanding; a missing WinSpeed truck plate is ignored).
- Accounting: bills of a day or a range with trip, scale and the WinSpeed documents that followed; detail per booking.
- Data start date (App Settings): every dated list hides documents before the date and keeps opening balances. A test
  in `backend/tests/data-window-coverage.test.js` keeps every dated route on it.

**Master data (WinSpeed is the single source)**
- Create, change and delete WinSpeed goods, goods groups and giveaways (group 1005) from Sale-App, only through `wf`
  stored procedures with WinSpeed's triggers on, one transaction and a change event (migration 248).
- Giveaways use the 98 goods of group 1005: older goods with an identical twin are aliased (249); quota lines that are
  not one of the 98 were removed and the rest linked (251). A company database without group 1005 is left as it is.

## Performance

Measured on the UAT copy of Production, R740 (SQL Server 2008 R2 Express):
- Dashboard counts: 30 s timeout → 0.3 s (fresh plans for the heavy reads, answers served from the last value while one
  background read refreshes).
- Lost paper copies: 30 s timeout → 1 s. Reconciliation: 4.5 s → under 1 s (two lookups joined by UNION instead of OR).
- Database: AUTO_CLOSE / AUTO_SHRINK off, CHECKSUM on, SIMPLE recovery with a 2 GB log, nightly index and statistics
  maintenance at 02:00 (`sql/maintenance/`), four approved non-clustered indexes on WinSpeed tables (`IX_wf_*`).
- Load test results: see the UAT load section of the private release acceptance record.

## Deploying 1.2.0

Follow [README.md](README.md) "Routine release". Before Production with pending migrations:
1. COPY_ONLY backups of `dbwins_worldfert9` (`sql/r740-prod-backup.sql`) and `dbwins_worldfert2`
   (`sql/r740-company-backup-dbwins_worldfert2.sql`), Windows login, younger than 120 minutes.
2. `migrate-company.sh dbwins_worldfert2 plan`, then `apply` (WSL as root; it uses the UAT image, so deploy UAT first).
3. `deploy.bat prod`: `YES` for the commit, then the database name `dbwins_worldfert9`.
4. Verify: receipt, `/api/health` shows 1.2.0, writer flags false, Reset admin false.
