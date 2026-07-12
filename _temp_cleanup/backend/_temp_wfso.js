const { wfQuery } = require('./db');
async function test() {
  const r = await wfQuery(`
    SELECT TABLE_NAME, COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME IN ('SalesOrder', 'SalesOrderExt', 'SalesOrderLine', 'SalesOrderLineExt') 
    AND TABLE_SCHEMA = 'wf'
  `);
  const schema = {};
  for (const row of r.recordset) {
    if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = [];
    schema[row.TABLE_NAME].push(row.COLUMN_NAME);
  }
  console.log(schema);
  process.exit(0);
}
test().catch(console.error);
