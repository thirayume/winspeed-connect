const { query } = require('./backend/db');

async function run() {
  try {
    const rows = await query(`
      SELECT TOP 100
        TruckPlate AS truckPlate,
        MAX(CustName) AS custName,
        COUNT(*) AS count,
        MAX(CreatedAt) AS lastVisit
      FROM wf.v_AllSalesOrders
      WHERE TruckPlate IS NOT NULL AND TruckPlate <> '' AND Status NOT IN ('DRAFT', 'CANCELLED')
        AND CreatedAt >= DATEADD(month, -12, GETDATE())
      GROUP BY TruckPlate
      ORDER BY count DESC
    `);
    console.log("Returned:", rows.length);
  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    process.exit(0);
  }
}
run();
