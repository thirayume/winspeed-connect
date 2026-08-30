/**
 * exportUtils.ts — Global CSV & Excel Export Utility with Thai UTF-8 Support
 */

export interface ExportColumn<T = any> {
  key: keyof T | string;
  label: string;
  formatter?: (value: any, row: T) => string | number;
}

/**
 * Encodes text into UTF-8 BOM CSV blob to ensure Thai characters display properly in Excel.
 */
export function exportToCsv<T = any>(
  filename: string,
  columns: ExportColumn<T>[],
  rows: T[]
) {
  if (!rows || !rows.length) {
    alert('ไม่มีข้อมูลสำหรับส่งออก');
    return;
  }

  // Header row
  const header = columns.map(c => `"${String(c.label).replace(/"/g, '""')}"`).join(',');

  // Data rows
  const dataRows = rows.map(row => {
    return columns
      .map(c => {
        let val = (row as any)[c.key];
        if (c.formatter) {
          val = c.formatter(val, row);
        } else if (val === null || val === undefined) {
          val = '';
        }
        const strVal = String(val).replace(/"/g, '""');
        return `"${strVal}"`;
      })
      .join(',');
  });

  const csvContent = '\uFEFF' + [header, ...dataRows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const safeFilename = filename.endsWith('.csv') ? filename : `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.setAttribute('download', safeFilename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Formats table rows into an HTML-based .xls spreadsheet file (supports styling & UTF-8 Thai text natively in Excel).
 */
export function exportToExcel<T = any>(
  filename: string,
  sheetName: string,
  columns: ExportColumn<T>[],
  rows: T[]
) {
  if (!rows || !rows.length) {
    alert('ไม่มีข้อมูลสำหรับส่งออก');
    return;
  }

  let tableHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8" />
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>${sheetName.replace(/[/\\?*:[\]]/g, ' ')}</x:Name>
              <x:WorksheetOptions>
                <x:DisplayGridlines/>
              </x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        th { background-color: #0C447C; color: #ffffff; font-weight: bold; text-align: center; }
        td, th { border: 0.5pt solid #cccccc; padding: 5px; font-family: Tahoma, sans-serif; font-size: 11pt; }
        .num { text-align: right; mso-number-format: "\#,\#\#0\.00"; }
        .text { mso-number-format: "\@"; }
      </style>
    </head>
    <body>
      <table>
        <thead>
          <tr>
            ${columns.map(c => `<th>${c.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
  `;

  rows.forEach(row => {
    tableHtml += '<tr>';
    columns.forEach(c => {
      let val = (row as any)[c.key];
      if (c.formatter) {
        val = c.formatter(val, row);
      } else if (val === null || val === undefined) {
        val = '';
      }
      const isNum = typeof val === 'number';
      const cellClass = isNum ? 'num' : 'text';
      tableHtml += `<td class="${cellClass}">${val}</td>`;
    });
    tableHtml += '</tr>';
  });

  tableHtml += `
        </tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob(['\uFEFF' + tableHtml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeFilename = filename.endsWith('.xls') ? filename : `${filename}_${new Date().toISOString().slice(0, 10)}.xls`;
  link.download = safeFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
