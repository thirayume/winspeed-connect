-- Rollback of 249: put budget lines back on the goods they had, remove the mapping rows 249 added, restore the
-- budget view of migration 188 and drop the alias table. Uses wf.GiveawayAlignLog, which 249 wrote.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('wf.GiveawayAlignLog', 'U') IS NOT NULL
BEGIN
    UPDATE b SET b.GoodId = l.OldGoodId, b.GoodCode = l.OldGoodCode, b.GoodName = l.OldGoodName
    FROM wf.GiveawayBudget b
    JOIN wf.GiveawayAlignLog l ON l.Migration = '249' AND l.Kind = 'BUDGET_RELINKED' AND l.RefId = CONVERT(VARCHAR(50), b.Id)
    WHERE b.GoodId = l.NewGoodId;
    DELETE m FROM wf.GiveawayItemMapping m
    JOIN wf.GiveawayAlignLog l ON l.Migration = '249' AND l.Kind = 'MAPPING_ADDED' AND l.RefId = CONVERT(VARCHAR(50), m.Id);
    DELETE FROM wf.GiveawayAlignLog WHERE Migration = '249';
END;
COMMIT TRANSACTION;
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
      (b.GoodId IS NOT NULL AND w.GoodId IS NOT NULL AND w.GoodId = b.GoodId)
      OR ((b.GoodId IS NULL OR w.GoodId IS NULL) AND w.Brand = b.Brand AND w.ItemName = b.ItemName)
    )
) w;
GO
IF OBJECT_ID('wf.GiveawayGoodAlias', 'U') IS NOT NULL DROP TABLE wf.GiveawayGoodAlias;
GO
