import { test, expect } from '@playwright/test';
// @ts-ignore
import XLSX from '../backend/node_modules/xlsx';

test.describe('SO-10: Assertion Sensitivity Checks (Isolated Negative Harness)', () => {

  test('Valid XLSX with altered numeric total fails summation assertion', async () => {
    // 1. Build a valid workbook with valid rows but intentional 1-unit quantity mismatch
    const data = [
      ['บริษัท ทดสอบความไว จำกัด'],
      ['สาขา: สำนักงานใหญ่'],
      ['ที่อยู่: 123 กรุงเทพฯ'],
      ['รายงาน: รายงานการขนสินค้าตามรายชื่อลูกค้า  |  แม่แบบ: TPL-001 (v1)'],
      [],
      ['รหัสลูกค้า', 'ชื่อลูกค้า', 'วันที่ขน', 'เลขที่ใบส่งของ', 'สูตรปุ๋ย', 'จำนวน (ตัน)', 'ราคา/ตัน', 'เป็นเงิน (บาท)'],
      ['C001', 'ลูกค้า ก', '2026-09-01', 'DO-001', '16-16-16', 10.500, 15000, 157500],
      ['C002', 'ลูกค้า ข', '2026-09-02', 'DO-002', '46-0-0', 20.000, 14000, 280000],
      ['รวมทั้งสิ้น (Total)', '', '', '', '', 30.500, '', 437500], // Correct sum
    ];

    // Alter one valid numeric cell in the summary row to simulate subtle corruption (30.500 -> 31.500)
    const corruptedData = JSON.parse(JSON.stringify(data));
    corruptedData[8][5] = 31.500; // Altered valid numeric quantity

    const ws = XLSX.utils.aoa_to_sheet(corruptedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 2. Parse workbook and run the same assertion
    const readWb = XLSX.read(buf, { type: 'buffer' });
    const sheet = readWb.Sheets['Report'];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
    const headers = rows[5];
    const dataRows = rows.slice(6);
    const lastRow = dataRows[dataRows.length - 1];

    const qtyIdx = headers.indexOf('จำนวน (ตัน)');
    let computedSum = 0;
    for (let i = 0; i < dataRows.length - 1; i++) {
      computedSum += Number(dataRows[i][qtyIdx]);
    }
    const sheetTotal = Number(lastRow[qtyIdx]);

    // Verify assertion catches the mismatch
    expect(computedSum).toBe(30.5);
    expect(sheetTotal).toBe(31.5);
    expect(() => {
      expect(computedSum).toBeCloseTo(sheetTotal, 2);
    }).toThrow();
  });

  test('Valid XLSX with altered metadata fails header assertion', async () => {
    const data = [
      ['บริษัท ผิดชื่อ จำกัด'], // Altered company name
      ['สาขา: สำนักงานใหญ่'],
      ['ที่อยู่: 123 กรุงเทพฯ'],
      ['รายงาน: รายงานการขนสินค้าตามรายชื่อลูกค้า  |  แม่แบบ: WRONG_TPL (v1)'], // Altered template
      [],
      ['รหัสลูกค้า', 'ชื่อลูกค้า', 'วันที่ขน'],
      ['C001', 'ลูกค้า ก', '2026-09-01'],
      ['รวมทั้งสิ้น (Total)', '', ''],
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const readWb = XLSX.read(buf, { type: 'buffer' });
    const sheet = readWb.Sheets['Report'];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

    const expectedCompanyName = 'บริษัท อีทูอี ตรวจสอบความถูกต้อง';
    expect(() => {
      expect(rows[0]?.[0]).toBe(expectedCompanyName);
    }).toThrow();
  });

});
