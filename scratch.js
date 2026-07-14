const { query } = require('./backend/db');

async function run() {
  try {
    const rows = await query(`
      SELECT 
        TruckPlate AS truckPlate,
        MAX(CustName) AS custName,
        COUNT(*) AS count,
        MAX(CreatedAt) AS lastVisit
      FROM wf.v_AllSalesOrders
      WHERE TruckPlate IS NOT NULL AND TruckPlate != '' AND Status NOT IN ('DRAFT', 'CANCELLED')
      GROUP BY TruckPlate
      ORDER BY count DESC
    `);
    console.log(rows);
  } catch (e) {
    console.error("ERROR:", e);
  } finally {
    process.exit(0);
  }
}
run();
