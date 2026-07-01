const { query, sql } = require('./db');
async function test() {
  const inputs = { custId: { type: sql.NVarChar(20), value: 'undefined' } };
  const rows = await query(`
    SELECT DISTINCT TruckPlate AS Plate
    FROM wf.v_AllSalesOrders
    WHERE CustId = @custId AND TruckPlate IS NOT NULL AND TruckPlate <> ''
  `, inputs);
  console.log('Success:', rows.length);
}
test().catch(console.error);
