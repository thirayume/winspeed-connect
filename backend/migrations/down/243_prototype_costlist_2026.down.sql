IF OBJECT_ID('wf.CostBookLine', 'U') IS NOT NULL AND OBJECT_ID('wf.CostBook', 'U') IS NOT NULL
BEGIN
    DELETE FROM wf.CostBookLine 
    WHERE CostBookId IN (
        SELECT Id FROM wf.CostBook 
        WHERE EffectiveFrom = '2026-01-01' AND EffectiveTo = '2026-12-31'
    );

    DELETE FROM wf.CostBook 
    WHERE EffectiveFrom = '2026-01-01' AND EffectiveTo = '2026-12-31';
END
GO
