const db = require('./db');
async function run() {
  try {
    const res = await db.query('SELECT TOP 5 * FROM wf.v_AllSalesOrders ORDER BY CreatedAt DESC');
    console.log(res.recordset);
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
run();
