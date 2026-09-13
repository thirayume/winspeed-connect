import type { ReportColumn } from '../services/api';

/**
 * ตรวจสอบว่าคอลัมน์นี้เป็นตัวเลขเชิงปริมาณหรือการเงิน (จัดชิดขวา) หรือไม่
 * คอลัมน์ประเภท identifier (เช่น CustCode, DocuNo, Plate) จะคืนค่า false (จัดชิดซ้าย) เสมอ
 */
export function isColumnNumeric(col: ReportColumn): boolean {
  return ['money', 'quantity', 'integer', 'percent'].includes(col.type || '');
}

/**
 * จัดรูปแบบค่าในเซลล์รายงานตาม Column Type Contract
 * - identifier: คงสตริงและศูนย์นำหน้าเสมอ (เช่น "0462002", "0331003") ห้ามแปลงเป็น number
 * - quantity: ทศนิยม 3 ตำแหน่ง (ตามหน่วยชั่งปุ๋ยตัน)
 * - money: ทศนิยม 2 ตำแหน่ง
 * - percent: ทศนิยม 2 ตำแหน่ง พร้อมเครื่องหมาย %
 * - integer: ไม่มีทศนิยม
 * - date / datetime: แสดงผลวันที่ตามมาตรฐานระบบ
 */
export function formatReportCell(value: unknown, col: ReportColumn): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  switch (col.type) {
    case 'identifier':
      return String(value);

    case 'text':
      return String(value);

    case 'date': {
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      const str = String(value);
      return str.slice(0, 10);
    }

    case 'datetime': {
      if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19);
      const str = String(value);
      return str.replace('T', ' ').slice(0, 19);
    }

    case 'money': {
      const n = Number(value);
      if (Number.isNaN(n)) return String(value);
      return n.toLocaleString('th-TH', {
        minimumFractionDigits: col.precision ?? 2,
        maximumFractionDigits: col.precision ?? 2,
      });
    }

    case 'quantity': {
      const n = Number(value);
      if (Number.isNaN(n)) return String(value);
      return n.toLocaleString('th-TH', {
        minimumFractionDigits: col.precision ?? 3,
        maximumFractionDigits: col.precision ?? 3,
      });
    }

    case 'percent': {
      const n = Number(value);
      if (Number.isNaN(n)) return String(value);
      return `${n.toLocaleString('th-TH', {
        minimumFractionDigits: col.precision ?? 2,
        maximumFractionDigits: col.precision ?? 2,
      })}%`;
    }

    case 'integer': {
      const n = Number(value);
      if (Number.isNaN(n)) return String(value);
      return n.toLocaleString('th-TH', { maximumFractionDigits: 0 });
    }

    default: {
      if (typeof value === 'number') {
        return value.toLocaleString('th-TH', { maximumFractionDigits: 2 });
      }
      return String(value);
    }
  }
}

/**
 * คำนวณผลรวมแถวสรุป (Total) เฉพาะคอลัมน์ที่กำหนด aggregation: 'sum' เท่านั้น
 * ป้องกันการหาผลรวมรหัสลูกค้า, เลขที่เอกสาร, หรือคอลัมน์ที่ไม่ใช่มาตรวัด
 */
export function calculateReportTotals(columns: ReportColumn[], rows: Record<string, unknown>[]): Record<string, number> {
  const totals: Record<string, number> = {};
  if (!rows || rows.length === 0) return totals;

  for (const col of columns) {
    if (col.aggregation === 'sum') {
      let sum = 0;
      let hasVal = false;
      for (const row of rows) {
        const val = row[col.key];
        if (val !== null && val !== undefined && val !== '') {
          const num = Number(val);
          if (!Number.isNaN(num)) {
            sum += num;
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

/**
 * จัดรูปแบบยอดรวมของคอลัมน์
 */
export function formatReportTotal(sum: number | undefined, col: ReportColumn): string {
  if (sum === undefined) return '';
  return formatReportCell(sum, col);
}
