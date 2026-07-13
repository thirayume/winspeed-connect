const { sql, getReadPool, closePools } = require('./_db');

async function main() {
  const pool = await getReadPool();
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
  await closePools();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
