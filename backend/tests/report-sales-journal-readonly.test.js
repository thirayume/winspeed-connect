'use strict';

/**
 * report-sales-journal-readonly.test.js
 *
 * Dedicated committed read-only HTTP & XLSX test suite for GL Sales Journal reports.
 * Fulfills findings V23-01 and V23-03 from Codex Candidate V2.3 Review.
 * 
 * Safety invariants:
 * - Read-only execution against test database (remote_b).
 * - Zero table mutations (no INSERT/UPDATE/DELETE).
 * - No SystemSetting lifecycle mutations.
 * - No ALLOW_TEST_NATIVE_WRITEBACK flag required.
 * - Strict assertTestDatabase() preflight check.
 */

process.env.DB_MODE = 'remote_b';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const { runWithTarget, wfQuery, closeAll, sql } = require('../db');
const { assertTestDatabase } = require('./test-safety');
const { SECRET } = require('../middleware/auth');

let server;
let baseUrl;
let adminToken;

test.before(async () => {
  // Strict test database preflight check
  await assertTestDatabase();

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    runWithTarget('remote_b', next);
  });
  app.use('/api/reports', require('../routes/reports'));
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message, code: err.code });
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  adminToken = jwt.sign(
    { sub: 1, username: 'admin', role: 'ADMIN', name: 'Admin Test' },
    SECRET,
    { expiresIn: '1h' }
  );
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closeAll();
});

