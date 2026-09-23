/**
 * audit-regression-r4.test.js
 * 
 * Deterministic regression tests covering findings R4-01 through R4-03 from:
 * docs/sale-app/qa/CODEX-AUDIT-REVIEW-20260920-R4.md
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
const path = require('node:path');

const linkage = require('../services/native-gl-linkage');
const reports = require('../routes/reports');
const db = require('../db');

test.describe('R4-01: Harmonize GL Evaluation, PostGL Contradictions & Invalid Lines', () => {
  const invoice = {
    SOInvID: 2,
    PostID: 10,
    DocuType: 107,
    DocuNo: 'INV-AUDIT-01',
    PostGL: 'N'
  };

  const header = {
    GLID: 1,
    FromID: 10,
    FromFlag: '107',
    DocuNo: 'JV-AUDIT-01',
    DocuStatus: 'N',
    JourID: '1001'
  };

  const balancedLines = [
    { Debit: 100, Credit: 0, AccID: 1, ListNo: 1 },
    { Debit: 0, Credit: 100, AccID: 2, ListNo: 2 }
  ];

  test('R4-01-1: Flag Contradiction (Balanced GL exists but invoice PostGL=N) must agree on Inconsistent GL', () => {
    // 1. Report evaluator
    const reportRes = linkage.evaluateJournalHeader(header, balancedLines, [invoice]);
    assert.equal(reportRes.isBalanced, true, 'Lines are balanced');
    assert.equal(reportRes.balanceStatus, 'สมดุล (Balanced)');
    assert.equal(
      reportRes.postingStatus,
      'ไม่สอดคล้อง (Inconsistent GL)',
      'Report evaluator must flag PostGL=N with balanced GL as Inconsistent GL, NOT Posted'
    );

    // 2. Recon evaluator
    const candidateHeader = {
      ...header,
      LineCount: 2,
      SumDebit: 100,
      SumCredit: 100,
      JournalDate: '2026-09-20'
    };
    const reconRes = linkage.evaluateSoGlStatus([invoice], [candidateHeader]);
    assert.equal(
      reconRes.verifiedGlStatus,
      'INCONSISTENT',
      'Recon evaluator must flag PostGL=N with balanced GL as INCONSISTENT'
    );

    // 3. Both evaluators agree
    assert.equal(reportRes.postingStatus.includes('ไม่สอดคล้อง'), true);
    assert.equal(reconRes.verifiedGlStatus, 'INCONSISTENT');
  });

  test('R4-01-2: Missing/Null line amounts must NOT report Posted (hasInvalidAmount propagation)', () => {
    const linesWithNull = [
      ...balancedLines,
      { Debit: null, Credit: null, AccID: 3, ListNo: 3 }
    ];

    const reportRes = linkage.evaluateJournalHeader(header, linesWithNull, [{ ...invoice, PostGL: 'Y' }]);
    assert.equal(reportRes.isBalanced, false, 'Journal with null amounts must be unbalanced');
    assert.equal(reportRes.balanceStatus, 'ไม่สมดุล (Unbalanced)');
    assert.equal(
      reportRes.postingStatus,
      'ไม่สมดุล (Unbalanced)',
      'PostingStatus must be ไม่สมดุล (Unbalanced), never ลงบัญชีแล้ว (Posted)'
    );
  });

  test('R4-01-3: Sibling active journals (cardinality violation) must flag Ambiguous Multiple GLs in report', () => {
    const header2 = {
      GLID: 2,
      FromID: 10,
      FromFlag: '107',
      DocuNo: 'JV-AUDIT-02',
      DocuStatus: 'N',
      JourID: '1001'
    };

    const allCandidates = [
      { ...header, LineCount: 2, SumDebit: 100, SumCredit: 100, InvalidLineCount: 0 },
      { ...header2, LineCount: 2, SumDebit: 100, SumCredit: 100, InvalidLineCount: 0 }
    ];

    const reportRes = linkage.evaluateJournalHeader(header, balancedLines, [{ ...invoice, PostGL: 'Y' }], allCandidates);
    assert.equal(
      reportRes.postingStatus,
      'กำกวมหลายใบสำคัญ (Ambiguous Multiple GLs)',
      'When invoice has sibling active journals, report must report Ambiguous Multiple GLs'
    );
  });

  test('R4-01-4: Recon SQL aggregation preserves invalid line count and prevents false balance', () => {
    const fs = require('node:fs');
    const reconSrc = fs.readFileSync(path.resolve(__dirname, '../routes/recon.js'), 'utf8');
    assert.ok(
      reconSrc.includes('InvalidLineCount'),
      'recon.js lookupGL must aggregate InvalidLineCount'
    );

    // Candidate with InvalidLineCount > 0 must be routed to invalidActive in matchGlToInvoice
    const candidateWithInvalid = {
      ...header,
      LineCount: 3,
      SumDebit: 100,
      SumCredit: 100,
      InvalidLineCount: 1
    };

    const matchRes = linkage.matchGlToInvoice({ ...invoice, PostGL: 'Y' }, [candidateWithInvalid]);
    assert.notEqual(matchRes.status, 'VERIFIED', 'Candidate with invalid lines must not be VERIFIED');
    assert.equal(matchRes.status, 'DISCREPANCY', 'Candidate with invalid lines must be DISCREPANCY');
  });
});

test.describe('R4-02 & R4-03: Production Projection SQL Execution on dbwins_worldfert9_test_v2', () => {
  const reportSql = reports.REPORTS['so-sales-billing-projection'].sql;

  function buildTestQuery(cteFixtures) {
    return cteFixtures + reportSql.replace(/^\s*WITH\s+/i, '')
      .replace(/dbo\.SOInvHD/g, 'fSOInvHD')
      .replace(/dbo\.SOInvDT/g, 'fSOInvDT')
      .replace(/dbo\.SOHD/g, 'fSOHD')
      .replace(/dbo\.SODT/g, 'fSODT')
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

  test('R4-02-1: Missing delivery line RefListNo must flag UNKNOWN and nullify EstimatedAmount (R4-02 repro)', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-R4-01', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int)),
        (2, 1, CAST(1000 AS decimal(12,2)), 1, 1)
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 3 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      SELECT 3 SOInvID, 1 ListNo, 2 RefID, CAST(NULL AS int) RefListNo, CAST(500 AS decimal(12,2)) GoodAmnt
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-R4-01');
    assert.equal(rows[0].AllocationStatus, 'UNKNOWN', 'Must be UNKNOWN');
    assert.equal(rows[0].EstimatedAmount, null, 'Unallocated remainder must NOT be shown as confirmed balance');
    assert.ok(rows[0].Note.includes('UNKNOWN Allocation'));
  });

  test('R4-02-2: Genuine header-only direct invoice reference must flag UNKNOWN and nullify EstimatedAmount', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-HDR-DIRECT', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int))
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 3 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      SELECT * FROM (VALUES (CAST(NULL AS int), CAST(NULL AS int), CAST(NULL AS int), CAST(NULL AS int), CAST(NULL AS decimal(12,2))))
      v(SOInvID, ListNo, RefID, RefListNo, GoodAmnt) WHERE 1=0
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-HDR-DIRECT');
    assert.equal(rows[0].AllocationStatus, 'UNKNOWN');
    assert.equal(rows[0].EstimatedAmount, null);
  });

  test('R4-02-3: Genuine header-only via-delivery reference must flag UNKNOWN and nullify EstimatedAmount', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-HDR-VIA-DELIVERY', CAST('20260920' AS date), 'AUDIT CUST'),
        (2, 104, 'N', 'DO-2', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int)),
        (2, 1, CAST(1000 AS decimal(12,2)), 1, 1)
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      -- Invoice references delivery order 2 at header level
      SELECT 3 SOInvID, 107 DocuType, 'N' DocuStatus, 2 RefSOID
    ), fSOInvDT AS (
      SELECT * FROM (VALUES (CAST(NULL AS int), CAST(NULL AS int), CAST(NULL AS int), CAST(NULL AS int), CAST(NULL AS decimal(12,2))))
      v(SOInvID, ListNo, RefID, RefListNo, GoodAmnt) WHERE 1=0
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-HDR-VIA-DELIVERY');
    assert.equal(rows[0].AllocationStatus, 'UNKNOWN');
    assert.equal(rows[0].EstimatedAmount, null);
  });

  test('R4-02-4: Multi-SO delivery order with unallocated line flags UNKNOWN for ALL serviced SOs', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-MULTI-1', CAST('20260920' AS date), 'AUDIT CUST 1'),
        (2, 103, 'N', 'SO-MULTI-2', CAST('20260920' AS date), 'AUDIT CUST 2'),
        (10, 104, 'N', 'DO-MULTI', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(600 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int)),
        (2, 1, CAST(400 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int)),
        -- Delivery 10 services both SO 1 and SO 2
        (10, 1, CAST(600 AS decimal(12,2)), 1, 1),
        (10, 2, CAST(400 AS decimal(12,2)), 2, 1)
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 20 SOInvID, 107 DocuType, 'N' DocuStatus, 10 RefSOID
    ), fSOInvDT AS (
      -- Invoice references Delivery 10 without specific line
      SELECT 20 SOInvID, 1 ListNo, 10 RefID, CAST(NULL AS int) RefListNo, CAST(300 AS decimal(12,2)) GoodAmnt
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 2, 'Both SO 1 and SO 2 must be returned');
    const so1 = rows.find(r => r.DocuNo === 'SO-MULTI-1');
    const so2 = rows.find(r => r.DocuNo === 'SO-MULTI-2');
    assert.ok(so1 && so2, 'Both SOs must exist in result');
    assert.equal(so1.AllocationStatus, 'UNKNOWN');
    assert.equal(so1.EstimatedAmount, null);
    assert.equal(so2.AllocationStatus, 'UNKNOWN');
    assert.equal(so2.EstimatedAmount, null);
  });

  test('R4-02-5: Partially allocated SO with unallocated remainder flags UNKNOWN and nullifies EstimatedAmount', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-PARTIAL', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(600 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int)),
        (1, 2, CAST(400 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int))
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 10 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID UNION ALL
      SELECT 11 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      -- Invoice 10 correctly allocates Line 1
      SELECT 10 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(600 AS decimal(12,2)) GoodAmnt UNION ALL
      -- Invoice 11 has unallocated line for SO 1
      SELECT 11 SOInvID, 1 ListNo, 1 RefID, CAST(NULL AS int) RefListNo, CAST(200 AS decimal(12,2)) GoodAmnt
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-PARTIAL');
    assert.equal(rows[0].AllocationStatus, 'UNKNOWN');
    assert.equal(rows[0].EstimatedAmount, null, 'Partial allocation must not present partial remainder as confirmed');
  });

  test('R4-03-1: Duplicate paths (direct + delivery) deduplicate and do not double count', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-DEDUP', CAST('20260920' AS date), 'AUDIT CUST'),
        (2, 104, 'N', 'DO-DEDUP', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int)),
        (2, 1, CAST(600 AS decimal(12,2)), 1, 1)
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 10 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      -- Invoice 10 line 1 maps BOTH directly (RefID=1) and via DO (RefID=2)
      SELECT 10 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(600 AS decimal(12,2)) GoodAmnt UNION ALL
      SELECT 10 SOInvID, 1 ListNo, 2 RefID, 1 RefListNo, CAST(600 AS decimal(12,2)) GoodAmnt
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-DEDUP');
    assert.equal(rows[0].AllocationStatus, 'NORMAL');
    assert.equal(rows[0].EstimatedAmount, 400.00, 'Must deduplicate to 400 remaining, NOT 1000 - 1200');
  });

  test('R4-03-2: Cancelled documents (DocuStatus = C) are excluded from billing projection', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-CANCELLED-DOCS', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int))
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      -- Cancelled invoice
      SELECT 10 SOInvID, 107 DocuType, 'C' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      SELECT 10 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(500 AS decimal(12,2)) GoodAmnt
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-CANCELLED-DOCS');
    assert.equal(rows[0].AllocationStatus, 'NORMAL');
    assert.equal(rows[0].EstimatedAmount, 1000.00, 'Cancelled invoice must not reduce balance');
  });

  test('R4-03-3: Wrong native document types (101, 116) are excluded from invoice allocation', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-WRONG-TYPES', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int))
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 10 SOInvID, 101 DocuType, 'N' DocuStatus, 1 RefSOID UNION ALL
      SELECT 11 SOInvID, 116 DocuType, 'N' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      SELECT 10 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(400 AS decimal(12,2)) GoodAmnt UNION ALL
      SELECT 11 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(400 AS decimal(12,2)) GoodAmnt
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-WRONG-TYPES');
    assert.equal(rows[0].AllocationStatus, 'NORMAL');
    assert.equal(rows[0].EstimatedAmount, 1000.00, 'DocuType 101/116 must not reduce balance');
  });

  test('R4-03-4: Over-invoicing flags OVER_INVOICED with negative estimated amount', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-OVER-INVOICE', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int))
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 10 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      SELECT 10 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(1500 AS decimal(12,2)) GoodAmnt
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-OVER-INVOICE');
    assert.equal(rows[0].AllocationStatus, 'OVER_INVOICED');
    assert.equal(rows[0].EstimatedAmount, -500.00);
    assert.ok(rows[0].Note.includes('Over-invoiced'));
  });

  test('R4-03-5: Exact 1 satang remainder (0.01) is displayed with NORMAL status', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-ONE-SATANG', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000.00 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int))
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 10 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      SELECT 10 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(999.99 AS decimal(12,2)) GoodAmnt
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].DocuNo, 'SO-ONE-SATANG');
    assert.equal(rows[0].AllocationStatus, 'NORMAL');
    assert.equal(rows[0].EstimatedAmount, 0.01);
  });

  test('R4-03-6: Fully invoiced SO (remainder 0.00) is excluded from billing projection', async () => {
    const fixtures = `WITH fSOHD AS (
      SELECT * FROM (VALUES
        (1, 103, 'N', 'SO-FULLY-BILLED', CAST('20260920' AS date), 'AUDIT CUST')
      ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
    ), fSODT AS (
      SELECT * FROM (VALUES
        (1, 1, CAST(1000.00 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int))
      ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
    ), fSOInvHD AS (
      SELECT 10 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID
    ), fSOInvDT AS (
      SELECT 10 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(1000.00 AS decimal(12,2)) GoodAmnt
    ), `;

    const rows = await runProjectionTest(fixtures);
    assert.equal(rows.length, 0, 'Fully billed SO must not appear in projection report');
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
