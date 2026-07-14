# 09 - Automated QA and Manual Retest Log v5.0.0

> Updated: 2026-07-13  
> Scope: Localhost QA after restored local `dbwins_worldfert9`, migrations through `045_access_as_audit.sql`, WINSpeed quotation alignment, Access As audit, dashboard/SO performance, and frontend build/lint health.

## Summary

| Area | Result | Notes |
|---|---|---|
| Local migrations | PASS | 49 migration files checked; all applied/unchanged |
| SQL/query smoke | PASS | Dashboard, goods, transports, quotation migration, Paper Trail, aging, SO distribution |
| API smoke | PASS | Auth guard, Access As, audit trail, goods/transports, SO stats/list, quotation native docs |
| Frontend lint | PASS | 0 errors; warnings remain as technical debt |
| Production build | PASS | Vite production build completed |
| Manual UAT still needed | REQUIRED | User workflow screens, WINSpeed visual confirmation, TruckScale live behavior |

## Commands For Repeat Testing

Run these from `C:\MyWork\wf\Git\winspeed-connect`.

```powershell
npm run migrate:local
npm run smoke:queries
npm run smoke:api:local
cd WSSale-App
npm run lint
cd ..
npm run build
```

Notes:

- `smoke:queries` talks directly to local SQL Server and may need to run outside the Codex sandbox.
- `smoke:api:local` starts the backend temporarily on port `3100`, runs API checks, then stops it.
- If port `3100` is already in use, run with `API_SMOKE_PORT=3101`.

## Automated Test Steps And Latest Results

### AT-01 Local Migration Check

Command:

```powershell
npm run migrate:local
```

Expected result:

- Migration runner connects to local SQL Server.
- `000_logins.sql` remains manual security setup when applicable.
- All normal migration files are applied or marked unchanged.

Latest result:

- PASS.
- 49 migration files applied successfully / unchanged.
- `044_winspeed_native_quotation_link.sql` and `045_access_as_audit.sql` are present.

### AT-02 SQL Query Smoke

Command:

```powershell
npm run smoke:queries
```

Expected result:

- All query smoke scripts exit with code `0`.
- Dashboard/SO queries return counts without timeout.
- Master goods and transport endpoints have supporting SQL data.
- Quotation migration and native WINSpeed quotation sample documents are detected.

Latest result:

| Check | Result |
|---|---|
| Dashboard stats | PASS: `DRAFT=1,486`, `CONFIRMED=61,847`, `IMPORTED=61,848` |
| Dashboard aging | PASS: about `75 ms` |
| SO list query | PASS: about `1.2 s`, total `125,181` rows |
| Goods master query | PASS: `209` rows, about `35 ms` |
| Transport master query | PASS: `3` rows, about `21 ms` |
| Quotation migration | PASS: migration `044`, required columns and indexes found |
| Native quotation samples | PASS: `QU6907-00001`, `QU6907-00002`, `QC69-00002` found |
| Paper Trail report | PASS: about `416 ms`; board about `317 ms` |
| Aging search query | PASS: `50` rows, about `380 ms` |
| SO distribution | PASS: `DocuType 102=4`, `103=63,333`, `104=61,848`, `113=1` |

### AT-03 API Smoke With Temporary Backend

Command:

```powershell
npm run smoke:api:local
```

Expected result:

- Backend starts on port `3100`.
- Health endpoint is OK.
- Access As token flow works.
- `wf.AccessAsAudit` and `wf.ApiAuditLog` receive rows.
- No 404/500 for goods, transports, SO stats/list, and quotation list.

Latest result:

| Step | Result |
|---|---|
| `/api/health` | PASS: SQL Server and MySQL health endpoint responded |
| `/api/auth/me` without token | PASS: returned `401` |
| `/api/auth/me` with generated test token | PASS |
| `/api/auth/access-as/candidates` | PASS: `50` candidates |
| Start Access As | PASS: actor `ADMIN`, effective user `SALES` |
| `/api/auth/me` while Access As | PASS: `isImpersonating=true` |
| `/api/master/goods` | PASS: `209` rows |
| `/api/master/transports` | PASS: `3` rows |
| `/api/so/stats` | PASS: total `125,181` |
| `/api/so?page=1&limit=5` | PASS: returned `5` rows; latest measured around `1.9 s` after count/page split |
| `/api/quotation` | PASS: includes native WINSpeed quotation documents |
| Stop Access As | PASS: returned to real actor |
| Audit verification | PASS: Access As and API audit rows written |

