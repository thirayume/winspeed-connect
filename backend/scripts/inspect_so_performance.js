const { getReadPool, closePools } = require('./_db');

async function run(pool, name, text) {
  const started = Date.now();
  const result = await pool.request().query(text);
  console.log(JSON.stringify({ name, ms: Date.now() - started, rows: result.recordset }, null, 2));
}

async function main() {
  const pool = await getReadPool();

  await run(pool, 'ext counts', `
    SELECT 'SalesOrderExt' AS TableName, COUNT(*) AS Cnt FROM wf.SalesOrderExt
    UNION ALL
    SELECT 'SalesOrderLineExt' AS TableName, COUNT(*) AS Cnt FROM wf.SalesOrderLineExt;
  `);

  await run(pool, 'relevant indexes', `
    SELECT OBJECT_SCHEMA_NAME(i.object_id) AS SchemaName,
           OBJECT_NAME(i.object_id) AS TableName,
           i.name AS IndexName
    FROM sys.indexes i
    WHERE i.object_id IN (
      OBJECT_ID('dbo.SOHD'),
      OBJECT_ID('dbo.SODT'),
      OBJECT_ID('wf.SalesOrderExt'),
      OBJECT_ID('wf.SalesOrderLineExt')
    )
      AND i.name IS NOT NULL
    ORDER BY SchemaName, TableName, IndexName;
  `);

  await run(pool, 'stats without ext join', `
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
      END;
  `);

  await closePools();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
