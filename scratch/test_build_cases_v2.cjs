const d = require('../backend/db');
const { sql, wfQuery } = d;

const isNum = (s) => /^\d+$/.test(String(s));
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function testRecon() {
  await d.runWithTarget('remote_b', async () => {
    const days = 60;
    // 1) Load recent 50 SOHD
    const rows = (await wfQuery(`
      SELECT TOP 50 CAST(hd.SOID AS VARCHAR(50)) AS SoId, ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
             hd.CustName, hd.TransRegistration AS TruckPlate,
             CONVERT(VARCHAR(10), hd.DocuDate, 120) AS ShipDate, hd.DocuNo AS WsDocuNo,
             hd.DocuStatus, hd.AppvFlag,
             ext.WeighOutWeight, ext.TripId,
             wt.NetKg, wt.Movebill, wt.ScaleNo, wt.Status AS WeighTicketStatus
      FROM dbo.SOHD hd WITH (NOLOCK)
      LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON ext.SOID = hd.SOID
      LEFT JOIN wf.WeighTicket wt WITH (NOLOCK) ON wt.SoId = CAST(hd.SOID AS NVARCHAR(50))
      WHERE hd.DocuType = 103 AND hd.DocuDate >= DATEADD(day, -@d, GETDATE())
      ORDER BY hd.DocuDate DESC
    `, { d: { type: sql.Int, value: days } })).recordset || [];

    console.log(`Loaded ${rows.length} SOHD rows`);

    // 2) Batch lookup invoices
    const ids = [...new Set(rows.map(r => String(r.SoId)).filter(isNum))];
    const idList = ids.length ? ids.map(quote).join(',') : `''`;

    const qDirect = ids.length ? (await wfQuery(`
      SELECT d.RefID AS SoId, h.SOInvID, h.DocuNo, CONVERT(VARCHAR(10), h.DocuDate, 120) AS DocuDate,
             h.DocuType, h.DocuStatus, h.PostID, h.PostGL,
             CONVERT(VARCHAR(10), h.PostGLDate, 120) AS PostGLDate,
             SUM(d.GoodQty2) AS LineQtyTon, SUM(d.GoodAmnt) AS LineAmnt,
             'PRIMARY_103_LINE' AS Provenance
      FROM dbo.SOInvDT d WITH (NOLOCK)
      JOIN dbo.SOInvHD h WITH (NOLOCK) ON h.SOInvID = d.SOInvID AND h.DocuType IN (107, 202)
      WHERE d.RefID IN (${idList})
      GROUP BY d.RefID, h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.DocuStatus, h.PostID, h.PostGL, h.PostGLDate
    `)).recordset || [] : [];

    const qVia104 = ids.length ? (await wfQuery(`
      SELECT dt104.RefSOID AS SoId, h.SOInvID, h.DocuNo, CONVERT(VARCHAR(10), h.DocuDate, 120) AS DocuDate,
             h.DocuType, h.DocuStatus, h.PostID, h.PostGL,
             CONVERT(VARCHAR(10), h.PostGLDate, 120) AS PostGLDate,
             SUM(d.GoodQty2) AS LineQtyTon, SUM(d.GoodAmnt) AS LineAmnt,
             'PRIMARY_104_LINE' AS Provenance
      FROM dbo.SODT dt104 WITH (NOLOCK)
      JOIN dbo.SOInvDT d WITH (NOLOCK) ON d.RefID = dt104.SOID
      JOIN dbo.SOInvHD h WITH (NOLOCK) ON h.SOInvID = d.SOInvID AND h.DocuType IN (107, 202)
      WHERE dt104.RefSOID IN (${idList})
      GROUP BY dt104.RefSOID, h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.DocuStatus, h.PostID, h.PostGL, h.PostGLDate
    `)).recordset || [] : [];

    const qHeaderRef = ids.length ? (await wfQuery(`
      SELECT CAST(h.RefSOID AS VARCHAR(50)) AS SoId, h.SOInvID, h.DocuNo, CONVERT(VARCHAR(10), h.DocuDate, 120) AS DocuDate,
             h.DocuType, h.DocuStatus, h.PostID, h.PostGL,
             CONVERT(VARCHAR(10), h.PostGLDate, 120) AS PostGLDate,
             NULL AS LineQtyTon, h.NetAmnt AS LineAmnt,
             'HEADER_SO_REF' AS Provenance
      FROM dbo.SOInvHD h WITH (NOLOCK)
      WHERE h.DocuType IN (107, 202) AND CAST(h.RefSOID AS VARCHAR(50)) IN (${idList})
    `)).recordset || [] : [];

    const invMap = {};
    for (const x of [...qDirect, ...qVia104, ...qHeaderRef]) {
      const sId = String(x.SoId);
      if (!invMap[sId]) invMap[sId] = [];
      if (!invMap[sId].some(e => e.SOInvID === x.SOInvID)) invMap[sId].push(x);
    }

    console.log(`Invoice matches found for ${Object.keys(invMap).length} SOs`);

    // 3) Batch GL Lookup
    const allInvs = Object.values(invMap).flat();
    const postIds = [...new Set(allInvs.map(i => i.PostID).filter(isNum))];
    let glMap = {};
    if (postIds.length) {
      const gls = (await wfQuery(`
        SELECT gl.GLID, gl.DocuNo, CONVERT(VARCHAR(10), gl.DocuDate, 120) AS DocuDate,
               gl.JourID, jour.JourName, gl.FromID, gl.FromFlag, gl.DocuStatus, gl.TotaAmnt
        FROM dbo.GLHD gl WITH (NOLOCK)
        LEFT JOIN dbo.EMAccJour jour WITH (NOLOCK) ON jour.JourID = gl.JourID
        WHERE gl.JourID = '1001' AND gl.FromID IN (${postIds.map(quote).join(',')})
      `)).recordset || [];
      for (const g of gls) glMap[`${g.FromID}|${g.DocuNo}`] = g;
    }
    console.log(`GL records found: ${Object.keys(glMap).length}`);

    // Print sample summary
    console.log('Sample parsed case:');
    if (rows[0]) {
      const r = rows[0];
      const invList = invMap[String(r.SoId)] || [];
      console.log('SoId:', r.SoId, 'WsDocuNo:', r.WsDocuNo, 'Invoices count:', invList.length);
    }
  });
}

testRecon().catch(console.error).finally(async () => {
  for (const p of Object.values(d.pools('remote_b'))) if (p && p.close) await p.close();
});
