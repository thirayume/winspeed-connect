-- ============================================================================
-- Migration 188: Giveaway Budget Link to Master 98 Giveaway Goods, Org Regions & Salesperson CRUD
-- - Adds GoodId, GoodCode, GoodName, RegionCode to wf.GiveawayBudget
-- - Adds GoodId, GoodCode, GoodName to wf.GiveawayWithdrawal
-- - Drops legacy single-per-region UQ_GBudget so multiple salespeople in the same
--   region and specific EMGood (GoodGroupID = 1005) items can have independent quotas
-- - Recreates wf.v_GiveawayBudgetStatus cleanly (SQL Server 2008 R2+ compatible)
-- ============================================================================

IF COL_LENGTH('wf.GiveawayBudget', 'GoodId') IS NULL
  ALTER TABLE wf.GiveawayBudget ADD GoodId VARCHAR(50) NULL;
GO
IF COL_LENGTH('wf.GiveawayBudget', 'GoodCode') IS NULL
  ALTER TABLE wf.GiveawayBudget ADD GoodCode NVARCHAR(50) NULL;
GO
IF COL_LENGTH('wf.GiveawayBudget', 'GoodName') IS NULL
  ALTER TABLE wf.GiveawayBudget ADD GoodName NVARCHAR(200) NULL;
GO
IF COL_LENGTH('wf.GiveawayBudget', 'RegionCode') IS NULL
  ALTER TABLE wf.GiveawayBudget ADD RegionCode VARCHAR(10) NULL;
GO

IF COL_LENGTH('wf.GiveawayWithdrawal', 'GoodId') IS NULL
  ALTER TABLE wf.GiveawayWithdrawal ADD GoodId VARCHAR(50) NULL;
GO
IF COL_LENGTH('wf.GiveawayWithdrawal', 'GoodCode') IS NULL
  ALTER TABLE wf.GiveawayWithdrawal ADD GoodCode NVARCHAR(50) NULL;
GO
IF COL_LENGTH('wf.GiveawayWithdrawal', 'GoodName') IS NULL
  ALTER TABLE wf.GiveawayWithdrawal ADD GoodName NVARCHAR(200) NULL;
GO

IF EXISTS (
  SELECT 1
  FROM sys.key_constraints
  WHERE name = N'UQ_GBudget'
    AND parent_object_id = OBJECT_ID(N'wf.GiveawayBudget')
)
  ALTER TABLE wf.GiveawayBudget DROP CONSTRAINT UQ_GBudget;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_GBudget_RegionUserGood'
    AND object_id = OBJECT_ID(N'wf.GiveawayBudget')
)
  CREATE INDEX IX_GBudget_RegionUserGood
    ON wf.GiveawayBudget (Region, PeriodYear, SalesUserId, GoodId);
GO

-- Backfill RegionCode onto existing GiveawayBudget rows where missing
IF OBJECT_ID(N'wf.SaleRegion', N'U') IS NOT NULL
BEGIN
  UPDATE b
  SET b.RegionCode = COALESCE(
    b.RegionCode,
    r.RegionCode,
    CASE
      WHEN b.Region IN (N'ภาคกลาง', N'ภาคกลาง-ตะวันตก') THEN '02'
      WHEN b.Region = N'ภาคเหนือ' THEN '04'
      WHEN b.Region = N'ภาคใต้' THEN '05'
      WHEN b.Region = N'ภาคตะวันออก' THEN '06'
      WHEN b.Region = N'ภาคอีสานบน' THEN '10'
      WHEN b.Region = N'ภาคอีสานกลาง' THEN '11'
      WHEN b.Region = N'ภาคอีสานล่าง' THEN '12'
      WHEN b.Region = N'ภาคปุ๋ยเทพ 1' THEN '13'
      WHEN b.Region = N'ภาคปุ๋ยเทพ 2' THEN '14'
      WHEN b.Region = N'โรงงานและหน่วยงานราชการ' THEN '15'
      WHEN b.Region = N'เคาน์เตอร์เซลล์' THEN '16'
      ELSE NULL
    END
  )
  FROM wf.GiveawayBudget b
  LEFT JOIN wf.SaleRegion r ON r.RegionName = b.Region
  WHERE b.RegionCode IS NULL;
END;
GO

-- Best-effort backfill GoodId from wf.GiveawayItemMapping where single unambiguous match exists
IF OBJECT_ID(N'wf.GiveawayItemMapping', N'U') IS NOT NULL
BEGIN
  UPDATE b
  SET b.GoodId = m.GoodID
  FROM wf.GiveawayBudget b
  CROSS APPLY (
    SELECT TOP 1 mm.GoodID
    FROM wf.GiveawayItemMapping mm
    WHERE ISNUMERIC(mm.Brand) = 0
      AND mm.ItemName = b.ItemName
      AND (mm.Brand = b.Brand OR mm.Brand LIKE N'%' + b.Brand + N'%' OR b.Brand LIKE N'%' + mm.Brand + N'%')
    ORDER BY mm.Id ASC
  ) m
  WHERE b.GoodId IS NULL;
END;
GO

IF OBJECT_ID(N'wf.v_GiveawayBudgetStatus', N'V') IS NULL
  EXEC(N'CREATE VIEW wf.v_GiveawayBudgetStatus AS SELECT 1 AS dummy');
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

