/**
 * audit-regression-r5.test.js
 * 
 * Deterministic regression tests covering findings R5-01 and R5-02 from:
 * docs/sale-app/qa/CODEX-AUDIT-REVIEW-20260920-R5.md
 *
 * Tests call ACTUAL production modules and production SQL:
 * - backend/services/native-gl-linkage.js
 * - backend/routes/reports.js
 * - backend/routes/recon.js
 * - Production SQL from reports.REPORTS['so-sales-billing-projection'].sql
 *   executed on dbwins_worldfert9_test_v2 with SELECT-only inline CTE fixtures.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const linkage = require('../services/native-gl-linkage');
const reports = require('../routes/reports');
const db = require('../db');

test.describe('R5-01: Partially mapped single invoice with unreferenced lines (Production SQL)', () => {
  const root = path.resolve(__dirname, '..');
  const reportSql = reports.REPORTS['so-sales-billing-projection'].sql;

  function buildTestQuery(fixturesSql) {
    return fixturesSql + reportSql.replace(/^\s*WITH\s+/i, '')
      .replace(/dbo\.SOInvHD/g, 'fSOInvHD').replace(/dbo\.SOInvDT/g, 'fSOInvDT')
      .replace(/dbo\.SOHD/g, 'fSOHD').replace(/dbo\.SODT/g, 'fSODT')
      .replace(/\s+WITH\s*\(NOLOCK\)/gi, '');
  }

  async function runProjectionTest(fixturesSql) {
    return db.runWithTarget('remote_b', async () => {
      const target = (await db.wfQuery('SELECT DB_NAME() AS DbName')).recordset[0].DbName;
      assert.equal(target, 'dbwins_worldfert9_test_v2', 'Must execute SELECT-only on test DB');
      const query = buildTestQuery(fixturesSql);
      const res = await db.wfQuery(query);
      return res.recordset || [];
    });
  }

  test('R5-01-1: Single invoice with line 1 mapped and line 2 unreferenced must return UNKNOWN with null EstimatedAmount', async () => {
    // SO 1 amount 1000; Invoice 3 header RefSOID = 1;
    // Line 1 amount 400 mapped to SO 1; Line 2 amount 100 with RefID/RefListNo NULL
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'AUDIT-SO', CAST('20260920' AS date), 'AUDIT CUSTOMER'),
        (2, 104, 'N', 'AUDIT-DELIVERY', CAST('20260920' AS date), 'AUDIT CUSTOMER')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int)),
        (2, 1, CAST(1000 AS decimal(12,2)), 1, 1)
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 3 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      SELECT 3 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(400 AS decimal(12,2)) GoodAmnt
      UNION ALL
      SELECT 3, 2, CAST(NULL AS int), CAST(NULL AS int), CAST(100 AS decimal(12,2))
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1, 'Exactly 1 row for SO 1 must be returned');
    assert.equal(rows[0].DocuNo, 'AUDIT-SO');
    assert.equal(rows[0].AllocationStatus, 'UNKNOWN', 'AllocationStatus must be UNKNOWN, never NORMAL');
    assert.equal(rows[0].EstimatedAmount, null, 'EstimatedAmount must be null, never 600.00');
    assert.ok(rows[0].Note.includes('UNKNOWN Allocation'), 'Note must indicate unallocated lines');
  });

  test('R5-01-2: Single invoice via delivery 104 with line 1 mapped and line 2 unreferenced must return UNKNOWN', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-VIA-DELIVERY', CAST('20260920' AS date), 'AUDIT CUST'),
        (2, 104, 'N', 'DO-VIA-DELIVERY', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int)),
        (2, 1, CAST(1000 AS decimal(12,2)), 1, 1)
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 10 SOInvID, 107 DocuType, 'N' DocuStatus, 2 RefSOID
    ), fSOInvDT AS (
      -- Line 1 mapped via DO 2
      SELECT 10 SOInvID, 1 ListNo, 2 RefID, 1 RefListNo, CAST(500 AS decimal(12,2)) GoodAmnt
      UNION ALL
      -- Line 2 unreferenced in the same invoice
      SELECT 10, 2, CAST(NULL AS int), CAST(NULL AS int), CAST(200 AS decimal(12,2))
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-VIA-DELIVERY');
    assert.equal(rows[0].AllocationStatus, 'UNKNOWN');
    assert.equal(rows[0].EstimatedAmount, null);
  });

  test('R5-01-3: Fully mapped single invoice (lines 1 & 2 mapped) returns NORMAL with correct remaining balance', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-FULL-MAP', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(600 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int)),
        (1, 2, CAST(400 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int))
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 10 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      -- Both lines mapped
      SELECT 10 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(600 AS decimal(12,2)) GoodAmnt
      UNION ALL
      SELECT 10, 2, 1, 2, CAST(200 AS decimal(12,2))
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-FULL-MAP');
    assert.equal(rows[0].AllocationStatus, 'NORMAL');
    assert.equal(rows[0].EstimatedAmount, 200.00, 'Remaining balance is 1000 - 800 = 200');
  });
});

test.describe('R5-02: Preserve zero-line GL headers in candidate sets (Production SQL & Module)', () => {
  const root = path.resolve(__dirname, '..');

  test('R5-02-1: Production recon lookupGL query preserves zero-line sibling header and evaluates INCONSISTENT', async () => {
    await db.runWithTarget('remote_b', async () => {
      const source = fs.readFileSync(path.join(root, 'routes/recon.js'), 'utf8');
      const glSqlMatch = source.match(/const gls = \(await wfQuery\(`([\s\S]*?)`\)/);
      assert.ok(glSqlMatch, 'Must find lookupGL query in recon.js');
      const glSql = glSqlMatch[1]
        .replace(/\$\{[^}]+\}/g, '10')
        .replace(/dbo\.GLHD/g, 'fGLHD').replace(/dbo\.GLDT/g, 'fGLDT')
        .replace(/dbo\.EMAccJour/g, 'fJour').replace(/\s+WITH\s*\(NOLOCK\)/gi, '');

      const glFixtures = `WITH fGLHD AS (
        SELECT GLID, 'AUDIT' DocuNo, CAST('20260920' AS date) DocuDate, 1001 JourID,
          10 FromID, '107' FromFlag, 'N' DocuStatus, 100 TotaAmnt
        FROM (VALUES (1), (2)) v(GLID)
      ), fGLDT AS (
        SELECT * FROM (VALUES (1, 1, 100, 0), (1, 2, 0, 100)) v(GLID, ListNo, DrAmnt, CrAmnt)
      ), fJour AS (SELECT 1001 JourID, 'AUDIT' JourName) `;

      const candidates = (await db.wfQuery(glFixtures + glSql)).recordset;
      assert.equal(candidates.length, 2, 'lookupGL query must return BOTH active headers, not drop zero-line header');
      const emptyHeader = candidates.find(c => c.GLID === 2 || c.GLID === '2');
      assert.ok(emptyHeader, 'Zero-line header must be in candidates');
      assert.equal(emptyHeader.LineCount, 0, 'Zero-line header must have LineCount 0');

      const invoice = { SOInvID: 2, PostID: 10, DocuType: 107, DocuNo: 'INV-AUDIT', PostGL: 'Y' };
      const reconResult = linkage.evaluateSoGlStatus([invoice], candidates);
      assert.notEqual(reconResult.verifiedGlStatus, 'VERIFIED_GL', 'Zero-line sibling must prevent false VERIFIED_GL');
      assert.equal(reconResult.verifiedGlStatus, 'INCONSISTENT', 'Must evaluate to INCONSISTENT');
    });
  });

  test('R5-02-2: Production reports glCandidates query preserves zero-line sibling and evaluates Ambiguous', async () => {
    await db.runWithTarget('remote_b', async () => {
      const source = fs.readFileSync(path.join(root, 'routes/reports.js'), 'utf8');
      const glMatch = source.match(/SELECT gl\.GLID, gl\.DocuNo, CONVERT\(VARCHAR\(10\), gl\.DocuDate, 120\) AS JournalDate,[\s\S]*?FROM dbo\.GLHD gl WITH \(NOLOCK\)[\s\S]*?GROUP BY gl\.GLID, gl\.DocuNo, gl\.DocuDate, gl\.JourID, gl\.DocuType, gl\.FromID, gl\.FromFlag, gl\.DocuStatus, gl\.TotaAmnt/);
      assert.ok(glMatch, 'Must find glCandidates query in reports.js');
      const glSql = glMatch[0]
        .replace(/\$\{fromIds\.join\('[^']*'\)\}/g, '10')
        .replace(/dbo\.GLHD/g, 'fGLHD').replace(/dbo\.GLDT/g, 'fGLDT')
        .replace(/\s+WITH\s*\(NOLOCK\)/gi, '');

      const glFixtures = `WITH fGLHD AS (
        SELECT GLID, 'AUDIT' DocuNo, CAST('20260920' AS date) DocuDate, 1001 JourID,
          '107' DocuType, 10 FromID, '107' FromFlag, 'N' DocuStatus, 100 TotaAmnt
        FROM (VALUES (1), (2)) v(GLID)
      ), fGLDT AS (
        SELECT * FROM (VALUES (1, 1, 100, 0), (1, 2, 0, 100)) v(GLID, ListNo, DrAmnt, CrAmnt)
      ) `;

      const candidates = (await db.wfQuery(glFixtures + glSql)).recordset;
      assert.equal(candidates.length, 2, 'glCandidates in reports must return BOTH headers');

      const invoice = { SOInvID: 2, PostID: 10, DocuType: '107', DocuNo: 'INV-AUDIT', PostGL: 'Y' };
      const header1 = candidates.find(c => c.GLID === 1 || c.GLID === '1');
      const header1Lines = [{ Debit: 100, Credit: 0 }, { Debit: 0, Credit: 100 }];
      const evalRes1 = linkage.evaluateJournalHeader(header1, header1Lines, [invoice], candidates);
      assert.equal(evalRes1.postingStatus, 'กำกวมหลายใบสำคัญ (Ambiguous Multiple GLs)', 'Header 1 must be flagged ambiguous due to empty sibling');

      const header2 = candidates.find(c => c.GLID === 2 || c.GLID === '2');
      const evalRes2 = linkage.evaluateJournalHeader(header2, [], [invoice], candidates);
      assert.equal(evalRes2.balanceStatus, 'ไม่สมดุล (Unbalanced)', 'Empty header 2 must be unbalanced');
      assert.equal(evalRes2.postingStatus, 'ไม่สมดุล (Unbalanced)', 'Empty header 2 must have unbalanced postingStatus');
    });
  });

  test('R5-02-3: Sole active empty header (0 lines) evaluates to DISCREPANCY / INCONSISTENT, never VERIFIED', () => {
    const emptyCandidate = {
      GLID: 1,
      DocuNo: 'EMPTY-01',
      JournalDate: '2026-09-20',
      JourID: '1001',
      FromID: 10,
      FromFlag: '107',
      DocuStatus: 'N',
      LineCount: 0,
      SumDebit: 0,
      SumCredit: 0,
      InvalidLineCount: 0
    };

    const invoiceY = { SOInvID: 2, PostID: 10, DocuType: 107, DocuNo: 'INV-01', PostGL: 'Y' };
    const resY = linkage.evaluateSoGlStatus([invoiceY], [emptyCandidate]);
    assert.notEqual(resY.verifiedGlStatus, 'VERIFIED_GL', 'Must never be VERIFIED_GL');
    assert.equal(resY.verifiedGlStatus, 'INCONSISTENT', 'PostGL=Y with empty GL must be INCONSISTENT');

    const invoiceN = { SOInvID: 2, PostID: 10, DocuType: 107, DocuNo: 'INV-01', PostGL: 'N' };
    const resN = linkage.evaluateSoGlStatus([invoiceN], [emptyCandidate]);
    assert.notEqual(resN.verifiedGlStatus, 'VERIFIED_GL', 'Must never be VERIFIED_GL');
    assert.equal(resN.verifiedGlStatus, 'INCONSISTENT', 'Empty journal evidence is discrepant');
  });

  test.after(async () => {
    await Promise.allSettled([db.readerReady, db.ownerReady]);
    const pl = db.runWithTarget('remote_b', () => db.pools());
    await Promise.allSettled([
      db.readerPool.close(),
      db.ownerPool.close(),
      pl.readerPool.close(),
      pl.ownerPool.close()
    ]);
  });
});