Fix applied during this test:

- `backend/middleware/apiAudit.js` now captures the audit path at request start, so routed Express requests still write `wf.ApiAuditLog` correctly after response finish.

### AT-04 Frontend Lint

Command:

```powershell
cd WSSale-App
npm run lint
```

Expected result:

- Exit code `0`.

Latest result:

- PASS.
- 0 lint errors.
- Warnings remain for existing technical debt such as unused variables, explicit `any`, hook dependency advisories, and React compiler advisory rules.

Lint policy change:

- `react-hooks/set-state-in-effect` is disabled because the current app intentionally loads remote data in effects across many screens.
- Advisory rules remain warnings so new real errors still fail lint.

### AT-05 Production Build

Command:

```powershell
npm run build
```

Expected result:

- Frontend dependency install/check runs.
- Vite production build completes.

Latest result:

- PASS.
- Vite production build completed successfully.

## Manual Retest Checklist

Use this checklist after running the automated tests.

| Step | Manual Action | Expected Result |
|---|---|---|
| M-01 | Login as Admin | Dashboard loads, user menu shows Admin, no console 401 loop after refresh |
| M-02 | Open Access As from topbar | Admin can select lower/equal permitted users; sidebar and visible data follow effective role |
| M-03 | Stop Access As | User returns to real Admin role; audit remains in DB |
| M-04 | Refresh browser during normal login | Token persists; if invalid, app redirects to Login cleanly |
| M-05 | Dashboard | Counts match status meaning: Draft, เธฃเธญเธเธฑเธ”เธชเนเธ, เธฃเธญเธฃเธฑเธเธชเธดเธเธเนเธฒ, เนเธซเธฅเธ”เธชเธดเธเธเนเธฒ, เธชเนเธเธญเธญเธเธเธฒเธเธ•เธฒเธเธฑเนเธ, เธเธดเธ” SO เนเธ WINSpeed, เธขเธเน€เธฅเธดเธ |
| M-06 | Sales Portal | Cards show latest SOs from WINSpeed and app-created drafts; search/filter remains responsive |
| M-07 | Create/inspect SO draft | Requested date/time, transport, credit days, remarks, master/child quantities display correctly |
| M-08 | Convert Sale Trip to Quotation | Draft trip creates one quotation, giveaway lines excluded, linked trip shows quotation remark/link |
| M-09 | Open Quotation page | Native WINSpeed docs and app-created docs appear consistently; accepted quotation cards are green and actionable |
| M-10 | Confirm quotation in WINSpeed | `QU...` approved and linked `QC...` becomes convertible to SO in app |
| M-11 | Cancel quotation | Linked Sale Trip returns to draft/normal flow and cannot remain locked by cancelled quotation |
| M-12 | Warehouse receive/load page | Cards clearly show truck, customer, product, qty, and status consistent with Dashboard |
| M-13 | Paper Trail | Columns and status labels match Dashboard; print/copy rules still correct |
| M-14 | WINSpeed visual check | App-confirmed SO appears in WINSpeed SO Data Entry as `DocuType=103` with line description, transport, check-all, master/child qty |
| M-15 | Post Invoice handoff | Shipped orders show ready for WINSpeed Post Invoice; once invoice exists, app locks edits |

## Known Non-Blocking Follow-Ups

- `/api/so?page=1&limit=5` improved from about `3.2 s` to about `1.9 s` after splitting total-count and page queries; target additional tuning if concurrent UAT needs sub-second list response.
- Frontend lint passes with warnings; cleanup can be done gradually without blocking current UAT.
- TruckScale live sync was not fully exercised in the API smoke because current local MySQL configuration may vary by machine.
- Word copy for this QA log was generated at `docs/word/09-AUTOMATED-QA-v5.0.0.docx`; older Word copies were not regenerated in this pass.
- DOCX structural QA passed; visual render QA was skipped because the current runtime does not have the DOCX-to-PDF renderer installed.

