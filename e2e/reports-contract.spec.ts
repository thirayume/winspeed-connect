import { test, expect } from '@playwright/test';
import { formatReportCell, calculateReportTotals, isColumnNumeric } from '../WSSale-App/src/utils/reportFormatter';
import type { ReportColumn } from '../WSSale-App/src/services/api';

test.describe('Reports Typed Column Contract & Formatting (SO-10)', () => {
  test('identifiers preserve leading zeros and do not coerce to numbers', () => {
    const custCodeCol: ReportColumn = { key: 'CustCode', label: 'รหัสลูกค้า', type: 'identifier' };
    expect(formatReportCell('0462002', custCodeCol)).toBe('0462002');
    expect(formatReportCell('0331003', custCodeCol)).toBe('0331003');

    const goodCodeCol: ReportColumn = { key: 'GoodCode', label: 'รหัสสินค้า', type: 'identifier' };
    expect(formatReportCell('001234', goodCodeCol)).toBe('001234');

    const docuNoCol: ReportColumn = { key: 'DocuNo', label: 'เลขที่เอกสาร', type: 'identifier' };
    expect(formatReportCell('I68-01345', docuNoCol)).toBe('I68-01345');
  });

  test('quantity maintains 3 decimal places precision for fertilizer tonnage', () => {
    const qtyCol: ReportColumn = { key: 'QtyTon', label: 'จำนวน (ตัน)', type: 'quantity', precision: 3 };
    expect(formatReportCell(15.125, qtyCol)).toBe('15.125');
    expect(formatReportCell(4, qtyCol)).toBe('4.000');
    expect(formatReportCell(10.5, qtyCol)).toBe('10.500');
  });

  test('null and zero values format correctly', () => {
    const qtyCol: ReportColumn = { key: 'QtyTon', label: 'จำนวน (ตัน)', type: 'quantity', precision: 3 };
    expect(formatReportCell(null, qtyCol)).toBe('-');
    expect(formatReportCell(undefined, qtyCol)).toBe('-');
    expect(formatReportCell('', qtyCol)).toBe('-');
    expect(formatReportCell(0, qtyCol)).toBe('0.000');
  });

  test('totals calculate only on columns with aggregation: "sum", never summing identifiers', () => {
    const columns: ReportColumn[] = [
      { key: 'CustCode', label: 'รหัสลูกค้า', type: 'identifier' },
      { key: 'CustName', label: 'ชื่อลูกค้า', type: 'text' },
      { key: 'QtyTon', label: 'จำนวน (ตัน)', type: 'quantity', precision: 3, aggregation: 'sum' },
      { key: 'Amount', label: 'เป็นเงิน', type: 'money', precision: 2, aggregation: 'sum' },
    ];

    const rows = [
      { CustCode: '0462001', CustName: 'ร้าน ก', QtyTon: 10.5, Amount: 150000 },
      { CustCode: '0462002', CustName: 'ร้าน ข', QtyTon: 20.25, Amount: 320000 },
    ];

    const totals = calculateReportTotals(columns, rows);
    expect(totals.CustCode).toBeUndefined();
    expect(totals.CustName).toBeUndefined();
    expect(totals.QtyTon).toBe(30.75);
    expect(totals.Amount).toBe(470000);
  });
});
