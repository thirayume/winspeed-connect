const { wfQuery, sql } = require('./db');
async function test() {
  const r = await wfQuery(
    `SELECT * FROM wf.v_AllSalesOrders WHERE Id = @id`,
    { id: { type: sql.Int, value: 132260 } }
  );
  console.log(r.recordset.length);
}
test().catch(console.error);
