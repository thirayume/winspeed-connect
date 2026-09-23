const path = require('path');
const { runWithTarget, wfQuery } = require(path.resolve(__dirname, '../backend/db'));

async function main() {
  await runWithTarget('remote_b', async () => {
    const r = await wfQuery(`
      SELECT m.Scenario, m.WGHDId, m.WGDTId, m.WGDTReportId,
             so.DocuNo, h.CarNo, h.MoveBill, h.Status, m.QtyTon,
             h.WeightIn, h.WeightOut, h.WeightNet,
             d.GoodName, d.GoodTon, d.GoodKasob,
             r.GoodKasobNet, r.GoodTonNet
      FROM wf.WeighingSampleManifest m
      JOIN dbo.WGHD h ON h.Id = m.WGHDId
      JOIN dbo.WGDT d ON d.Id = m.WGDTId
      LEFT JOIN dbo.WGDTReport r ON r.Id = m.WGDTReportId
      JOIN dbo.SOHD so ON so.SOID = m.SourceSOID
      WHERE m.BatchKey = 'SAMPLE-WEIGH-20260917-V1'
      ORDER BY m.WGHDId, m.WGDTId;
    `);
    console.log(JSON.stringify(r.recordset, null, 2));
    
    // Also check table totals
    const counts = await wfQuery(`
      SELECT 
        (SELECT COUNT(*) FROM dbo.WGHD) AS TotalWGHD,
        (SELECT COUNT(*) FROM dbo.WGDT) AS TotalWGDT,
        (SELECT COUNT(*) FROM dbo.WGDTReport) AS TotalWGDTReport
    `);
    console.log('Current table counts:', counts.recordset[0]);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
