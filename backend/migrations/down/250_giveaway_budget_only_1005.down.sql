-- Rollback of 250: put the removed quota lines back with their original Id, unlink the linked lines, and drop
-- the log. Uses wf.GiveawayBudgetCleanupLog, which 250 wrote. The change events stay as history.
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
BEGIN TRANSACTION;
IF OBJECT_ID('wf.GiveawayBudgetCleanupLog', 'U') IS NOT NULL
BEGIN
    SET IDENTITY_INSERT wf.GiveawayBudget ON;
    INSERT INTO wf.GiveawayBudget (Id, SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty,
        CreatedAt, UpdatedAt, BudgetAmt, PlanSection, PlanId, Channel, GoodId, GoodCode, GoodName, RegionCode)
    SELECT l.BudgetId, l.SalesUserId, l.EmpId, l.EmpCode, l.Region, l.PeriodYear, l.Brand, l.ItemName, l.BudgetQty,
        l.BudgetCreatedAt, l.BudgetUpdatedAt, l.BudgetAmt, l.PlanSection, l.PlanId, l.Channel, l.GoodId, l.GoodCode, l.GoodName, l.RegionCode
    FROM wf.GiveawayBudgetCleanupLog l
    WHERE l.Migration = '250' AND l.Kind = 'REMOVED'
      AND NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget b WHERE b.Id = l.BudgetId);
    SET IDENTITY_INSERT wf.GiveawayBudget OFF;

    UPDATE b SET b.GoodId = l.GoodId, b.GoodCode = l.GoodCode, b.GoodName = l.GoodName, b.UpdatedAt = l.BudgetUpdatedAt
    FROM wf.GiveawayBudget b
    JOIN wf.GiveawayBudgetCleanupLog l ON l.Migration = '250' AND l.Kind = 'LINKED' AND l.BudgetId = b.Id
    WHERE b.GoodId = l.NewGoodId;

    DROP TABLE wf.GiveawayBudgetCleanupLog;
END;
COMMIT TRANSACTION;
GO
