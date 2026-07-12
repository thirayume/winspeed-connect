const { wfQuery } = require('./db');
async function test() {
  const r = await wfQuery("SELECT TOP 1 * FROM wf.v_AllSalesOrders");
  console.log(Object.keys(r.recordset[0]));
}
test().catch(console.error);
