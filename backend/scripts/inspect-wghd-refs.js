const { query, runWithTarget } = require('../db');

runWithTarget('remote_b', async () => {
  const res = await query(`
    SELECT 
      wg.Id, wg.SPID, so.SOID, so.DocuNo, so.DocuType,
      (SELECT COUNT(*) FROM dbo.SODT dt WHERE dt.SOID = so.SOID AND dt.RefSOID IS NOT NULL) AS dt_refs
    FROM dbo.WGHD wg
    JOIN dbo.SOHD so ON so.SOID = wg.SPID
    WHERE wg.SPID IS NOT NULL
  `);
  console.log('--- SPID DOCUTYPE DISTRIBUTION ---');
  const typeCounts = {};
  for (const r of res) {
    typeCounts[r.DocuType] = (typeCounts[r.DocuType] || 0) + 1;
  }
  console.log(typeCounts);

  // Also check if any WGHD points to RefSOID or if 104 links to 103
  const refMatch = await query(`
    SELECT TOP 5 
      wg.Id AS WeighId, wg.SPID, wg.Status,
      so104.SOID AS SO104_ID, so104.DocuNo AS SO104_DocuNo,
      sodt.RefSOID, so103.DocuNo AS SO103_DocuNo
    FROM dbo.WGHD wg
    JOIN dbo.SOHD so104 ON so104.SOID = wg.SPID AND so104.DocuType = 104
    JOIN dbo.SODT sodt ON sodt.SOID = so104.SOID
    JOIN dbo.SOHD so103 ON so103.SOID = sodt.RefSOID
  `);
  console.log('--- 104 to 103 LINK VIA SODT.RefSOID ---');
  console.table(refMatch);
}).catch(console.error);
