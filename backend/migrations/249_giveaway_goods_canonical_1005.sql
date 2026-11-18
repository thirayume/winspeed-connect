-- @transaction
-- ============================================================================
-- 249_giveaway_goods_canonical_1005.sql
-- Owner, 18 Nov 2026: giveaways refer to the WinSpeed goods of group 1005 (ส่งเสริมการขาย), with no duplicates.
-- Replaces migration 246 (excluded: it re-pointed budgets by fuzzy name and rewrote withdrawal history).
--
-- Found on UAT data the same day: WinSpeed holds 83 older giveaway goods without a group (28xxx) that each have
-- exactly one twin of the same name in group 1005 (31xxx, codes PM…). The quota mapping and the budgets still
-- point at the older goods, so a giveaway picked from group 1005 did not meet its budget.
--
-- What this does, exactly and only:
--  1. wf.GiveawayGoodAlias records each older good → its 1005 twin, where the names are equal (trimmed) and the
--     pair is one-to-one. Nothing is guessed: no LIKE, no partial names.
--  2. The quota mapping (wf.GiveawayItemMapping) gets the same Brand/ItemName for the 1005 twin; the older row
--     stays, so lines saved before still match.
--  3. Budget lines that point at an older good point at its twin (GoodId, GoodCode, GoodName snapshot).
--     Brand and ItemName, the quota key, are not touched.
--  4. Withdrawal history is not touched. wf.v_GiveawayBudgetStatus counts a withdrawal of the older good
--     against the budget of its twin, so used and remaining quantities stay right.
-- Every change is logged in wf.GiveawayAlignLog, which the rollback uses.
-- SQL Server 2008 R2, compatibility 80.
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('wf.GiveawayGoodAlias', 'U') IS NULL
BEGIN
    CREATE TABLE wf.GiveawayGoodAlias (
        OldGoodId VARCHAR(50)  NOT NULL CONSTRAINT PK_GiveawayGoodAlias PRIMARY KEY,
        NewGoodId VARCHAR(50)  NOT NULL,
        Reason    NVARCHAR(200) NOT NULL,
        CreatedAt DATETIME2    NOT NULL CONSTRAINT DF_GiveawayGoodAlias_CreatedAt DEFAULT GETUTCDATE()
    );
    CREATE UNIQUE INDEX UX_GiveawayGoodAlias_New ON wf.GiveawayGoodAlias (NewGoodId);
END;
GO

IF OBJECT_ID('wf.GiveawayAlignLog', 'U') IS NULL
    CREATE TABLE wf.GiveawayAlignLog (
        Id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_GiveawayAlignLog PRIMARY KEY,
        Migration VARCHAR(10)  NOT NULL,
        Kind      VARCHAR(30)  NOT NULL,       -- ALIAS | MAPPING_ADDED | BUDGET_RELINKED
        RefId     VARCHAR(50)  NOT NULL,       -- alias old id, mapping Id, budget Id
        OldGoodId VARCHAR(50)  NULL,
        NewGoodId VARCHAR(50)  NULL,
        OldGoodCode NVARCHAR(100) NULL,
        OldGoodName NVARCHAR(200) NULL,
        CreatedAt DATETIME2    NOT NULL CONSTRAINT DF_GiveawayAlignLog_CreatedAt DEFAULT GETUTCDATE()
    );
GO

-- 1. one-to-one exact-name pairs: older good without a group → giveaway good of group 1005
DECLARE @pairs TABLE (OldGoodId VARCHAR(50) PRIMARY KEY, NewGoodId VARCHAR(50) NOT NULL);
INSERT INTO @pairs (OldGoodId, NewGoodId)
SELECT CONVERT(VARCHAR(50), o.GoodID), CONVERT(VARCHAR(50), n.GoodID)
FROM dbo.EMGood o
JOIN dbo.EMGood n ON n.GoodGroupID = 1005 AND LTRIM(RTRIM(n.GoodName1)) = LTRIM(RTRIM(o.GoodName1))
WHERE o.GoodGroupID IS NULL
  AND LTRIM(RTRIM(ISNULL(o.GoodName1, ''))) <> ''
  AND (SELECT COUNT(*) FROM dbo.EMGood n2 WHERE n2.GoodGroupID = 1005 AND LTRIM(RTRIM(n2.GoodName1)) = LTRIM(RTRIM(o.GoodName1))) = 1
  AND (SELECT COUNT(*) FROM dbo.EMGood o2 WHERE o2.GoodGroupID IS NULL AND LTRIM(RTRIM(o2.GoodName1)) = LTRIM(RTRIM(n.GoodName1))) = 1;

