const { query } = require('./backend/db');

async function run() {
  try {
    const rows = await query(`
      SELECT TOP 100
        TruckPlate AS truckPlate,
        MAX(CustName) AS custName,
        COUNT(*) AS count,
        MAX(CreatedAt) AS lastVisit
      FROM (
        SELECT 
            so.TruckPlate,
            so.CustName,
            so.CreatedAt
        FROM wf.SalesOrder so
        WHERE so.TruckPlate IS NOT NULL AND so.TruckPlate <> '' AND so.Status NOT IN ('DRAFT', 'CANCELLED')
          AND so.CreatedAt >= DATEADD(month, -12, GETDATE())
        
        UNION ALL
        
        SELECT 
            hd.TransRegistration AS TruckPlate,
            hd.CustName,
            ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.TransRegistration IS NOT NULL AND hd.TransRegistration <> ''
          AND hd.DocuDate >= DATEADD(month, -12, GETDATE())
          AND hd.DocuType IN (103, 104)
          AND hd.DocuStatus <> 'C' 
      ) T
      WHERE TruckPlate IS NOT NULL AND TruckPlate <> ''
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
