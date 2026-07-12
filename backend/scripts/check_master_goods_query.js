const sql = require('mssql/msnodesqlv8');

async function main() {
  const pool = new sql.ConnectionPool({
    server: '.\\SQLEXPRESS',
    database: 'dbwins_worldfert9',
    driver: 'msnodesqlv8',
    requestTimeout: 120000,
    options: { trustedConnection: true, trustServerCertificate: true },
  });
  await pool.connect();
  const started = Date.now();
  const result = await pool.request()
    .input('limit', sql.Int, 800)
    .query(`
      SELECT TOP (@limit)
             g.GoodID, g.GoodCode, g.GoodName1 AS GoodName,
             ISNULL(gx.BagPerTon, 20) AS BagPerTon,
             ISNULL(gx.WeightKgPerBag, 50.0) AS WeightKgPerBag,
             gg.GoodGroupName,
             g.StockQty,
             g.RemaQty,
             CAST(0 AS DECIMAL(18,3)) AS TotalQtyTon,
             CAST(0 AS DECIMAL(18,3)) AS TotalQtyTonThisYear
      FROM dbo.EMGood g WITH (NOLOCK)
      LEFT JOIN wf.GoodExtra gx ON gx.GoodId = g.GoodID
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON g.GoodGroupID = gg.GoodGroupID
      WHERE g.StockFlag = 'Y' AND g.MainGoodUnitID = 1002 AND g.Inactive = 'A'
      ORDER BY g.GoodCode
    `);
  console.log(JSON.stringify({
    ms: Date.now() - started,
    rows: result.recordset.length,
    sample: result.recordset.slice(0, 5),
  }, null, 2));
  await pool.close();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
