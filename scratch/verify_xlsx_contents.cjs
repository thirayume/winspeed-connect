'use strict';
/**
 * scratch/verify_xlsx_contents.cjs
 * 
 * Verifies that API and XLSX export produce identical statuses, amounts,
 * and column contracts on dbwins_worldfert9_test_v2.
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const express = require(root + '/backend/node_modules/express');
const jwt = require(root + '/backend/node_modules/jsonwebtoken');
const XLSX = require(root + '/backend/node_modules/xlsx');
const db = require(root + '/backend/db');
const { assertTestDatabase } = require(root + '/backend/tests/test-safety');

let server;
let baseUrl;

const secret = process.env.JWT_SECRET || 'worldfert-secret-2026';

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    db.runWithTarget('remote_b', next);
  });
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      try {
        req.user = jwt.verify(auth.slice(7), secret);
      } catch (e) {}
    }
    next();
  });
  app.use('/api/reports', require(root + '/backend/routes/reports'));
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message });
  });

  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

(async () => {
  try {
    await startServer();
    await db.runWithTarget('remote_b', async () => {
      const { dbName } = await assertTestDatabase();
      assert.equal(dbName, 'dbwins_worldfert9_test_v2', 'Must run on dbwins_worldfert9_test_v2');
      console.log('Connected to TEST DB:', dbName);
    });

    const token = jwt.sign(
      { id: 1, username: 'test_admin', role: 'ADMIN' },
      secret,
      { expiresIn: '1h' }
    );
    const headers = { Authorization: `Bearer ${token}` };

    // ── 1. Verify so-sales-billing-projection (API vs XLSX) ───────────────────
    console.log('\n--- 1. Testing so-sales-billing-projection ---');
    const projApiRes = await fetch(`${baseUrl}/api/reports/so-sales-billing-projection`, { headers });
    assert.equal(projApiRes.status, 200, 'API must return 200');
    const projApiData = await projApiRes.json();
    console.log(`API returned ${projApiData.rows.length} rows`);

    const projXlsxRes = await fetch(`${baseUrl}/api/reports/so-sales-billing-projection/export?format=xlsx`, { headers });
    assert.equal(projXlsxRes.status, 200, 'Export must return 200');
    const projBuf = Buffer.from(await projXlsxRes.arrayBuffer());
    assert.equal(projBuf[0], 0x50, 'Must have PK zip header byte 0');
    assert.equal(projBuf[1], 0x4B, 'Must have PK zip header byte 1');

    const projWb = XLSX.read(projBuf, { type: 'buffer' });
    const projSheet = projWb.Sheets['Report'];
    assert.ok(projSheet, 'Sheet "Report" must exist');
    const projAoa = XLSX.utils.sheet_to_json(projSheet, { header: 1 });

    // Find table header row (e.g. contains 'เลขที่เอกสาร SO')
    const headerRowIdx = projAoa.findIndex(row => Array.isArray(row) && row.includes('เลขที่เอกสาร SO'));
    assert.ok(headerRowIdx >= 0, 'Header row must be present');
    const colLabels = projAoa[headerRowIdx];
    const docuNoCol = colLabels.indexOf('เลขที่เอกสาร SO');
    const estAmtCol = colLabels.indexOf('มูลค่าขายประมาณการ (บาท)');
    const statusCol = colLabels.indexOf('สถานะการจัดสรร');

    // Data rows start after header row
    const dataRows = projAoa.slice(headerRowIdx + 1);
    // If total row exists, last row has 'รวมทั้งสิ้น (Total)' in col 0
    let hasTotalRow = false;
    let tableDataRows = dataRows;
    if (dataRows.length > 0 && String(dataRows[dataRows.length - 1][0]).includes('รวมทั้งสิ้น')) {
      hasTotalRow = true;
      tableDataRows = dataRows.slice(0, -1);
    }

    assert.equal(tableDataRows.length, projApiData.rows.length, 'Row count between API and XLSX data rows must match');

    // Verify row by row
    let apiSum = 0;
    for (let i = 0; i < projApiData.rows.length; i++) {
      const apiRow = projApiData.rows[i];
      const xlsxRow = tableDataRows[i];

      assert.equal(xlsxRow[docuNoCol], apiRow.DocuNo, `Row ${i} DocuNo must match`);
      assert.equal(xlsxRow[statusCol], apiRow.AllocationStatus, `Row ${i} AllocationStatus must match`);

      if (apiRow.AllocationStatus === 'UNKNOWN') {
        assert.equal(apiRow.EstimatedAmount, null, `API UNKNOWN row ${i} must have null EstimatedAmount`);
        assert.ok(
          xlsxRow[estAmtCol] === undefined || xlsxRow[estAmtCol] === '' || xlsxRow[estAmtCol] === null,
          `XLSX UNKNOWN row ${i} must have empty cell for EstimatedAmount, got: ${xlsxRow[estAmtCol]}`
        );
      } else {
        const expectedAmt = Number(apiRow.EstimatedAmount);
        const actualAmt = Number(xlsxRow[estAmtCol]);
        assert.equal(actualAmt, expectedAmt, `Row ${i} EstimatedAmount must match`);
        apiSum += expectedAmt;
      }
    }

    if (hasTotalRow) {
      const xlsxTotalRow = dataRows[dataRows.length - 1];
      const xlsxTotal = Number(xlsxTotalRow[estAmtCol]);
      assert.equal(
        Math.round(xlsxTotal * 100),
        Math.round(apiSum * 100),
        `Total row sum in XLSX (${xlsxTotal}) must equal verified API sum (${apiSum.toFixed(2)})`
      );
      console.log(`✓ Total row sum matched: ${xlsxTotal} (no UNKNOWN amounts contaminated the sum)`);
    }
    console.log('✓ so-sales-billing-projection API and XLSX match 100%');

    // ── 2. Verify gl-sales-journal (API vs XLSX) ─────────────────────────────
    console.log('\n--- 2. Testing gl-sales-journal ---');
    const glApiRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal?days=60`, { headers });
    assert.equal(glApiRes.status, 200, 'GL journal API must return 200');
    const glApiData = await glApiRes.json();
    console.log(`GL API returned ${glApiData.rows.length} rows`);

    const glXlsxRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal/export?format=xlsx&days=60`, { headers });
    assert.equal(glXlsxRes.status, 200, 'GL export must return 200');
    const glBuf = Buffer.from(await glXlsxRes.arrayBuffer());

    const glWb = XLSX.read(glBuf, { type: 'buffer' });
    const glSheet = glWb.Sheets['Report'];
    assert.ok(glSheet, 'GL Sheet "Report" must exist');
    const glAoa = XLSX.utils.sheet_to_json(glSheet, { header: 1 });

    const glHdrIdx = glAoa.findIndex(row => Array.isArray(row) && row.includes('เลขที่สมุดรายวัน'));
    assert.ok(glHdrIdx >= 0, 'GL Header row must be present');
    const glLabels = glAoa[glHdrIdx];
    const jNoCol = glLabels.indexOf('เลขที่สมุดรายวัน');
    const drCol = glLabels.indexOf('เดบิต (บาท)');
    const crCol = glLabels.indexOf('เครดิต (บาท)');
    const balCol = glLabels.indexOf('สถานะสมดุล');
    const postCol = glLabels.indexOf('สถานะ Posting');

    const glDataRows = glAoa.slice(glHdrIdx + 1);
    let glTableRows = glDataRows;
    if (glDataRows.length > 0 && String(glDataRows[glDataRows.length - 1][0]).includes('รวมทั้งสิ้น')) {
      glTableRows = glDataRows.slice(0, -1);
    }

    assert.equal(glTableRows.length, glApiData.rows.length, 'GL Row count between API and XLSX data rows must match');

    for (let i = 0; i < glApiData.rows.length; i++) {
      const apiRow = glApiData.rows[i];
      const xlsxRow = glTableRows[i];

      assert.equal(xlsxRow[jNoCol], apiRow.JournalNo, `GL Row ${i} JournalNo must match`);
      assert.equal(xlsxRow[balCol], apiRow.BalanceStatus, `GL Row ${i} BalanceStatus must match`);
      assert.equal(xlsxRow[postCol], apiRow.PostingStatus, `GL Row ${i} PostingStatus must match`);
      assert.equal(Number(xlsxRow[drCol]), Number(apiRow.Debit), `GL Row ${i} Debit must match`);
      assert.equal(Number(xlsxRow[crCol]), Number(apiRow.Credit), `GL Row ${i} Credit must match`);
    }
    console.log('✓ gl-sales-journal API and XLSX match 100%');

    console.log('\nALL XLSX AND API RECONCILIATION CHECKS PASSED.');
    process.exit(0);
  } catch (err) {
    console.error('XLSX VERIFICATION FAILED:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
    await Promise.allSettled([db.readerReady, db.ownerReady]);
    const pl = db.runWithTarget('remote_b', () => db.pools());
    await Promise.allSettled([
      db.readerPool.close(),
      db.ownerPool.close(),
      pl.readerPool.close(),
      pl.ownerPool.close()
    ]);
  }
})();
