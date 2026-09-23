const d = require('../backend/db');
(async () => {
  await d.runWithTarget('remote_b', async () => {
    // 1. Inspect recent SOInvHD
    const recentInvs = await d.query(`
      SELECT TOP 10
        h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.DocuStatus,
        h.PostID, h.PostGL, h.PostGLDate, h.NetAmnt, h.CustName,
        h.RefSOID, h.SONo
      FROM dbo.SOInvHD h
      WHERE h.DocuType IN (107, 202)
      ORDER BY h.DocuDate DESC, h.SOInvID DESC
    `);
    console.log('Recent SOInvHD:', JSON.stringify(recentInvs, null, 2));

    // 2. Check SOInvDT columns
    const dtCols = await d.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SOInvDT'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('SOInvDT cols:', dtCols.map(c => c.COLUMN_NAME).join(', '));

    // 3. Check sample SOInvDT lines
    if (recentInvs.length > 0) {
      const soinvId = recentInvs[0].SOInvID;
      const lines = await d.query(`
        SELECT TOP 5 d.SOInvID, d.ListNo, d.GoodID, d.GoodQty, d.GoodPrice, d.GoodAmnt, d.RefID, d.RefDocuNo
        FROM dbo.SOInvDT d
        WHERE d.SOInvID = @id
      `, { id: { type: d.sql.Int, value: soinvId } });
      console.log('SOInvDT sample lines:', JSON.stringify(lines, null, 2));
    }
  });
})().catch(console.error).finally(async () => {
  for (const p of Object.values(d.pools('remote_b'))) if (p && p.close) await p.close();
});
