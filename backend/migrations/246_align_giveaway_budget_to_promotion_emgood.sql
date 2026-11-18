-- ============================================================================
-- Migration 246: Align Giveaway Budget & Withdrawals to dbo.EMGood (GoodGroupID = 1005)
-- Resolves discrepancy between giveaway quota table and 98 master giveaway items (FR-011/UAT)
-- Safe to re-run (idempotent)
-- ============================================================================

-- 1. Backfill GoodId, GoodCode, GoodName, ItemName on wf.GiveawayBudget from dbo.EMGood (GoodGroupID = 1005)
-- Priority 1: Match on chemical formula inside merchandise bags (e.g. '13-3-21' -> 'กระเป๋า สูตร 13-3-21 ตราเกษตร')
UPDATE b
SET b.GoodId   = CAST(g.GoodID AS VARCHAR(50)),
    b.GoodCode = g.GoodCode,
    b.GoodName = g.GoodName1,
    b.ItemName = g.GoodName1
FROM wf.GiveawayBudget b
CROSS APPLY (
  SELECT TOP 1 g.GoodID, g.GoodCode, g.GoodName1
  FROM dbo.EMGood g WITH (NOLOCK)
  WHERE g.GoodGroupID = 1005
    AND (
      g.GoodName1 LIKE N'%สูตร ' + b.ItemName + N' %'
      OR g.GoodName1 LIKE N'%' + b.ItemName + N'%'
    )
  ORDER BY
    CASE WHEN g.GoodName1 LIKE N'%สูตร ' + b.ItemName + N' %' THEN 0 ELSE 1 END,
    g.GoodCode ASC
) g
WHERE b.GoodId IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM dbo.EMGood eg WITH (NOLOCK)
     WHERE CAST(eg.GoodID AS VARCHAR(50)) = CAST(b.GoodId AS VARCHAR(50))
       AND eg.GoodGroupID = 1005
   );
GO

-- Priority 2: Fix typos such as 'แบบเนอร์ดราเกษตร' -> 'แบนเนอร์ตราเกษตร'
UPDATE b
SET b.GoodId   = CAST(g.GoodID AS VARCHAR(50)),
    b.GoodCode = g.GoodCode,
    b.GoodName = g.GoodName1,
    b.ItemName = g.GoodName1
FROM wf.GiveawayBudget b
CROSS APPLY (
  SELECT TOP 1 g.GoodID, g.GoodCode, g.GoodName1
  FROM dbo.EMGood g WITH (NOLOCK)
  WHERE g.GoodGroupID = 1005
    AND (
      (b.ItemName LIKE N'%แบบเนอร์%' AND g.GoodName1 LIKE N'%แบนเนอร์%')
      OR (b.ItemName LIKE N'%เสื้อ%' AND g.GoodName1 LIKE N'%เสื้อ%')
    )
  ORDER BY g.GoodCode ASC
) g
WHERE b.GoodId IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM dbo.EMGood eg WITH (NOLOCK)
     WHERE CAST(eg.GoodID AS VARCHAR(50)) = CAST(b.GoodId AS VARCHAR(50))
       AND eg.GoodGroupID = 1005
   );
GO

-- 2. Backfill GoodId, GoodCode, GoodName, ItemName on wf.GiveawayWithdrawal from dbo.EMGood (GoodGroupID = 1005)
UPDATE w
SET w.GoodId   = CAST(g.GoodID AS VARCHAR(50)),
    w.GoodCode = g.GoodCode,
    w.GoodName = g.GoodName1,
    w.ItemName = g.GoodName1
FROM wf.GiveawayWithdrawal w
CROSS APPLY (
  SELECT TOP 1 g.GoodID, g.GoodCode, g.GoodName1
  FROM dbo.EMGood g WITH (NOLOCK)
  WHERE g.GoodGroupID = 1005
    AND (
      g.GoodName1 LIKE N'%สูตร ' + w.ItemName + N' %'
      OR g.GoodName1 LIKE N'%' + w.ItemName + N'%'
      OR (w.ItemName LIKE N'%แบบเนอร์%' AND g.GoodName1 LIKE N'%แบนเนอร์%')
    )
  ORDER BY
    CASE WHEN g.GoodName1 LIKE N'%สูตร ' + w.ItemName + N' %' THEN 0 ELSE 1 END,
    g.GoodCode ASC
) g
WHERE w.GoodId IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM dbo.EMGood eg WITH (NOLOCK)
     WHERE CAST(eg.GoodID AS VARCHAR(50)) = CAST(w.GoodId AS VARCHAR(50))
       AND eg.GoodGroupID = 1005
   );
GO

-- 3. Recreate wf.v_GiveawayBudgetStatus ensuring GoodName and GoodCode always resolve to dbo.EMGood Group 1005
IF OBJECT_ID(N'wf.v_GiveawayBudgetStatus', N'V') IS NULL
  EXEC(N'CREATE VIEW wf.v_GiveawayBudgetStatus AS SELECT 1 AS dummy');
GO

ALTER VIEW wf.v_GiveawayBudgetStatus AS
SELECT b.Id,
       b.SalesUserId,
       b.EmpId,
       b.EmpCode,
       b.Region,
       b.RegionCode,
       b.PeriodYear,
       b.Brand,
       COALESCE(g.GoodName1, b.GoodName, b.ItemName) AS ItemName,
       COALESCE(b.GoodId, CAST(g.GoodID AS VARCHAR(50))) AS GoodId,
       COALESCE(g.GoodCode, b.GoodCode) AS GoodCode,
       COALESCE(g.GoodName1, b.GoodName, b.ItemName) AS GoodName,
       b.BudgetQty,
       ISNULL(w.Withdrawn, 0)               AS WithdrawnQty,
       b.BudgetQty - ISNULL(w.Withdrawn, 0) AS RemainingQty
FROM wf.GiveawayBudget b
LEFT JOIN dbo.EMGood g WITH (NOLOCK)
  ON CAST(g.GoodID AS VARCHAR(50)) = CAST(b.GoodId AS VARCHAR(50))
 AND g.GoodGroupID = 1005
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

PRINT '✓ Migration 246 complete (Giveaway budget & withdrawals aligned to dbo.EMGood Group 1005)';
GO
