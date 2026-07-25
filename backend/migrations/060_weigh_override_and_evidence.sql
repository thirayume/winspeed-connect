-- =============================================================
-- 060_weigh_override_and_evidence.sql
-- Add discretionary override fields and photo evidence to WeighTicket
-- Safe to re-run (idempotent)
-- =============================================================

IF COL_LENGTH('wf.WeighTicket', 'OverrideReason') IS NULL
  ALTER TABLE wf.WeighTicket ADD OverrideReason NVARCHAR(500) NULL;
GO
IF COL_LENGTH('wf.WeighTicket', 'OverrideApprovedBy') IS NULL
  ALTER TABLE wf.WeighTicket ADD OverrideApprovedBy INT NULL REFERENCES wf.AppUser(Id);
GO
IF COL_LENGTH('wf.WeighTicket', 'OverrideApprovedByName') IS NULL
  ALTER TABLE wf.WeighTicket ADD OverrideApprovedByName NVARCHAR(100) NULL;
GO
IF COL_LENGTH('wf.WeighTicket', 'EvidencePhotoUrl') IS NULL
  ALTER TABLE wf.WeighTicket ADD EvidencePhotoUrl NVARCHAR(MAX) NULL;
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader;
GO
PRINT '✓ WF migration 060 complete (Discretionary Override & EvidencePhotoUrl on WeighTicket)';
GO
