# Claude Code Workspace Guide — World Fertilizer Sale-App

## 1. Single Source of Truth (SSOT)
- **Primary Handover & Operations SSOT**: `docs/sale-app/handover/README.md`
- **Agent Collaboration & Active WIP Log**: `docs/sale-app/handover/AGENT-COLLABORATION.md`
- **Technical & Architecture References**:
  - Master index: `docs/README.md`
  - Requirements & Trace: `docs/01-REQUIREMENTS-AND-TRACE.md`
  - On-Premises & CI/CD: `docs/02-ONPREM-AND-CICD.md`
  - Implementation Plan & Roadmap: `docs/03-IMPLEMENTATION-PLAN.md`
  - Database Runbook: `docs/DEPLOYMENT-DATABASE-RUNBOOK-V1.7.0.md`

> [!IMPORTANT]
> **Every session MUST start by reviewing `docs/sale-app/handover/AGENT-COLLABORATION.md`.**
> When you complete work or make architecture/state changes, you MUST append your entry to the Agent Activity & Handoff Log in `docs/sale-app/handover/AGENT-COLLABORATION.md`.

---

## 2. Active Work Protection (CRITICAL)
- **Codex Active Worktree**: `scratch/database-profiles-20261109` (branch `codex/database-profiles-20261109`)
  - Contains database connection profiles, encryption, badge styling, and switcher permissions.
  - **DO NOT delete, modify, or overwrite any files in this worktree or the related database-connection files on main.**
- **Main Uncommitted Work**: Check `git status` on `main` before editing. Active work exists for Customer Portal & Credit Aging (Migration 172).

---

## 3. Project Architecture
- **Frontend (`WSSale-App/`)**:
  - Stack: React 18, Vite, TypeScript, Tailwind CSS, Zustand, Lucide React.
  - Commands: `cd WSSale-App && npm run build` (runs `tsc -b && vite build`).
- **Backend (`backend/`)**:
  - Stack: Node.js 22+, Express, `mssql` / `msnodesqlv8` for SQL Server 2019+.
  - Migrations: `backend/migrations/` (169 applied, sequential numbering).
  - Tests: `cd backend && npm test` (Node test runner).
- **Deployment**:
  - Host: Dell PowerEdge R740-SRV.
  - Runtime: Docker Compose, Caddy reverse proxy (HTTPS/ACME), Node backend, MSSQL.

---

## 4. Development & Security Guidelines
1. **Never commit credentials**: Production credentials and customer profiles are local-only and excluded from git.
2. **Migration Safety**: Migrations must be idempotent, use transactions (`@transaction`), handle rollbacks in `backend/migrations/down/`, and never alter WinSpeed native tables without guardrails.
3. **No Unneeded Worktrees**: Do not leave stale git worktrees in `scratch/` or `.claude/worktrees/`. If a worktree is merged, prune it cleanly.
4. **Preserve Documentation Integrity**: Update canonical docs in `docs/sale-app/handover/` or `docs/` rather than creating redundant context packs.

