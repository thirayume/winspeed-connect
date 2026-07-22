const sql = require('mssql');
require('dotenv').config();
async function run() {
  try {
    const pool = await sql.connect({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: 'localhost',
      database: process.env.DB_NAME,
      options: { instanceName: 'SQLEXPRESS' },
      trustServerCertificate: true
    });
    const res = await pool.request().query('SELECT TOP 1 * FROM dbo.EMGood');
    console.log(Object.keys(res.recordset[0]).filter(k => k.includes('Price')));
    pool.close();
  } catch (e) {
    console.error(e);
  }
}
run();
