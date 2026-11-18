-- Transactional audit for changes to the current credit policy, not a debt ledger.
IF OBJECT_ID('wf.CreditMasterAudit','U') IS NULL
BEGIN
 CREATE TABLE wf.CreditMasterAudit (
  Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_CreditMasterAudit PRIMARY KEY,
  CustId nvarchar(20) NOT NULL,
  BeforeState nvarchar(max) NULL,
  AfterState nvarchar(max) NOT NULL,
  ActorPrimaryId int NOT NULL,
  EffectivePrimaryId int NOT NULL,
  ActorBusinessId int NOT NULL,
  EffectiveBusinessId int NOT NULL,
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_CreditMasterAudit_Created DEFAULT GETUTCDATE()
 );
 CREATE INDEX IX_CreditMasterAudit_CustAt ON wf.CreditMasterAudit(CustId,CreatedAt);
END;
GO
