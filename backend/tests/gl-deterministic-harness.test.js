/**
 * gl-deterministic-harness.test.js
 * 
 * S1 & S4 Deterministic Query Harness:
 * - Executes within an isolated database transaction with session temp tables (#GLHD, #GLDT, #SOInvHD, #EMAcc, #EMCust).
 * - Zero writes to persistent dbo tables; shared TEST DB remains 100% read-only.
 * - Deterministically verifies:
 *   1. Duplicate invoice candidate: detail lines are never multiplied; ambiguity set to 'AMBIGUOUS'.
 *   2. Wrong-type collision: Docutype 107 vs 108 on same PostID strictly disambiguated.
 *   3. >2000-line voucher integrity: 2,500 detail lines returned completely and balanced.
 *   4. Exact limit boundary: limit=3 on 3 vouchers yields isTruncated=false; limit=2 yields isTruncated=true.
 *   5. 2 distinct GLIDs sharing same DocuNo.
 *   6. Missing invoice reference handling.
 *   7. Unbalanced voucher detection.
 *   8. Strict rejection of non-107 fromFlag (INVALID_FROM_FLAG, 400).
 */
process.env.DB_MODE = 'remote_b';
process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { wfTransaction, sql, closeAll } = require('../db');
const { assertTestDatabase } = require('./test-safety');
const { runSalesJournalReport, fetchInvoicesByPostIds } = require('../routes/reports').__testing;

test.after(async () => {
  await closeAll();
});

