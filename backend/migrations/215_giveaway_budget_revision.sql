-- @transaction
-- SQL Server 2008 R2 compatible. This migration creates no business rows.
-- A rowversion prevents stale form ABA; withdrawal changes touch every budget
-- in the affected region/year so even an insert followed by a delete advances it.
IF OBJECT_ID(N'wf.GiveawayBudget', N'U') IS NULL OR OBJECT_ID(N'wf.GiveawayWithdrawal', N'U') IS NULL
  RAISERROR('Giveaway tables are required', 16, 1);
ELSE IF COL_LENGTH('wf.GiveawayBudget', 'EditVersion') IS NULL
  ALTER TABLE wf.GiveawayBudget ADD EditVersion rowversion;
GO
IF OBJECT_ID(N'wf.tr_GiveawayWithdrawal_BudgetVersion', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER wf.tr_GiveawayWithdrawal_BudgetVersion ON wf.GiveawayWithdrawal AFTER INSERT, UPDATE, DELETE AS BEGIN SET NOCOUNT ON; END');
GO
ALTER TRIGGER wf.tr_GiveawayWithdrawal_BudgetVersion ON wf.GiveawayWithdrawal
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE b SET UpdatedAt = b.UpdatedAt
  FROM wf.GiveawayBudget AS b
  WHERE EXISTS (
    SELECT 1 FROM inserted AS i WHERE i.Region = b.Region AND i.PeriodYear = b.PeriodYear
    UNION ALL
    SELECT 1 FROM deleted AS d WHERE d.Region = b.Region AND d.PeriodYear = b.PeriodYear
  );
END;
GO
