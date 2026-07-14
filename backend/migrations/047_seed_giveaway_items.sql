-- 047_seed_giveaway_items.sql
-- Seed GiveawayItem automatically from GiveawayBudget

INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType)
SELECT DISTINCT Brand, ItemName, 
  CASE 
    WHEN ItemName LIKE N'%เสื้อ%' THEN 'SHIRT'
    WHEN ItemName LIKE N'%แบนเนอร์%' OR ItemName LIKE N'%ป้าย%' THEN 'BANNER'
    WHEN ItemName LIKE '%-%' THEN 'BAG'
    ELSE 'OTHER'
  END AS ItemType
FROM wf.GiveawayBudget
WHERE NOT EXISTS (
  SELECT 1 FROM wf.GiveawayItem gi 
  WHERE gi.Brand = wf.GiveawayBudget.Brand AND gi.ItemName = wf.GiveawayBudget.ItemName
);
GO
