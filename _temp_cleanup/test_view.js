const { pools } = require('./backend/db');
async function test() {
  try {
    const pl = pools();
    await pl.ready;
    const res = await pl.ownerPool.request().query("EXEC sp_helptext 'wf.v_AllSalesOrders'");
    console.log(res.recordset.map(r => r.Text).join(''));
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
test();
