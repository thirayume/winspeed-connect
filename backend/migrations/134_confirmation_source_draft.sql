-- Durable draft-to-native identity for idempotent confirmation retries.
-- Historical drafts cannot be reconstructed reliably and are left NULL.
IF COL_LENGTH('wf.SalesOrderExt','SourceDraftId') IS NULL
    ALTER TABLE wf.SalesOrderExt ADD SourceDraftId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.SalesOrderExt') AND name='UX_SalesOrderExt_SourceDraftId')
    CREATE UNIQUE INDEX UX_SalesOrderExt_SourceDraftId
    ON wf.SalesOrderExt(SourceDraftId) WHERE SourceDraftId IS NOT NULL;
GO
