const { query, sql } = require('./db');
async function test() {
  console.time('fetchTruckPlates');
  const inputs = { custId: { type: sql.NVarChar(50), value: 'C-0001' } };
  const rows = await query(`
    SELECT DISTINCT TruckPlate AS Plate
    FROM wf.v_AllSalesOrders
    WHERE CustId = @custId AND TruckPlate IS NOT NULL AND TruckPlate <> ''
  `, inputs);
  console.timeEnd('fetchTruckPlates');
  console.log(rows.length);
}
test().catch(console.error).finally(() => process.exit());
