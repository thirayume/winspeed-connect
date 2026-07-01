-- =============================================================
-- 019_request_types.sql
-- Add ReqType to wf.UnlockRequest for EDIT and CANCEL workflows
-- =============================================================

IF COL_LENGTH('wf.UnlockRequest','ReqType') IS NULL
BEGIN
  ALTER TABLE wf.UnlockRequest ADD ReqType NVARCHAR(20) NOT NULL DEFAULT 'UNLOCK';
END
GO

IF COL_LENGTH('wf.UnlockRequest','ReqType') IS NOT NULL
BEGIN
  IF OBJECT_ID('chk_UnlockReq_ReqType', 'C') IS NULL
    ALTER TABLE wf.UnlockRequest ADD CONSTRAINT chk_UnlockReq_ReqType CHECK (ReqType IN ('UNLOCK', 'EDIT', 'CANCEL'));
END
GO

PRINT '✓ WF migration 019 complete (ReqType)'
GO
