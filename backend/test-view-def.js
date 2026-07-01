const { query } = require('./db');
async function test() {
  const r = await query(`SELECT OBJECT_DEFINITION(OBJECT_ID('wf.v_AllSalesOrders')) AS def`);
  console.log(r.recordset[0].def);
}
test().catch(console.error);
