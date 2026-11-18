-- @transaction
-- Migration 243 created the 2569 prototype cost list (70% of the price list) as ACTIVE. It was the only cost list,
-- so the below-cost check (services/cost-authority.js) started judging sales prices against invented costs, and
-- 88 of its 159 lines have no cost at all (review, 18 Nov 2026). It goes back to DRAFT: accounting fills in real
-- costs and activates it from the Costlist screen. A book anyone has already acted on (an audit row) is left alone.
IF OBJECT_ID('wf.CostBook', 'U') IS NOT NULL AND OBJECT_ID('wf.CostBookAudit', 'U') IS NOT NULL
BEGIN
    DECLARE @Prototype TABLE (Id INT PRIMARY KEY);

    INSERT INTO @Prototype (Id)
    SELECT cb.Id
    FROM wf.CostBook cb WITH (UPDLOCK, HOLDLOCK)
    WHERE cb.Status = 'ACTIVE'
      AND cb.EffectiveFrom = '2026-01-01' AND cb.EffectiveTo = '2026-12-31'
      AND cb.Name = N'ตารางราคาทุนต้นแบบ พ.ศ. 2569 (70% Pricelist)'
      AND NOT EXISTS (SELECT 1 FROM wf.CostBookAudit a WHERE a.CostBookId = cb.Id);

    UPDATE cb
    SET Status = 'DRAFT', UpdatedAt = GETUTCDATE()
    FROM wf.CostBook cb
    JOIN @Prototype p ON p.Id = cb.Id;

    INSERT INTO wf.CostBookAudit (CostBookId, Action, FromStatus, ToStatus, ByUser, Note)
    SELECT p.Id, 'MIGRATION_247', 'ACTIVE', 'DRAFT', NULL,
           N'ต้นแบบ 70% ยังไม่ใช่ราคาทุนจริง: เป็นฉบับร่างจนกว่าบัญชีจะตรวจและเปิดใช้'
    FROM @Prototype p;
END;