// ─────────────────────────────────────────────────────────────
// Test 1: Real Native Sales Journal API and Live GLDT Comparison
// ─────────────────────────────────────────────────────────────
test('Read-Only API: gl-sales-journal returns valid contract and matches authoritative dbo.GLDT for sampled live vouchers', async () => {
  const glRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal?limit=50`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(glRes.status, 200, 'gl-sales-journal must return 200 OK');
  const glData = await glRes.json();
  assert.equal(glData.type, 'gl-sales-journal');
  assert.ok(Array.isArray(glData.rows), 'gl-sales-journal must return array of rows');
  assert.ok(glData.rows.length > 0, 'gl-sales-journal should contain native historical records');

  // Verify pagination and completeness metadata
  assert.ok(glData.meta, 'gl-sales-journal must return metadata object');
  assert.equal(glData.meta.jourId, '1001', 'Default journal scope must be 1001 (Sales Journal)');
  assert.equal(glData.meta.fromFlag, '107', 'Default fromFlag must be 107 (Credit Sales Invoice)');
  assert.equal(glData.meta.status, 'POSTED', 'Default status must be POSTED');
  assert.ok(typeof glData.meta.voucherCount === 'number');
  assert.ok(typeof glData.meta.rowCount === 'number');
  assert.ok(typeof glData.meta.totalMatchingVouchers === 'number');
  assert.ok(typeof glData.meta.isCompleteScope === 'boolean');
  assert.ok(typeof glData.meta.isPartialScope === 'boolean');

  // Verify column contract
  const colKeys = glData.columns.map(c => c.key);
  assert.ok(colKeys.includes('GLID'), 'Must include GLID');
  assert.ok(colKeys.includes('ListNo'), 'Must include ListNo');
  assert.ok(colKeys.includes('JournalNo'), 'Must include JournalNo');
  assert.ok(colKeys.includes('AccountCode'), 'Must include AccountCode');
  assert.ok(colKeys.includes('Debit'), 'Must include Debit');
  assert.ok(colKeys.includes('Credit'), 'Must include Credit');
  assert.ok(colKeys.includes('RefInvoice'), 'Must include RefInvoice');
  assert.ok(colKeys.includes('InvoiceAmbiguity'), 'Must include InvoiceAmbiguity');

  // Assert line uniqueness: (GLID, ListNo) must appear exactly once
  const seenLineKeys = new Set();
  for (const r of glData.rows) {
    const lineKey = `${r.GLID}:${r.ListNo}`;
    assert.ok(!seenLineKeys.has(lineKey), `Duplicate line detected for (GLID, ListNo) = ${lineKey}`);
    seenLineKeys.add(lineKey);
    assert.ok(['EXACT', 'AMBIGUOUS', 'NONE'].includes(r.InvoiceAmbiguity), `Invalid ambiguity state ${r.InvoiceAmbiguity}`);
  }

  // Authoritative GLDT comparison: Sample 5 live vouchers from API response
  const uniqueGLIDs = Array.from(new Set(glData.rows.map(r => r.GLID))).slice(0, 5);
  assert.ok(uniqueGLIDs.length > 0, 'Must have at least one voucher to sample');
  
  for (const glid of uniqueGLIDs) {
    const apiLines = glData.rows.filter(r => r.GLID === glid);
    const dbLinesRes = await wfQuery(`
      SELECT dt.ListNo, CAST(dt.DrAmnt AS DECIMAL(14,2)) AS DrAmnt, CAST(dt.CrAmnt AS DECIMAL(14,2)) AS CrAmnt
      FROM dbo.GLDT dt
      WHERE dt.GLID = @glid
      ORDER BY dt.ListNo ASC
    `, { glid: { type: sql.Int, value: parseInt(glid, 10) } });
    const dbLines = dbLinesRes.recordset || [];

    assert.equal(apiLines.length, dbLines.length, `Line count for sample GLID ${glid} must match authoritative GLDT lines exactly`);
    let totalDr = 0;
    let totalCr = 0;
    for (let i = 0; i < dbLines.length; i++) {
      assert.equal(Number(apiLines[i].ListNo), Number(dbLines[i].ListNo));
      assert.equal(Number(apiLines[i].Debit), Number(dbLines[i].DrAmnt));
      assert.equal(Number(apiLines[i].Credit), Number(dbLines[i].CrAmnt));
      totalDr += Number(apiLines[i].Debit);
      totalCr += Number(apiLines[i].Credit);
    }
    const diff = Math.abs(totalDr - totalCr);
    assert.ok(diff <= 0.01, `Sample voucher GLID ${glid} must be balanced: Dr=${totalDr} Cr=${totalCr} diff=${diff}`);
  }
});

// ─────────────────────────────────────────────────────────────
// Test 2: Real XLSX Export Verification (Buffer Parsing, Summary Row & Numeric Types)
// ─────────────────────────────────────────────────────────────
test('Read-Only Export: XLSX export includes mandatory total summary row with numeric types and cell parity', async () => {
  const glRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal?limit=50`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const glData = await glRes.json();

  const exportRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal/export?limit=50`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(exportRes.status, 200, 'XLSX export must return 200 OK');
  assert.match(exportRes.headers.get('content-type'), /spreadsheetml/, 'Must return Excel content type');

  const arrayBuffer = await exportRes.arrayBuffer();
  const exportBuf = Buffer.from(arrayBuffer);
  assert.ok(exportBuf.length > 0, 'Export buffer must not be empty');

  const workbook = XLSX.read(exportBuf, { type: 'buffer' });
  assert.ok(workbook.SheetNames.length >= 1, 'Workbook must contain at least 1 sheet');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // 2A: Header validation
  const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const headerRowIdx = sheetRows.findIndex(row => Array.isArray(row) && row.includes('รหัส GL'));
  assert.ok(headerRowIdx >= 0, 'Export must include table headers row');
  const headerRow = sheetRows[headerRowIdx];
  assert.ok(headerRow.includes('รหัส GL'));
  assert.ok(headerRow.includes('ลำดับ'));
  assert.ok(headerRow.includes('เลขที่สมุดรายวัน'));
  assert.ok(headerRow.includes('สถานะใบกำกับ'));

  // 2B: Separate data rows and summary total row
  const rowsAfterHeader = sheetRows.slice(headerRowIdx + 1).filter(r => r.length > 0);
  const totalSummaryRow = rowsAfterHeader.find(r => String(r[0] || '').includes('รวมทั้งสิ้น'));
  const dataRows = rowsAfterHeader.filter(r => !String(r[0] || '').includes('รวมทั้งสิ้น'));

  assert.equal(dataRows.length, glData.rows.length, 'Excel data rows count must match JSON API rows count exactly');

  // V23-03 Mandatory requirement: Total summary row MUST exist
  assert.ok(totalSummaryRow, 'XLSX export MUST contain total summary row ("รวมทั้งสิ้น")');

  // 2C: Cell-by-cell parity and numeric cell types
  let totalApiDr = 0;
  let totalApiCr = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const xRow = dataRows[i];
    const apiRow = glData.rows[i];
    const excelRowNumber = headerRowIdx + 2 + i; // 1-indexed

    // Col 0: GLID (identifier string)
    assert.equal(String(xRow[0]).trim(), String(apiRow.GLID).trim(), `Row ${i}: GLID mismatch`);
    // Col 1: ListNo (integer)
    assert.equal(Number(xRow[1]), Number(apiRow.ListNo), `Row ${i}: ListNo mismatch`);

    // Col 6: Debit (number) - check value and cell type in sheet
    const xDr = Number(xRow[6] || 0);
    const apiDr = Number(apiRow.Debit || 0);
    assert.equal(xDr.toFixed(2), apiDr.toFixed(2), `Row ${i}: Debit mismatch`);
    totalApiDr += apiDr;

    const drCell = sheet[XLSX.utils.encode_cell({ r: excelRowNumber - 1, c: 6 })];
    if (drCell && drCell.v !== 0) {
      assert.equal(drCell.t, 'n', `Row ${i} Debit cell must have numeric type 'n'`);
    }

    // Col 7: Credit (number) - check value and cell type in sheet
    const xCr = Number(xRow[7] || 0);
    const apiCr = Number(apiRow.Credit || 0);
    assert.equal(xCr.toFixed(2), apiCr.toFixed(2), `Row ${i}: Credit mismatch`);
    totalApiCr += apiCr;

    const crCell = sheet[XLSX.utils.encode_cell({ r: excelRowNumber - 1, c: 7 })];
    if (crCell && crCell.v !== 0) {
      assert.equal(crCell.t, 'n', `Row ${i} Credit cell must have numeric type 'n'`);
    }

    // Col 9: InvoiceAmbiguity (text)
    assert.equal(String(xRow[9] || '').trim(), String(apiRow.InvoiceAmbiguity).trim(), `Row ${i}: InvoiceAmbiguity mismatch`);
  }

  // 2D: Summary row amounts and cell types
  const xTotalDr = Number(totalSummaryRow[6] || 0);
  const xTotalCr = Number(totalSummaryRow[7] || 0);
  assert.equal(xTotalDr.toFixed(2), totalApiDr.toFixed(2), 'Total row Debit mismatch');
  assert.equal(xTotalCr.toFixed(2), totalApiCr.toFixed(2), 'Total row Credit mismatch');

  const summaryRowIndex = sheetRows.indexOf(totalSummaryRow);
  const summaryDrCell = sheet[XLSX.utils.encode_cell({ r: summaryRowIndex, c: 6 })];
  const summaryCrCell = sheet[XLSX.utils.encode_cell({ r: summaryRowIndex, c: 7 })];
  assert.ok(summaryDrCell, 'Summary Debit cell must exist');
  assert.ok(summaryCrCell, 'Summary Credit cell must exist');
  assert.equal(summaryDrCell.t, 'n', 'Summary Debit cell must have numeric type "n"');
  assert.equal(summaryCrCell.t, 'n', 'Summary Credit cell must have numeric type "n"');
});

// ─────────────────────────────────────────────────────────────
// Test 3: Pagination, Boundary Protection & V23-01 Last-Page Export
// ─────────────────────────────────────────────────────────────
test('Read-Only Boundaries: strict FromFlag rejection, whole-voucher protection, and V23-01 last-page partial export', async () => {
  // 3A: Strict rejection of non-107 FromFlag
  const rej108Res = await fetch(`${baseUrl}/api/reports/gl-sales-journal?fromFlag=108`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(rej108Res.status, 400, 'Must reject fromFlag=108 with 400 Bad Request');
  const rej108Data = await rej108Res.json();
  assert.equal(rej108Data.code, 'INVALID_FROM_FLAG');

  const rejAllRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal?fromFlag=ALL`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(rejAllRes.status, 400, 'Must reject fromFlag=ALL with 400 Bad Request');
  const rejAllData = await rejAllRes.json();
  assert.equal(rejAllData.code, 'INVALID_FROM_FLAG');

  // 3B: Whole-Voucher Boundary Protection (limit: 1 never truncates lines of that voucher)
  const limitOneRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal?limit=1`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(limitOneRes.status, 200);
  const limitOneData = await limitOneRes.json();
  assert.ok(limitOneData.rows.length >= 2, 'Voucher with limit 1 must return all lines of that single voucher (never truncated mid-voucher)');
  const singleGlid = limitOneData.rows[0].GLID;
  for (const r of limitOneData.rows) {
    assert.equal(r.GLID, singleGlid, 'All returned lines must belong to that single selected voucher header');
  }

  // 3C: Truncation transparency on Page 1 (limit: 2)
  const limitTwoRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal?limit=2&page=1`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const limitTwoData = await limitTwoRes.json();
  assert.equal(limitTwoData.meta.voucherLimit, 2);
  assert.equal(limitTwoData.meta.voucherCount, 2);
  if (limitTwoData.meta.totalMatchingVouchers > 2) {
    assert.equal(limitTwoData.meta.hasMore, true);
    assert.equal(limitTwoData.meta.isTruncated, true);
    assert.equal(limitTwoData.meta.isPartialScope, true);
    assert.equal(limitTwoData.meta.isCompleteScope, false);
  }

  // 3D: V23-01 Last-page export test
  // If totalMatchingVouchers > 2, query last page: page = totalPages
  const totalPages = limitTwoData.meta.totalPages || 2;
  const lastPageRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal?limit=2&page=${totalPages}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(lastPageRes.status, 200);
  const lastPageData = await lastPageRes.json();

  // On last page of a multi-page dataset:
  assert.equal(lastPageData.meta.hasMore, false, 'Last page must have hasMore=false');
  assert.equal(lastPageData.meta.hasPrev, true, 'Last page must have hasPrev=true');
  assert.equal(lastPageData.meta.isCompleteScope, false, 'Last page alone is NOT complete scope (V23-01)');
  assert.equal(lastPageData.meta.isPartialScope, true, 'Last page alone MUST be marked isPartialScope=true (V23-01)');
  assert.equal(lastPageData.meta.isTruncated, true, 'Last page alone MUST be marked isTruncated=true (V23-01)');

  // Verify real XLSX export for last page: MUST contain warning banner & partial title
  const exportLastPageRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal/export?limit=2&page=${totalPages}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(exportLastPageRes.status, 200);
  const lastBuf = Buffer.from(await exportLastPageRes.arrayBuffer());
  const lastWb = XLSX.read(lastBuf, { type: 'buffer' });
  const lastSheet = lastWb.Sheets[lastWb.SheetNames[0]];
  const lastSheetRows = XLSX.utils.sheet_to_json(lastSheet, { header: 1 });

  // Banner row present on last page
  const lastBannerRow = lastSheetRows.find(r => Array.isArray(r) && r.some(c => String(c).includes('คำเตือน') && String(c).includes('Partial Export')));
  assert.ok(lastBannerRow, 'Last page export must include prominent Partial Export warning banner (V23-01)');
  assert.match(String(lastBannerRow[0]), /เฉพาะหน้า/);

  // Title row contains [ข้อมูลบางส่วน - Partial Export]
  const lastTitleRow = lastSheetRows.find(r => Array.isArray(r) && r.some(c => String(c).includes('Partial Export') && String(c).includes('รายงาน:')));
  assert.ok(lastTitleRow, 'Last page export title must contain [ข้อมูลบางส่วน - Partial Export] (V23-01)');

  // 3E: scope=all parameter forces offset=0 and expands voucherLimit
  const allRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal?scope=all&from=2026-09-20&to=2026-09-25`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(allRes.status, 200);
  const allData = await allRes.json();
  assert.ok(allData.meta.voucherLimit >= 10000, 'scope=all must expand voucherLimit');
  assert.equal(allData.meta.offset, 0, 'scope=all must force offset to 0');
  assert.equal(allData.meta.page, 1, 'scope=all must force page to 1');
});

// ─────────────────────────────────────────────────────────────
// Test 4: Unavailable Reports Isolation
// ─────────────────────────────────────────────────────────────
test('Read-Only Isolation: Unavailable reports return 503 REPORT_UNAVAILABLE and are marked in types list', async () => {
  // 1. GET /api/reports/cq-cheque-register returns 503 REPORT_UNAVAILABLE
  const cqRes = await fetch(`${baseUrl}/api/reports/cq-cheque-register`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(cqRes.status, 503, 'cq-cheque-register must return 503 Service Unavailable');
  const cqData = await cqRes.json();
  assert.equal(cqData.code, 'REPORT_UNAVAILABLE');
  assert.match(cqData.message, /native cheque register/);

  // 2. GET /api/reports/cq-cheque-register/export returns 503 REPORT_UNAVAILABLE
  const cqExportRes = await fetch(`${baseUrl}/api/reports/cq-cheque-register/export`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(cqExportRes.status, 503, 'cq-cheque-register export must return 503');

  // 3. GET /api/reports/ar-receipt-history returns 503 REPORT_UNAVAILABLE
  const arRes = await fetch(`${baseUrl}/api/reports/ar-receipt-history`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(arRes.status, 503, 'ar-receipt-history must return 503');

  // 4. GET /api/reports/types marks unavailable reports clearly
  const typesRes = await fetch(`${baseUrl}/api/reports/types`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(typesRes.status, 200);
  const typesData = await typesRes.json();
  const cqType = typesData.find(t => t.key === 'cq-cheque-register');
  assert.ok(cqType);
  assert.equal(cqType.available, false);
  assert.match(cqType.title, /ยังไม่เปิดใช้งาน/);
});
