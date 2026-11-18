-- Durable coordinator. No row is seeded: the environment must be explicitly
-- initialized after verifying the primary DB, target manifest and restore mode.
-- SQL Server 2008 R2 compatible. This migration does not reset any balance.
IF OBJECT_ID('wf.RebateResetCoordinator','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateResetCoordinator (
    EnvironmentKind varchar(16) NOT NULL CONSTRAINT PK_RebateResetCoordinator PRIMARY KEY,
    PrimaryDatabase sysname NOT NULL,
    ManifestDigest char(64) NOT NULL,
    Generation int NOT NULL,
    Phase varchar(16) NOT NULL,
    ResetId uniqueidentifier NULL,
    StartedAtUtc datetime2 NULL,
    LastResetAtUtc datetime2 NULL,
    UpdatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateResetCoordinator_Updated DEFAULT GETUTCDATE(),
    CONSTRAINT CK_RebateResetCoordinator_Environment CHECK (EnvironmentKind IN ('uat','production')),
    CONSTRAINT CK_RebateResetCoordinator_Generation CHECK (Generation >= 0),
    CONSTRAINT CK_RebateResetCoordinator_Phase CHECK (Phase IN ('READY','PREPARING','APPLYING','FAILED'))
  );
END;
GO
