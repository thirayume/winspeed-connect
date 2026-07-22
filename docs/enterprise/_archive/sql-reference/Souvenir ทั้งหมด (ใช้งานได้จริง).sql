USE dbwins_worldfert9;

-- Souvenir = GoodGroupID IS NULL + ไม่ใช่ปุ๋ย
SELECT
    g.GoodID,
    g.GoodCode,
    g.GoodName1                         AS product_name,
    g.MainGoodUnitID,
    g.StockFlag,
    g.Inactive,
    ISNULL(s.total_sold, 0)             AS total_sold,
    ISNULL(s.total_revenue, 0)          AS total_revenue,
    ISNULL(s.inv_count, 0)              AS inv_count
FROM dbo.EMGood g
LEFT JOIN (
    SELECT
        d.GoodID,
        SUM(d.GoodQty2)             AS total_sold,
        SUM(d.GoodAmnt)             AS total_revenue,
        COUNT(DISTINCT d.SOInvID)   AS inv_count
    FROM dbo.SOInvDT   d WITH (NOLOCK)
    JOIN dbo.SOInvHD   h WITH (NOLOCK) ON h.SOInvID = d.SOInvID
    WHERE h.DocuStatus = 'Y'
    GROUP BY d.GoodID
) s ON s.GoodID = g.GoodID
WHERE g.GoodGroupID IS NULL
  AND g.MainGoodUnitID <> 1002    -- ไม่ใช่ปุ๋ย (ตัน)
  AND g.Inactive       <> 'Y'
ORDER BY s.total_sold DESC, g.GoodID;