
const sql = require('mssql');
const config = {
  user: 'sa',
  password: '123',
  server: '127.0.0.1',
  database: 'dbwins_worldfert9',
  options: { encrypt: false, trustServerCertificate: true }
};
sql.connect(config).then(pool => {
  return pool.request()
    .input('docuNo', sql.NVarChar(30), 'AI68-02752')
    .query(\
      SELECT 
        d.ListNo, d.GoodID, g.GoodCode, g.GoodName1 AS GoodName, 
        d.GoodQty2 AS QtyTon, d.GoodPrice2 AS PricePerTon, 
        ISNULL(gx.BagPerTon, 20) AS BagPerTon
      FROM dbo.SOHD h WITH (NOLOCK)
      JOIN dbo.SODT d WITH (NOLOCK) ON h.SOID = d.SOID
      JOIN dbo.EMGood g WITH (NOLOCK) ON d.GoodID = g.GoodID
      LEFT JOIN wf.GoodExtra gx WITH (NOLOCK) ON gx.GoodId = g.GoodID
      WHERE h.AppvDocuNo = @docuNo AND h.DocuType = 103 AND h.DocuStatus = 'Y'
      ORDER BY d.ListNo ASC
    \);
}).then(result => {
  console.log(result.recordset);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});

