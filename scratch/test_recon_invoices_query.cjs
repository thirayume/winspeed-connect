const d = require('../backend/db');
(async () => {
  await d.runWithTarget('remote_b', async () => {
    // Test lookup on recent 20 SOs
    const soRows = await d.query(`
      SELECT TOP 20 CAST(hd.SOID AS VARCHAR(50)) AS SoId, hd.DocuNo AS WsDocuNo
      FROM dbo.SOHD hd WITH (NOLOCK)
      WHERE hd.DocuType = 103 AND hd.DocuDate >= DATEADD(day, -60, GETDATE())
      ORDER BY hd.DocuDate DESC
    `);
    const ids = soRows.map(r => r.SoId);
    console.log('Testing with', ids.length, 'SO IDs');

    if (ids.length === 0) return;
    const idList = ids.map(x => `'${x}'`).join(',');

    // Query 1: Direct 103 to SOInvDT
    const direct103 = await d.query(`
      SELECT dt.RefID AS SoId, h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.DocuStatus,
             h.PostID, h.PostGL, h.PostGLDate,
             SUM(dt.GoodQty2) AS LineQtyTon, SUM(dt.GoodAmnt) AS LineAmnt,
             'PRIMARY_103_LINE' AS Provenance
      FROM dbo.SOInvDT dt WITH (NOLOCK)
      JOIN dbo.SOInvHD h WITH (NOLOCK) ON h.SOInvID = dt.SOInvID AND h.DocuType IN (107, 202)
      WHERE dt.RefID IN (${idList})
      GROUP BY dt.RefID, h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.DocuStatus,
               h.PostID, h.PostGL, h.PostGLDate
    `);
    console.log('Direct 103 matches:', direct103.length);

    // Query 2: Via 104 Delivery Orders
    const via104 = await d.query(`
      SELECT dt104.RefSOID AS SoId, h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.DocuStatus,
             h.PostID, h.PostGL, h.PostGLDate,
             SUM(dt.GoodQty2) AS LineQtyTon, SUM(dt.GoodAmnt) AS LineAmnt,
             'PRIMARY_104_LINE' AS Provenance
      FROM dbo.SODT dt104 WITH (NOLOCK)
      JOIN dbo.SOInvDT dt WITH (NOLOCK) ON dt.RefID = dt104.SOID
      JOIN dbo.SOInvHD h WITH (NOLOCK) ON h.SOInvID = dt.SOInvID AND h.DocuType IN (107, 202)
      WHERE dt104.RefSOID IN (${idList})
      GROUP BY dt104.RefSOID, h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.DocuStatus,
               h.PostID, h.PostGL, h.PostGLDate
    `);
    console.log('Via 104 matches:', via104.length);

    // Query 3: By RefSOID on header
    const byRefSOID = await d.query(`
      SELECT CAST(h.RefSOID AS VARCHAR(50)) AS SoId, h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.DocuStatus,
             h.PostID, h.PostGL, h.PostGLDate,
             h.NetAmnt AS LineAmnt, NULL AS LineQtyTon,
             'HEADER_REFSOID' AS Provenance
      FROM dbo.SOInvHD h WITH (NOLOCK)
      WHERE h.DocuType IN (107, 202) AND CAST(h.RefSOID AS VARCHAR(50)) IN (${idList})
    `);
    console.log('By RefSOID matches:', byRefSOID.length);
  });
})().catch(console.error).finally(async () => {
  for (const p of Object.values(d.pools('remote_b'))) if (p && p.close) await p.close();
});
