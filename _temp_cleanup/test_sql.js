const { query } = require('./backend/db');

async function run() {
  const start = Date.now();
  try {
    const rows = await query(`
      WITH Tickets AS (
        SELECT TOP 100
          h.SOID, h.AppvDocuNo AS DocuNo, h.DocuDate, h.CustID,
          h.CustName, h.TransRegistration AS TruckPlate,
          h.AppvFlag, h.DocuNo AS OriginalDocuNo, h.AppvDate, h.Desc1, h.Desc2
        FROM dbo.SOHD h WITH (NOLOCK)
        WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND h.AppvDocuNo LIKE 'AI%'
        ORDER BY h.DocuDate DESC, h.SOID DESC
      )
      SELECT * FROM (
        SELECT 
          t.*,
          ISNULL((
            SELECT SUM(d.GoodQty2)
            FROM dbo.SODT d WITH (NOLOCK)
            WHERE d.SOID = t.SOID
          ), 0) AS TotalQtyTon,
          (
            ISNULL((
              SELECT SUM(d2.GoodQty2)
              FROM dbo.SOHD h2 WITH (NOLOCK)
              JOIN dbo.SODT d2 WITH (NOLOCK) ON h2.SOID = d2.SOID
              WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C'
                AND h2.RefNo = t.DocuNo
            ), 0)
            +
            ISNULL((
              SELECT SUM(d2.GoodQty2)
              FROM dbo.SOHD h2 WITH (NOLOCK)
              JOIN dbo.SODT d2 WITH (NOLOCK) ON h2.SOID = d2.SOID
              JOIN wf.SalesOrderLine wfl WITH (NOLOCK) ON wfl.SoId = h2.SOID AND wfl.LineNum = d2.ListNo
              WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C'
                AND wfl.RefControlTicketNo = t.DocuNo
                AND (h2.RefNo IS NULL OR h2.RefNo <> t.DocuNo)
            ), 0)
          ) AS DrawnQtyTon
        FROM Tickets t
      ) final
      WHERE TotalQtyTon > DrawnQtyTon
    `);
    console.log('Count:', rows.length);
  } catch(e) {
    console.error(e);
  }
  console.log('Time:', Date.now() - start, 'ms');
  process.exit(0);
}
run();
