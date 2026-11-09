# AI Agents Operating Guide — World Fertilizer Sale-App
<!-- Applicable to OpenAI Codex, Claude Code, Google Antigravity, and all AI coding assistants -->

## 1. Single Source of Truth (SSOT)
- **Master Operations & Handover SSOT**: `docs/sale-app/handover/README.md`
- **Shared Agent Collaboration & WIP Log**: `docs/sale-app/handover/AGENT-COLLABORATION.md`
- **Technical & Architecture Specifications**:
  - Master index: `docs/README.md`
  - Workflow & Requirements: `docs/01-REQUIREMENTS-AND-TRACE.md`
  - On-Premises & CI/CD: `docs/02-ONPREM-AND-CICD.md`
  - Implementation Plan & Roadmap: `docs/03-IMPLEMENTATION-PLAN.md`
  - Database Runbook: `docs/DEPLOYMENT-DATABASE-RUNBOOK-V1.7.0.md`

> [!IMPORTANT]
> **Check `docs/sale-app/handover/AGENT-COLLABORATION.md` before making any changes.**
> Always append an activity entry in the log upon completing your work.

---

## 2. Active Work Protection (CRITICAL)
- **Codex Active Worktree**: `scratch/database-profiles-20261109` (branch `codex/database-profiles-20261109`)
  - Status: Active development for per-database connection profiles, encrypted storage, badge placement, and role checks.
  - **DO NOT delete or overwrite any files in this worktree.**
- **Main Uncommitted Work**: Active development on Customer Portal fields & Credit Aging Policy (Migration 172).

---

## 3. Architecture & Build Commands
- **Frontend (`WSSale-App/`)**:
  - `npm run build` — Runs `tsc -b && vite build`.
  - Type checking is enforced; `tsc -b` must exit 0.
- **Backend (`backend/`)**:
  - `npm test` — Node.js native test runner.
  - Idempotent migrations in `backend/migrations/`.
- **Infrastructure**:
  - Production & UAT on R740-SRV with Docker Compose and Caddy.

---

## 4. Multi-Agent Protocol
1. **Coordination**: Record handoffs in `docs/sale-app/handover/AGENT-COLLABORATION.md`.
2. **Worktree Discipline**: Clean up worktrees when branches are merged; never leave orphaned worktrees.
3. **Security**: Never commit secrets, passwords, or customer data to git.

