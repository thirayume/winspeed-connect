const sql = require('mssql/msnodesqlv8');

const config = {
  server: 'localhost\\SQLEXPRESS',
  database: 'dbwins_worldfert9',
  driver: 'msnodesqlv8',
  options: {
    trustedConnection: true,
    trustServerCertificate: true
  }
};

async function run() {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('custId', sql.VarChar(20), '7019')
      .query(`
        SELECT ISNULL(SUM(RemainingAmt), 0) AS AvailableRebate 
        FROM wf.RebateLedger 
        WHERE CustId = @custId AND Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0
      `);
    console.dir(result.recordset);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
