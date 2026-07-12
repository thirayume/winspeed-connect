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
        SELECT TOP 20
            c.CustID, c.CustName, 
            (SELECT SUM(RemainingAmt) FROM wf.RebateLedger WHERE CustId = c.CustID AND Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0) AS RebateBalance,
            h.AppvDocuNo AS ControlTicketNo,
            (
                (SELECT ISNULL(SUM(d1.GoodQty2), 0) FROM dbo.SODT d1 WITH(NOLOCK) WHERE d1.SOID = h.SOID)
                -
                (SELECT ISNULL(SUM(d2.GoodQty2), 0) FROM dbo.SOHD h2 WITH(NOLOCK) JOIN dbo.SODT d2 WITH(NOLOCK) ON h2.SOID = d2.SOID LEFT JOIN wf.SalesOrderLine wfl WITH(NOLOCK) ON wfl.SoId = h2.SOID AND wfl.LineNum = d2.ListNo WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C' AND (h2.RefNo = h.AppvDocuNo OR wfl.RefControlTicketNo = h.AppvDocuNo))
            ) AS TicketRemainQty,
            g.GoodCode,
            g.GoodName1 AS GoodName,
            d.GoodQty2 AS LineQty
        FROM (SELECT DISTINCT CustId FROM wf.RebateLedger WHERE Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0) r
        JOIN dbo.EMCust c WITH(NOLOCK) ON c.CustID = r.CustId
        JOIN dbo.SOHD h WITH(NOLOCK) ON h.CustID = c.CustID
        JOIN dbo.SODT d WITH(NOLOCK) ON d.SOID = h.SOID
        JOIN dbo.EMGood g WITH(NOLOCK) ON g.GoodID = d.GoodID
        WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND h.AppvDocuNo LIKE 'AI%'
    `);
    console.dir(result.recordset);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
