const { runWithTarget, wfQuery } = require('../backend/db');

async function test() {
  await runWithTarget('remote_b', async () => {
    // 1. Check matching latest 50 sales journals via PostID + DocuType
    const res = await wfQuery(`
      SELECT TOP 50 gl.GLID, gl.DocuNo AS GLDocuNo, gl.FromID, gl.FromFlag,
             inv.DocuNo AS InvDocuNo, inv.PostID, inv.DocuType, inv.SOInvID
      FROM dbo.GLHD gl WITH (NOLOCK)
      LEFT JOIN dbo.SOInvHD inv WITH (NOLOCK) ON inv.PostID = gl.FromID AND CAST(inv.DocuType AS VARCHAR(10)) = gl.FromFlag
      WHERE gl.JourID = '1001' AND gl.DocuStatus = 'N'
      ORDER BY gl.GLID DESC
    `);
    const matched = res.recordset.filter(r => r.InvDocuNo != null);
    console.log(`Matched via PostID & DocuType: ${matched.length} / ${res.recordset.length}`);
    if (matched.length > 0) {
      console.log('Sample match:', matched[0]);
    }

    // 2. Check matching via SOInvID
    const res2 = await wfQuery(`
      SELECT TOP 50 gl.GLID, gl.DocuNo AS GLDocuNo, gl.FromID, gl.FromFlag,
             inv.DocuNo AS InvDocuNo, inv.PostID, inv.DocuType, inv.SOInvID
      FROM dbo.GLHD gl WITH (NOLOCK)
      LEFT JOIN dbo.SOInvHD inv WITH (NOLOCK) ON inv.SOInvID = gl.FromID AND CAST(inv.DocuType AS VARCHAR(10)) = gl.FromFlag
      WHERE gl.JourID = '1001' AND gl.DocuStatus = 'N'
      ORDER BY gl.GLID DESC
    `);
    const matched2 = res2.recordset.filter(r => r.InvDocuNo != null);
    console.log(`Matched via SOInvID & DocuType: ${matched2.length} / ${res2.recordset.length}`);
  });
}

test().catch(console.error);
