const { runWithTarget, query } = require('../backend/db');

runWithTarget('remote_b', async () => {
  const r = await query(`
    SELECT TOP 10 dt.ListID, g.GoodCode, g.GoodName1, dt.GoodPriceNet
    FROM dbo.EMSetPriceDT dt
    JOIN dbo.EMGood g ON g.GoodID = dt.ListID
    WHERE dt.SetPriceID = 2064 AND dt.GoodPriceNet > 0
    ORDER BY g.GoodCode
  `);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
});
