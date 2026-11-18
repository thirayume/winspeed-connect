-- Append-only ticket redemption receipts. No API or write path is enabled by
-- this migration. Native accounting treatment remains separately gated.
IF OBJECT_ID('wf.RebateTicketRedemptionReceipt','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateTicketRedemptionReceipt (
    Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_RebateTicketRedemptionReceipt PRIMARY KEY,
    RequestId uniqueidentifier NOT NULL,
    BookingSOID int NOT NULL,
    BookingLineNo int NOT NULL,
    CustId int NOT NULL,
    GoodId int NOT NULL,
    QuantityTon decimal(14,4) NOT NULL,
    Treatment varchar(16) NOT NULL,
    NativeFingerprint char(64) NOT NULL,
    ActorPrimaryId int NOT NULL,
    EffectivePrimaryId int NOT NULL,
    ActorBusinessId int NOT NULL,
    EffectiveBusinessId int NOT NULL,
    CreatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RTRR_Created DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_RTRR_Request UNIQUE(RequestId),
    CONSTRAINT UQ_RTRR_BookingLine UNIQUE(BookingSOID,BookingLineNo),
    CONSTRAINT CK_RTRR_Values CHECK(BookingSOID>0 AND BookingLineNo>0 AND CustId>0 AND GoodId>0
      AND QuantityTon>0 AND ActorPrimaryId>0 AND EffectivePrimaryId>0 AND ActorBusinessId>0 AND EffectiveBusinessId>0),
    CONSTRAINT CK_RTRR_Treatment CHECK(Treatment IN ('ZERO','DISCOUNT'))
  );
END;
GO
IF OBJECT_ID('wf.RebateTicketRedemptionAllocation','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateTicketRedemptionAllocation (
    ReceiptId bigint NOT NULL CONSTRAINT FK_RTRA_Receipt REFERENCES wf.RebateTicketRedemptionReceipt(Id),
    TicketId bigint NOT NULL CONSTRAINT FK_RTRA_Ticket REFERENCES wf.FertilizerTicket(Id),
    Ordinal int NOT NULL,
    QuantityTon decimal(14,4) NOT NULL,
    RemainingBefore decimal(14,4) NOT NULL,
    RemainingAfter decimal(14,4) NOT NULL,
    CONSTRAINT PK_RTRA PRIMARY KEY(ReceiptId,TicketId),
    CONSTRAINT UQ_RTRA_Ordinal UNIQUE(ReceiptId,Ordinal),
    CONSTRAINT CK_RTRA_Values CHECK(Ordinal>0 AND QuantityTon>0 AND RemainingBefore>=QuantityTon
      AND RemainingAfter>=0 AND RemainingAfter=RemainingBefore-QuantityTon)
  );
END;
GO
IF OBJECT_ID('wf.TR_RebateTicketReceipt_Immutable','TR') IS NULL
EXEC(N'CREATE TRIGGER wf.TR_RebateTicketReceipt_Immutable ON wf.RebateTicketRedemptionReceipt
  INSTEAD OF UPDATE, DELETE AS BEGIN RAISERROR(''Redemption receipts are immutable'',16,1); END');
GO
IF OBJECT_ID('wf.TR_RebateTicketAllocation_Immutable','TR') IS NULL
EXEC(N'CREATE TRIGGER wf.TR_RebateTicketAllocation_Immutable ON wf.RebateTicketRedemptionAllocation
  INSTEAD OF UPDATE, DELETE AS BEGIN RAISERROR(''Redemption allocations are immutable'',16,1); END');
GO
