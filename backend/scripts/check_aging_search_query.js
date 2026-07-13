const { sql, getReadPool, closePools } = require('./_db');

async function main() {
  const pool = await getReadPool();
  const started = Date.now();
  const result = await pool.request()
    .input('dateFrom', sql.Date, new Date(`${new Date().getFullYear() - 2}-01-01`))
    .input('offset', sql.Int, 0)
    .input('pageSize', sql.Int, 50)
    .query(`
      SELECT hd.CustName,
             CAST(dt.GoodID AS VARCHAR(50)) AS GoodCode,
             dt.GoodName,
             SUM(CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12,3))) AS QtyTon,
             DATEDIFF(DAY, CAST(hd.DocuDate AS DATETIME2), GETUTCDATE()) AS DaysOpen,
             CASE
               WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
               WHEN ext.IsLoaded = 1 THEN 'LOADED'
               WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
               ELSE 'CONFIRMED'
             END AS Status,
             hd.DocuNo AS WfRef,
             CAST(hd.SOID AS VARCHAR(50)) AS SoId,
             CONVERT(VARCHAR(10), hd.DocuDate, 120) AS CreatedAt
      FROM dbo.SOHD hd WITH (NOLOCK)
      JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
      LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
        ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
      WHERE hd.DocuDate >= @dateFrom
        AND hd.DocuType IN (103, 104)
        AND ISNULL(hd.DocuStatus, '') <> 'C'
        AND ISNULL(hd.clearflag, 'N') <> 'Y'
        AND ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'
      GROUP BY hd.CustName, dt.GoodID, dt.GoodName, hd.DocuDate, hd.PkgStatus,
               ext.IsLoaded, ext.WeighOutWeight, hd.DocuNo, hd.SOID
      ORDER BY DaysOpen DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);
  console.log(JSON.stringify({
    ms: Date.now() - started,
    rows: result.recordset.length,
    sample: result.recordset.slice(0, 5),
  }, null, 2));
  await closePools();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
