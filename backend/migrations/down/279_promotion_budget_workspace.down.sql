-- @transaction
-- Refuse to discard saved projects, deletion evidence or keyed estimate lines.
IF EXISTS(SELECT 1 FROM wf.BudgetPlan WHERE DocumentJson IS NOT NULL OR DeletedAt IS NOT NULL)
 OR EXISTS(SELECT 1 FROM wf.PromotionBudgetLine WHERE ProjectKey IS NOT NULL)
BEGIN RAISERROR('PROMOTION_BUDGET_WORKSPACE_HISTORY_PREVENTS_DOWN',16,1);RETURN;END;
-- Keep additive nullable columns: no history or schema is destructively removed.
GO
