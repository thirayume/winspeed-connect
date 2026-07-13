const { getReadPool, closePools } = require('./_db');

async function main() {
  const pool = await getReadPool();

  const queries = {
    byDocuType: `
      SELECT DocuType, COUNT_BIG(*) AS Cnt, MIN(DocuDate) AS MinDate, MAX(DocuDate) AS MaxDate
      FROM dbo.SOHD WITH (NOLOCK)
      GROUP BY DocuType
      ORDER BY DocuType;
    `,
    so103104ByYear: `
      SELECT YEAR(DocuDate) AS DocuYear, DocuType, COUNT_BIG(*) AS Cnt
      FROM dbo.SOHD WITH (NOLOCK)
      WHERE DocuType IN (103, 104)
      GROUP BY YEAR(DocuDate), DocuType
      ORDER BY DocuYear DESC, DocuType;
    `,
    so103104Flags: `
      SELECT
        DocuType,
        ISNULL(DocuStatus, '') AS DocuStatus,
        ISNULL(clearflag, '') AS clearflag,
        ISNULL(PkgStatus, '') AS PkgStatus,
        COUNT_BIG(*) AS Cnt
      FROM dbo.SOHD WITH (NOLOCK)
      WHERE DocuType IN (103, 104)
      GROUP BY DocuType, ISNULL(DocuStatus, ''), ISNULL(clearflag, ''), ISNULL(PkgStatus, '')
      ORDER BY DocuType, Cnt DESC;
    `,
    latest: `
      SELECT TOP 10 SOID, DocuNo, DocuType, DocuDate, DocuStatus, clearflag, PkgStatus, NetAmnt
      FROM dbo.SOHD WITH (NOLOCK)
      WHERE DocuType IN (103, 104)
      ORDER BY DocuDate DESC, SOID DESC;
    `,
  };

  const output = {};
  for (const [name, query] of Object.entries(queries)) {
    const result = await pool.request().query(query);
    output[name] = result.recordset;
  }

  console.log(JSON.stringify(output, null, 2));
  await closePools();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
