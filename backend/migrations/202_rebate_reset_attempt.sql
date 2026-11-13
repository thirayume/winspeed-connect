-- @transaction
-- Durable coordinator journal, installed on the environment's primary DB.
-- Installing it does not initialize or execute a reset.
IF OBJECT_ID('wf.RebateResetAttempt','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateResetAttempt (
    EnvironmentKind varchar(16) NOT NULL,
    ResetId uniqueidentifier NOT NULL,
    ManifestDigest char(64) NOT NULL,
    PreviousGeneration int NOT NULL,
    PreviousResetId uniqueidentifier NULL,
    PreviousResetAtUtc datetime2 NULL,
    NewGeneration int NOT NULL,
    ResetAtUtc datetime2 NOT NULL,
    IdentityActorId int NOT NULL,
    IdentityEffectiveId int NOT NULL,
    Phase varchar(16) NOT NULL,
    CreatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateResetAttempt_Created DEFAULT GETUTCDATE(),
    CompletedAtUtc datetime2 NULL,
    CONSTRAINT PK_RebateResetAttempt PRIMARY KEY(EnvironmentKind,ResetId),
    CONSTRAINT CK_RebateResetAttempt_Environment CHECK(EnvironmentKind IN ('uat','production')),
    CONSTRAINT CK_RebateResetAttempt_Phase CHECK(Phase IN ('PREPARING','APPLYING','COMPLETE')),
    CONSTRAINT CK_RebateResetAttempt_Values CHECK(PreviousGeneration>=0 AND CAST(NewGeneration AS bigint)=CAST(PreviousGeneration AS bigint)+1
      AND ((PreviousGeneration=0 AND PreviousResetId IS NULL AND PreviousResetAtUtc IS NULL)
        OR (PreviousGeneration>0 AND PreviousResetId IS NOT NULL AND PreviousResetAtUtc IS NOT NULL AND ResetAtUtc>PreviousResetAtUtc))
      AND IdentityActorId>0 AND IdentityEffectiveId>0)
  );
END;
IF OBJECT_ID('wf.RebateResetAttemptTarget','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateResetAttemptTarget (
    EnvironmentKind varchar(16) NOT NULL,
    ResetId uniqueidentifier NOT NULL,
    DatabaseName nvarchar(128) NOT NULL,
    ServerName nvarchar(128) NOT NULL,
    ReceiptVerifiedAtUtc datetime2 NULL,
    CONSTRAINT PK_RebateResetAttemptTarget PRIMARY KEY(EnvironmentKind,ResetId,DatabaseName),
    CONSTRAINT FK_RebateResetAttemptTarget_Attempt FOREIGN KEY(EnvironmentKind,ResetId)
      REFERENCES wf.RebateResetAttempt(EnvironmentKind,ResetId),
    CONSTRAINT CK_RebateResetAttemptTarget_Names CHECK(LEN(LTRIM(RTRIM(DatabaseName)))>0 AND LEN(LTRIM(RTRIM(ServerName)))>0)
  );
END;
GO
