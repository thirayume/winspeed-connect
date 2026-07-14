# 05 โ€” เธเธฃเธฐเน€เธกเธดเธเธเธงเธฒเธกเธเธฃเนเธญเธก Production (Production Readiness Assessment)

> WS-Sale-App ยท build v5.0.0 ยท เธเธฃเธฐเน€เธกเธดเธ 8 เธ.เธ. 2569 ยท เนเธ”เธข Solution Architect

## เธเธ—เธชเธฃเธธเธเธเธนเนเธเธฃเธดเธซเธฒเธฃ (Verdict)
> **เธชเธ–เธฒเธเธฐ: เธเธฃเนเธญเธกเธฃเธฐเธ”เธฑเธ "Soft Launch / Pilot" โ€” เธขเธฑเธเนเธกเนเธเธงเธฃเธเธถเนเธ Full Production เธเธเธเธงเนเธฒเธเธฐเธเธดเธ”เธฃเธฒเธขเธเธฒเธฃ P0 (เธเธงเธฒเธกเธเธฅเธญเธ”เธ เธฑเธข/เธเธงเธฒเธกเธ–เธนเธเธ•เนเธญเธเธเธฑเธเธเธต)**

เธฃเธฐเธเธเธกเธตเธเธฑเธเธเนเธเธฑเธเธเธฃเธเธ•เธฒเธก SRS v6.2 (22 เธซเธเนเธฒ, FR เธซเธฅเธฑเธเธเธฃเธ, deploy เธเธฃเธดเธ Railway+Vercel, migration clean) โ€” **เธเธงเธฒเธกเธเธฃเนเธญเธกเธ”เนเธฒเธเธเธตเน€เธเธญเธฃเน โ 90%** เนเธ•เนเธเธงเธฒเธกเธเธฃเนเธญเธกเธ”เนเธฒเธ **Operations/Security โ 55%** เธ•เนเธญเธ hardening เธเนเธญเธเนเธเนเธเธฒเธเธเธฃเธดเธเน€เธ•เนเธกเธฃเธนเธเนเธเธ

| เธกเธดเธ•เธด | เธเธฐเนเธเธ | เธชเธฃเธธเธ |
|------|-------|------|
| Functionality | ๐ข 95% | เธเธฃเธเธ•เธฒเธก SRS เธซเธฅเธฑเธ + Meeting Minutes 02072026 เธชเนเธงเธเนเธซเธเน ยท LINE Login implemented in code; Credit Hold เธขเธฑเธเน€เธเนเธ next phase |
| Security | ๐”ด 50% | **credentials เธซเธฅเธธเธ”/เธญเนเธญเธ, JWT default** (P0) |
| Data Integrity / เธเธฑเธเธเธต | ๐ก 65% | เน€เธเธตเธขเธ dbo เธ•เธฃเธ โ€” เธ•เนเธญเธเธขเธทเธเธขเธฑเธเธงเนเธฒเนเธกเนเธเธฃเธฐเธ—เธ GL WINSpeed (P0) |
| Reliability / Backup | ๐ก 60% | เธขเธฑเธเนเธกเนเธกเธต backup/DR policy เธ—เธตเนเธเธฑเธ”, เนเธกเนเธกเธต error monitoring |
| Testability / QA | ๐ก 75% | เธกเธต manual test cases เนเธฅเธฐ automated smoke tests เธชเธณเธซเธฃเธฑเธ migration/query/API/build/lint เนเธฅเนเธง; เธขเธฑเธเธ•เนเธญเธเน€เธเธดเนเธก unit/integration เน€เธเธดเธเธฅเธถเธ |
| Observability | ๐”ด 40% | log เนเธเน console ยท เนเธกเนเธกเธต centralized log/alert |
| Performance | ๐ข 80% | indexed views, polling เน€เธเธฒ, dataset เนเธซเธเนเนเธ•เน query เธกเธต TOP/cache |

---

## ๐”ด P0 โ€” เธ•เนเธญเธเนเธเนเธเนเธญเธ Full Production (เธชเธณเธเธฑเธเธชเธนเธเธชเธธเธ”)

