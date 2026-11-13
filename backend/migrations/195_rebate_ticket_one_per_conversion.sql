-- Exactly one ticket per conversion. Do not rewrite or delete historic rows.
IF EXISTS (SELECT ConversionId FROM wf.FertilizerTicket WHERE ConversionId IS NOT NULL
           GROUP BY ConversionId HAVING COUNT_BIG(*) > 1)
BEGIN
  RAISERROR('Duplicate fertilizer tickets for a conversion require manual reconciliation',16,1);
END;
ELSE IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.FertilizerTicket')
                    AND name='UX_FertilizerTicket_ConversionId')
  CREATE UNIQUE INDEX UX_FertilizerTicket_ConversionId ON wf.FertilizerTicket(ConversionId)
    WHERE ConversionId IS NOT NULL;
GO
