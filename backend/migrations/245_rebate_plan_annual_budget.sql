-- =============================================================
-- 245_rebate_plan_annual_budget.sql
-- Expand wf.RebatePlan for Annual Promotion & Budget Planning (FR-008/009 / UAT feedback)
-- Supports Budget Category, Objective, Internal/External Participants, and Expense Breakdown
-- Safe to re-run (idempotent)
-- =============================================================

IF COL_LENGTH('wf.RebatePlan', 'PlanCategory') IS NULL
  ALTER TABLE wf.RebatePlan ADD PlanCategory NVARCHAR(100) NULL;
GO

IF COL_LENGTH('wf.RebatePlan', 'Objective') IS NULL
  ALTER TABLE wf.RebatePlan ADD Objective NVARCHAR(1000) NULL;
GO

IF COL_LENGTH('wf.RebatePlan', 'DetailsJson') IS NULL
  ALTER TABLE wf.RebatePlan ADD DetailsJson NVARCHAR(MAX) NULL;
GO

PRINT '✓ Migration 245 complete (RebatePlan annual budget & promotion fields)';
GO
