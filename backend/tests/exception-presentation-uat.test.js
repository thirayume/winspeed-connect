/**
 * exception-presentation-uat.test.js
 *
 * Deterministic UAT covering exception presentation across UI and XLSX export
 * using ACTUAL PRODUCTION CODE (no duplicated helpers):
 *
 * 1. UI Formatter: WSSale-App/src/utils/reportFormatter.ts (formatReportCell, calculateReportTotals)
 * 2. XLSX Exporter: backend/routes/reports.js (buildReportWorkbook)
 * 3. GL Presentation: backend/services/native-gl-linkage.js (evaluateJournalHeader)
 *
 * Controls 5 deterministic rows:
 * - 3 UNKNOWN rows (R5-01 partial, delivery missing RefListNo, header-only)
 * - 1 NORMAL row (500.00)
 * - 1 OVER_INVOICED row (-200.00)
 * Total sum must strictly be 300.00 in both UI totals and XLSX total row.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '../..');

// 1. Import PRODUCTION UI Formatter directly from source
const {
  formatReportCell,
  calculateReportTotals,
  isColumnNumeric
} = require(path.join(root, 'WSSale-App/src/utils/reportFormatter.ts'));

// 2. Import PRODUCTION Reports route and workbook exporter directly
const reports = require('../routes/reports');
const { buildReportWorkbook } = reports.__testing;
const { evaluateJournalHeader } = require('../services/native-gl-linkage');

// Columns contract from production definition
const projectionColumns = reports.REPORTS['so-sales-billing-projection'].columns;
const glJournalColumns = reports.REPORTS['gl-sales-journal'].columns;

// Deterministic Controlled Dataset containing 5 rows (3 UNKNOWN, 1 NORMAL, 1 OVER_INVOICED)
const controlledDataset = [
  {
    DocuNo: 'SO-CTRL-NORMAL-01',
    DocuDate: '2026-09-20',
    CustName: 'CUSTOMER A',
    EstimatedAmount: 500.00,
    AllocationStatus: 'NORMAL',
    Note: 'ประมาณการยอดขายค้างออกใบกำกับ (ไม่ใช่หลักฐาน GL)',
    RefSO: '1001'
  },
  {
    DocuNo: 'SO-CTRL-OVER-02',
    DocuDate: '2026-09-20',
    CustName: 'CUSTOMER B',
    EstimatedAmount: -200.00,
    AllocationStatus: 'OVER_INVOICED',
    Note: 'ออกใบกำกับเกินยอดสั่งซื้อ (Over-invoiced exception)',
    RefSO: '1002'
  },
  {
    DocuNo: 'SO-CTRL-UNKNOWN-PARTIAL',
    DocuDate: '2026-09-20',
    CustName: 'CUSTOMER C',
    EstimatedAmount: null,
    AllocationStatus: 'UNKNOWN',
    Note: 'พบรายการใบกำกับที่ไม่สามารถระบุรายการสั่งซื้อได้ (UNKNOWN Allocation)',
    RefSO: '1003'
  },
  {
    DocuNo: 'SO-CTRL-UNKNOWN-DELIVERY',
    DocuDate: '2026-09-20',
    CustName: 'CUSTOMER D',
    EstimatedAmount: null,
    AllocationStatus: 'UNKNOWN',
    Note: 'พบรายการใบกำกับที่ไม่สามารถระบุรายการสั่งซื้อได้ (UNKNOWN Allocation)',
    RefSO: '1004'
  },
  {
    DocuNo: 'SO-CTRL-UNKNOWN-HEADER',
    DocuDate: '2026-09-20',
    CustName: 'CUSTOMER E',
    EstimatedAmount: null,
    AllocationStatus: 'UNKNOWN',
    Note: 'พบรายการใบกำกับที่ไม่สามารถระบุรายการสั่งซื้อได้ (UNKNOWN Allocation)',
    RefSO: '1005'
  }
];

test.describe('Controlled UI Renderer UAT (Production reportFormatter.ts)', () => {
  const estCol = projectionColumns.find(c => c.key === 'EstimatedAmount');
  assert.ok(estCol, 'EstimatedAmount column must exist in production schema');
  assert.equal(isColumnNumeric(estCol), true, 'EstimatedAmount must be numeric money column');

  test('UAT-01: Every UNKNOWN row renders dash "-" in UI cell without numeric leakage', () => {
    let unknownCount = 0;
    for (const row of controlledDataset) {
      const rendered = formatReportCell(row.EstimatedAmount, estCol);
      if (row.AllocationStatus === 'UNKNOWN') {
        unknownCount++;
        assert.equal(row.EstimatedAmount, null, `${row.DocuNo} EstimatedAmount must be strictly null`);
        assert.equal(
          rendered,
          '-',
          `${row.DocuNo} UI display must be dash "-", never a fabricated number or NaN`
        );
      } else if (row.AllocationStatus === 'NORMAL') {
        assert.equal(rendered, '500.00', `${row.DocuNo} must render formatted 500.00`);
      } else if (row.AllocationStatus === 'OVER_INVOICED') {
        assert.equal(rendered, '-200.00', `${row.DocuNo} must render formatted -200.00`);
      }
    }
    assert.equal(unknownCount, 3, 'Must exercise exactly 3 UNKNOWN cases in controlled dataset');
  });

  test('UAT-02: UI calculateReportTotals strictly produces 300.00 without UNKNOWN contamination', () => {
    const totals = calculateReportTotals(projectionColumns, controlledDataset);
    assert.equal(typeof totals.EstimatedAmount, 'number', 'Total must be a number');
    assert.equal(
      totals.EstimatedAmount,
      300.00,
      `UI Total sum must be strictly 500.00 + (-200.00) = 300.00, got: ${totals.EstimatedAmount}`
    );
  });
});

test.describe('Controlled Production XLSX Exporter UAT (Production buildReportWorkbook)', () => {
  const template = {
    templateCode: 'TPL_STANDARD_TABLE',
    version: 1,
    header: {
      companyNameTh: 'บริษัท เวิลด์ เฟอท จำกัด',
      companyNameEn: 'World Fert Co., Ltd.',
      branchNameTh: 'สำนักงานใหญ่',
      taxId: '0123456789012'
    }
  };

  const reportData = {
    type: 'so-sales-billing-projection',
    title: 'รายงานประมาณการขายก่อนลงบัญชี',
    columns: projectionColumns,
    rows: controlledDataset
  };

  const { wb, ws, aoa } = buildReportWorkbook(reportData, template);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const wbRead = XLSX.read(buf, { type: 'buffer' });
  const sheetRead = wbRead.Sheets['Report'];
  assert.ok(sheetRead, 'Report worksheet must be created');
  const aoaRead = XLSX.utils.sheet_to_json(sheetRead, { header: 1 });

  const hdrIdx = aoaRead.findIndex(r => Array.isArray(r) && r.includes('เลขที่เอกสาร SO'));
  assert.ok(hdrIdx >= 0, 'Header row must exist in generated XLSX');
  const colLabels = aoaRead[hdrIdx];
  const docColIdx = colLabels.indexOf('เลขที่เอกสาร SO');
  const estColIdx = colLabels.indexOf('มูลค่าขายประมาณการ (บาท)');
  const statColIdx = colLabels.indexOf('สถานะการจัดสรร');

  test('UAT-03: Production XLSX export writes empty cells for UNKNOWN rows and exact amounts for confirmed rows', () => {
    for (let i = 0; i < controlledDataset.length; i++) {
      const orig = controlledDataset[i];
      const sheetRow = aoaRead[hdrIdx + 1 + i];

      assert.equal(sheetRow[docColIdx], orig.DocuNo, `Row ${i} DocuNo must match`);
      assert.equal(sheetRow[statColIdx], orig.AllocationStatus, `Row ${i} AllocationStatus must match`);

      if (orig.AllocationStatus === 'UNKNOWN') {
        const val = sheetRow[estColIdx];
        assert.ok(
          val === undefined || val === '' || val === null,
          `XLSX cell for ${orig.DocuNo} must be empty, got: ${val}`
        );
      } else {
        assert.equal(Number(sheetRow[estColIdx]), orig.EstimatedAmount, `Row ${i} amount must match`);
      }
    }
  });

  test('UAT-04: Production XLSX export total row strictly equals 300.00', () => {
    const totalRow = aoaRead[hdrIdx + 1 + controlledDataset.length];
    assert.equal(totalRow[0], 'รวมทั้งสิ้น (Total)', 'First cell of total row must be label');
    const totalVal = Number(totalRow[estColIdx]);
    assert.equal(
      totalVal,
      300.00,
      `XLSX export total row must be exactly 300.00 without UNKNOWN contamination, got: ${totalVal}`
    );
  });
});

test.describe('Controlled Production GL Header With No Lines UAT (R5-02 Presentation)', () => {
  const emptyGlHeader = {
    GLID: 8888,
    DocuNo: 'JV-EMPTY-01',
    DocuDate: '2026-09-20',
    JourID: '1001',
    JourName: 'รายวันขาย',
    DocuType: '107',
    FromID: 99,
    FromFlag: '107',
    DocuStatus: 'N',
    TotaAmnt: 0
  };

  const invoice = {
    SOInvID: 55,
    PostID: 99,
    DocuType: '107',
    DocuNo: 'INV-FOR-EMPTY-GL',
    PostGL: 'Y'
  };

  test('UAT-05: evaluateJournalHeader evaluates 0 lines to Unbalanced and preserves incomplete evidence', () => {
    const evalRes = evaluateJournalHeader(emptyGlHeader, [], [invoice], [emptyGlHeader]);
    assert.equal(evalRes.isBalanced, false, 'Journal with 0 lines must NOT be balanced');
    assert.equal(evalRes.balanceStatus, 'ไม่สมดุล (Unbalanced)');
    assert.equal(evalRes.postingStatus, 'ไม่สมดุล (Unbalanced)');
    assert.equal(evalRes.refInvoiceNo, 'INV-FOR-EMPTY-GL');
  });

  test('UAT-06: Production XLSX export includes explicit "ไม่มีรายการบัญชี" row for 0-line header', () => {
    const emptyHeaderReportData = {
      type: 'gl-sales-journal',
      title: 'รายงานสมุดรายวันขาย (GL Sales Journal)',
      columns: glJournalColumns,
      rows: [
        {
          GLID: emptyGlHeader.GLID,
          JournalNo: emptyGlHeader.DocuNo,
          DocuDate: emptyGlHeader.DocuDate,
          JourName: emptyGlHeader.JourName,
          AccountCode: '-',
          AccountName: 'ไม่มีรายการบัญชี (No GL Lines)',
          Debit: 0,
          Credit: 0,
          BalanceStatus: 'ไม่สมดุล (Unbalanced)',
          PostingStatus: 'ไม่สมดุล (Unbalanced)',
          RefInvoiceNo: 'INV-FOR-EMPTY-GL',
        }
      ]
    };

    const { wb } = buildReportWorkbook(emptyHeaderReportData);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const wbRead = XLSX.read(buf, { type: 'buffer' });
    const sheet = wbRead.Sheets['Report'];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const hdrIdx = aoa.findIndex(r => Array.isArray(r) && r.includes('เลขที่สมุดรายวัน'));
    assert.ok(hdrIdx >= 0, 'GL Journal Header row must exist');
    const labels = aoa[hdrIdx];
    const accNameIdx = labels.indexOf('ชื่อบัญชี');
    const balStatusIdx = labels.indexOf('สถานะสมดุล');
    const postStatusIdx = labels.indexOf('สถานะ Posting');

    const dataRow = aoa[hdrIdx + 1];
    assert.equal(dataRow[accNameIdx], 'ไม่มีรายการบัญชี (No GL Lines)');
    assert.equal(dataRow[balStatusIdx], 'ไม่สมดุล (Unbalanced)');
    assert.equal(dataRow[postStatusIdx], 'ไม่สมดุล (Unbalanced)');
  });
});
