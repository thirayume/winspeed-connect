-- A per-database fence. No environment row is automatically initialized and
-- this migration never changes rebate balances or cancels transactions.
IF OBJECT_ID('wf.RebateResetParticipant','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateResetParticipant (
    EnvironmentKind varchar(16) NOT NULL CONSTRAINT PK_RebateResetParticipant PRIMARY KEY,
    ManifestDigest char(64) NOT NULL,
    Generation int NOT NULL,
    Phase varchar(16) NOT NULL,
    ResetId uniqueidentifier NULL,
    LastResetAtUtc datetime2 NULL,
    UpdatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateResetParticipant_Updated DEFAULT GETUTCDATE(),
    CONSTRAINT CK_RebateResetParticipant_Environment CHECK (EnvironmentKind IN ('uat','production')),
    CONSTRAINT CK_RebateResetParticipant_Generation CHECK (Generation >= 0),
    CONSTRAINT CK_RebateResetParticipant_Phase CHECK (Phase IN ('READY','PREPARING','APPLYING','FAILED'))
  );
END;
GO
