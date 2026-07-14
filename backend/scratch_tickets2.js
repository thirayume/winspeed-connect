const { wfQuery } = require('./db');

async function check() {
  try {
    const rows = await wfQuery(`
      WITH Tickets AS (
        SELECT TOP 100
          h.SOID, h.AppvDocuNo AS DocuNo, h.DocuDate, h.CustID,
          h.CustName, h.TransRegistration AS TruckPlate,
          h.AppvFlag, h.DocuNo AS OriginalDocuNo, h.AppvDate, h.Desc1, h.Desc2
        FROM dbo.SOHD h WITH (NOLOCK)
        WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND h.AppvDocuNo LIKE 'AI%'
      ),
      DraftTickets AS (
        SELECT 
          so.Id AS SOID,
          so.WfRef AS DocuNo,
          so.CreatedAt AS DocuDate,
          so.CustId AS CustID,
          so.CustName AS CustName,
          so.TruckPlate AS TruckPlate,
          'N' AS AppvFlag,
          so.WfRef AS OriginalDocuNo,
          NULL AS AppvDate,
          N'(แบบร่าง / ยังไม่ยืนยัน)' AS Desc1,
          NULL AS Desc2
        FROM wf.SalesOrder so WITH (NOLOCK)
        WHERE so.SoPrefix = 'AI' AND so.Status = 'DRAFT'
      ),
      AllTickets AS (
        SELECT * FROM Tickets
        UNION ALL
        SELECT * FROM DraftTickets
      )
      SELECT * FROM (
        SELECT 
          t.*,
          ISNULL((
            SELECT SUM(d.GoodQty2)
            FROM dbo.SODT d WITH (NOLOCK)
            WHERE d.SOID = t.SOID
          ), 
            ISNULL((SELECT SUM(wfl.QtyTon) FROM wf.SalesOrderLine wfl WHERE wfl.SoId = t.SOID), 0)
          ) AS TotalQtyTon,
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
            +
            ISNULL((
              SELECT SUM(wfl.QtyTon)
              FROM wf.SalesOrderLine wfl
              JOIN wf.SalesOrder so2 ON so2.Id = wfl.SoId
              WHERE so2.Status = 'DRAFT' AND wfl.RefControlTicketNo = t.DocuNo
            ), 0)
          ) AS DrawnQtyTon
        FROM AllTickets t
      ) final
      WHERE TotalQtyTon > DrawnQtyTon
      ORDER BY DocuDate DESC
    `);
    console.log("Filtered active tickets: ", rows.recordset);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
check();
