-- @transaction
-- Additive annual-budget workspace metadata. No dbo, Rebate or quota writes.
IF COL_LENGTH('wf.BudgetPlan','DocumentJson') IS NULL ALTER TABLE wf.BudgetPlan ADD DocumentJson NVARCHAR(MAX) NULL;
IF COL_LENGTH('wf.BudgetPlan','DeletedAt') IS NULL ALTER TABLE wf.BudgetPlan ADD DeletedAt DATETIME2 NULL;
IF COL_LENGTH('wf.BudgetPlan','DeletedBy') IS NULL ALTER TABLE wf.BudgetPlan ADD DeletedBy INT NULL REFERENCES wf.AppUser(Id);
IF COL_LENGTH('wf.PromotionBudgetLine','ProjectKey') IS NULL ALTER TABLE wf.PromotionBudgetLine ADD ProjectKey NVARCHAR(50) NULL;
GO
