-- @transaction
-- Shared shipment reservations for claims and ticket conversions. Migration
-- creates no reservations and does not alter any legacy balance.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO
IF OBJECT_ID('wf.RebateShipmentReservation','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateShipmentReservation (
    Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_RebateShipmentReservation PRIMARY KEY,
    AccrualId bigint NOT NULL CONSTRAINT FK_RebateShipmentReservation_Accrual REFERENCES wf.RebateShipmentAccrual(Id),
    ClaimId int NULL CONSTRAINT FK_RebateShipmentReservation_Claim REFERENCES wf.RebateClaim(Id),
    ConversionId bigint NULL CONSTRAINT FK_RebateShipmentReservation_Conversion REFERENCES wf.FertilizerTicketConversion(Id),
    QuantityTon decimal(18,3) NOT NULL,
    AmountBaht decimal(18,2) NOT NULL,
    Status varchar(16) NOT NULL CONSTRAINT DF_RebateShipmentReservation_Status DEFAULT 'ACTIVE',
    CreatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateShipmentReservation_Created DEFAULT GETUTCDATE(),
    ReleasedAtUtc datetime2 NULL,
    ReleaseActorPrimaryId int NULL,
    ReleaseEffectivePrimaryId int NULL,
    ReleaseActorBusinessId int NULL,
    ReleaseEffectiveBusinessId int NULL,
    ReleaseReason nvarchar(500) NULL,
    CONSTRAINT CK_RebateShipmentReservation_Document CHECK((ClaimId IS NOT NULL AND ConversionId IS NULL) OR (ClaimId IS NULL AND ConversionId IS NOT NULL)),
    CONSTRAINT CK_RebateShipmentReservation_Values CHECK(QuantityTon>0 AND AmountBaht>0 AND Status IN ('ACTIVE','RELEASED')),
    CONSTRAINT CK_RebateShipmentReservation_Release CHECK(
      (Status='ACTIVE' AND ReleasedAtUtc IS NULL AND ReleaseActorPrimaryId IS NULL AND ReleaseEffectivePrimaryId IS NULL
        AND ReleaseActorBusinessId IS NULL AND ReleaseEffectiveBusinessId IS NULL AND ReleaseReason IS NULL)
      OR (Status='RELEASED' AND ReleasedAtUtc IS NOT NULL AND ReleaseActorPrimaryId IS NOT NULL AND ReleaseActorPrimaryId>0
        AND ReleaseEffectivePrimaryId IS NOT NULL AND ReleaseEffectivePrimaryId>0 AND ReleaseActorBusinessId IS NOT NULL AND ReleaseActorBusinessId>0
        AND ReleaseEffectiveBusinessId IS NOT NULL AND ReleaseEffectiveBusinessId>0 AND ReleaseReason IS NOT NULL AND LEN(LTRIM(RTRIM(ReleaseReason)))>0))
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.RebateShipmentReservation') AND name='UX_RebateShipmentReservation_Claim')
  CREATE UNIQUE INDEX UX_RebateShipmentReservation_Claim ON wf.RebateShipmentReservation(AccrualId,ClaimId) WHERE ClaimId IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.RebateShipmentReservation') AND name='UX_RebateShipmentReservation_Conversion')
  CREATE UNIQUE INDEX UX_RebateShipmentReservation_Conversion ON wf.RebateShipmentReservation(AccrualId,ConversionId) WHERE ConversionId IS NOT NULL;
GO
