-- Persistent per-reset scanner checkpoint. Evidence stays HELD until reviewed.
-- SQL Server 2008 R2; this does not start a worker or create balances.
IF OBJECT_ID('wf.RebateEvidenceDiscoveryCursor','U') IS NULL
BEGIN
  CREATE TABLE wf.RebateEvidenceDiscoveryCursor (
    EnvironmentKind varchar(16) NOT NULL,
    ResetId uniqueidentifier NOT NULL,
    Generation int NOT NULL,
    LastRedemptionId int NOT NULL CONSTRAINT DF_Redisc_Id DEFAULT 0,
    LastListNo int NOT NULL CONSTRAINT DF_Redisc_Line DEFAULT 0,
    Revision int NOT NULL CONSTRAINT DF_Redisc_Revision DEFAULT 1,
    CompletedCycles bigint NOT NULL CONSTRAINT DF_Redisc_Cycles DEFAULT 0,
    UpdatedAtUtc datetime2 NOT NULL CONSTRAINT DF_Redisc_Updated DEFAULT GETUTCDATE(),
    CONSTRAINT PK_RebateEvidenceDiscoveryCursor PRIMARY KEY(EnvironmentKind,ResetId),
    CONSTRAINT CK_Redisc_Env CHECK(EnvironmentKind IN ('uat','production')),
    CONSTRAINT CK_Redisc_Values CHECK(Generation>0 AND LastRedemptionId>=0 AND LastListNo>=0 AND Revision>0 AND CompletedCycles>=0)
  );
END;
GO
