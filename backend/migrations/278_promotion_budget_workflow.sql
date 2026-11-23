-- @transaction
-- Annual promotion budgets are distinct from Rebate and piece quotas. No dbo writes.
IF COL_LENGTH('wf.BudgetPlan','EditVersion') IS NULL ALTER TABLE wf.BudgetPlan ADD EditVersion INT NOT NULL CONSTRAINT DF_PromotionBudgetVersion DEFAULT 1;
IF COL_LENGTH('wf.BudgetPlan','AssignedReviewerId') IS NULL ALTER TABLE wf.BudgetPlan ADD AssignedReviewerId INT NULL REFERENCES wf.AppUser(Id);
IF COL_LENGTH('wf.BudgetPlan','AssignedApproverId') IS NULL ALTER TABLE wf.BudgetPlan ADD AssignedApproverId INT NULL REFERENCES wf.AppUser(Id);
IF COL_LENGTH('wf.BudgetPlan','PreparedActorId') IS NULL ALTER TABLE wf.BudgetPlan ADD PreparedActorId INT NULL REFERENCES wf.AppUser(Id);
IF COL_LENGTH('wf.BudgetPlan','ReviewedActorId') IS NULL ALTER TABLE wf.BudgetPlan ADD ReviewedActorId INT NULL REFERENCES wf.AppUser(Id);
IF COL_LENGTH('wf.BudgetPlan','ApprovedActorId') IS NULL ALTER TABLE wf.BudgetPlan ADD ApprovedActorId INT NULL REFERENCES wf.AppUser(Id);
GO
IF OBJECT_ID('wf.PromotionBudgetLine','U') IS NULL
CREATE TABLE wf.PromotionBudgetLine (
 LineId INT IDENTITY(1,1) PRIMARY KEY,PlanId INT NOT NULL REFERENCES wf.BudgetPlan(PlanId),
 SortOrder INT NOT NULL,Region NVARCHAR(100) NOT NULL,Category NVARCHAR(100) NOT NULL,
 ItemName NVARCHAR(200) NOT NULL,Quantity DECIMAL(18,4) NULL,UnitPrice DECIMAL(18,2) NULL,
 Amount DECIMAL(18,2) NOT NULL,Note NVARCHAR(500) NULL,
 CONSTRAINT CK_PromotionBudgetAmount CHECK(Amount>=0 AND (Quantity IS NULL OR Quantity>=0) AND (UnitPrice IS NULL OR UnitPrice>=0)),
 CONSTRAINT UQ_PromotionBudgetSort UNIQUE(PlanId,SortOrder)
);
GO
IF OBJECT_ID('wf.PromotionBudgetPermissionSeed','U') IS NULL
CREATE TABLE wf.PromotionBudgetPermissionSeed(RoleCode NVARCHAR(50) NOT NULL,PermissionCode NVARCHAR(100) NOT NULL,PRIMARY KEY(RoleCode,PermissionCode));
GO
IF OBJECT_ID('wf.PromotionBudgetAllocation','U') IS NULL
CREATE TABLE wf.PromotionBudgetAllocation (
 PlanId INT NOT NULL REFERENCES wf.BudgetPlan(PlanId),Region NVARCHAR(100) NOT NULL,
 Amount DECIMAL(18,2) NOT NULL CHECK(Amount>=0),PRIMARY KEY(PlanId,Region)
);
GO
INSERT INTO wf.PromotionBudgetPermissionSeed(RoleCode,PermissionCode)
SELECT p.Code,a.PermissionCode FROM wf.RoleProfile p
JOIN (SELECT 'budget.plan.create' PermissionCode,'SALES' BaseRole UNION ALL SELECT 'budget.plan.create','COUNTER_SALES'
 UNION ALL SELECT 'budget.plan.create','ACCOUNTING' UNION ALL SELECT 'budget.plan.create','MANAGER' UNION ALL SELECT 'budget.plan.create','C_LEVEL'
 UNION ALL SELECT 'budget.plan.create','ADMIN' UNION ALL SELECT 'budget.plan.review','MANAGER' UNION ALL SELECT 'budget.plan.review','ADMIN'
 UNION ALL SELECT 'budget.plan.approve','C_LEVEL' UNION ALL SELECT 'budget.plan.approve','ADMIN') a ON a.BaseRole=p.BaseRole
WHERE NOT EXISTS(SELECT 1 FROM wf.RolePermission r WHERE r.RoleCode=p.Code AND r.PermissionCode=a.PermissionCode)
 AND NOT EXISTS(SELECT 1 FROM wf.PromotionBudgetPermissionSeed s WHERE s.RoleCode=p.Code AND s.PermissionCode=a.PermissionCode);
INSERT INTO wf.RolePermission(RoleCode,PermissionCode)
SELECT s.RoleCode,s.PermissionCode FROM wf.PromotionBudgetPermissionSeed s
WHERE NOT EXISTS(SELECT 1 FROM wf.RolePermission r WHERE r.RoleCode=s.RoleCode AND r.PermissionCode=s.PermissionCode);
GO