### P0-1 Credentials เธซเธฅเธธเธ”เนเธฅเธฐเธญเนเธญเธเนเธญ
- เธฃเธซเธฑเธช SQL `sa`, MySQL `root`, เนเธฅเธฐเธเนเธฒเนเธ `.env` เธ–เธนเธเธเธดเธกเธเนเธฅเธเนเธเธ•/เธเธฃเธฐเธงเธฑเธ•เธดเนเธฅเนเธง โ’ **เธ•เนเธญเธ rotate (เน€เธเธฅเธตเนเธขเธเธฃเธซเธฑเธชเธ—เธฑเนเธเธซเธกเธ”) เธ—เธฑเธเธ—เธต**
- `JWT_SECRET` เธขเธฑเธเน€เธเนเธเธเนเธฒ default placeholder (`wssale_jwt_secret_please_change...`) โ’ **เน€เธเธฅเธตเนเธขเธเน€เธเนเธ random โฅ64 เธ•เธฑเธงเธญเธฑเธเธฉเธฃ**
- เนเธเน `sa` / `root` (เธชเธดเธ—เธเธดเนเธชเธนเธเธชเธธเธ”) เนเธเธเธฒเธฃเน€เธเธทเนเธญเธก โ’ เธเธงเธฃเนเธเน **least-privilege user** (เน€เธเนเธ wf_owner เธชเธณเธซเธฃเธฑเธ wf, read-only user เธชเธณเธซเธฃเธฑเธ dbo, read-only user เธชเธณเธซเธฃเธฑเธ MySQL)
- **เนเธเธงเธ—เธฒเธ:** เน€เธเนเธ secret เนเธ Railway/Vercel env vars เน€เธ—เนเธฒเธเธฑเนเธ ยท เธซเนเธฒเธก commit `.env` (เธ•เธฃเธงเธเธงเนเธฒ .gitignore เธเธฃเธญเธเธเธฅเธธเธก) ยท เน€เธเธฅเธตเนเธขเธเธฃเธซเธฑเธชเธ—เธธเธเธ•เธฑเธง

### P0-2 เธเธงเธฒเธกเธ–เธนเธเธ•เนเธญเธเธเธฑเธเธเธต (dbo direct-write)
- เธฃเธฐเธเธเน€เธเธตเธขเธ `dbo.SOHD/SODT` เธ•เธฃเธ (confirm/picking/ship) โ€” เธ•เธฑเธ”เธชเธดเธเนเธเธฃเธฑเธเนเธงเนเนเธฅเนเธง เนเธ•เน **เธ•เนเธญเธ dual-run / เธ•เธฃเธงเธเธชเธญเธเธเธฑเธเธเธฑเธเธเธตเธเธฃเธดเธ 2-4 เธชเธฑเธเธ”เธฒเธซเน** เธงเนเธฒ:
  - เนเธเธชเธฑเนเธเธเธฒเธขเธ—เธตเน App เธชเธฃเนเธฒเธ โ’ WINSpeed เธญเธญเธเนเธเธเธณเธเธฑเธ + post GL เนเธ”เนเธ–เธนเธเธ•เนเธญเธ 100%
  - เนเธกเนเธกเธตเน€เธฅเธเธเนเธณ/เธเนเธฒเธกเน€เธฅเธ, เธขเธญเธ”เธ•เธฃเธ, VAT เธ–เธนเธ (เธเธธเนเธขเธขเธเน€เธงเนเธ VAT)
- เธกเธต **rollback plan**: เธ–เนเธฒเธเธดเธ”เธ•เนเธญเธเธเธตเธขเน WINSpeed เธ•เธฃเธเนเธ”เน (Non-Invasive fallback)

### P0-3 เธ•เธฃเธงเธเธชเธดเธ—เธเธดเน DB เธเธญเธ App เธเธ Production
- เธขเธทเธเธขเธฑเธเธงเนเธฒ user เธ—เธตเน Railway เนเธเน **เน€เธเธตเธขเธเนเธ”เนเน€เธเธเธฒเธฐเธ—เธตเนเธเธณเน€เธเนเธ** (wf + SOHD/SODT/EMSetPrice เธ—เธตเนเธญเธเธธเธเธฒเธ•) โ€” เนเธกเนเนเธเน full `sa`

---

## ๐ก P1 โ€” เธเธงเธฃเธ—เธณเธเนเธญเธ/เธฃเธฐเธซเธงเนเธฒเธ Pilot

