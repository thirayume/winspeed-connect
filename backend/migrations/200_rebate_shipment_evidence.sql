-- Per-environment, per-reset evidence ledger. No source document is modified
-- and no eligibility is granted by this migration. Application code must
-- recheck the source fingerprint under a transaction before verification.
IF OBJECT_ID('wf.RebateShipmentEvidence','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateShipmentEvidence (
    Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_RebateShipmentEvidence PRIMARY KEY,
    EnvironmentKind varchar(16) NOT NULL,
    ResetId uniqueidentifier NOT NULL,
    RedemptionId int NOT NULL,
    RedemptionListNo int NOT NULL,
    CouponId int NULL,
    SourceSOID int NULL,
    SourceListNo int NULL,
    GoodId int NULL,
    QuantityTon decimal(18,3) NULL,
    SourceFingerprint char(64) NOT NULL,
    OccurredAtUtc datetime2 NULL,
    Status varchar(24) NOT NULL,
    HoldReason varchar(80) NULL,
    ReviewReason nvarchar(1000) NULL,
    ReviewedByPrimaryId int NULL,
    ReviewedByBusinessId int NULL,
    ReviewActorPrimaryId int NULL,
    ReviewActorBusinessId int NULL,
    ReviewedAtUtc datetime2 NULL,
    Revision int NOT NULL CONSTRAINT DF_RebateShipmentEvidence_Revision DEFAULT 1,
    CreatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateShipmentEvidence_Created DEFAULT GETUTCDATE(),
    UpdatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateShipmentEvidence_Updated DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_RebateShipmentEvidence_Source UNIQUE (EnvironmentKind,ResetId,RedemptionId,RedemptionListNo),
    CONSTRAINT CK_RebateShipmentEvidence_Environment CHECK (EnvironmentKind IN ('uat','production')),
    CONSTRAINT CK_RebateShipmentEvidence_Positive CHECK (RedemptionId>0 AND RedemptionListNo>0 AND Revision>0
      AND (CouponId IS NULL OR CouponId>0) AND (SourceSOID IS NULL OR SourceSOID>0)
      AND (SourceListNo IS NULL OR SourceListNo>0) AND (GoodId IS NULL OR GoodId>0)
      AND (QuantityTon IS NULL OR QuantityTon>0)),
    CONSTRAINT CK_RebateShipmentEvidence_Status CHECK (Status IN ('HELD','AUTO_VERIFIED','MANUALLY_VERIFIED','REJECTED')),
    CONSTRAINT CK_RebateShipmentEvidence_HoldReason CHECK (Status <> 'HELD' OR
      (HoldReason IS NOT NULL AND LEN(LTRIM(RTRIM(HoldReason)))>0)),
    CONSTRAINT CK_RebateShipmentEvidence_VerifiedTime CHECK (Status NOT IN ('AUTO_VERIFIED','MANUALLY_VERIFIED') OR OccurredAtUtc IS NOT NULL),
    CONSTRAINT CK_RebateShipmentEvidence_VerifiedSource CHECK (Status NOT IN ('AUTO_VERIFIED','MANUALLY_VERIFIED') OR
      (CouponId IS NOT NULL AND SourceSOID IS NOT NULL AND SourceListNo IS NOT NULL AND GoodId IS NOT NULL AND QuantityTon IS NOT NULL)),
    CONSTRAINT CK_RebateShipmentEvidence_ManualReview CHECK (Status NOT IN ('MANUALLY_VERIFIED','REJECTED') OR
      (ReviewReason IS NOT NULL AND LEN(LTRIM(RTRIM(ReviewReason)))>0 AND ReviewedByPrimaryId IS NOT NULL AND ReviewedByPrimaryId>0
       AND ReviewedByBusinessId IS NOT NULL AND ReviewedByBusinessId>0
       AND ReviewActorPrimaryId IS NOT NULL AND ReviewActorPrimaryId>0
       AND ReviewActorBusinessId IS NOT NULL AND ReviewActorBusinessId>0 AND ReviewedAtUtc IS NOT NULL))
  );
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.RebateShipmentEvidence') AND name='IX_RebateShipmentEvidence_Queue')
  CREATE INDEX IX_RebateShipmentEvidence_Queue ON wf.RebateShipmentEvidence(EnvironmentKind,ResetId,Status,Id);
GO
