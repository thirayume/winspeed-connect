'use strict';

/**
 * Stock on hand from WinSpeed (owner, 3 November 2026: there is no warehouse count yet, use WinSpeed for now). WinSpeed
 * leaves dbo.ICStock empty; the balance is the signed sum of dbo.ICStockDetail. A figure the warehouse typed in
 * (Source MANUAL) is left alone. The figure trails real stock: a truck leaves it only when the 107 is posted.
 */
const { wfQuery } = require('../db');

const SOURCE = 'WINSPEED';

async function syncStockFromWinSpeed() {
  const r = await wfQuery(`
    ;WITH bal AS (
      SELECT RTRIM(g.GoodCode) AS GoodId, MAX(RTRIM(g.GoodName1)) AS GoodName,
             CAST(SUM(CAST(d.StockFlag AS INT) * d.GoodStockQty) AS DECIMAL(18,2)) AS Qty
      FROM dbo.ICStockDetail d WITH (NOLOCK)
      JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = d.GoodID
      WHERE g.GoodCode IS NOT NULL AND LEN(RTRIM(g.GoodCode)) <= 20
      GROUP BY RTRIM(g.GoodCode)
    )
    MERGE wf.OperationalStock AS t
    USING (SELECT GoodId, GoodName, Qty FROM bal WHERE Qty <> 0) AS s
      ON t.GoodId = s.GoodId AND t.WarehouseId = '-'
    WHEN MATCHED AND ISNULL(t.Source, '') = '${SOURCE}' THEN
      UPDATE SET GoodName = s.GoodName, QtyOnHand = s.Qty, AsOf = GETUTCDATE(), UpdatedBy = NULL
    WHEN NOT MATCHED BY TARGET THEN
      INSERT (GoodId, WarehouseId, GoodName, QtyOnHand, Unit, Source, UpdatedBy)
      VALUES (s.GoodId, '-', s.GoodName, s.Qty, N'ตัน', '${SOURCE}', NULL)
    WHEN NOT MATCHED BY SOURCE AND ISNULL(t.Source, '') = '${SOURCE}' THEN
      UPDATE SET QtyOnHand = 0, AsOf = GETUTCDATE();
    SELECT @@ROWCOUNT AS Affected;
  `);
  return Number(r.recordset?.[0]?.Affected) || 0;
}

module.exports = { syncStockFromWinSpeed };
