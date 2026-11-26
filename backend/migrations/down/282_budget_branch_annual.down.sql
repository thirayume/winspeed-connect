-- @transaction
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- A downgrade must never erase branch ownership or silently merge annual plans.
IF COL_LENGTH('wf.BudgetPlan','BranchPositionCode') IS NULL RETURN;
DECLARE @hasBranch bit;SET @hasBranch=0;
EXEC sp_executesql N'IF EXISTS(SELECT 1 FROM wf.BudgetPlan WHERE BranchPositionCode IS NOT NULL) SET @found=1',N'@found bit OUTPUT',@found=@hasBranch OUTPUT;
IF @hasBranch=1 BEGIN RAISERROR('ROLLBACK_BUDGET_BRANCH_DATA_REQUIRES_REVIEW',16,1);RETURN;END;
IF EXISTS(SELECT PeriodYear,Channel FROM wf.BudgetPlan GROUP BY PeriodYear,Channel HAVING COUNT(*)>1)
BEGIN RAISERROR('ROLLBACK_BUDGET_BRANCH_DUPLICATE_YEAR_CHANNEL',16,1);RETURN;END;
DROP FUNCTION wf.fn_IsUserAbovePosition;
ALTER TABLE wf.BudgetPlan DROP CONSTRAINT UQ_BudgetPlan_Branch;
ALTER TABLE wf.BudgetPlan DROP CONSTRAINT FK_BudgetPlan_Branch;
ALTER TABLE wf.BudgetPlan DROP COLUMN BranchPositionCode;
ALTER TABLE wf.BudgetPlan ADD CONSTRAINT UQ_BudgetPlan UNIQUE(PeriodYear,Channel);
GO
