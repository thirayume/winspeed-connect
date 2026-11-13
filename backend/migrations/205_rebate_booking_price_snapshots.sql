-- @transaction
-- SQL Server 2008 R2. Append-only approval and 103 price evidence. This
-- migration creates no data and does not enable the booking or Rebate routes.
-- Draft rows are intentionally not foreign keys: the existing 103 conversion
-- procedure removes the draft in the same transaction.
IF OBJECT_ID('wf.RebatePriceApprovalEvidence','U') IS NULL
BEGIN
 CREATE TABLE wf.RebatePriceApprovalEvidence (
  Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_RebatePriceApprovalEvidence PRIMARY KEY,
  DecisionFingerprint char(64) NOT NULL,
  DraftId int NOT NULL, [LineNo] int NOT NULL, DocumentRevision int NOT NULL,
  Decision varchar(12) NOT NULL,
  ActorPrimaryId int NOT NULL, EffectivePrimaryId int NOT NULL,
  ActorBusinessId int NOT NULL, EffectiveBusinessId int NOT NULL,
  Reason nvarchar(500) NOT NULL,
  CreatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebatePriceApprovalEvidence_Created DEFAULT GETUTCDATE(),
  CONSTRAINT UQ_RebatePriceApprovalEvidence_Fingerprint UNIQUE(DecisionFingerprint),
  CONSTRAINT CK_RebatePriceApprovalEvidence_Values CHECK
    (DraftId>0 AND [LineNo]>0 AND DocumentRevision>0 AND Decision IN ('APPROVED','REJECTED')
     AND ActorPrimaryId>0 AND EffectivePrimaryId>0 AND ActorBusinessId>0 AND EffectiveBusinessId>0
     AND LEN(LTRIM(RTRIM(Reason)))>0)
 );
END;
GO
IF OBJECT_ID('wf.RebateBookingPriceSnapshot','U') IS NULL
BEGIN
 CREATE TABLE wf.RebateBookingPriceSnapshot (
  BookingSOID int NOT NULL, [LineNo] int NOT NULL,
  DraftId int NOT NULL, DocumentRevision int NOT NULL, GoodId int NOT NULL, SaleDate date NOT NULL,
  SourceServer nvarchar(128) NOT NULL, SourceDatabase nvarchar(128) NOT NULL,
  SetPriceId int NOT NULL, SetPriceListNo int NOT NULL, PriceBegin date NOT NULL, PriceEnd date NULL,
  BasePrice decimal(18,2) NOT NULL, SellingPrice decimal(18,2) NOT NULL,
  InvoicePrice decimal(18,2) NOT NULL, QuantityTon decimal(18,3) NOT NULL,
  IsCashDiscount bit NOT NULL, RebatePerTon decimal(18,2) NOT NULL, TotalRebate decimal(18,2) NOT NULL,
  RequiresManagerApproval bit NOT NULL, ApprovalEvidenceId bigint NULL,
  DecisionFingerprint char(64) NOT NULL,
  CreatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RebateBookingPriceSnapshot_Created DEFAULT GETUTCDATE(),
  CONSTRAINT PK_RebateBookingPriceSnapshot PRIMARY KEY(BookingSOID,[LineNo]),
  CONSTRAINT FK_RebateBookingPriceSnapshot_Approval FOREIGN KEY(ApprovalEvidenceId) REFERENCES wf.RebatePriceApprovalEvidence(Id),
  CONSTRAINT CK_RebateBookingPriceSnapshot_Values CHECK
   (BookingSOID>0 AND [LineNo]>0 AND DraftId>0 AND DocumentRevision>0 AND GoodId>0
    AND SetPriceId>0 AND SetPriceListNo>0 AND BasePrice>0 AND SellingPrice>=0 AND InvoicePrice>=0
    AND QuantityTon>0 AND RebatePerTon>=0 AND TotalRebate>=0 AND PriceBegin<=SaleDate
    AND (PriceEnd IS NULL OR PriceEnd>=SaleDate)
    AND TotalRebate=CAST(ROUND(QuantityTon*RebatePerTon,2) AS decimal(18,2))
    AND ((SellingPrice<BasePrice AND IsCashDiscount=1 AND InvoicePrice=SellingPrice AND RebatePerTon=0 AND RequiresManagerApproval=0)
      OR (SellingPrice<BasePrice AND IsCashDiscount=0 AND InvoicePrice=BasePrice AND RebatePerTon=BasePrice-SellingPrice
        AND RebatePerTon<=300 AND ((RebatePerTon<=200 AND RequiresManagerApproval=0) OR (RebatePerTon>200 AND RequiresManagerApproval=1)))
      OR (SellingPrice>=BasePrice AND InvoicePrice=SellingPrice AND RequiresManagerApproval=0
        AND RebatePerTon=CASE WHEN SellingPrice-BasePrice>200 THEN 200 ELSE SellingPrice-BasePrice END))
    AND ((RequiresManagerApproval=1 AND ApprovalEvidenceId IS NOT NULL) OR
         (RequiresManagerApproval=0 AND ApprovalEvidenceId IS NULL)))
 );
END;
GO
IF OBJECT_ID('wf.trg_RebatePriceApprovalEvidence_Immutable','TR') IS NULL
 EXEC('CREATE TRIGGER wf.trg_RebatePriceApprovalEvidence_Immutable ON wf.RebatePriceApprovalEvidence AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; END');
GO
ALTER TRIGGER wf.trg_RebatePriceApprovalEvidence_Immutable ON wf.RebatePriceApprovalEvidence AFTER UPDATE, DELETE
AS BEGIN SET NOCOUNT ON; IF EXISTS(SELECT 1 FROM deleted) RAISERROR('Rebate price approval evidence is immutable',16,1); END;
GO
IF OBJECT_ID('wf.trg_RebateBookingPriceSnapshot_Immutable','TR') IS NULL
 EXEC('CREATE TRIGGER wf.trg_RebateBookingPriceSnapshot_Immutable ON wf.RebateBookingPriceSnapshot AFTER INSERT, UPDATE, DELETE AS BEGIN SET NOCOUNT ON; END');
GO
ALTER TRIGGER wf.trg_RebateBookingPriceSnapshot_Immutable ON wf.RebateBookingPriceSnapshot AFTER INSERT, UPDATE, DELETE
AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM deleted) BEGIN RAISERROR('Rebate booking price snapshot is immutable',16,1); RETURN; END;
 IF EXISTS(SELECT 1 FROM inserted i LEFT JOIN wf.RebatePriceApprovalEvidence a ON a.Id=i.ApprovalEvidenceId
    WHERE i.RequiresManagerApproval=1 AND (a.Id IS NULL OR a.Decision<>'APPROVED' OR a.DecisionFingerprint<>i.DecisionFingerprint
      OR a.DraftId<>i.DraftId OR a.[LineNo]<>i.[LineNo] OR a.DocumentRevision<>i.DocumentRevision))
  RAISERROR('Rebate booking price approval mismatch',16,1);
END;
GO
