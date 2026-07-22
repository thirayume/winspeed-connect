USE dbwins_worldfert9;

-- Finished Goods = StockFlag='Y' พร้อมยอดขายจริง
SELECT
    g.GoodID,
    g.GoodCode,
    g.GoodName1                             AS product_name,
    g.MainGoodUnitID,
    CASE g.MainGoodUnitID
        WHEN 1001 THEN 'ใบ/กระสอบ'
        WHEN 1002 THEN 'ตัน'
        ELSE CAST(g.MainGoodUnitID AS varchar)
    END                                     AS unit,
    g.GoodGroupID,
    g.StockFlag,
    g.Inactive,
    ISNULL(sold.total_sold_ton, 0)          AS total_sold,
    ISNULL(sold.total_revenue, 0)           AS total_revenue,
    ISNULL(sold.invoice_count, 0)           AS inv_count,
    ISNULL(ordered.total_ordered, 0)        AS total_ordered
FROM dbo.EMGood g
LEFT JOIN (
    SELECT
        d.GoodID,
        SUM(d.GoodQty2)             AS total_sold_ton,
        SUM(d.GoodAmnt)             AS total_revenue,
        COUNT(DISTINCT d.SOInvID)   AS invoice_count
    FROM dbo.SOInvDT   d WITH (NOLOCK)
    JOIN dbo.SOInvHD   h WITH (NOLOCK) ON h.SOInvID = d.SOInvID
    WHERE h.DocuStatus = 'Y'
      AND h.Docutype IN (107, 202)
    GROUP BY d.GoodID
) sold ON sold.GoodID = g.GoodID
LEFT JOIN (
    SELECT
        d.GoodID,
        SUM(d.GoodQty2)             AS total_ordered
    FROM dbo.SODT      d WITH (NOLOCK)
    JOIN dbo.SOHD      h WITH (NOLOCK) ON h.SOID = d.SOID
    WHERE h.DocuStatus = 'Y'
      AND h.DocuType IN (103, 104)
    GROUP BY d.GoodID
) ordered ON ordered.GoodID = g.GoodID
WHERE g.StockFlag = 'Y'
  AND g.Inactive <> 'Y'
ORDER BY total_sold DESC, g.GoodID;