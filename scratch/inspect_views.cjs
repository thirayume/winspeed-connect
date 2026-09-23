const sql = require('./backend/node_modules/mssql');
require('./backend/node_modules/dotenv').config({ path: 'backend/.env' });

async function inspectViews() {
  const pool = await sql.connect({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT || '1433'),
    options: { encrypt: false, trustServerCertificate: true }
  });
  
  const v1 = await pool.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('wf.v_RebateAccrualRemaining')) AS def");
  console.log('=== v_RebateAccrualRemaining ===');
  console.log(v1.recordset[0] ? v1.recordset[0].def : 'NOT FOUND');

  const v2 = await pool.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('wf.v_RebateAccrualLot')) AS def");
  console.log('=== v_RebateAccrualLot ===');
  console.log(v2.recordset[0] ? v2.recordset[0].def : 'NOT FOUND');

  await pool.close();
}
inspectViews().catch(console.error);
