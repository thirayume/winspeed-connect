-- Idempotent manual conversion receipt. It is written in the same transaction
-- as FIFO deductions and binds the request to both authenticated identities.
-- SQL Server 2008 R2 compatible.
IF OBJECT_ID('wf.RebateConversionRequest', 'U') IS NULL
BEGIN
  CREATE TABLE wf.RebateConversionRequest (
    RequestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_RebateConversionRequest PRIMARY KEY,
    Fingerprint CHAR(64) NOT NULL,
    IdentityActorId INT NOT NULL,
    IdentityEffectiveId INT NOT NULL,
    BusinessActorId INT NOT NULL,
    BusinessEffectiveId INT NOT NULL,
    CustId INT NOT NULL,
    BusinessDate DATE NOT NULL,
    CycleMonths INT NOT NULL,
    ConversionId BIGINT NULL CONSTRAINT FK_RebateConversionRequest_Conversion
      REFERENCES wf.FertilizerTicketConversion(Id),
    CreatedAt DATETIME NOT NULL CONSTRAINT DF_RebateConversionRequest_CreatedAt DEFAULT GETUTCDATE(),
    CompletedAt DATETIME NULL
  );
END;
GO
