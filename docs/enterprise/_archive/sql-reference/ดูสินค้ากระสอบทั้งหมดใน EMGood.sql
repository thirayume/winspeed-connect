USE dbwins_worldfert9;

SELECT
    GoodID,
    GoodCode,
    GoodName1           AS product_name,
    GoodGroupID,
    MainGoodUnitID,
    StockFlag,
    Inactive
FROM dbo.EMGood
WHERE GoodGroupID   = 1000          -- กลุ่มกระสอบ/บรรจุภัณฑ์
  AND Inactive     <> 'Y'
ORDER BY GoodID;