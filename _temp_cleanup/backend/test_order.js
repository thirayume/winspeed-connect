const db = require('./db');
async function run() {
  try {
    const r = await db.query("SELECT TOP 1 * FROM wf.v_AllSalesOrderLines");
    console.dir(r, { depth: null });
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
run();
