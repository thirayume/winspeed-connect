# Claude Code Workspace Guide — World Fertilizer Sale-App

## 1. Single Source of Truth (SSOT)
Tracked in git (the source for everyone):
- **Operations, deploy and release**: `docs/deploy/r740/README.md` (start here), release notes `docs/deploy/r740/RELEASE-*.md`,
  live status `docs/deploy/r740/GO-LIVE-STATUS.md`, database care `docs/deploy/r740/sql/maintenance/README.md`.
- **Agent activity and hand-off log**: `docs/sale-app/handover/AGENT-COLLABORATION.md`.
- **Business rules**: `docs/sale-app/handover/WINSPEED-MASTER-DATA-RULES.md`, `APPROVAL-POLICIES.md`, `DATABASE-SYNC.md`
  in the same folder; owner settings live in App Settings (`backend/services/policy-contract.js` lists every key).

Private, on the owner's machine only (git-ignored, never committed): the hand-over pack (`docs/sale-app/handover/*.docx`,
`*.pptx`, `README.md`), evidence in `docs/sale-app/current/`, QA material in `docs/sale-app/qa/`, staff account lists.

> [!IMPORTANT]
> **Every session starts by reading `docs/sale-app/handover/AGENT-COLLABORATION.md`** and appends one row when it
> finishes work or changes architecture or state.

---

## 2. Repository layout
- `WSSale-App/` — frontend: React 18, Vite, TypeScript, Tailwind, Zustand. `npm run build` (`tsc -b && vite build`).
- `backend/` — Node.js 22, Express, `mssql` for SQL Server 2008 R2 (compatibility 80: no CONCAT/THROW/TRY_CAST/IIF).
  - `routes/` HTTP only; `services/` business logic; `migrations/` numbered SQL with rollbacks in `migrations/down/`
    (through 291; 246 and 250 excluded in `migration-policy.json`); `tests/` Node test runner (`npm test`).
- `e2e/` — Playwright browser suites; CI runs those listed in `.github/actions/verify/action.yml`.
- `docs/deploy/r740/` — the only deploy kit (scripts, targets, SQL, maintenance). `docs/deploy/onprem/` holds the
  Caddy/WSL files it builds from.
- `db-init/`, `scripts/`, `sql/maintenance/` — local seeding, read-only investigation and maintenance SQL.
- Deployment: Dell PowerEdge R740-SRV (172.16.30.169), Docker Compose in WSL, Caddy (HTTPS/ACME), SQL Server 2008 R2
  Express shared by PROD `dbwins_worldfert9`, UAT `dbwins_worldfert9_uat` and the second company `dbwins_worldfert2`.

---

## 3. Development & Security Guidelines
1. **Never commit credentials**: production credentials and customer profiles are local-only and excluded from git.
2. **Migration safety**: migrations are idempotent, use `-- @transaction`, ship a rollback in `backend/migrations/down/`,
   and never alter WinSpeed native tables without guardrails. A migration that changes data matches exactly (one-to-one,
   no `LIKE '%…%'`), never rewrites history, logs every changed row for the rollback, and is rehearsed in a rolled-back
   transaction on the UAT copy first. An applied migration is never edited: exclude it in `migration-policy.json` and
   write a corrected one. Check `dbwins_worldfert2` data before any data migration — it can differ from company 9.
3. **WinSpeed master data (owner, 18 Nov 2026)**: Sale-App may create, update and delete the WinSpeed master rows it works
   with (goods, goods groups, giveaway goods = group 1005, customers, prices) — **only through `wf` stored procedures**,
   inside one transaction, with WinSpeed's triggers on, ids taken under lock, no duplicates, and a `wf.ChangeEvent` per
   change. Routes never write `dbo` directly; no `dbo` schema changes. WinSpeed is the single source: Sale-App keeps no
   copy of master data. Full rules: `docs/sale-app/handover/WINSPEED-MASTER-DATA-RULES.md`.
4. **Sale-App-only resets**: the data start date, Rebate reset and giveaway Set Zero change `wf` data only; WinSpeed stays
   as it is. Each is repeatable and logged.
5. **One deploy kit, no stray files**: deploy only with `docs/deploy/r740/deploy-r740.ps1`; one-off SQL goes to
   `docs/deploy/r740/sql/one-off/` with a dated name and a header saying what it did. No ad-hoc scripts in the repo root.
6. **No unneeded worktrees or branches**: remove a worktree once its branch is merged; old work is kept as
   `archive/*` tags, not branches.
7. **Preserve documentation integrity**: update the SSOT files above rather than writing new context packs.
