-- Durable initialization journal; creates no coordinator/participant rows
-- and does not reset balances. SQL Server 2008 R2 compatible.
-- @transaction
IF OBJECT_ID('wf.RebateResetParticipant','U') IS NULL
  RAISERROR('RebateResetParticipant is required',16,1);
ELSE IF COL_LENGTH('wf.RebateResetParticipant','BootstrapId') IS NULL
  ALTER TABLE wf.RebateResetParticipant ADD BootstrapId uniqueidentifier NULL;
GO
IF OBJECT_ID('wf.RebateResetBootstrap','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateResetBootstrap (
    EnvironmentKind varchar(16) NOT NULL CONSTRAINT PK_RebateResetBootstrap PRIMARY KEY,
    BootstrapId uniqueidentifier NOT NULL CONSTRAINT UQ_RebateResetBootstrap_Id UNIQUE,
    PrimaryDatabase sysname NOT NULL,
    ManifestDigest char(64) NOT NULL,
    IdentityActorId int NOT NULL,
    IdentityEffectiveId int NOT NULL,
    Phase varchar(16) NOT NULL,
    CreatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateResetBootstrap_Created DEFAULT GETUTCDATE(),
    CompletedAtUtc datetime2 NULL,
    CONSTRAINT CK_RebateResetBootstrap_Env CHECK(EnvironmentKind IN ('uat','production')),
    CONSTRAINT CK_RebateResetBootstrap_Phase CHECK(Phase IN ('APPLYING','COMPLETE')),
    CONSTRAINT CK_RebateResetBootstrap_Identity CHECK(IdentityActorId>0 AND IdentityEffectiveId>0),
    CONSTRAINT CK_RebateResetBootstrap_Complete CHECK((Phase='APPLYING' AND CompletedAtUtc IS NULL) OR
      (Phase='COMPLETE' AND CompletedAtUtc IS NOT NULL))
  );
END;
GO
IF OBJECT_ID('wf.RebateResetBootstrapTarget','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateResetBootstrapTarget (
    EnvironmentKind varchar(16) NOT NULL,
    BootstrapId uniqueidentifier NOT NULL,
    DatabaseName sysname NOT NULL,
    ServerName nvarchar(128) NOT NULL,
    BusinessActorId int NOT NULL,
    BusinessEffectiveId int NOT NULL,
    VerifiedAtUtc datetime2 NULL,
    CONSTRAINT PK_RebateResetBootstrapTarget PRIMARY KEY(EnvironmentKind,BootstrapId,DatabaseName,ServerName),
    CONSTRAINT FK_RebateResetBootstrapTarget_Bootstrap FOREIGN KEY(BootstrapId) REFERENCES wf.RebateResetBootstrap(BootstrapId),
    CONSTRAINT CK_RebateResetBootstrapTarget_Identity CHECK(BusinessActorId>0 AND BusinessEffectiveId>0)
  );
END;
GO
