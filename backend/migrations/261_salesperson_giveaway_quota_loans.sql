-- @transaction
-- Individual quota loans, including within one region. No legacy borrowing or WinSpeed rows are rewritten.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF COL_LENGTH('wf.ChangeEvent','ActorUserId') IS NULL
 RAISERROR('QUOTA_LOAN_ACTOR_AUDIT_REQUIRED',16,1);
IF OBJECT_ID('wf.GiveawayQuotaLoan','U') IS NULL
CREATE TABLE wf.GiveawayQuotaLoan(
 Id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_GiveawayQuotaLoan PRIMARY KEY,
 RequestId varchar(36) NOT NULL CONSTRAINT UQ_GiveawayQuotaLoan_Request UNIQUE,
 Fingerprint varchar(64) NOT NULL,
 LenderBudgetId int NOT NULL CONSTRAINT FK_GiveawayQuotaLoan_LenderBudget REFERENCES wf.GiveawayBudget(Id),
 BorrowerBudgetId int NOT NULL CONSTRAINT FK_GiveawayQuotaLoan_BorrowerBudget REFERENCES wf.GiveawayBudget(Id),
 LenderUserId int NOT NULL, BorrowerUserId int NOT NULL,
 Quantity decimal(12,2) NOT NULL, ReturnedQty decimal(12,2) NOT NULL CONSTRAINT DF_GiveawayQuotaLoan_Returned DEFAULT(0),
 Status varchar(12) NOT NULL CONSTRAINT DF_GiveawayQuotaLoan_Status DEFAULT('PENDING'),
 Revision int NOT NULL CONSTRAINT DF_GiveawayQuotaLoan_Revision DEFAULT(1),
 RequestedById int NOT NULL, RequesterActorId int NOT NULL,
 RequesterPrimaryId int NOT NULL, RequesterActorPrimaryId int NOT NULL,
 DecidedById int NULL, DeciderActorId int NULL,
 Reason nvarchar(500) NOT NULL,
 CreatedAtUtc datetime NOT NULL CONSTRAINT DF_GiveawayQuotaLoan_Created DEFAULT(GETUTCDATE()),
 ChangedAtUtc datetime NOT NULL CONSTRAINT DF_GiveawayQuotaLoan_Changed DEFAULT(GETUTCDATE()),
 CONSTRAINT CK_GiveawayQuotaLoan_Parties CHECK(LenderUserId<>BorrowerUserId AND LenderBudgetId<>BorrowerBudgetId),
 CONSTRAINT CK_GiveawayQuotaLoan_Quantity CHECK(Quantity>0 AND ReturnedQty>=0 AND ReturnedQty<=Quantity),
 CONSTRAINT CK_GiveawayQuotaLoan_Status CHECK(Status IN('PENDING','APPROVED','REJECTED','CANCELLED','RETURNED')),
 CONSTRAINT CK_GiveawayQuotaLoan_ReturnState CHECK((Status='RETURNED' AND ReturnedQty=Quantity) OR
  (Status='APPROVED' AND ReturnedQty<Quantity) OR (Status IN('PENDING','REJECTED','CANCELLED') AND ReturnedQty=0))
);
IF OBJECT_ID('wf.GiveawayQuotaRepayment','U') IS NULL
CREATE TABLE wf.GiveawayQuotaRepayment(
 RequestId varchar(36) NOT NULL CONSTRAINT PK_GiveawayQuotaRepayment PRIMARY KEY,
 LoanId int NOT NULL CONSTRAINT FK_GiveawayQuotaRepayment_Loan REFERENCES wf.GiveawayQuotaLoan(Id),
 Fingerprint varchar(64) NOT NULL, Quantity decimal(12,2) NOT NULL,
 UserId int NOT NULL, ActorUserId int NOT NULL, PrimaryUserId int NOT NULL, ActorPrimaryId int NOT NULL,
 Reason nvarchar(500) NOT NULL,
 CreatedAtUtc datetime NOT NULL CONSTRAINT DF_GiveawayQuotaRepayment_Created DEFAULT(GETUTCDATE()),
 CONSTRAINT CK_GiveawayQuotaRepayment_Quantity CHECK(Quantity>0)
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.GiveawayQuotaLoan') AND name='IX_GiveawayQuotaLoan_Parties')
 CREATE INDEX IX_GiveawayQuotaLoan_Parties ON wf.GiveawayQuotaLoan(BorrowerUserId,LenderUserId,Id);
GO
