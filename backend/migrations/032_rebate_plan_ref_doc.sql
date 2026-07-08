-- =============================================================
-- 032_rebate_plan_ref_doc.sql
-- Add app-owned reference document text to wf.RebatePlan.
-- Safe to re-run (idempotent)
-- =============================================================

IF OBJECT_ID('wf.RebatePlan','U') IS NOT NULL
   AND COL_LENGTH('wf.RebatePlan','RefDoc') IS NULL
BEGIN
  ALTER TABLE wf.RebatePlan ADD RefDoc NVARCHAR(100) NULL;
END
GO

PRINT 'WF migration 032 complete (RebatePlan.RefDoc)'
GO
