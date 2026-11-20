# Release 1.2.0 (20 November 2026)

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
- Lost paper copies: 30 s timeout → 1 s. Reconciliation: the invoice fallback uses two lookups joined by UNION
  instead of OR (8.4 s → 0.4 s in isolation) and the WinSpeed side of the cases is shared for 60 s; the refresh button
  reads it fresh. Paper Trail board: identical requests share one read for 5 s.
- Database: AUTO_CLOSE / AUTO_SHRINK off, CHECKSUM on, SIMPLE recovery with a 2 GB log, nightly index and statistics
  maintenance at 02:00 (`sql/maintenance/`), four approved non-clustered indexes on WinSpeed tables (`IX_wf_*`).

### Load test on UAT (20 November 2026)

Read workload from one ADMIN session (all-record scope, the heaviest), 20 endpoints weighted like daily use
(sales list, dashboard, aging, trips, accounting, Paper Trail, reconciliation, master data), each virtual user
waiting 1–3 s between requests, HTTP/2 through the public UAT hostname. Run during business hours on the SQL Server
instance that Production shares, so the no-think-time stress stage was not run; PROD health stayed 0.1–0.6 s.

| Stage | Reads | Errors | P50 | P95 | Max |
|---|---:|---:|---:|---:|---:|
| 10 users, 2 min | 501 | 0 | 128 ms | 1.3 s | 6.3 s |
| 20 users, 2 min | 844 | 0 | 138 ms | 2.1 s | 21.5 s |
| 30 users, 3 min (before the reconciliation fix) | 1,776 | 0 | 167 ms | 2.4 s | 26.1 s |
| 30 users, 3 min (final, `743c31c`) | 1,793 | 0 | 257 ms | 1.6 s | 5.2 s |

Final run per endpoint (P95): lost paper copies 3.8 s, sales list 2.3 s, Paper Trail board 1.5 s (was 5.0 s),
aging 1.4 s, reconciliation no longer among the slowest (was 24 s), everything else under 1 s.
SQL Server during the 30-user stage: no blocked request, longest wait 2 ms, SQL process CPU at most 62 % of the
host (average 36 %), memory 1.6 GB (the Express cap). What limits further growth is the Express edition shared by
UAT, PROD and the second company: see `sql/maintenance/README.md` (separate instance or Standard edition).

## Deploying 1.2.0

Follow [README.md](README.md) "Routine release". Before Production with pending migrations:
1. COPY_ONLY backups of `dbwins_worldfert9` (`sql/r740-prod-backup.sql`) and `dbwins_worldfert2`
   (`sql/r740-company-backup-dbwins_worldfert2.sql`), Windows login, younger than 120 minutes.
2. `migrate-company.sh dbwins_worldfert2 plan`, then `apply` (WSL as root; it uses the UAT image, so deploy UAT first).
3. `deploy.bat prod`: `YES` for the commit, then the database name `dbwins_worldfert9`.
4. Verify: receipt, `/api/health` shows 1.2.0, writer flags false, Reset admin false.
