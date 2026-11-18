-- @transaction
-- Creates an empty request journal. No existing reservation or balance changes.
IF OBJECT_ID('wf.FertilizerTicketConversion','U') IS NULL
  RAISERROR('FertilizerTicketConversion is required',16,1);
ELSE IF OBJECT_ID('wf.RebateConversionApprovalRequest','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateConversionApprovalRequest (
    Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_RebateConversionApprovalRequest PRIMARY KEY,
    RequestId uniqueidentifier NOT NULL CONSTRAINT UQ_RebateConversionApprovalRequest_RequestId UNIQUE,
    Fingerprint char(64) NOT NULL,
    EnvironmentKind varchar(16) NOT NULL,
    ResetId uniqueidentifier NOT NULL,
    Generation int NOT NULL,
    CustId int NOT NULL,
    ConversionId bigint NOT NULL CONSTRAINT FK_RebateConversionApprovalRequest_Conversion REFERENCES wf.FertilizerTicketConversion(Id),
    Status varchar(16) NOT NULL,
    RequestedExpiryDate date NULL,
    ActorPrimaryId int NOT NULL,
    EffectivePrimaryId int NOT NULL,
    ActorBusinessId int NOT NULL,
    EffectiveBusinessId int NOT NULL,
    CreatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateConversionApprovalRequest_Created DEFAULT GETUTCDATE(),
    DecisionActorPrimaryId int NULL,
    DecisionEffectivePrimaryId int NULL,
    DecisionActorBusinessId int NULL,
    DecisionEffectiveBusinessId int NULL,
    DecidedAtUtc datetime2 NULL,
    DecisionReason nvarchar(500) NULL,
    CONSTRAINT UQ_RebateConversionApprovalRequest_Conversion UNIQUE (ConversionId),
    CONSTRAINT CK_RebateConversionApprovalRequest_Status CHECK(Status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    CONSTRAINT CK_RebateConversionApprovalRequest_Ids CHECK(Generation>0 AND CustId>0 AND ActorPrimaryId>0 AND EffectivePrimaryId>0 AND ActorBusinessId>0 AND EffectiveBusinessId>0),
    CONSTRAINT CK_RebateConversionApprovalRequest_Decision CHECK(
      (Status='PENDING' AND DecidedAtUtc IS NULL AND DecisionActorPrimaryId IS NULL AND DecisionEffectivePrimaryId IS NULL
        AND DecisionActorBusinessId IS NULL AND DecisionEffectiveBusinessId IS NULL AND DecisionReason IS NULL)
      OR (Status IN ('APPROVED','REJECTED','CANCELLED') AND DecidedAtUtc IS NOT NULL
        AND DecisionActorPrimaryId IS NOT NULL AND DecisionActorPrimaryId>0
        AND DecisionEffectivePrimaryId IS NOT NULL AND DecisionEffectivePrimaryId>0
        AND DecisionActorBusinessId IS NOT NULL AND DecisionActorBusinessId>0
        AND DecisionEffectiveBusinessId IS NOT NULL AND DecisionEffectiveBusinessId>0
        AND DecisionReason IS NOT NULL AND LEN(LTRIM(RTRIM(DecisionReason)))>0))
  );
END;
GO
IF OBJECT_ID('wf.RebateResetAttemptTarget','U') IS NULL
  RAISERROR('RebateResetAttemptTarget is required',16,1);
ELSE
BEGIN
  IF COL_LENGTH('wf.RebateResetAttemptTarget','BusinessActorId') IS NULL
    ALTER TABLE wf.RebateResetAttemptTarget ADD BusinessActorId int NULL;
  IF COL_LENGTH('wf.RebateResetAttemptTarget','BusinessEffectiveId') IS NULL
    ALTER TABLE wf.RebateResetAttemptTarget ADD BusinessEffectiveId int NULL;
END;
GO
