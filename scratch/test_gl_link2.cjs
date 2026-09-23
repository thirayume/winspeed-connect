const d = require('../backend/db');
(async () => {
  await d.runWithTarget('remote_b', async () => {
    const res = await d.query(`
      SELECT TOP 5
        inv.SOInvID, inv.DocuNo AS InvDocuNo, inv.DocuDate AS InvDocuDate, inv.DocuType AS InvDocuType,
        inv.PostID AS InvPostId, inv.PostGL, inv.PostGLDate, inv.NetAmnt AS InvNetAmnt,
        gl.GLID, gl.DocuNo AS GLDocuNo, gl.DocuDate AS GLDocuDate, gl.JourID, gl.DocuType AS GLDocuType,
        gl.FromID, gl.FromFlag, gl.DocuStatus AS GLDocuStatus, gl.PostID AS GLPostId, gl.TotaAmnt AS GLTotalAmnt
      FROM dbo.SOInvHD inv
      JOIN dbo.GLHD gl ON gl.FromID = inv.SOInvID
      WHERE inv.DocuType IN (107, 202)
      ORDER BY inv.DocuDate DESC
    `);
    console.log('Detailed link:', JSON.stringify(res, null, 2));

    if (res.length > 0) {
      const glid = res[0].GLID;
      const lines = await d.query(`
        SELECT dt.GLID, dt.ListNo, dt.AccID, dt.DrAmnt, dt.CrAmnt, acc.AccCode, acc.AccTName
        FROM dbo.GLDT dt
        LEFT JOIN dbo.EMAcc acc ON acc.AccID = dt.AccID
        WHERE dt.GLID = @glid
        ORDER BY dt.ListNo
      `, { glid: { type: d.sql.Int, value: glid } });
      console.log('GLDT lines for GLID ' + glid + ':', JSON.stringify(lines, null, 2));
    }
  });
})().catch(console.error).finally(async () => {
  for (const p of Object.values(d.pools('remote_b'))) if (p && p.close) await p.close();
});
