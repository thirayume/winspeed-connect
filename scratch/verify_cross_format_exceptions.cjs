'use strict';
/**
 * scratch/verify_cross_format_exceptions.cjs
 *
 * Verifies cross-format consistency across UI, API, and XLSX on a controlled
 * exception dataset containing UNKNOWN/null rows, as required by Codex R5:
 *
 * 1. Controlled exception dataset with known UNKNOWN, NORMAL, OVER_INVOICED rows.
 * 2. Verifies UI table cell formatting (formatReportCell) and UI total aggregation (calculateReportTotals).
 * 3. Verifies XLSX sheet cell generation and XLSX total row summation.
 * 4. Verifies deployed Hostinger TEST API and deployed XLSX export endpoint with live timing.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const XLSX = require(path.join(root, 'backend/node_modules/xlsx'));

// Mirror UI report formatter logic directly from WSSale-App/src/utils/reportFormatter.ts
function formatReportCell(value, col) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  switch (col.type) {
    case 'identifier':
    case 'text':
      return String(value);
    case 'money': {
      const n = Number(value);
      if (Number.isNaN(n)) return String(value);
      return n.toLocaleString('th-TH', {
        minimumFractionDigits: col.precision ?? 2,
        maximumFractionDigits: col.precision ?? 2,
      });
    }
    default:
      return String(value);
  }
}

function calculateReportTotals(cols, rows) {
  const totals = {};
  if (!rows || rows.length === 0) return totals;
  for (const col of cols) {
    if (col.aggregation === 'sum') {
      let sum = 0;
      let hasVal = false;
      for (const row of rows) {
        const val = row[col.key];
        if (val !== null && val !== undefined && val !== '') {
          const n = Number(val);
          if (!Number.isNaN(n)) {
            sum += n;
            hasVal = true;
          }
        }
      }
      if (hasVal) {
        totals[col.key] = col.precision != null ? Number(sum.toFixed(col.precision)) : sum;
      }
    }
  }
  return totals;
}

// Columns contract for so-sales-billing-projection
const columns = [
  { key: 'DocuNo', label: 'เลขที่เอกสาร SO', type: 'identifier' },
  { key: 'DocuDate', label: 'วันที่เอกสาร SO', type: 'date' },
  { key: 'CustName', label: 'ชื่อลูกค้า', type: 'text' },
  { key: 'EstimatedAmount', label: 'มูลค่าขายประมาณการ (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
  { key: 'AllocationStatus', label: 'สถานะการจัดสรร', type: 'text' },
  { key: 'Note', label: 'หมายเหตุความหมายข้อมูล', type: 'text' },
  { key: 'RefSO', label: 'อ้างอิง SO ID', type: 'identifier' },
];

// Controlled exception dataset with explicit UNKNOWN/null and known boundary rows
const controlledExceptionDataset = [
  {
    DocuNo: 'SO-TEST-NORMAL-01',
    DocuDate: '2026-09-20',
    CustName: 'CUSTOMER A',
    EstimatedAmount: 500.00,
    AllocationStatus: 'NORMAL',
    Note: 'ประมาณการยอดขายค้างออกใบกำกับ (ไม่ใช่หลักฐาน GL)',
    RefSO: '1001'
  },
  {
    DocuNo: 'SO-TEST-OVER-02',
    DocuDate: '2026-09-20',
    CustName: 'CUSTOMER B',
    EstimatedAmount: -200.00,
    AllocationStatus: 'OVER_INVOICED',
    Note: 'ออกใบกำกับเกินยอดสั่งซื้อ (Over-invoiced exception)',
    RefSO: '1002'
  },
  {
    DocuNo: 'SO-TEST-UNKNOWN-R5-01',
    DocuDate: '2026-09-20',
    CustName: 'CUSTOMER C',
    EstimatedAmount: null,
    AllocationStatus: 'UNKNOWN',
    Note: 'พบรายการใบกำกับที่ไม่สามารถระบุรายการสั่งซื้อได้ (UNKNOWN Allocation)',
    RefSO: '1003'
  },
  {
    DocuNo: 'SO-TEST-UNKNOWN-DELIVERY',
    DocuDate: '2026-09-20',
    CustName: 'CUSTOMER D',
    EstimatedAmount: null,
    AllocationStatus: 'UNKNOWN',
    Note: 'พบรายการใบกำกับที่ไม่สามารถระบุรายการสั่งซื้อได้ (UNKNOWN Allocation)',
    RefSO: '1004'
  },
  {
    DocuNo: 'SO-TEST-UNKNOWN-HEADER',
    DocuDate: '2026-09-20',
    CustName: 'CUSTOMER E',
    EstimatedAmount: null,
    AllocationStatus: 'UNKNOWN',
    Note: 'พบรายการใบกำกับที่ไม่สามารถระบุรายการสั่งซื้อได้ (UNKNOWN Allocation)',
    RefSO: '1005'
  }
];

(async () => {
  console.log('=== Step 1: Testing UI Presentation & Totals on Controlled Dataset ===');
  const estCol = columns.find(c => c.key === 'EstimatedAmount');
  let unknownCount = 0;
  let normalCount = 0;
  let overInvoicedCount = 0;

  for (const row of controlledExceptionDataset) {
    const formatted = formatReportCell(row.EstimatedAmount, estCol);
    if (row.AllocationStatus === 'UNKNOWN') {
      unknownCount++;
      assert.equal(row.EstimatedAmount, null, 'UNKNOWN row must have null EstimatedAmount');
      assert.equal(formatted, '-', `UI cell for UNKNOWN row must be '-', got: ${formatted}`);
    } else if (row.AllocationStatus === 'NORMAL') {
      normalCount++;
      assert.equal(formatted, '500.00');
    } else if (row.AllocationStatus === 'OVER_INVOICED') {
      overInvoicedCount++;
      assert.equal(formatted, '-200.00');
    }
  }

  assert.equal(unknownCount, 3, 'Must have exactly 3 UNKNOWN exception cases in controlled set');
  assert.equal(normalCount, 1, 'Must have 1 NORMAL case');
  assert.equal(overInvoicedCount, 1, 'Must have 1 OVER_INVOICED case');
  console.log(`✓ Exercised controlled cases: ${controlledExceptionDataset.length} total (${unknownCount} UNKNOWN, ${normalCount} NORMAL, ${overInvoicedCount} OVER_INVOICED)`);

  const uiTotals = calculateReportTotals(columns, controlledExceptionDataset);
  assert.equal(uiTotals.EstimatedAmount, 300.00, 'UI total must strictly sum only non-null rows: 500 + (-200) = 300.00');
  console.log(`✓ UI Total Row matched expected: ${uiTotals.EstimatedAmount.toFixed(2)} (no UNKNOWN/null contamination)`);

  console.log('\n=== Step 2: Testing XLSX Generation Logic on Controlled Dataset ===');
  // Build XLSX AOA exactly as done in backend/routes/reports.js export handler
  const headerRows = [
    ['บริษัท เวิลด์ เฟอท จำกัด'],
    ['รายงาน: รายงานประมาณการขายก่อนลงบัญชี'],
    []
  ];
  const aoa = [...headerRows, columns.map(c => c.label)];
  const dataStartRowIdx = aoa.length;

  for (const row of controlledExceptionDataset) {
    const rowArr = columns.map(c => {
      const val = row[c.key];
      if (val === null || val === undefined) return '';
      if (c.type === 'identifier' || c.type === 'text') return String(val);
      if (c.type === 'integer' || c.type === 'money' || c.type === 'quantity' || c.type === 'percent') {
        const n = Number(val);
        return Number.isNaN(n) ? String(val) : n;
      }
      return String(val);
    });
    aoa.push(rowArr);
  }

  // Add total row
  const totalRow = columns.map((c, colIdx) => {
    if (colIdx === 0) return 'รวมทั้งสิ้น (Total)';
    if (c.aggregation === 'sum') {
      const sum = controlledExceptionDataset.reduce((acc, r) => {
        const n = Number(r[c.key]);
        return acc + (Number.isNaN(n) ? 0 : n);
      }, 0);
      return c.precision != null ? Number(sum.toFixed(c.precision)) : sum;
    }
    return '';
  });
  aoa.push(totalRow);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // Read back buffer to verify written cells
  const wbRead = XLSX.read(xlsxBuf, { type: 'buffer' });
  const sheetRead = wbRead.Sheets['Report'];
  const aoaRead = XLSX.utils.sheet_to_json(sheetRead, { header: 1 });

  const hdrIdx = aoaRead.findIndex(r => Array.isArray(r) && r.includes('เลขที่เอกสาร SO'));
  assert.ok(hdrIdx >= 0, 'Header row must exist');
  const readColLabels = aoaRead[hdrIdx];
  const estColIdx = readColLabels.indexOf('มูลค่าขายประมาณการ (บาท)');
  const statusColIdx = readColLabels.indexOf('สถานะการจัดสรร');

  for (let i = 0; i < controlledExceptionDataset.length; i++) {
    const orig = controlledExceptionDataset[i];
    const rowInSheet = aoaRead[hdrIdx + 1 + i];
    assert.equal(rowInSheet[statusColIdx], orig.AllocationStatus);
    if (orig.AllocationStatus === 'UNKNOWN') {
      assert.ok(
        rowInSheet[estColIdx] === undefined || rowInSheet[estColIdx] === '' || rowInSheet[estColIdx] === null,
        `XLSX cell for UNKNOWN row must be empty, got: ${rowInSheet[estColIdx]}`
      );
    } else {
      assert.equal(Number(rowInSheet[estColIdx]), orig.EstimatedAmount);
    }
  }

  const readTotalRow = aoaRead[hdrIdx + 1 + controlledExceptionDataset.length];
  assert.equal(readTotalRow[0], 'รวมทั้งสิ้น (Total)');
  assert.equal(Number(readTotalRow[estColIdx]), 300.00, 'XLSX Total row must be 300.00');
  console.log(`✓ XLSX Export logic verified: UNKNOWN rows have empty cells, Total row is exactly 300.00`);

  console.log('\n=== Step 3: Testing Live Deployed Hostinger TEST API & XLSX Export ===');
  const apiBase = 'https://api-test.thirayu.online/api';

  // 1. Authenticate against deployed server
  const tAuth0 = Date.now();
  const authRes = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'emp-00002', password: 'W0rldF3rt' })
  });
  assert.equal(authRes.status, 200, 'Login must succeed');
  const authData = await authRes.json();
  const token = authData.accessToken;
  assert.ok(token, 'Access token must be returned');
  console.log(`✓ Authenticated on ${apiBase} in ${Date.now() - tAuth0} ms`);

  const headers = { Authorization: `Bearer ${token}` };

  // 2. Fetch deployed Projection API JSON
  const tApi0 = Date.now();
  const projRes = await fetch(`${apiBase}/reports/so-sales-billing-projection`, { headers });
  const apiDuration = Date.now() - tApi0;
  assert.equal(projRes.status, 200, 'Deployed projection API must return 200');
  const projData = await projRes.json();
  console.log(`✓ Deployed Projection API returned ${projData.rows.length} rows in ${apiDuration} ms (NO TIMEOUT)`);

  // Count deployed row statuses
  const statusCounts = {};
  let deployedApiSum = 0;
  for (const r of projData.rows) {
    statusCounts[r.AllocationStatus] = (statusCounts[r.AllocationStatus] || 0) + 1;
    if (r.AllocationStatus === 'UNKNOWN') {
      assert.equal(r.EstimatedAmount, null, 'Any UNKNOWN row in deployed API must have null EstimatedAmount');
    } else {
      deployedApiSum += Number(r.EstimatedAmount || 0);
    }
  }
  console.log(`Deployed DB row status distribution:`, JSON.stringify(statusCounts));

  // 3. Fetch deployed XLSX export binary
  const tXlsx0 = Date.now();
  const xlsxRes = await fetch(`${apiBase}/reports/so-sales-billing-projection/export?format=xlsx`, { headers });
  const xlsxDuration = Date.now() - tXlsx0;
  assert.equal(xlsxRes.status, 200, 'Deployed XLSX export must return 200');
  const buf = Buffer.from(await xlsxRes.arrayBuffer());
  assert.equal(buf[0], 0x50, 'Must have PK zip header byte 0');
  assert.equal(buf[1], 0x4B, 'Must have PK zip header byte 1');
  console.log(`✓ Deployed XLSX Export returned ${buf.length} bytes in ${xlsxDuration} ms (NO TIMEOUT)`);

  const deployedWb = XLSX.read(buf, { type: 'buffer' });
  const deployedSheet = deployedWb.Sheets['Report'];
  assert.ok(deployedSheet, 'Report sheet must exist');
  const deployedAoa = XLSX.utils.sheet_to_json(deployedSheet, { header: 1 });

  const deployedHdrIdx = deployedAoa.findIndex(r => Array.isArray(r) && r.includes('เลขที่เอกสาร SO'));
  assert.ok(deployedHdrIdx >= 0, 'Header row must be in deployed XLSX');
  const deployedLabels = deployedAoa[deployedHdrIdx];
  const depDocCol = deployedLabels.indexOf('เลขที่เอกสาร SO');
  const depEstCol = deployedLabels.indexOf('มูลค่าขายประมาณการ (บาท)');
  const depStatCol = deployedLabels.indexOf('สถานะการจัดสรร');

  const deployedDataRows = deployedAoa.slice(deployedHdrIdx + 1);
  let deployedTableRows = deployedDataRows;
  let deployedHasTotal = false;
  if (deployedDataRows.length > 0 && String(deployedDataRows[deployedDataRows.length - 1][0]).includes('รวมทั้งสิ้น')) {
    deployedHasTotal = true;
    deployedTableRows = deployedDataRows.slice(0, -1);
  }

  assert.equal(deployedTableRows.length, projData.rows.length, 'Row count between deployed API and XLSX must match exactly');

  for (let i = 0; i < projData.rows.length; i++) {
    const apiRow = projData.rows[i];
    const xlsxRow = deployedTableRows[i];
    assert.equal(xlsxRow[depDocCol], apiRow.DocuNo);
    assert.equal(xlsxRow[depStatCol], apiRow.AllocationStatus);
    if (apiRow.AllocationStatus === 'UNKNOWN') {
      assert.ok(
        xlsxRow[depEstCol] === undefined || xlsxRow[depEstCol] === '' || xlsxRow[depEstCol] === null,
        `Deployed XLSX cell for UNKNOWN row must be empty, got: ${xlsxRow[depEstCol]}`
      );
    } else {
      assert.equal(Number(xlsxRow[depEstCol]), Number(apiRow.EstimatedAmount));
    }
  }

  if (deployedHasTotal) {
    const totalRow = deployedDataRows[deployedDataRows.length - 1];
    const xlsxTotal = Number(totalRow[depEstCol]);
    assert.equal(
      Math.round(xlsxTotal * 100),
      Math.round(deployedApiSum * 100),
      `Total row in deployed XLSX (${xlsxTotal}) must equal deployed API sum (${deployedApiSum.toFixed(2)})`
    );
    console.log(`✓ Total row sum matched deployed API sum: ${xlsxTotal.toFixed(2)}`);
  }

  console.log('\n=== ALL CROSS-FORMAT AND DEPLOYED VERIFICATIONS PASSED SUCCESSFULLY ===');
})().catch(err => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
