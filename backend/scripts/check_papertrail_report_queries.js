const sql = require('mssql/msnodesqlv8');

async function main() {
  const pool = new sql.ConnectionPool({
    server: '.\\SQLEXPRESS',
    database: 'dbwins_worldfert9',
    driver: 'msnodesqlv8',
    requestTimeout: 120000,
    options: { trustedConnection: true, trustServerCertificate: true },
  });
  await pool.connect();

  const reportStart = Date.now();
  const report = await pool.request().query(`
    WITH WfDraft AS (
      SELECT Status, COUNT_BIG(*) AS Cnt
      FROM wf.SalesOrder WITH (NOLOCK)
      GROUP BY Status
    ),
    WinspeedBase AS (
      SELECT
        CASE
          WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
          WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
          WHEN hd.DocuType = 104 THEN 'IMPORTED'
          WHEN ext.IsLoaded = 1 THEN 'LOADED'
          WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
          WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
          ELSE 'CONFIRMED'
        END AS Status,
        COUNT_BIG(*) AS Cnt
      FROM dbo.SOHD hd WITH (NOLOCK)
      LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
        ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
      WHERE hd.DocuType IN (103, 104)
      GROUP BY
        CASE
          WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
          WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
          WHEN hd.DocuType = 104 THEN 'IMPORTED'
          WHEN ext.IsLoaded = 1 THEN 'LOADED'
          WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
          WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
          ELSE 'CONFIRMED'
        END
    )
    SELECT Status, CAST(SUM(Cnt) AS INT) AS Cnt
    FROM (
      SELECT Status, Cnt FROM WfDraft
      UNION ALL
      SELECT Status, Cnt FROM WinspeedBase
    ) x
    GROUP BY Status
    ORDER BY Cnt DESC
  `);

  const boardStart = Date.now();
  const board = await pool.request().query(`
    WITH Orders AS (
      SELECT
        CAST(so.Id AS VARCHAR(50)) AS Id, so.WfRef, so.CustName, so.Status,
        so.TruckPlate, so.ControlTicketNo, so.ImportedDocuNo, so.CreatedAt,
        so.DeliveryDate, so.SalesUserId, CAST('DRAFT' AS VARCHAR(20)) AS SourceType
      FROM wf.SalesOrder so WITH (NOLOCK)
      WHERE so.Status IN ('DRAFT', 'CONFIRMED', 'PICKING')

      UNION ALL

      SELECT
        CAST(w.SOID AS VARCHAR(50)) AS Id, ISNULL(w.WfRef, w.DocuNo) AS WfRef,
        w.CustName, w.Status, w.TruckPlate, w.ControlTicketNo, w.ImportedDocuNo,
        w.CreatedAt, w.DeliveryDate, w.SalesUserId, CAST('WINSPEED' AS VARCHAR(20)) AS SourceType
      FROM (
        SELECT
          hd.SOID, hd.DocuNo, ext.WfRef, hd.CustName, hd.TransRegistration AS TruckPlate,
          ext.ControlTicketNo, hd.DocuNo AS ImportedDocuNo, ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt,
          ext.DeliveryDate, ext.SalesUserId,
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS Status,
          ROW_NUMBER() OVER(PARTITION BY hd.DocuNo ORDER BY hd.DocuType DESC, hd.SOID DESC) AS DedupRN
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
          ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.DocuType IN (103, 104)
      ) w
      WHERE w.DedupRN = 1
        AND (w.Status IN ('DRAFT', 'CONFIRMED', 'PICKING')
             OR (w.Status = 'SHIPPED' AND w.CreatedAt >= DATEADD(day, -3, GETDATE())))
    ),
    RankedSO AS (
      SELECT *, ROW_NUMBER() OVER(PARTITION BY Status ORDER BY CreatedAt DESC, Id DESC) as RN
      FROM Orders
    ),
    ActiveSO AS ( SELECT * FROM RankedSO WHERE RN <= 100 )
    SELECT so.Id, so.WfRef, so.CustName, so.Status,
           SUM(CASE
                 WHEN so.SourceType = 'DRAFT' AND ISNULL(sol.IsGiveaway, 0) = 0 THEN ISNULL(sol.QtyTon, 0)
                 WHEN so.SourceType = 'WINSPEED' AND ISNULL(sle.IsGiveaway, CASE WHEN dt.FreeFlag = 'Y' THEN 1 ELSE 0 END) = 0 THEN ISNULL(dt.GoodQty2, 0)
                 ELSE 0
               END) AS QtyTon,
           COUNT(CASE WHEN so.SourceType = 'DRAFT' THEN sol.SoId ELSE dt.SOID END) AS LineCnt
    FROM ActiveSO so
    LEFT JOIN wf.SalesOrderLine sol WITH (NOLOCK)
      ON so.SourceType = 'DRAFT' AND CONVERT(VARCHAR(50), sol.SoId) = so.Id
    LEFT JOIN dbo.SODT dt WITH (NOLOCK)
      ON so.SourceType = 'WINSPEED' AND CONVERT(VARCHAR(50), dt.SOID) = so.Id
    LEFT JOIN wf.SalesOrderLineExt sle WITH (NOLOCK)
      ON so.SourceType = 'WINSPEED' AND CONVERT(VARCHAR(50), sle.SOID) = so.Id AND sle.ListNo = dt.ListNo
    GROUP BY so.Id, so.WfRef, so.CustName, so.Status, so.CreatedAt
    ORDER BY so.CreatedAt DESC
  `);

  console.log(JSON.stringify({
    reportMs: Date.now() - reportStart,
    reportRows: report.recordset,
    boardMs: Date.now() - boardStart,
    boardRows: board.recordset.length,
    boardSample: board.recordset.slice(0, 5),
  }, null, 2));

  await pool.close();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
