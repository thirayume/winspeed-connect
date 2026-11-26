-- @transaction
-- Owner: one annual plan per organization branch; company reports roll up plans.
-- Preserve legacy NULL ownership. Never infer staff/branch assignments.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('wf.BudgetPlan','BranchPositionCode') IS NULL
 ALTER TABLE wf.BudgetPlan ADD BranchPositionCode varchar(30) NULL;
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('wf.BudgetPlan') AND name='FK_BudgetPlan_Branch')
 EXEC(N'ALTER TABLE wf.BudgetPlan ADD CONSTRAINT FK_BudgetPlan_Branch FOREIGN KEY(BranchPositionCode) REFERENCES wf.OrgPosition(PositionCode)');
DECLARE @duplicate bit;SET @duplicate=0;
EXEC sp_executesql N'IF EXISTS(SELECT CASE WHEN PeriodYear>=2400 THEN PeriodYear-543 ELSE PeriodYear END,Channel,BranchPositionCode FROM wf.BudgetPlan GROUP BY CASE WHEN PeriodYear>=2400 THEN PeriodYear-543 ELSE PeriodYear END,Channel,BranchPositionCode HAVING COUNT(*)>1) SET @found=1',N'@found bit OUTPUT',@found=@duplicate OUTPUT;
IF @duplicate=1 BEGIN RAISERROR('BUDGET_BRANCH_NORMALIZED_YEAR_DUPLICATE',16,1);RETURN;END;
IF EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID('wf.BudgetPlan') AND name='UQ_BudgetPlan')
 ALTER TABLE wf.BudgetPlan DROP CONSTRAINT UQ_BudgetPlan;
IF NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID('wf.BudgetPlan') AND name='UQ_BudgetPlan_Branch')
 EXEC(N'ALTER TABLE wf.BudgetPlan ADD CONSTRAINT UQ_BudgetPlan_Branch UNIQUE(PeriodYear,Channel,BranchPositionCode)');
GO
IF OBJECT_ID('wf.fn_IsUserAbovePosition','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_IsUserAbovePosition(@supervisor int,@branch varchar(30)) RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_IsUserAbovePosition(@supervisor int,@branch varchar(30)) RETURNS bit AS
BEGIN
 DECLARE @position varchar(30),@parent varchar(30),@depth int;SET @depth=0;
 SELECT @position=u.PositionCode FROM wf.AppUser u JOIN wf.OrgPosition p ON p.PositionCode=u.PositionCode
  WHERE u.Id=@supervisor AND u.IsActive=1 AND p.IsActive=1 AND p.CanApprove=1;
 IF @position IS NULL RETURN 0;
 SELECT @parent=ReportsTo FROM wf.OrgPosition WHERE PositionCode=@branch AND IsActive=1;
 DECLARE @seen TABLE(PositionCode varchar(30) PRIMARY KEY);
 WHILE @parent IS NOT NULL AND @depth<32
 BEGIN
  IF EXISTS(SELECT 1 FROM @seen WHERE PositionCode=@parent) RETURN 0;
  IF NOT EXISTS(SELECT 1 FROM wf.OrgPosition WHERE PositionCode=@parent AND IsActive=1) RETURN 0;
  IF @parent=@position RETURN 1;
  INSERT @seen VALUES(@parent);
  SELECT @parent=ReportsTo FROM wf.OrgPosition WHERE PositionCode=@parent;
  SET @depth=@depth+1;
 END;
 RETURN 0;
END;
GO
