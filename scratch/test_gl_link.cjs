const d = require('../backend/db');
(async () => {
  await d.runWithTarget('remote_b', async () => {
    // 1. Check if SOInvHD.PostID = GLHD.PostID
    const linkByPostId = await d.query(`
      SELECT TOP 5
        inv.SOInvID, inv.DocuNo AS InvDocuNo, inv.DocuDate AS InvDocuDate,
        inv.PostID AS InvPostId, inv.PostGL, inv.PostGLDate,
        gl.GLID, gl.DocuNo AS GLDocuNo, gl.DocuDate AS GLDocuDate, gl.JourID, gl.PostID AS GLPostId,
        gl.TotaAmnt AS GLTotalAmnt, inv.NetAmnt AS InvNetAmnt
      FROM dbo.SOInvHD inv
      JOIN dbo.GLHD gl ON gl.PostID = inv.PostID
      WHERE inv.DocuType IN (107, 202)
      ORDER BY inv.DocuDate DESC
    `);
    console.log('Link by PostID:', JSON.stringify(linkByPostId, null, 2));

    // 2. Check if SOInvHD links by FromID or RefNo
    const linkByFromId = await d.query(`
      SELECT TOP 5
        inv.SOInvID, inv.DocuNo AS InvDocuNo, gl.GLID, gl.DocuNo AS GLDocuNo, gl.FromID, gl.RefNo
      FROM dbo.SOInvHD inv
      JOIN dbo.GLHD gl ON gl.FromID = inv.SOInvID OR gl.RefNo = inv.DocuNo
      WHERE inv.DocuType IN (107, 202)
      ORDER BY inv.DocuDate DESC
    `);
    console.log('Link by FromID/RefNo:', JSON.stringify(linkByFromId, null, 2));

    // 3. Check GLDT lines for one matched GLID
    if (linkByPostId.length > 0) {
      const sampleGlid = linkByPostId[0].GLID;
      const gldtLines = await d.query(`
        SELECT dt.GLID, dt.ListNo, dt.AccID, dt.DrAmnt, dt.CrAmnt, acc.AccCode, acc.AccTName
        FROM dbo.GLDT dt
        LEFT JOIN dbo.EMAcc acc ON acc.AccID = dt.AccID
        WHERE dt.GLID = @glid
        ORDER BY dt.ListNo
      `, { glid: { type: d.sql.Int, value: sampleGlid } });
      console.log('GLDT lines for GLID ' + sampleGlid + ':', JSON.stringify(gldtLines, null, 2));
    }
  });
})().catch(console.error).finally(async () => {
  for (const p of Object.values(d.pools('remote_b'))) if (p && p.close) await p.close();
});
