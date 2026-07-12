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
    .input('limit', sql.Int, 300)
    .query(`
      SELECT TOP (@limit)
             TranspID,
             TranspCode,
             TranspName,
             Remark
      FROM dbo.EMTransp WITH (NOLOCK)
      ORDER BY TranspName, TranspCode, TranspID
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
