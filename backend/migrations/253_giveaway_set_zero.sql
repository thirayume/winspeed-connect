-- @transaction
-- ============================================================================
-- 253_giveaway_set_zero.sql
-- Owner, 20 Nov 2026: "Set Zero" for giveaways, Sale-App only (WinSpeed unchanged), the same on PROD and UAT, and
-- repeatable (giveaways move fully into Sale-App after 31/12/2569 and may be zeroed again that day).
-- Meaning approved by the owner: budgets stay; the used quantity counts again from the moment of the latest
-- Set Zero; withdrawal history stays and is still listed.
--  1. wf.GiveawayZeroLog keeps every Set Zero (UTC moment, note, who). The latest one counts.
--  2. wf.v_GiveawayBudgetStatus counts only withdrawals saved at or after that moment. The rest of the view is
--     migration 249's (aliased older goods still count against their group-1005 twin).
-- Nothing is deleted. Rollback: down/ restores 249's view and drops the log.
-- SQL Server 2008 R2, compatibility 80.
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('wf.GiveawayZeroLog', 'U') IS NULL
    CREATE TABLE wf.GiveawayZeroLog (
        Id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_GiveawayZeroLog PRIMARY KEY,
        ZeroAt    DATETIME2      NOT NULL,
        Note      NVARCHAR(500)  NULL,
        ActorId   INT            NULL,
        CreatedAt DATETIME2      NOT NULL CONSTRAINT DF_GiveawayZeroLog_CreatedAt DEFAULT GETUTCDATE()
    );
GO

ALTER VIEW wf.v_GiveawayBudgetStatus AS
SELECT b.Id, b.SalesUserId, b.EmpId, b.EmpCode, b.Region, b.RegionCode, b.PeriodYear,
       b.Brand, b.ItemName, b.GoodId, b.GoodCode, b.GoodName, b.BudgetQty,
       ISNULL(w.Withdrawn, 0)                AS WithdrawnQty,
       b.BudgetQty - ISNULL(w.Withdrawn, 0)  AS RemainingQty
FROM wf.GiveawayBudget b
OUTER APPLY (
  SELECT SUM(Qty) AS Withdrawn FROM wf.GiveawayWithdrawal w
  WHERE w.Region = b.Region AND w.PeriodYear = b.PeriodYear
    -- Set Zero (migration 253): count from the latest wf.GiveawayZeroLog moment
    AND w.CreatedAt >= ISNULL((SELECT MAX(z.ZeroAt) FROM wf.GiveawayZeroLog z), CONVERT(DATETIME2, '1900-01-01'))
    AND (
      (b.SalesUserId IS NOT NULL AND w.SalesUserId = b.SalesUserId)
      OR (b.SalesUserId IS NOT NULL AND w.SalesUserId IS NULL)
      OR (b.SalesUserId IS NULL)
    )
    AND (
      (b.GoodId IS NOT NULL AND w.GoodId IS NOT NULL
        AND (w.GoodId = b.GoodId
             OR EXISTS (SELECT 1 FROM wf.GiveawayGoodAlias ga WHERE ga.OldGoodId = w.GoodId AND ga.NewGoodId = b.GoodId)))
      OR ((b.GoodId IS NULL OR w.GoodId IS NULL) AND w.Brand = b.Brand AND w.ItemName = b.ItemName)
    )
) w;
GO