| # | เธฃเธฒเธขเธเธฒเธฃ | เนเธเธงเธ—เธฒเธ |
|---|--------|--------|
| P1-1 | **Backup & DR** | SQL Server: full daily + log hourly ยท MySQL: Railway backup + export เธชเธณเธฃเธญเธ ยท เธ—เธ”เธชเธญเธ restore (RTO<4เธเธก., RPO<1เธเธก. เธ•เธฒเธก NFR-009) |
| P1-2 | **Error monitoring** | เน€เธเธดเนเธก Sentry/Logtail เธซเธฃเธทเธญ log เธฃเธงเธกเธจเธนเธเธขเน + alert เน€เธกเธทเนเธญ 5xx ยท เธ•เธญเธเธเธตเน log เนเธเน console |
| P1-3 | **Rate limiting + Helmet** | เธเธฑเธ brute-force login + security headers (express-rate-limit, helmet) |
| P1-4 | **CORS เน€เธเนเธก** | เธ•เธฑเนเธ `CORS_ORIGIN` เน€เธเนเธ domain Vercel เธเธฃเธดเธ (เนเธกเนเนเธเน `*`) |
| P1-5 | **Health check** | endpoint `/health` (DB ping เธ—เธฑเนเธ SQL+MySQL) เนเธซเน Railway/monitor เน€เธฃเธตเธขเธ |
| P1-6 | **Migration tracking** | เธ•เธญเธเธเธตเน runner เธฃเธฑเธเธ—เธธเธเนเธเธฅเนเธ—เธธเธเธเธฃเธฑเนเธ (idempotent) โ€” เธเธดเธเธฒเธฃเธ“เธฒเธ•เธฒเธฃเธฒเธ schema_migrations เธเธฑเธเธฃเธฑเธเธเนเธณ |
| P1-7 | **TruckScale env เธเธ Railway** | เน€เธเธดเนเธก `MYSQL_*` เนเธ Railway backend (เธ•เธญเธเธเธตเนเธกเธตเนเธเน local) เนเธกเนเธเธฑเนเธ TruckScale เนเธกเนเธ—เธณเธเธฒเธเธเธ prod |

---

## ๐ข P2 โ€” เธเธฃเธฑเธเธเธฃเธธเธเธ•เนเธญเน€เธเธทเนเธญเธ (เธซเธฅเธฑเธ Go-Live)

| # | เธฃเธฒเธขเธเธฒเธฃ |
|---|--------|
| P2-1 | Automated tests เน€เธเธดเธเธฅเธถเธ: unit เธชเธณเธซเธฃเธฑเธ rebate FIFO/accrual เนเธฅเธฐ integration เธชเธณเธซเธฃเธฑเธ SO lifecycle เน€เธเธดเนเธกเน€เธ•เธดเธก; smoke tests เธเธฑเธเธเธธเธเธฑเธเธญเธขเธนเนเธ—เธตเน `docs/09-AUTOMATED-QA-v5.0.0.md` |
| P2-2 | Code-split frontend (bundle 858KB > 500KB warning) โ€” lazy load เธซเธเนเธฒเธ—เธตเนเนเธกเนเนเธเนเธเนเธญเธข |
| P2-3 | Credit Hold (FR-003) โ€” Phase เธ–เธฑเธ”เนเธ; LINE Login implemented in code, pending migration/UAT |
| P2-4 | Receive-mode (เธฃเธฑเธเน€เธเธเธฒเธฐเธเธธเธ”/เธฃเธฑเธเธเธฃเนเธญเธก) เนเธซเนเธเธฑเธเธ—เธถเธเธเธฑเธ”เนเธ Control Ticket |
| P2-5 | เธฅเธ migration เธ•เธฒเธข (002_wf_schema_v2 no-op, 011 section) เธญเธญเธเน€เธเธทเนเธญเธเธงเธฒเธกเธชเธฐเธญเธฒเธ” โ€” optional |
| P2-6 | PDPA: เน€เธเนเธฒเธฃเธซเธฑเธชเธเนเธญเธกเธนเธฅเธชเนเธงเธเธเธธเธเธเธฅ + retention policy (NFR-007) |

---

## เธฃเธฒเธขเธเธฒเธฃเธ•เธฃเธงเธเธเนเธญเธ Go-Live (Go-Live Checklist)
- [ ] **P0-1** เน€เธเธฅเธตเนเธขเธเธฃเธซเธฑเธช DB เธ—เธฑเนเธเธซเธกเธ” + JWT_SECRET + เนเธเน least-privilege user
- [ ] **P0-1** เธขเธทเธเธขเธฑเธ `.env` เนเธกเนเธญเธขเธนเนเนเธ git (`git ls-files | grep .env` เธ•เนเธญเธเธงเนเธฒเธ เธขเธเน€เธงเนเธ .env.example)
- [ ] **P0-2** dual-run เธเธฑเธเธเธต 2-4 เธชเธฑเธเธ”เธฒเธซเน + เธขเธทเธเธขเธฑเธ GL/เนเธเธเธณเธเธฑเธเธ–เธนเธ
- [ ] **P0-3** เธขเธทเธเธขเธฑเธเธชเธดเธ—เธเธดเน DB user เธเธ Railway
- [ ] **P1-7** เธ•เธฑเนเธ MYSQL_* เธเธ Railway
- [ ] **P1-1** เธ•เธฑเนเธ backup + เธ—เธ”เธชเธญเธ restore เธชเธณเน€เธฃเนเธ
- [ ] **P1-4** CORS = domain เธเธฃเธดเธ
- [ ] UAT เธเนเธฒเธ โฅ90% ([02-TEST-CASES](02-TEST-CASES.md)) + เธเธนเนเนเธเนเน€เธเนเธเธฃเธฑเธ ([06-FORMS](06-FORMS.md))
- [ ] เธญเธเธฃเธกเธเธนเนเนเธเนเธเธฃเธเธ—เธธเธ Role + เธชเนเธเธกเธญเธเธเธนเนเธกเธทเธญ ([03-USER-GUIDE](03-USER-GUIDE.md))
- [ ] Backup/rollback plan เธชเธทเนเธญเธชเธฒเธฃเธเธฑเธเธ—เธตเธกเนเธฅเนเธง

