const { wfQuery, sql } = require('./db');
async function test() {
  try {
    const r = await wfQuery(
      `SELECT * FROM wf.v_AllSalesOrders WHERE Id = @id`,
      { id: { type: sql.VarChar(50), value: 'undefined' } }
    );
    console.log(r.recordset);
  } catch (e) {
    console.error(e);
  }
}
test();
