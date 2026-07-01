const { query } = require('./db');
async function test() {
  const r = await query(`
    SELECT COLUMN_NAME, DATA_TYPE 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME='SOHD' AND TABLE_SCHEMA='dbo' AND COLUMN_NAME='CustID'
  `);
  console.log(r.recordset);
}
test().catch(console.error);
