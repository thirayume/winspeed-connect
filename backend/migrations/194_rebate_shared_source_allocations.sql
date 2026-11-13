-- Keep conversion reservations on the same WinSpeed 104 lots used by claims.
-- The application must hold the same transaction-scoped RebateCust_<CustId>
-- lock as claim creation before reading the view and inserting allocations.
-- SQL Server 2008 R2 compatible. No source rows are copied or backfilled.
IF OBJECT_ID('wf.RebateConversionSourceAllocation', 'U') IS NULL
BEGIN
  CREATE TABLE wf.RebateConversionSourceAllocation (
    Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RebateConversionSourceAllocation PRIMARY KEY,
    ConversionId BIGINT NOT NULL CONSTRAINT FK_RCSA_Conversion REFERENCES wf.FertilizerTicketConversion(Id),
    SourceSOID INT NOT NULL,
    SourceListNo INT NOT NULL,
    QtyTon DECIMAL(18,3) NOT NULL,
    RebatePerTon DECIMAL(18,2) NOT NULL,
    AmountBaht DECIMAL(18,2) NOT NULL,
    CreatedAt DATETIME NOT NULL CONSTRAINT DF_RCSA_CreatedAt DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_RCSA_ConversionSource UNIQUE (ConversionId, SourceSOID, SourceListNo),
    CONSTRAINT CK_RCSA_Positive CHECK (QtyTon > 0 AND RebatePerTon > 0 AND AmountBaht > 0)
  );
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.RebateConversionSourceAllocation') AND name='IX_RCSA_Source')
  CREATE INDEX IX_RCSA_Source ON wf.RebateConversionSourceAllocation(SourceSOID, SourceListNo) INCLUDE (ConversionId, QtyTon);
GO
ALTER VIEW wf.v_RebateAccrualRemaining
AS
SELECT
    l.*,
    ISNULL(u.ClaimedTonRebate, 0) AS ClaimedTonRebate,
    ISNULL(u.ClaimedTonDiff, 0) AS ClaimedTonDiff,
    CAST(l.QtyTon - ISNULL(u.ClaimedTonRebate, 0) - ISNULL(v.ConvertedTon, 0) AS DECIMAL(18,3)) AS RemainingTonRebate,
    CAST(l.QtyTon - ISNULL(u.ClaimedTonDiff, 0) AS DECIMAL(18,3)) AS RemainingTonDiff
FROM wf.v_RebateAccrualLot l
OUTER APPLY (
    SELECT SUM(CASE WHEN cl.LineType = 'DIFF' THEN 0 ELSE cl.QtyTon END) AS ClaimedTonRebate,
           SUM(CASE WHEN cl.LineType = 'DIFF' THEN cl.QtyTon ELSE 0 END) AS ClaimedTonDiff
    FROM wf.RebateClaimLine cl JOIN wf.RebateClaim c ON c.Id = cl.ClaimId
    WHERE cl.SourceSOID = l.SourceSOID AND cl.SourceListNo = l.SourceListNo
      AND c.Status NOT IN ('REJECTED', 'CANCELLED')
) u
OUTER APPLY (
    SELECT SUM(a.QtyTon) AS ConvertedTon
    FROM wf.RebateConversionSourceAllocation a
    JOIN wf.FertilizerTicketConversion c ON c.Id = a.ConversionId
    WHERE a.SourceSOID = l.SourceSOID AND a.SourceListNo = l.SourceListNo AND c.Status <> 'VOID'
) v;
GO
