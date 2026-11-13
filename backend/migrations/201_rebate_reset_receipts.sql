-- @transaction
-- Reset receipts and cancellation audit only. No reset is performed here.
-- SQL Server 2008 R2 compatible; created in each configured participant.
IF OBJECT_ID('wf.RebateResetReceipt','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateResetReceipt (
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
    CancelledClaimCount int NOT NULL,
    AppliedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateResetReceipt_Applied DEFAULT GETUTCDATE(),
    CONSTRAINT PK_RebateResetReceipt PRIMARY KEY(EnvironmentKind,ResetId),
    CONSTRAINT CK_RebateResetReceipt_Environment CHECK(EnvironmentKind IN ('uat','production')),
    CONSTRAINT CK_RebateResetReceipt_Values CHECK(PreviousGeneration>=0 AND CAST(NewGeneration AS bigint)=CAST(PreviousGeneration AS bigint)+1
      AND ((PreviousGeneration=0 AND PreviousResetId IS NULL AND PreviousResetAtUtc IS NULL)
        OR (PreviousGeneration>0 AND PreviousResetId IS NOT NULL AND PreviousResetAtUtc IS NOT NULL AND ResetAtUtc>PreviousResetAtUtc))
      AND IdentityActorId>0 AND IdentityEffectiveId>0 AND CancelledClaimCount>=0)
  );
END;
IF OBJECT_ID('wf.RebateResetClaimCancellation','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateResetClaimCancellation (
    EnvironmentKind varchar(16) NOT NULL,
    ResetId uniqueidentifier NOT NULL,
    ClaimId int NOT NULL,
    PreviousStatus nvarchar(20) NOT NULL,
    PreviousTier int NULL,
    CancelledAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateResetClaimCancellation_At DEFAULT GETUTCDATE(),
    CONSTRAINT PK_RebateResetClaimCancellation PRIMARY KEY(EnvironmentKind,ResetId,ClaimId),
    CONSTRAINT FK_RebateResetClaimCancellation_Receipt FOREIGN KEY(EnvironmentKind,ResetId)
      REFERENCES wf.RebateResetReceipt(EnvironmentKind,ResetId),
    CONSTRAINT CK_RebateResetClaimCancellation_Values CHECK(ClaimId>0 AND PreviousStatus IN
      (N'DRAFT',N'PENDING',N'TIER2_PENDING',N'TIER3_PENDING',N'TIER4_PENDING'))
  );
END;
GO
