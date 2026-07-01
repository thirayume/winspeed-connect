const { query } = require('./db');
async function test() {
  const r = await query(`
    SELECT COLUMN_NAME, DATA_TYPE 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME='v_AllSalesOrders'
  `);
  console.log(r.recordset);
}
test().catch(console.error);