---

## เธเนเธญเธชเธฃเธธเธเนเธฅเธฐเธเธณเนเธเธฐเธเธณ
1. **เธเธถเนเธ Pilot เนเธ”เนเน€เธฅเธข** เธเธฑเธเธเธนเนเนเธเนเธเธฅเธธเนเธกเน€เธฅเนเธ (1-2 เธ เธฒเธ) เน€เธเธทเนเธญเน€เธเนเธ feedback โ€” เนเธ•เนเธ•เนเธญเธเธเธดเธ” **P0-1 (security) เธเนเธญเธ** เน€เธเธฃเธฒเธฐ credentials เธซเธฅเธธเธ”เนเธฅเนเธง
2. **เธญเธขเนเธฒเน€เธเธดเนเธเธ•เธฑเธ” WINSpeed manual** โ€” เธฃเธฑเธ dual-run เธเธเธกเธฑเนเธเนเธเธเธฑเธเธเธต (P0-2)
3. เธฅเธเธ—เธธเธ **backup + monitoring (P1)** เธเนเธญเธเธเธขเธฒเธขเธเธนเนเนเธเน
4. เธซเธฅเธฑเธเน€เธชเธ–เธตเธขเธฃ เธเนเธญเธขเธ—เธณ **automated tests + Phase 2 (Credit/LINE)**

> เนเธ”เธขเธฃเธงเธก: เธฃเธฐเธเธ "เนเธเนเธเธฒเธเนเธ”เนเธเธฃเธดเธเนเธฅเธฐเธญเธญเธเนเธเธเธ”เธต" เนเธ•เนเธ•เนเธญเธ **harden เธ”เนเธฒเธ security/ops** เนเธซเนเธ–เธถเธเธกเธฒเธ•เธฃเธเธฒเธ production เธเนเธญเธเนเธเนเน€เธ•เนเธกเธฃเธนเธเนเธเธ โ€” เธเธถเนเธเน€เธเนเธเธเธฒเธเธเธดเธ” gap เธ—เธตเนเธเธฑเธ”เน€เธเธเนเธฅเธฐเธ—เธณเนเธ”เนเนเธเน€เธงเธฅเธฒเธชเธฑเนเธ

---

## Current Addendum - 2026-07-08

### Feature readiness update
- Functionality is now closer to pilot-complete for the Meeting Minutes 02072026 backlog.
- Implemented in source: SO requested/transport flags, 5-level price colors, rebate role visibility, dashboard/date search, customer filters, goods dedupe, giveaway line approval, status timestamps, Paper Trail price hiding/security green, customer request flow, Rebate Plan Ref Doc, and LINE Login.
- Migrations `031-035` have been applied to the restored local `dbwins_worldfert9` database on 2026-07-08.

### Remaining critical work before full production
- Run smoke tests against the restored local database.
- Restart backend after migration/config changes.
- Verify LINE Login callback domain and CORS on the real deployment domain.
- Smoke test first-time LINE self-link with an existing active user; Admin binding is only needed for support exceptions.
- Keep P0 security controls active: rotate any secrets exposed in chat/history, store secrets only in env vars, and confirm `.env` is not tracked.

### Updated P2 status
- LINE Login is no longer purely future work; it is implemented in code and schema, but requires callback URL verification and self-link UAT.
- Credit Hold remains a future/next-phase item.

## Current Addendum - 2026-07-13

### QA readiness update
- Added repeatable local smoke commands:
  - `npm run smoke:queries`
  - `npm run smoke:api`
  - `npm run smoke:api:local`
- Latest local QA passed migration, SQL query smoke, API smoke, frontend lint, and production build.
- `wf.AccessAsAudit` and `wf.ApiAuditLog` are verified by API smoke.
- The remaining QA gap is not basic stability; it is deeper workflow/UAT coverage for real users, WINSpeed screens, and TruckScale live data.

### Remaining before wider UAT
- Continue tuning `/api/so?page=1&limit=5` if concurrent UAT needs sub-second response; latest local API smoke improved from about 3.2 seconds to about 1.9 seconds after splitting total-count and page queries.
- Run manual retest checklist in [09-AUTOMATED-QA-v5.0.0.md](09-AUTOMATED-QA-v5.0.0.md).
- Confirm Access As behavior by real role: Admin, Manager, Accounting, Approver, Counter Sale, Sales.
- Confirm LINE callback URL and first-time self-link on the real deployment domain.

