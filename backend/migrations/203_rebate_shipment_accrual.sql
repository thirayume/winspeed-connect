-- @transaction
-- Immutable accrual snapshots from reviewed shipment evidence. Creating this
-- table does not backfill or change a customer balance. Claims and conversions
-- must share reservations against these rows before they are exposed.
IF OBJECT_ID('wf.RebateShipmentAccrual','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateShipmentAccrual (
    Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_RebateShipmentAccrual PRIMARY KEY,
    EnvironmentKind varchar(16) NOT NULL,
    ResetId uniqueidentifier NOT NULL,
    Generation int NOT NULL,
    EvidenceId bigint NOT NULL,
    SourceSOID int NOT NULL,
    SourceListNo int NOT NULL,
    CouponId int NOT NULL,
    GoodId int NOT NULL,
    CustId int NOT NULL,
    PlanId int NOT NULL,
    QuantityTon decimal(18,3) NOT NULL,
    ListPricePerTon decimal(18,2) NOT NULL,
    NetPricePerTon decimal(18,2) NOT NULL,
    RebatePerTon decimal(18,2) NOT NULL,
    AmountBaht decimal(18,2) NOT NULL,
    OccurredAtUtc datetime2 NOT NULL,
    CreatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateShipmentAccrual_Created DEFAULT GETUTCDATE(),
    CONSTRAINT FK_RebateShipmentAccrual_Evidence FOREIGN KEY(EvidenceId) REFERENCES wf.RebateShipmentEvidence(Id),
    CONSTRAINT UQ_RebateShipmentAccrual_Evidence UNIQUE(EnvironmentKind,ResetId,EvidenceId),
    CONSTRAINT CK_RebateShipmentAccrual_Environment CHECK(EnvironmentKind IN ('uat','production')),
    CONSTRAINT CK_RebateShipmentAccrual_Values CHECK(Generation>0 AND EvidenceId>0 AND SourceSOID>0 AND SourceListNo>0
      AND CouponId>0 AND GoodId>0 AND CustId>0 AND PlanId>0 AND QuantityTon>0 AND ListPricePerTon>=0 AND NetPricePerTon>=0
      AND RebatePerTon>0 AND ListPricePerTon-NetPricePerTon=RebatePerTon AND AmountBaht>0)
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.RebateShipmentAccrual') AND name='IX_RebateShipmentAccrual_Lot')
  CREATE INDEX IX_RebateShipmentAccrual_Lot ON wf.RebateShipmentAccrual(EnvironmentKind,ResetId,SourceSOID,SourceListNo)
    INCLUDE(QuantityTon,EvidenceId);
GO
IF OBJECT_ID('wf.trg_RebateShipmentAccrual_Verified','TR') IS NULL
  EXEC('CREATE TRIGGER wf.trg_RebateShipmentAccrual_Verified ON wf.RebateShipmentAccrual AFTER INSERT, UPDATE, DELETE AS BEGIN SET NOCOUNT ON; END');
GO
ALTER TRIGGER wf.trg_RebateShipmentAccrual_Verified ON wf.RebateShipmentAccrual AFTER INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted)
  BEGIN RAISERROR('Shipment accrual rows are immutable',16,1); RETURN; END;
  IF EXISTS (
    SELECT 1 FROM inserted i
    LEFT JOIN wf.RebateShipmentEvidence e ON e.Id=i.EvidenceId
    LEFT JOIN wf.RebateResetParticipant p ON p.EnvironmentKind=i.EnvironmentKind
    WHERE e.Id IS NULL OR e.Status<>'MANUALLY_VERIFIED' OR e.EnvironmentKind<>i.EnvironmentKind OR e.ResetId<>i.ResetId
      OR e.SourceSOID IS NULL OR e.SourceListNo IS NULL OR e.CouponId IS NULL OR e.GoodId IS NULL
      OR e.SourceSOID<>i.SourceSOID OR e.SourceListNo<>i.SourceListNo OR e.CouponId<>i.CouponId OR e.GoodId<>i.GoodId
      OR e.QuantityTon IS NULL OR e.OccurredAtUtc IS NULL OR e.QuantityTon<>i.QuantityTon OR e.OccurredAtUtc<>i.OccurredAtUtc
      OR p.EnvironmentKind IS NULL OR p.Phase<>'READY' OR p.ResetId IS NULL OR p.ResetId<>i.ResetId
      OR p.Generation<>i.Generation OR p.LastResetAtUtc IS NULL OR i.OccurredAtUtc<=p.LastResetAtUtc
  ) RAISERROR('Shipment accrual requires verified current-epoch evidence',16,1);
END;
GO
