-- Rollback of 253: the budget view of migration 249 (every withdrawal counts again) and no Set Zero log.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
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
IF OBJECT_ID('wf.GiveawayZeroLog', 'U') IS NOT NULL DROP TABLE wf.GiveawayZeroLog;
GO
