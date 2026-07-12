const { getPool } = require('./backend/db');
async function test() {
  const pool = await getPool();
  const res1 = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='wf' AND TABLE_NAME='SalesOrder'");
  console.log('SalesOrder:', res1.recordset.map(r => r.COLUMN_NAME));
  
  const res2 = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='wf' AND TABLE_NAME='SalesOrderLine'");
  console.log('SalesOrderLine:', res2.recordset.map(r => r.COLUMN_NAME));
  process.exit(0);
}
test();
