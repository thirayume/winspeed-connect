const { wfQuery, sql } = require('./db');
async function test() {
  const r = await wfQuery(
    `SELECT * FROM wf.v_AllSalesOrders WHERE Id = @id`,
    { id: { type: sql.Int, value: 132260 } } // Use a known WINSpeed SOHD order ID
  );
  console.log(Object.keys(r.recordset[0]));
}
test().catch(console.error);
