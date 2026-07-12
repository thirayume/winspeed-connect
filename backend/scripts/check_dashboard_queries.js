const sql = require('mssql/msnodesqlv8');

async function timed(pool, text) {
  const started = Date.now();
  const result = await pool.request().query(text);
  return { ms: Date.now() - started, rows: result.recordset || [] };
}

async function main() {
  const pool = new sql.ConnectionPool({
    server: '.\\SQLEXPRESS',
    database: 'dbwins_worldfert9',
    driver: 'msnodesqlv8',
    requestTimeout: 120000,
    options: { trustedConnection: true, trustServerCertificate: true },
  });
  await pool.connect();

  const ext = await timed(pool, `SELECT COUNT_BIG(*) AS Cnt FROM wf.SalesOrderExt WITH (NOLOCK)`);
  const hasWinspeedExt = Number(ext.rows[0]?.Cnt || 0) > 0;

  const statsSql = hasWinspeedExt ? `
    WITH WfDraft AS (
      SELECT Status, COUNT(*) AS Cnt
      FROM wf.SalesOrder WITH (NOLOCK)
      GROUP BY Status
    ),
    WinspeedBase AS (
      SELECT
        CASE
          WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
          WHEN hd.DocuType = 104 THEN 'IMPORTED'
          WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
          WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
          ELSE 'CONFIRMED'
        END AS Status,
        COUNT_BIG(*) AS Cnt
      FROM dbo.SOHD hd WITH (NOLOCK)
      WHERE hd.DocuType IN (103, 104)
      GROUP BY
        CASE
          WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
          WHEN hd.DocuType = 104 THEN 'IMPORTED'
          WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
          WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
          ELSE 'CONFIRMED'
        END
    ),
    WinspeedExtAdjust AS (
      SELECT OldStatus AS Status, CAST(-COUNT_BIG(*) AS BIGINT) AS Cnt
      FROM (
        SELECT
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS OldStatus,
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS NewStatus
        FROM wf.SalesOrderExt ext WITH (NOLOCK)
        JOIN dbo.SOHD hd WITH (NOLOCK)
          ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.DocuType IN (103, 104)
      ) adjusted
      WHERE OldStatus <> NewStatus
      GROUP BY OldStatus

      UNION ALL

      SELECT NewStatus AS Status, COUNT_BIG(*) AS Cnt
      FROM (
        SELECT
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS OldStatus,
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS NewStatus
        FROM wf.SalesOrderExt ext WITH (NOLOCK)
        JOIN dbo.SOHD hd WITH (NOLOCK)
          ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.DocuType IN (103, 104)
      ) adjusted
      WHERE OldStatus <> NewStatus
      GROUP BY NewStatus
    )
    SELECT Status, CAST(SUM(Cnt) AS INT) AS Cnt
    FROM (
      SELECT Status, Cnt FROM WfDraft
      UNION ALL
      SELECT Status, Cnt FROM WinspeedBase
      UNION ALL
      SELECT Status, Cnt FROM WinspeedExtAdjust
    ) x
    GROUP BY Status;
  ` : `
    WITH WfDraft AS (
      SELECT Status, COUNT(*) AS Cnt
      FROM wf.SalesOrder WITH (NOLOCK)
      GROUP BY Status
    ),
    WinspeedBase AS (
      SELECT
        CASE
          WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
          WHEN hd.DocuType = 104 THEN 'IMPORTED'
          WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
          WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
          ELSE 'CONFIRMED'
        END AS Status,
        COUNT_BIG(*) AS Cnt
      FROM dbo.SOHD hd WITH (NOLOCK)
      WHERE hd.DocuType IN (103, 104)
      GROUP BY
        CASE
          WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
          WHEN hd.DocuType = 104 THEN 'IMPORTED'
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
    GROUP BY Status;
  `;

  const agingSql = hasWinspeedExt ? `
    WITH CandidateSo AS (
      SELECT TOP 1000
        hd.SOID AS SoIdKey,
        CAST(hd.SOID AS VARCHAR(50)) AS SoId,
        hd.DocuNo AS WfRef,
        hd.CustName,
        CAST(hd.DocuDate AS DATETIME2) AS CreatedAt,
        CASE WHEN hd.PkgStatus = 'Y' THEN 'PICKING' ELSE 'CONFIRMED' END AS BaseStatus
      FROM dbo.SOHD hd WITH (NOLOCK)
      WHERE hd.DocuType IN (103, 104)
        AND ISNULL(hd.DocuStatus, '') <> 'C'
        AND ISNULL(hd.clearflag, 'N') <> 'Y'
        AND ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'
        AND hd.DocuDate >= DATEFROMPARTS(YEAR(GETDATE()) - 2, 1, 1)
      ORDER BY hd.DocuDate ASC, hd.SOID ASC
    ),
    OpenSo AS (
      SELECT TOP 200
        c.SoIdKey,
        c.SoId,
        c.WfRef,
        c.CustName,
        c.CreatedAt,
        CASE WHEN ext.IsLoaded = 1 THEN 'LOADED' ELSE c.BaseStatus END AS Status
      FROM CandidateSo c
      LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
        ON ext.SOID = c.SoId
      WHERE ext.WeighOutWeight IS NULL
      ORDER BY c.CreatedAt ASC, c.SoId ASC
    )
    SELECT TOP 5 o.CustName, CAST(ISNULL(line.GoodID, '') AS VARCHAR(50)) AS GoodCode,
           line.GoodName, ISNULL(line.QtyTon, 0) AS QtyTon,
           DATEDIFF(DAY, o.CreatedAt, GETUTCDATE()) AS DaysOpen,
           o.Status, o.WfRef, o.SoId, o.CreatedAt
    FROM OpenSo o
    OUTER APPLY (
      SELECT TOP 1 dt.GoodID, dt.GoodName, CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12,3)) AS QtyTon
      FROM dbo.SODT dt WITH (NOLOCK)
      WHERE CONVERT(VARCHAR(50), dt.SOID) = o.SoId
      ORDER BY dt.ListNo
    ) line
    ORDER BY DaysOpen DESC;
  ` : `
    WITH OpenSo AS (
      SELECT TOP 200
        hd.SOID AS SoIdKey,
        CAST(hd.SOID AS VARCHAR(50)) AS SoId,
        hd.DocuNo AS WfRef,
        hd.CustName,
        CAST(hd.DocuDate AS DATETIME2) AS CreatedAt,
        CASE WHEN hd.PkgStatus = 'Y' THEN 'PICKING' ELSE 'CONFIRMED' END AS Status
      FROM dbo.SOHD hd WITH (NOLOCK)
      WHERE hd.DocuType IN (103, 104)
        AND ISNULL(hd.DocuStatus, '') <> 'C'
        AND ISNULL(hd.clearflag, 'N') <> 'Y'
        AND ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'
        AND hd.DocuDate >= DATEFROMPARTS(YEAR(GETDATE()) - 2, 1, 1)
      ORDER BY hd.DocuDate ASC, hd.SOID ASC
    )
    SELECT TOP 5 o.CustName, CAST(ISNULL(line.GoodID, '') AS VARCHAR(50)) AS GoodCode,
           line.GoodName, ISNULL(line.QtyTon, 0) AS QtyTon,
           DATEDIFF(DAY, o.CreatedAt, GETUTCDATE()) AS DaysOpen,
           o.Status, o.WfRef, o.SoId, o.CreatedAt
    FROM OpenSo o
    OUTER APPLY (
      SELECT TOP 1 dt.GoodID, dt.GoodName, CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12,3)) AS QtyTon
      FROM dbo.SODT dt WITH (NOLOCK)
      WHERE dt.SOID = o.SoIdKey
      ORDER BY dt.ListNo
    ) line
    ORDER BY DaysOpen DESC;
  `;

  const listSql = `
    WITH Orders AS (
      SELECT CAST(so.Id AS VARCHAR(50)) AS Id, so.WfRef, so.CustName, so.TruckPlate,
             so.Status, so.SalesUserId, so.ImportedDocuNo, so.CreatedAt
      FROM wf.SalesOrder so WITH (NOLOCK)

      UNION ALL

      SELECT CAST(hd.SOID AS VARCHAR(50)) AS Id, ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
             hd.CustName, hd.TransRegistration AS TruckPlate,
             CASE
               WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
               WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
               WHEN hd.DocuType = 104 THEN 'IMPORTED'
               WHEN ext.IsLoaded = 1 THEN 'LOADED'
               WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
               WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
               ELSE 'CONFIRMED'
             END AS Status,
             ext.SalesUserId, hd.DocuNo AS ImportedDocuNo, CAST(hd.DocuDate AS DATETIME2) AS CreatedAt
      FROM dbo.SOHD hd WITH (NOLOCK)
      LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
        ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
      WHERE hd.DocuType IN (103, 104)
    )
    SELECT TOP 20 q.*, COUNT_BIG(*) OVER() AS TotalCount
    FROM Orders q
    ORDER BY q.CreatedAt DESC, q.Id DESC;
  `;

  const stats = await timed(pool, statsSql);
  const aging = await timed(pool, agingSql);
  const list = await timed(pool, listSql);

  console.log(JSON.stringify({
    salesOrderExtRows: ext.rows[0]?.Cnt || 0,
    statsMs: stats.ms,
    stats: stats.rows,
    agingMs: aging.ms,
    agingSample: aging.rows,
    listMs: list.ms,
    listTotal: list.rows[0]?.TotalCount || 0,
    listSample: list.rows.slice(0, 3),
  }, null, 2));

  await pool.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
