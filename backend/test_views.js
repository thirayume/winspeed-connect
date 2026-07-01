const db = require('./db');

async function test() {
  await db.ownerReady;
  const pool = db.ownerPool;
  try {
    const r1 = await pool.request().query("SELECT TOP 1 * FROM wf.v_AllSalesOrders");
    console.log("v_AllSalesOrders OK", Object.keys(r1.recordset[0] || {}));
  } catch (e) {
    console.error("v_AllSalesOrders Error:", e.message);
  }

  try {
    const r2 = await pool.request().query("SELECT TOP 1 LineNum, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway, LoadSequence FROM wf.v_AllSalesOrderLines");
    console.log("v_AllSalesOrderLines OK", Object.keys(r2.recordset[0] || {}));
  } catch (e) {
    console.error("v_AllSalesOrderLines Error:", e.message);
  }

  process.exit(0);
}
test();
