'use strict';
const assert = require('node:assert/strict');
const db = require('../backend/db');
const link = require('../backend/services/native-gl-linkage');

(async () => {
  try {
    await db.runWithTarget('remote_b', async () => {
      // Test with LEFT JOIN on GLDT
      const glSql = `
        SELECT gl.GLID, gl.DocuNo, CONVERT(VARCHAR(10), gl.DocuDate, 120) AS JournalDate,
               gl.JourID, jour.JourName, gl.FromID, gl.FromFlag, gl.DocuStatus, gl.TotaAmnt,
               COUNT(dt.ListNo) AS LineCount,
               ISNULL(SUM(dt.DrAmnt), 0) AS SumDebit,
               ISNULL(SUM(dt.CrAmnt), 0) AS SumCredit,
               SUM(CASE WHEN dt.ListNo IS NOT NULL AND (dt.DrAmnt IS NULL OR dt.CrAmnt IS NULL) THEN 1 ELSE 0 END) AS InvalidLineCount
        FROM fGLHD gl
        LEFT JOIN fJour jour ON jour.JourID = gl.JourID
        LEFT JOIN fGLDT dt ON dt.GLID = gl.GLID
        WHERE gl.JourID = '1001'
          AND gl.FromFlag IN ('107', '202')
          AND gl.FromID IN (10)
        GROUP BY gl.GLID, gl.DocuNo, gl.DocuDate, gl.JourID, jour.JourName, gl.FromID, gl.FromFlag, gl.DocuStatus, gl.TotaAmnt
      `;

      const glFixtures = `WITH fGLHD AS (
        SELECT GLID, 'AUDIT' DocuNo, CAST('20260920' AS date) DocuDate, 1001 JourID,
          10 FromID, '107' FromFlag, 'N' DocuStatus, 100 TotaAmnt
        FROM (VALUES (1), (2)) v(GLID)
      ), fGLDT AS (
        SELECT * FROM (VALUES (1, 1, 100, 0), (1, 2, 0, 100)) v(GLID, ListNo, DrAmnt, CrAmnt)
      ), fJour AS (SELECT 1001 JourID, 'AUDIT' JourName) `;

      const candidates = (await db.wfQuery(glFixtures + glSql)).recordset;
      console.log('Candidates returned:', JSON.stringify(candidates));

      assert.equal(candidates.length, 2, 'Both headers must be returned by SQL query');
      const headerWithNoLines = candidates.find(c => c.GLID === 2 || c.GLID === '2');
      assert.ok(headerWithNoLines, 'Header 2 must exist');
      assert.equal(headerWithNoLines.LineCount, 0, 'Header 2 must have LineCount 0');

      const inv = { SOInvID: 2, PostID: 10, DocuType: 107, DocuNo: 'AUDIT', PostGL: 'Y' };
      const res = link.evaluateSoGlStatus([inv], candidates);
      console.log('evaluateSoGlStatus result:', JSON.stringify(res));

      assert.notEqual(res.verifiedGlStatus, 'VERIFIED_GL', 'Empty sibling must block VERIFIED_GL');
      assert.equal(res.verifiedGlStatus, 'INCONSISTENT', 'Must evaluate to INCONSISTENT');
      console.log('✓ R5-02 Recon Test PASSED!');
    });
  } finally {
    await Promise.allSettled([db.readerReady, db.ownerReady]);
    const pl = db.runWithTarget('remote_b', () => db.pools());
    await Promise.allSettled([db.readerPool.close(), db.ownerPool.close(), pl.readerPool.close(), pl.ownerPool.close()]);
  }
})();
