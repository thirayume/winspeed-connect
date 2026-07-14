const { query, sql } = require('./backend/db');

async function run() {
  try {
    const plate = '70-9888';
    const inputs = { plate: { type: sql.NVarChar(30), value: plate } };
    const rows = await query(`
      SELECT TOP 100
        T.CreatedAt AS date,
        ISNULL(T.WfRef, CAST(T.Id AS VARCHAR(50))) AS so,
        CAST(T.Id AS VARCHAR(50)) AS soId,
        ISNULL(SUM(sol.QtyTon), 0) AS qtyTon
      FROM (
        SELECT 
            CAST(so.Id AS VARCHAR(50)) AS Id,
            so.WfRef,
            so.CreatedAt
        FROM wf.SalesOrder so
        WHERE so.TruckPlate = @plate AND so.Status NOT IN ('DRAFT', 'CANCELLED')
        
        UNION ALL
        
        SELECT 
            CAST(hd.SOID AS VARCHAR(50)) AS Id,
            ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
            ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.TransRegistration = @plate
          AND hd.DocuType IN (103, 104)
          AND hd.DocuStatus <> 'C' 
      ) T
      LEFT JOIN wf.v_AllSalesOrderLines sol ON sol.SoId = T.Id
      GROUP BY T.Id, T.WfRef, T.CreatedAt
      ORDER BY T.CreatedAt DESC
    `, inputs);
    console.log("History:", rows.length);
  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    process.exit(0);
  }
}
run();
