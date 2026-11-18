-- =============================================================
-- 245_rebate_plan_annual_budget.down.sql
-- =============================================================

IF COL_LENGTH('wf.RebatePlan', 'DetailsJson') IS NOT NULL
  ALTER TABLE wf.RebatePlan DROP COLUMN DetailsJson;
GO

IF COL_LENGTH('wf.RebatePlan', 'Objective') IS NOT NULL
  ALTER TABLE wf.RebatePlan DROP COLUMN Objective;
GO

IF COL_LENGTH('wf.RebatePlan', 'PlanCategory') IS NOT NULL
  ALTER TABLE wf.RebatePlan DROP COLUMN PlanCategory;
GO

PRINT '✓ Migration 245 rolled back';
GO
