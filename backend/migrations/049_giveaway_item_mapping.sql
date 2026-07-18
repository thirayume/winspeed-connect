-- ══════════════════════════════════════════════════════════════
-- WF Migration 049 — Giveaway Item Mapping
-- ══════════════════════════════════════════════════════════════

IF OBJECT_ID('wf.GiveawayItemMapping','U') IS NULL
CREATE TABLE wf.GiveawayItemMapping (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  Brand     NVARCHAR(50)  NOT NULL,
  ItemName  NVARCHAR(100) NOT NULL,
  GoodID    VARCHAR(50)   NOT NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  CONSTRAINT UQ_GItemMapping UNIQUE (Brand, ItemName, GoodID),
  CONSTRAINT FK_GItemMapping FOREIGN KEY (Brand, ItemName) REFERENCES wf.GiveawayItem(Brand, ItemName)
)
GO

-- Auto-map existing giveaway items to EMGood (heuristic based)
INSERT INTO wf.GiveawayItemMapping (Brand, ItemName, GoodID)
SELECT DISTINCT i.Brand, i.ItemName, g.GoodID
FROM wf.GiveawayItem i
JOIN dbo.EMGood g WITH (NOLOCK)
  ON g.GoodGroupID IS NULL AND g.MainGoodUnitID <> 1002
  AND (g.GoodCode LIKE 'P%' OR g.GoodCode LIKE 'N%')
  -- Example heuristics: ItemName in GoodName1
  AND (g.GoodName1 LIKE '%' + i.ItemName + '%' OR REPLACE(g.GoodName1, '-', '') LIKE '%' + REPLACE(i.ItemName, '-', '') + '%')
  AND (g.GoodName1 LIKE '%' + i.Brand + '%' OR i.Brand LIKE '%252%')
WHERE NOT EXISTS (
  SELECT 1 FROM wf.GiveawayItemMapping m
  WHERE m.Brand = i.Brand AND m.ItemName = i.ItemName AND m.GoodID = g.GoodID
)
GO

PRINT '✓ WF migration 049 complete (GiveawayItemMapping)'
GO
