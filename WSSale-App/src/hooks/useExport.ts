import { useState, useCallback } from 'react';
import { exportToCsv, exportToExcel, type ExportColumn } from '../utils/exportUtils';

export function useExport<T = any>() {
  const [isExporting, setIsExporting] = useState(false);

  const exportData = useCallback(
    (
      type: 'excel' | 'csv',
      filename: string,
      columns: ExportColumn<T>[],
      rows: T[],
      sheetName = 'Sheet1'
    ) => {
      setIsExporting(true);
      try {
        if (type === 'excel') {
          exportToExcel(filename, sheetName, columns, rows);
        } else {
          exportToCsv(filename, columns, rows);
        }
      } catch (err) {
        console.error('Export failed:', err);
        alert('เกิดข้อผิดพลาดในการส่งออกไฟล์');
      } finally {
        setIsExporting(false);
      }
    },
    []
  );

  return { exportData, isExporting };
}
