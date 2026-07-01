const { query } = require('./db');
async function test() {
  const r = await query("SELECT * FROM wf.SalesOrder WHERE CAST(Id AS VARCHAR) = 'undefined'");
  console.log('SalesOrder undefined:', r.recordset);
  
  const r2 = await query("SELECT * FROM dbo.SOHD WHERE CAST(SOID AS VARCHAR) = 'undefined'");
  console.log('SOHD undefined:', r2.recordset);
}
test().catch(console.error);
