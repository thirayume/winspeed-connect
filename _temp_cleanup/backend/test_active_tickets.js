const sql = require('mssql/msnodesqlv8');
const config = {
  server: 'localhost\\SQLEXPRESS',
  database: 'dbwins_worldfert9',
  driver: 'msnodesqlv8',
  options: { trustedConnection: true, trustServerCertificate: true }
};

async function run() {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query(`
        WITH ControlTickets AS (
            SELECT 
                h.CustID,
                h.AppvDocuNo AS DocuNo,
                h.SOID,
                (SELECT ISNULL(SUM(d.GoodQty2), 0) FROM dbo.SODT d WITH(NOLOCK) WHERE d.SOID = h.SOID) AS TotalQtyTon,
                (SELECT ISNULL(SUM(d2.GoodQty2), 0) FROM dbo.SOHD h2 WITH(NOLOCK) JOIN dbo.SODT d2 WITH(NOLOCK) ON h2.SOID = d2.SOID LEFT JOIN wf.SalesOrderLine wfl WITH(NOLOCK) ON wfl.SoId = h2.SOID AND wfl.LineNum = d2.ListNo WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C' AND (h2.RefNo = h.AppvDocuNo OR wfl.RefControlTicketNo = h.AppvDocuNo)) AS DrawnQtyTon
            FROM dbo.SOHD h WITH(NOLOCK)
            WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND h.AppvDocuNo LIKE 'AI%' AND h.CustID = '7019'
        )
        SELECT CustID, DocuNo, TotalQtyTon, DrawnQtyTon, (TotalQtyTon - DrawnQtyTon) AS RemainQtyTon
        FROM ControlTickets
        WHERE TotalQtyTon > DrawnQtyTon
    `);
    console.dir(result.recordset);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