test('GL Deterministic Harness: Comprehensive S1–S4 and V23-01/V23-02 synthetic suite in disposable session temp tables', async () => {
  await assertTestDatabase();

  await wfTransaction(async (tx) => {
    const sessionQuery = async (queryText, inputs = {}) => {
      const req = new sql.Request(tx);
      for (const [k, { type, value }] of Object.entries(inputs)) {
        req.input(k, type, value);
      }
      return await req.query(queryText);
    };

    const tableOverrides = {
      tableHD: '#GLHD',
      tableDT: '#GLDT',
      tableInv: '#SOInvHD',
      tableAcc: '#EMAcc',
      tableCust: '#EMCust',
      queryFn: sessionQuery,
    };

    // ── Setup Disposable Temp Tables in tempdb ──
    await sessionQuery(`
      CREATE TABLE #GLHD (
        GLID INT NOT NULL,
        JourID VARCHAR(10) NOT NULL,
        FromFlag VARCHAR(10) NOT NULL,
        DocuNo NVARCHAR(50) NOT NULL,
        DocuDate DATETIME2 NOT NULL,
        DocuStatus VARCHAR(1) NOT NULL DEFAULT 'N',
        Revflag VARCHAR(1) NULL,
        FromID INT NULL,
        TotaAmnt DECIMAL(14,2) NOT NULL DEFAULT 0,
        GLDesc1 NVARCHAR(255) NULL
      );

      CREATE TABLE #GLDT (
        GLID INT NOT NULL,
        ListNo INT NOT NULL,
        AccID INT NOT NULL,
        DrAmnt DECIMAL(14,2) NOT NULL DEFAULT 0,
        CrAmnt DECIMAL(14,2) NOT NULL DEFAULT 0,
        GLDesc1 NVARCHAR(255) NULL
      );

      CREATE TABLE #SOInvHD (
        SOInvID INT IDENTITY(1,1),
        PostID INT NOT NULL,
        Docutype VARCHAR(10) NOT NULL,
        DocuNo NVARCHAR(50) NOT NULL,
        CustID INT NULL,
        ContactName NVARCHAR(100) NULL
      );

      CREATE TABLE #EMAcc (
        AccID INT NOT NULL,
        AccCode NVARCHAR(50) NOT NULL,
        AccName NVARCHAR(150) NOT NULL
      );

      CREATE TABLE #EMCust (
        CustID INT NOT NULL,
        CustName NVARCHAR(150) NOT NULL
      );
    `);

    // Populate chart of accounts & customer master
    await sessionQuery(`
      INSERT INTO #EMAcc (AccID, AccCode, AccName) VALUES
        (101, '1111-01', N'เงินสดในมือ'),
        (102, '1113-01', N'ลูกหนี้การค้า'),
        (401, '4111-01', N'รายได้จากการขายปุ๋ย');

      INSERT INTO #EMCust (CustID, CustName) VALUES
        (1, N'บริษัท เกษตรไทย จำกัด'),
        (2, N'สหกรณ์การเกษตร ทุ่งทอง');
    `);

    // ── Test 1: Duplicate invoice candidates do not multiply financial lines ──
    await sessionQuery(`
      INSERT INTO #GLHD (GLID, JourID, FromFlag, DocuNo, DocuDate, DocuStatus, FromID, TotaAmnt, GLDesc1)
      VALUES (10, '1001', '107', 'JV-DUP-INV', '2026-09-25', 'N', 5001, 1000.00, N'ทดสอบ invoice ซ้ำ');

      INSERT INTO #GLDT (GLID, ListNo, AccID, DrAmnt, CrAmnt, GLDesc1) VALUES
        (10, 1, 102, 1000.00, 0.00, N'ลูกหนี้การค้า'),
        (10, 2, 401, 0.00, 1000.00, N'ขายปุ๋ย');

      -- 2 invoice headers sharing PostID 5001 with same Docutype 107
      INSERT INTO #SOInvHD (PostID, Docutype, DocuNo, CustID) VALUES
        (5001, '107', 'INV-5001-A', 1),
        (5001, '107', 'INV-5001-B', 1);
    `);

    const dupRows = await runSalesJournalReport({ journalNo: 'JV-DUP-INV' }, tableOverrides);
    assert.equal(dupRows.length, 2, 'Financial detail lines must NEVER be multiplied (expected exactly 2 rows)');
    assert.equal(dupRows[0].InvoiceAmbiguity, 'AMBIGUOUS', 'Must mark ambiguity as AMBIGUOUS');
    assert.equal(dupRows[0].RefInvoice, 'INV-5001-A, INV-5001-B', 'Must concatenate invoice numbers');
    assert.equal(dupRows[0].CustName, 'บริษัท เกษตรไทย จำกัด');

    // ── Test 2: Wrong-type collision disambiguation (107 vs 108 sharing PostID) ──
    await sessionQuery(`
      INSERT INTO #GLHD (GLID, JourID, FromFlag, DocuNo, DocuDate, DocuStatus, FromID, TotaAmnt, GLDesc1)
      VALUES (20, '1001', '107', 'JV-TYPE-COLLISION', '2026-09-25', 'N', 5002, 500.00, N'ทดสอบชนประเภท 107/108');

      INSERT INTO #GLDT (GLID, ListNo, AccID, DrAmnt, CrAmnt, GLDesc1) VALUES
        (20, 1, 102, 500.00, 0.00, N'ลูกหนี้การค้า'),
        (20, 2, 401, 0.00, 500.00, N'ขายปุ๋ย');

      -- SOInvHD has two rows for PostID 5002: one for 107 and one for 108
      INSERT INTO #SOInvHD (PostID, Docutype, DocuNo, CustID) VALUES
        (5002, '107', 'INV-CREDIT-SALE', 1),
        (5002, '108', 'INV-CASH-SALE', 2);
    `);

    const typeRows = await runSalesJournalReport({ journalNo: 'JV-TYPE-COLLISION' }, tableOverrides);
    assert.equal(typeRows.length, 2);
    assert.equal(typeRows[0].InvoiceAmbiguity, 'EXACT', 'Must strictly match Docutype 107 and not collide with 108');
    assert.equal(typeRows[0].RefInvoice, 'INV-CREDIT-SALE', 'Must resolve only the 107 invoice');
    assert.equal(typeRows[0].CustName, 'บริษัท เกษตรไทย จำกัด');

    // ── Test 3: Large Voucher Integrity (>2000 detail lines in a single voucher) ──
    await sessionQuery(`
      INSERT INTO #GLHD (GLID, JourID, FromFlag, DocuNo, DocuDate, DocuStatus, FromID, TotaAmnt, GLDesc1)
      VALUES (30, '1001', '107', 'JV-LARGE-VOUCHER', '2026-09-25', 'N', NULL, 25000.00, N'เอกสารขนาดใหญ่ 2500 บรรทัด');

      -- Generate 2500 detail lines using a recursive CTE
      ;WITH Nums AS (
        SELECT 1 AS n
        UNION ALL
        SELECT n + 1 FROM Nums WHERE n < 2500
      )
      INSERT INTO #GLDT (GLID, ListNo, AccID, DrAmnt, CrAmnt, GLDesc1)
      SELECT
        30,
        n,
        CASE WHEN n % 2 = 1 THEN 102 ELSE 401 END,
        CASE WHEN n % 2 = 1 THEN 10.00 ELSE 0.00 END,
        CASE WHEN n % 2 = 1 THEN 0.00 ELSE 10.00 END,
        CONCAT(N'บรรทัดที่ ', n)
      FROM Nums
      OPTION (MAXRECURSION 3000);
    `);

    const largeRows = await runSalesJournalReport({ journalNo: 'JV-LARGE-VOUCHER' }, tableOverrides);
    assert.equal(largeRows.length, 2500, 'Must retrieve all 2,500 detail lines without mid-voucher truncation');
    const totalDr = largeRows.reduce((s, r) => s + Number(r.Debit || 0), 0);
    const totalCr = largeRows.reduce((s, r) => s + Number(r.Credit || 0), 0);
    assert.equal(totalDr, 12500.00, 'Total debit must match');
    assert.equal(totalCr, 12500.00, 'Total credit must match');
    assert.equal(largeRows.meta.voucherCount, 1, 'Voucher count must be exactly 1');
    assert.equal(largeRows.meta.isTruncated, false, 'Should not be marked truncated when all matching vouchers fit');

    // ── Test 4: Exact Limit vs Limit + 1 Boundary Semantics ──
    // Insert 3 distinct vouchers for a specific date
    await sessionQuery(`
      INSERT INTO #GLHD (GLID, JourID, FromFlag, DocuNo, DocuDate, DocuStatus, FromID, TotaAmnt, GLDesc1)
      VALUES
        (41, '1001', '107', 'JV-BOUND-01', '2026-09-20', 'N', NULL, 100.00, N'B1'),
        (42, '1001', '107', 'JV-BOUND-02', '2026-09-20', 'N', NULL, 200.00, N'B2'),
        (43, '1001', '107', 'JV-BOUND-03', '2026-09-20', 'N', NULL, 300.00, N'B3');

      INSERT INTO #GLDT (GLID, ListNo, AccID, DrAmnt, CrAmnt) VALUES
        (41, 1, 102, 100.00, 0.00), (41, 2, 401, 0.00, 100.00),
        (42, 1, 102, 200.00, 0.00), (42, 2, 401, 0.00, 200.00),
        (43, 1, 102, 300.00, 0.00), (43, 2, 401, 0.00, 300.00);
    `);

    // 4A: Exact limit query (limit: 3 on 3 matching vouchers) -> FALSE POSITIVE ELIMINATED
    const exactRows = await runSalesJournalReport({
      from: '2026-09-20',
      to: '2026-09-20',
      limit: '3'
    }, tableOverrides);
    assert.equal(exactRows.meta.voucherCount, 3, 'Must fetch all 3 vouchers');
    assert.equal(exactRows.meta.totalMatchingVouchers, 3, 'Total matching must be 3');
    assert.equal(exactRows.meta.hasMore, false, 'hasMore must be false when exact limit equals total');
    assert.equal(exactRows.meta.isTruncated, false, 'isTruncated must be false at exact limit (S2 finding resolved!)');

    // 4B: Limit + 1 boundary query (limit: 2 on 3 matching vouchers) -> PROPERLY DETECTS TRUNCATION
    const truncRows = await runSalesJournalReport({
      from: '2026-09-20',
      to: '2026-09-20',
      limit: '2'
    }, tableOverrides);
    assert.equal(truncRows.meta.voucherCount, 2, 'Must fetch capped 2 vouchers');
    assert.equal(truncRows.meta.totalMatchingVouchers, 3, 'Total matching remains 3');
    assert.equal(truncRows.meta.hasMore, true, 'hasMore must be true when more records exist');
    assert.equal(truncRows.meta.isTruncated, true, 'isTruncated must be true');

    // ── Test 5: Two distinct GLIDs sharing identical DocuNo ──
    await sessionQuery(`
      INSERT INTO #GLHD (GLID, JourID, FromFlag, DocuNo, DocuDate, DocuStatus, FromID, TotaAmnt, GLDesc1)
      VALUES
        (51, '1001', '107', 'JV-SHARED-DOCUNO', '2026-09-22', 'N', NULL, 150.00, N'Doc 1'),
        (52, '1001', '107', 'JV-SHARED-DOCUNO', '2026-09-22', 'N', NULL, 250.00, N'Doc 2');

      INSERT INTO #GLDT (GLID, ListNo, AccID, DrAmnt, CrAmnt) VALUES
        (51, 1, 102, 150.00, 0.00), (51, 2, 401, 0.00, 150.00),
        (52, 1, 102, 250.00, 0.00), (52, 2, 401, 0.00, 250.00);
    `);

    const sharedRows = await runSalesJournalReport({ journalNo: 'JV-SHARED-DOCUNO' }, tableOverrides);
    assert.equal(sharedRows.length, 4, 'Must return 4 lines total for the two vouchers');
    const glids = Array.from(new Set(sharedRows.map(r => r.GLID)));
    assert.equal(glids.length, 2, 'Must track 2 distinct GLIDs despite shared DocuNo');
    assert.ok(glids.includes(51) && glids.includes(52));

    // ── Test 6: Missing Invoice Reference ──
    await sessionQuery(`
      INSERT INTO #GLHD (GLID, JourID, FromFlag, DocuNo, DocuDate, DocuStatus, FromID, TotaAmnt, GLDesc1)
      VALUES (60, '1001', '107', 'JV-MISSING-INV', '2026-09-23', 'N', 999999, 100.00, N'ไม่มีใบกำกับ');

      INSERT INTO #GLDT (GLID, ListNo, AccID, DrAmnt, CrAmnt) VALUES
        (60, 1, 102, 100.00, 0.00), (60, 2, 401, 0.00, 100.00);
    `);

    const missingRows = await runSalesJournalReport({ journalNo: 'JV-MISSING-INV' }, tableOverrides);
    assert.equal(missingRows.length, 2);
    assert.equal(missingRows[0].InvoiceAmbiguity, 'NONE');
    assert.equal(missingRows[0].RefInvoice, '999999', 'Falls back to FromID string');
    assert.equal(missingRows[0].CustName, '-');

    // ── Test 7: Unbalanced Voucher Detection ──
    await sessionQuery(`
      INSERT INTO #GLHD (GLID, JourID, FromFlag, DocuNo, DocuDate, DocuStatus, FromID, TotaAmnt, GLDesc1)
      VALUES (70, '1001', '107', 'JV-UNBALANCED', '2026-09-24', 'N', NULL, 100.00, N'ไม่ดุล');

      INSERT INTO #GLDT (GLID, ListNo, AccID, DrAmnt, CrAmnt) VALUES
        (70, 1, 102, 100.00, 0.00), (70, 2, 401, 0.00, 85.00);
    `);

    const unbRows = await runSalesJournalReport({ journalNo: 'JV-UNBALANCED' }, tableOverrides);
    assert.equal(unbRows.length, 2);
    const dr = unbRows.reduce((s, r) => s + Number(r.Debit || 0), 0);
    const cr = unbRows.reduce((s, r) => s + Number(r.Credit || 0), 0);
    assert.equal(dr, 100.00);
    assert.equal(cr, 85.00);
    assert.equal(Math.abs(dr - cr), 15.00, 'Difference of 15.00 must be accurately preserved');

    // ── Test 8: Strict Rejection of Non-107 FromFlag ──
    await assert.rejects(
      async () => {
        await runSalesJournalReport({ fromFlag: '108' }, tableOverrides);
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'INVALID_FROM_FLAG');
        assert.match(err.message, /รองรับเฉพาะ FromFlag=107/);
        return true;
      },
      'Must reject fromFlag=108 with 400 INVALID_FROM_FLAG'
    );

    await assert.rejects(
      async () => {
        await runSalesJournalReport({ fromFlag: 'ALL' }, tableOverrides);
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'INVALID_FROM_FLAG');
        return true;
      },
      'Must reject fromFlag=ALL with 400 INVALID_FROM_FLAG'
    );

    // ── Test 9: V23-01 Last-Page Export Partial Status ──
    // In #GLHD we have 3 vouchers for date 2026-09-20 (GLID 1, 2, 3).
    // Query limit: 2, page: 2 (last page containing 1 voucher)
    const lastPageResult = await runSalesJournalReport({
      from: '2026-09-20',
      to: '2026-09-20',
      limit: '2',
      page: '2'
    }, tableOverrides);
    assert.equal(lastPageResult.meta.voucherCount, 1, 'Last page must return remaining 1 voucher');
    assert.equal(lastPageResult.meta.totalMatchingVouchers, 3, 'Total matching must be 3');
    assert.equal(lastPageResult.meta.hasMore, false, 'hasMore must be false on last page');
    assert.equal(lastPageResult.meta.hasPrev, true, 'hasPrev must be true on page 2');
    assert.equal(lastPageResult.meta.isTruncated, true, 'isTruncated must be true on last page (omits previous pages)');
    assert.equal(lastPageResult.meta.isPartialScope, true, 'isPartialScope must be true on last page (V23-01)');
    assert.equal(lastPageResult.meta.isCompleteScope, false, 'isCompleteScope must be false on last page (V23-01)');

    // ── Test 10: V23-02 Out-of-Range Page Preserves Metadata ──
    const outOfRangeResult = await runSalesJournalReport({
      from: '2026-09-20',
      to: '2026-09-20',
      limit: '2',
      page: '999'
    }, tableOverrides);
    assert.equal(outOfRangeResult.length, 0, 'Out-of-range page must return 0 rows');
    assert.equal(outOfRangeResult.meta.voucherCount, 0);
    assert.equal(outOfRangeResult.meta.totalMatchingVouchers, 3, 'Total matching must be preserved even on page 999 (V23-02)');
    assert.equal(outOfRangeResult.meta.hasMore, false);
    assert.equal(outOfRangeResult.meta.hasPrev, true);
    assert.equal(outOfRangeResult.meta.isPartialScope, true);
    assert.equal(outOfRangeResult.meta.isCompleteScope, false);

    // ── Test 11: V23-02 Header with Missing GLDT Details ──
    await sessionQuery(`
      INSERT INTO #GLHD (GLID, JourID, FromFlag, DocuNo, DocuDate, DocuStatus, FromID, TotaAmnt, GLDesc1)
      VALUES (90, '1001', '107', 'JV-NO-DETAILS', '2026-09-26', 'N', NULL, 500.00, N'ไม่มีรายละเอียด');
    `);
    const noDetailResult = await runSalesJournalReport({ journalNo: 'JV-NO-DETAILS' }, tableOverrides);
    assert.equal(noDetailResult.length, 0, 'No detail lines exist, must not fabricate zero GL lines');
    assert.equal(noDetailResult.meta.totalMatchingVouchers, 1, 'Header was matched');
    assert.equal(noDetailResult.meta.missingDetailCount, 1, 'Must detect 1 voucher missing details (V23-02)');
    assert.equal(noDetailResult.meta.missingDetailVouchers?.[0]?.GLID, 90);
    assert.equal(noDetailResult.meta.isCompleteScope, false, 'Incomplete data must not claim completeness (V23-02)');
    assert.equal(noDetailResult.meta.isPartialScope, true);

    // ── Test 12: V23-02 Mixed Valid and Missing Details ──
    await sessionQuery(`
      INSERT INTO #GLHD (GLID, JourID, FromFlag, DocuNo, DocuDate, DocuStatus, FromID, TotaAmnt, GLDesc1)
      VALUES
        (91, '1001', '107', 'JV-MIXED-1', '2026-09-27', 'N', NULL, 100.00, N'มีรายละเอียด'),
        (92, '1001', '107', 'JV-MIXED-2', '2026-09-27', 'N', NULL, 200.00, N'ไม่มีรายละเอียด');

      INSERT INTO #GLDT (GLID, ListNo, AccID, DrAmnt, CrAmnt) VALUES
        (91, 1, 102, 100.00, 0.00), (91, 2, 401, 0.00, 100.00);
    `);
    const mixedResult = await runSalesJournalReport({
      from: '2026-09-27',
      to: '2026-09-27'
    }, tableOverrides);
    assert.equal(mixedResult.length, 2, 'Only returns detail rows of voucher 91');
    assert.equal(mixedResult.meta.voucherCount, 2, 'Selected 2 vouchers');
    assert.equal(mixedResult.meta.totalMatchingVouchers, 2);
    assert.equal(mixedResult.meta.missingDetailCount, 1, 'Must detect voucher 92 missing details');
    assert.equal(mixedResult.meta.missingDetailVouchers?.[0]?.GLID, 92);
    assert.equal(mixedResult.meta.isCompleteScope, false);
    assert.equal(mixedResult.meta.isPartialScope, true);

    // ── Test 13: Genuinely Empty Filters ──
    const emptyResult = await runSalesJournalReport({
      from: '2020-01-01',
      to: '2020-01-02'
    }, tableOverrides);
    assert.equal(emptyResult.length, 0);
    assert.equal(emptyResult.meta.totalMatchingVouchers, 0);
    assert.equal(emptyResult.meta.voucherCount, 0);
    assert.equal(emptyResult.meta.missingDetailCount, 0);
    assert.equal(emptyResult.meta.isCompleteScope, true, 'Empty filter is considered complete scope of empty results');
    assert.equal(emptyResult.meta.isPartialScope, false);
    assert.equal(emptyResult.meta.hasMore, false);

    // Rollback explicitly to guarantee zero side-effects and cleanup
    throw new Error('DETERMINISTIC_HARNESS_CLEANUP_ROLLBACK');
  }).catch((err) => {
    if (err.message === 'DETERMINISTIC_HARNESS_CLEANUP_ROLLBACK') {
      // Expected clean exit
      return;
    }
    throw err;
  });
});
