const { runWithTarget, query } = require('../backend/db');

runWithTarget('remote_b', async () => {
  const r1 = await query(`
    SELECT TOP 10 dt.SetPriceID, dt.GoodPriceNet, hd.DocuNo, hd.BeginDate, hd.EndDate, hd.CustID
    FROM dbo.EMSetPriceDT dt
    JOIN dbo.EMSetPriceHD hd ON hd.SetPriceID = dt.SetPriceID
    JOIN dbo.EMGood g ON g.GoodID = dt.ListID
    WHERE g.GoodCode = '7-12042600BBCAR'
    ORDER BY hd.BeginDate DESC
  `);
  console.log('Latest SetPrices for 12-4-26:', r1);

  process.exit(0);
});
