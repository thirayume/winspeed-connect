const d = require('../backend/db');
(async () => {
  await d.runWithTarget('remote_b', async () => {
    const glhdCols = await d.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'GLHD'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('GLHD cols:', glhdCols.map(c => c.COLUMN_NAME).join(', '));

    const gldtCols = await d.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'GLDT'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('GLDT cols:', gldtCols.map(c => c.COLUMN_NAME).join(', '));

    // Check sample rows from GLHD
    const glhdSample = await d.query(`
      SELECT TOP 5 GLID, JourID, DocuNo, DocuDate, RefNo, RefDate, DocuType, FromID, FromFlag, DocuStatus, PostID, TotaAmnt
      FROM dbo.GLHD
      ORDER BY DocuDate DESC, GLID DESC
    `);
    console.log('GLHD sample:', JSON.stringify(glhdSample, null, 2));

    // Check distinct PostID, PostGL in SOInvHD
    const soinvStats = await d.query(`
      SELECT PostID, PostGL, DocuStatus, COUNT(*) as cnt
      FROM dbo.SOInvHD
      WHERE DocuType IN (107, 202)
      GROUP BY PostID, PostGL, DocuStatus
      ORDER BY cnt DESC
    `);
    console.log('SOInvHD stats:', JSON.stringify(soinvStats, null, 2));
  });
})().catch(console.error).finally(async () => {
  for (const p of Object.values(d.pools('remote_b'))) if (p && p.close) await p.close();
});