INSERT INTO wf.GiveawayGoodAlias (OldGoodId, NewGoodId, Reason)
SELECT p.OldGoodId, p.NewGoodId, N'ชื่อตรงกันทุกตัวอักษรกับของแถมกลุ่ม 1005 (migration 249)'
FROM @pairs p
WHERE NOT EXISTS (SELECT 1 FROM wf.GiveawayGoodAlias a WHERE a.OldGoodId = p.OldGoodId)
  AND NOT EXISTS (SELECT 1 FROM wf.GiveawayGoodAlias a WHERE a.NewGoodId = p.NewGoodId);

INSERT INTO wf.GiveawayAlignLog (Migration, Kind, RefId, OldGoodId, NewGoodId)
SELECT '249', 'ALIAS', a.OldGoodId, a.OldGoodId, a.NewGoodId
FROM wf.GiveawayGoodAlias a
WHERE NOT EXISTS (SELECT 1 FROM wf.GiveawayAlignLog l WHERE l.Kind = 'ALIAS' AND l.RefId = a.OldGoodId);

-- 2. the quota mapping: the twin gets the same Brand / ItemName as the older good
IF OBJECT_ID('wf.GiveawayItemMapping', 'U') IS NOT NULL
BEGIN
    DECLARE @added TABLE (Id INT, GoodID VARCHAR(50));
    INSERT INTO wf.GiveawayItemMapping (Brand, ItemName, GoodID)
    OUTPUT inserted.Id, inserted.GoodID INTO @added
    SELECT DISTINCT m.Brand, m.ItemName, a.NewGoodId
    FROM wf.GiveawayItemMapping m
    JOIN wf.GiveawayGoodAlias a ON a.OldGoodId = m.GoodID
    WHERE ISNUMERIC(m.Brand) = 0
      AND NOT EXISTS (SELECT 1 FROM wf.GiveawayItemMapping x WHERE x.GoodID = a.NewGoodId AND x.Brand = m.Brand AND x.ItemName = m.ItemName);
    INSERT INTO wf.GiveawayAlignLog (Migration, Kind, RefId, NewGoodId)
    SELECT '249', 'MAPPING_ADDED', CONVERT(VARCHAR(50), Id), GoodID FROM @added;
END;

-- 3. budget lines that point at an older good point at its twin; Brand / ItemName unchanged
DECLARE @relinked TABLE (Id INT, OldGoodId VARCHAR(50), NewGoodId VARCHAR(50), OldGoodCode NVARCHAR(100), OldGoodName NVARCHAR(200));
UPDATE b
SET b.GoodId = a.NewGoodId, b.GoodCode = RTRIM(n.GoodCode), b.GoodName = RTRIM(n.GoodName1)
OUTPUT inserted.Id, deleted.GoodId, inserted.GoodId, deleted.GoodCode, deleted.GoodName INTO @relinked
FROM wf.GiveawayBudget b
JOIN wf.GiveawayGoodAlias a ON a.OldGoodId = b.GoodId
JOIN dbo.EMGood n ON CONVERT(VARCHAR(50), n.GoodID) = a.NewGoodId;
INSERT INTO wf.GiveawayAlignLog (Migration, Kind, RefId, OldGoodId, NewGoodId, OldGoodCode, OldGoodName)
SELECT '249', 'BUDGET_RELINKED', CONVERT(VARCHAR(50), Id), OldGoodId, NewGoodId, OldGoodCode, OldGoodName FROM @relinked;

INSERT wf.ChangeEvent (EntityType, EntityId, Action, AfterJson, ReasonCode, ReasonText, UserId, ActorUserId)
SELECT 'GIVEAWAY_GOODS', '249', 'ALIGN_1005',
       N'{"aliases":' + CONVERT(NVARCHAR(20), (SELECT COUNT(*) FROM wf.GiveawayGoodAlias))
       + N',"budgetsRelinked":' + CONVERT(NVARCHAR(20), (SELECT COUNT(*) FROM @relinked)) + N'}',
       'MIGRATION', N'ของแถมอ้างอิงสินค้ากลุ่ม 1005 แบบชื่อตรงกันทุกตัวอักษร ไม่แก้ประวัติการเบิก', 'SYSTEM', 'SYSTEM';
GO

-- 4. used quantity: a withdrawal of the older good counts against the budget of its 1005 twin
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

PRINT 'Migration 249: giveaway goods aligned to group 1005 (exact one-to-one names, history unchanged)';
GO
