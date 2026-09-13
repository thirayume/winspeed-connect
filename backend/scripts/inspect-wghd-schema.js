const { query, runWithTarget } = require('../db');

runWithTarget('remote_b', async () => {
  const sample = await query(`
    SELECT TOP 10 wg.Id, wg.DocuNo, wg.SPID, wg.Status, wg.WGType, wg.DateIn, wg.DateOut, wg.WeightIn, wg.WeightOut, so.SOID, so.DocuNo AS SODocuNo, so.DocuType AS SODocuType
    FROM dbo.WGHD wg
    LEFT JOIN dbo.SOHD so ON so.SOID = wg.SPID
    WHERE wg.SPID IS NOT NULL
    ORDER BY wg.Id DESC
  `);
  console.log('--- WGHD SAMPLE LINKED TO SOHD BY SPID ---');
  console.table(sample);

  const stats = await query(`
    SELECT 
      COUNT(*) AS total_wghd,
      COUNT(CASE WHEN SPID IS NOT NULL AND SPID > 0 THEN 1 END) AS with_spid,
      COUNT(CASE WHEN so.SOID IS NOT NULL THEN 1 END) AS matched_soid
    FROM dbo.WGHD wg
    LEFT JOIN dbo.SOHD so ON so.SOID = wg.SPID
  `);
  console.log('--- WGHD STATS ---');
  console.table(stats);

  const statuses = await query(`
    SELECT Status, QStatus, WGType, COUNT(*) AS cnt
    FROM dbo.WGHD
    GROUP BY Status, QStatus, WGType
    ORDER BY cnt DESC
  `);
  console.log('--- WGHD STATUSES ---');
  console.table(statuses);
}).catch(console.error);
