-- Preserve the actual actor for new print events. Historical rows stay NULL:
-- their actor cannot be reconstructed reliably from PrintedBy.
IF OBJECT_ID('wf.NativePrintLog','U') IS NULL
  RAISERROR('NativePrintLog is required before migration 210',16,1);
ELSE IF COL_LENGTH('wf.NativePrintLog','ActorUserId') IS NULL
  ALTER TABLE wf.NativePrintLog ADD ActorUserId int NULL;
GO
