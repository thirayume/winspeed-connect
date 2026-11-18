-- Rollback of 245: the prototype cost list that 245 moved to DRAFT becomes ACTIVE again.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('wf.CostBook', 'U') IS NOT NULL AND OBJECT_ID('wf.CostBookAudit', 'U') IS NOT NULL
BEGIN
    DECLARE @Moved TABLE (Id INT PRIMARY KEY);

    -- Only books 245 itself moved and that nobody has acted on since.
    INSERT INTO @Moved (Id)
    SELECT cb.Id
    FROM wf.CostBook cb WITH (UPDLOCK, HOLDLOCK)
    WHERE cb.Status = 'DRAFT'
      AND EXISTS (SELECT 1 FROM wf.CostBookAudit a WHERE a.CostBookId = cb.Id AND a.Action = 'MIGRATION_245')
      AND NOT EXISTS (SELECT 1 FROM wf.CostBookAudit a WHERE a.CostBookId = cb.Id AND a.Action <> 'MIGRATION_245');

    UPDATE cb SET Status = 'ACTIVE', UpdatedAt = GETUTCDATE()
    FROM wf.CostBook cb JOIN @Moved m ON m.Id = cb.Id;

    DELETE a FROM wf.CostBookAudit a JOIN @Moved m ON m.Id = a.CostBookId WHERE a.Action = 'MIGRATION_245';
END;
COMMIT TRANSACTION;
