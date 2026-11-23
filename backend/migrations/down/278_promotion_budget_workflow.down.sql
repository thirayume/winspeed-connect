-- @transaction
-- Never discard an annual plan or its signature history.
IF EXISTS(SELECT 1 FROM wf.PromotionBudgetLine)
 OR EXISTS(SELECT 1 FROM wf.PromotionBudgetAllocation)
 OR EXISTS(SELECT 1 FROM wf.ChangeEvent WHERE EntityType='PROMOTION_BUDGET')
BEGIN RAISERROR('PROMOTION_BUDGET_HISTORY_PREVENTS_DOWN',16,1);RETURN;END;
DELETE r FROM wf.RolePermission r JOIN wf.PromotionBudgetPermissionSeed s ON s.RoleCode=r.RoleCode AND s.PermissionCode=r.PermissionCode;
DROP TABLE wf.PromotionBudgetPermissionSeed;
DROP TABLE wf.PromotionBudgetLine;
DROP TABLE wf.PromotionBudgetAllocation;
-- Retain additive nullable signature/assignment columns and revision to avoid altering legacy plans.
GO
