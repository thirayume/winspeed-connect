import { Fragment } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, FileText, AlertCircle } from 'lucide-react';
import type { ReportData, ResolvedReportTemplateDto } from '../../services/api';
import { formatThaiDate } from '../../utils/date';
import { DEFAULT_WF_LOGO_DATA_URL } from '../../utils/docHeaderSettings';
import {ReportContext} from './ReportContext';
import {ReportGroupHeading} from './ReportGroupHeading';
import {useReportPagination} from './useReportPagination';
import {
  formatReportCell,
  isColumnNumeric,
  calculateReportTotals,
  formatReportTotal
} from '../../utils/reportFormatter';

export function LegacyReportPdfModal({
  data,
  template,
  onClose,
}: {
  data: ReportData;
  template: ResolvedReportTemplateDto | null;
  onClose: () => void;
}) {
  const isLandscape = template?.orientation === 'landscape';
  const paperSize = ['A3','A4','A5','Letter','Legal'].includes(template?.paperSize || '') ? template!.paperSize : 'A4';
  const [shortEdge,longEdge]=({A3:[297,420],A4:[210,297],A5:[148,210],Letter:[215.9,279.4],Legal:[215.9,355.6]} as Record<string,number[]>)[paperSize];
  const pageWidth=isLandscape?longEdge:shortEdge,pageHeight=isLandscape?shortEdge:longEdge;
  const defaultLimit=data.meta?.groupBy?.length?(isLandscape?6:10):isLandscape?13:22;
  const {pages,areaRef}=useReportPagination(data,template,pageHeight,defaultLimit);
  // Transport references can be long. Keep every reference in a second row
  // instead of shrinking a 21-column invoice register until it is unreadable.
  const referenceKeys=['BookingRefs','SaleRefs','DebtRefs','TicketRefs','SlipRefs','TruckPlates','TraceState','DetailState','CostState'];
  const referenceColumns=data.type==='daily-invoice'?data.columns.filter(c=>referenceKeys.includes(c.key)):[];
  const printColumns=data.type==='daily-invoice'?data.columns.filter(c=>c.key!=='DocBook'&&!referenceKeys.includes(c.key)):data.columns;

  const PRINT_CSS = `
.report-invoice-table { table-layout: fixed; width: 100%; }
.report-invoice-table th, .report-invoice-table td { padding: 6px; font-size: 10px; overflow-wrap: anywhere; letter-spacing: normal; }
@media print {
  @page { 
    size: ${paperSize} ${isLandscape ? 'landscape' : 'portrait'};
    margin: 8mm; 
  }
  body { 
    margin: 0; 
    padding: 0; 
    background: white; 
    -webkit-print-color-adjust: exact; 
    print-color-adjust: exact; 
  }
  body > :not(.report-modal-root) { 
    display: none !important; 
  }
  .report-modal-root { 
    display: block !important; 
    position: static !important; 
  }
  .report-print-area { 
    width: 100%; 
    margin: 0 !important; 
    display: block !important; 
  }
  .report-no-print { 
    display: none !important; 
  }
  .report-page-container {
    width: 100% !important;
    page-break-after: always !important;
    break-after: page !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    box-shadow: none !important;
  }
  .report-page-container:last-child {
    page-break-after: avoid !important;
    break-after: avoid !important;
  }
  .report-page { 
    width: ${pageWidth-16}mm;
    min-height: ${pageHeight-16}mm;
    box-sizing: border-box;
    margin: 0 auto !important;
    padding: 4mm !important;
    border: none !important;
    box-shadow: none !important;
  }
  thead { display: table-header-group !important; }
  tfoot { display: table-row-group !important; }
  tr { page-break-inside: avoid !important; break-inside: avoid !important; }
}
`;

  if (!data) return null;

  // Authoritative guard: Report MUST have an active server-resolved template
  if (!template || !template.header) {
    return createPortal(
      <div className="report-modal-root fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center space-y-4" onClick={e => e.stopPropagation()}>
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
            <AlertCircle size={24} />
          </div>
          <h3 className="text-base font-bold text-gray-800">ไม่สามารถพิมพ์รายงานได้</h3>
          <p className="text-xs text-gray-600 leading-relaxed">
            รายงานฉบับนี้ยังไม่มีการกำหนดแม่แบบหรือหัวกระดาษทางการจากระบบผู้ดูแลระบบ (Admin Master)
            หรือเกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดแม่แบบในเมนูจัดการแม่แบบ
          </p>
          <div className="pt-2">
            <button
              onClick={onClose}
              className="px-5 py-2 bg-gray-800 text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors"
            >
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  const th = template.header;
  const resolvedHeader = {
    companyNameTh: th.companyNameTh || 'บริษัท เวิลด์ เฟอท จำกัด',
    companyNameEn: th.companyNameEn || 'WORLD FERT CO., LTD.',
    branchNameTh: th.branchNameTh || '',
    branchCode: th.branchCode || '',
    addressTh: th.addressTh || '',
    tel: th.tel || '',
    fax: th.fax || '',
    taxId: th.taxId || '',
    // Preserve deliberate empty strings or nulls: do NOT overwrite intentional empty logo with default
    logoUrl: th.logoUrl !== undefined ? th.logoUrl : DEFAULT_WF_LOGO_DATA_URL,
    footerNote: th.footerNote || '',
    termsAndConditions: th.termsAndConditions || '',
    showSignatures: template.showSignatures !== false,
    showPageNumber: template.showPageNumber !== false,
    signatureSalesLabel: template.signatureSalesLabel || '',
    signatureApprovedLabel: template.signatureApprovedLabel || '',
    signatureWarehouseLabel: template.signatureWarehouseLabel || '',
    templateName: template.templateName || 'แม่แบบมาตรฐานระบบ',
    templateCode: template.templateCode || 'TPL_STANDARD',
    version: template.version || 1,
  };

  const nowStr = formatThaiDate(new Date(), true);

  // Totals for numeric measure columns
  const totals = calculateReportTotals(data.columns, data.rows);

  const handlePrint = () => {
    const prevTitle = document.title;
    document.title = `WINSpeed_Report_${data.title}_${new Date().toISOString().substring(0, 10)}`;
    window.print();
    document.title = prevTitle;
  };

  const totalPages = pages.length;

  // Logo rendering decision
  const hasLogo = typeof resolvedHeader.logoUrl === 'string' && resolvedHeader.logoUrl.trim().length > 0;

  // Signature-block derivations
  const showSalesBox = Boolean(resolvedHeader.signatureSalesLabel && resolvedHeader.signatureSalesLabel.trim() !== '');
  const showApproverBox = Boolean(resolvedHeader.signatureApprovedLabel && resolvedHeader.signatureApprovedLabel.trim() !== '');
  const showWarehouseBox = Boolean(resolvedHeader.signatureWarehouseLabel && resolvedHeader.signatureWarehouseLabel.trim() !== '');
  const activeSigBoxesCount = (showSalesBox ? 1 : 0) + (showApproverBox ? 1 : 0) + (showWarehouseBox ? 1 : 0);
  const showSignaturesSection = Boolean(resolvedHeader.showSignatures && activeSigBoxesCount > 0
    && !data.meta?.signatures && data.type!=='budget-plan-approval');

  const getGridColsClass = (count: number) => {
    if (count === 3) return 'grid-cols-3';
    if (count === 2) return 'grid-cols-2';
    return 'grid-cols-1 max-w-xs mx-auto';
  };

  return createPortal(
    <div className="report-modal-root fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:static print:p-0 print:bg-transparent print:block" onClick={onClose}>
      <style>{PRINT_CSS}</style>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${isLandscape ? 'max-w-6xl' : 'max-w-5xl'} max-h-[92vh] flex flex-col print:max-w-none print:max-h-none print:shadow-none print:rounded-none print:bg-transparent print:block`} onClick={e => e.stopPropagation()}>
        
        {/* Modal Toolbar (No Print) */}
        <div className="report-no-print px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-red-50 rounded-xl flex items-center justify-center text-red-600">
              <FileText size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-gray-800 text-base">แม่แบบรายงาน {paperSize} — {data.title}</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                  {resolvedHeader.templateName} ({isLandscape ? 'แนวนอน' : 'แนวตั้ง'})
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700">
                  รวม {totalPages} หน้า ({data.rows.length.toLocaleString()} แถว)
                </span>
              </div>
              <p className="text-xs text-gray-500">รูปแบบเอกสาร {paperSize} จากข้อมูล WinSpeed</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="px-5 py-2 rounded-xl text-white text-sm font-semibold flex items-center gap-2 shadow-md hover:bg-red-700 transition-colors cursor-pointer"
              style={{ background: '#E53935' }}
            >
              <Printer size={16} /> พิมพ์ / บันทึกเป็น PDF ({paperSize})
            </button>
            <button
              onClick={onClose}
              className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-500 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Multi-Page Area */}
        <div ref={areaRef} className="report-print-area flex-1 overflow-y-auto p-6 bg-gray-100 print:overflow-visible print:p-0 print:bg-transparent print:block space-y-8 print:space-y-0">
          {pages.map((pageRows, pageIdx) => {
            const isLastPage = pageIdx === totalPages - 1;
            const pageNumberStr = `หน้า ${pageIdx + 1} / ${totalPages}`;
            const startRowIndex = pages.slice(0,pageIdx).reduce((count,rows)=>count+rows.length,0);

            return (
              <div
                key={pageIdx}
                className="report-page-container mx-auto print:max-w-none"
                style={{maxWidth:`${pageWidth}mm`}}
              >
                <div className={`report-page bg-white border border-gray-200 rounded-xl p-8 shadow-sm print:border-none print:shadow-none print:p-0 min-h-[700px] flex flex-col justify-between`}>
                  
                  {/* Page Content */}
                  <div>
                    {/* Repeated Header Section across Every Page */}
                    <div className="border-b border-black pb-3 mb-4">
                      <div className="flex justify-between items-start">
                        <div className="flex items-start gap-4">
                          {hasLogo && (
                            <img src={resolvedHeader.logoUrl!} alt="Logo" className="h-12 w-auto object-contain shrink-0 mt-0.5" />
                          )}
                          <div>
                            <h1 className="text-xl font-bold tracking-tight text-black leading-none">
                              {resolvedHeader.companyNameTh}
                              {resolvedHeader.branchNameTh && (
                                <span className="ml-2 text-sm font-bold text-gray-700">({resolvedHeader.branchNameTh})</span>
                              )}
                            </h1>
                            <p className="text-xs font-bold text-gray-800 mt-0.5 tracking-wide">{resolvedHeader.companyNameEn}</p>
                            <p className="text-[11px] text-gray-800 leading-tight mt-1 max-w-lg">{resolvedHeader.addressTh}</p>
                            <p className="text-[11px] text-gray-800 mt-0.5">
                              {resolvedHeader.tel ? `โทร. ${resolvedHeader.tel} ` : ''}
                              {resolvedHeader.fax ? `โทรสาร ${resolvedHeader.fax} ` : ''}
                              {resolvedHeader.taxId ? `เลขประจำตัวผู้เสียภาษี ${resolvedHeader.taxId}` : ''}
                            </p>
                          </div>
                        </div>

                        {/* A report has no signed verification endpoint. Only show page count. */}
                        <div className="text-right shrink-0 flex flex-col items-end gap-1">
                          {resolvedHeader.showPageNumber && (
                            <div className="text-[11px] font-mono text-gray-800 font-bold mb-0.5">{pageNumberStr}</div>
                          )}
                        </div>
                      </div>

                      {/* Report Title */}
                      <div className="mt-3 pt-2 text-center">
                        <h2 className="text-xl font-bold text-black tracking-wide">{data.title}</h2>
                        <p className="text-xs text-gray-600 mt-0.5">ข้อมูลระบบสะสมและกระทบยอดรายการ WINSpeed ERP · วันที่พิมพ์: {nowStr}</p>
                      </div>
                    </div>

                    {/* Summary Metadata Bar (First Page Only) */}
                    {pageIdx === 0 && (
                      <div className="flex items-center justify-between text-xs bg-gray-50 border border-gray-200 rounded-lg p-2.5 mb-4">
                        <div><span className="text-gray-500">จำนวนรายการทั้งหมด:</span> <b className="font-semibold text-gray-800">{data.rows.length.toLocaleString()} รายการ</b></div>
                        <div><span className="text-gray-500">สถานะข้อมูล:</span> <b className="font-semibold text-gray-700">อ่านจากต้นทางตามเงื่อนไขรายงาน</b></div>
                        <div><span className="text-gray-500">ระบบอ้างอิง:</span> <b className="font-mono text-gray-800">WINSpeed-Connect · แม่แบบ v{resolvedHeader.version}</b></div>
                      </div>
                    )}

                    {/* Data Table */}
                    {pageIdx===0&&<ReportContext data={data}/>}
                    <div className="overflow-x-auto mb-4">
                      <table data-report-rows className={`w-full text-xs text-left border-collapse border border-gray-300 ${data.type==='daily-invoice'?'report-invoice-table':''}`}>
                        <thead>
                          <tr className="bg-[#1F3864] text-white text-[11px] font-semibold uppercase tracking-wider">
                            <th className="border border-gray-400 px-2.5 py-2 text-center w-10">#</th>
                            {printColumns.map(c => {
                              const isNum = isColumnNumeric(c);
                              return (
                                <th
                                  key={c.key}
                                  className={`border border-gray-400 px-3 py-2 ${isNum ? 'text-right' : 'text-left'}`}
                                >
                                  {c.label}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((row, i) => {
                            const globalRowIdx = startRowIndex + i;
                            return (
                              <Fragment key={globalRowIdx}><ReportGroupHeading data={data} row={row} previous={pageRows[i-1]} colSpan={printColumns.length+1}/><tr className={globalRowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                                <td className="border border-gray-300 px-2.5 py-1.5 text-center text-gray-400 text-[11px]">{globalRowIdx + 1}</td>
                                {printColumns.map(c => {
                                  const isNum = isColumnNumeric(c);
                                  const isIdent = c.type === 'identifier';
                                  return (
                                    <td
                                      key={c.key}
                                      className={`border border-gray-300 px-3 py-1.5 ${
                                        isNum ? 'text-right font-mono font-medium' : 'text-left'
                                      } ${isIdent ? 'font-mono font-semibold' : ''}`}
                                    >
                                      {formatReportCell(row[c.key], c)}
                                    </td>
                                  );
                                })}
                              </tr>{referenceColumns.length>0&&<tr><td colSpan={printColumns.length+1} className="border border-gray-300 px-3 py-2 text-[10px] leading-relaxed break-words"><div className="grid grid-cols-2 gap-x-4 gap-y-1">{referenceColumns.map(c=><div key={c.key}><strong>{c.label}: </strong>{formatReportCell(row[c.key],c)||'—'}</div>)}</div></td></tr>}</Fragment>
                            );
                          })}
                          {data.rows.length === 0 && (
                            <tr>
                              <td colSpan={printColumns.length + 1} className="py-10 text-center text-gray-400">
                                ไม่มีข้อมูลสำหรับรายงานนี้
                              </td>
                            </tr>
                          )}
                        </tbody>
                        {/* Table Totals Row on the Final Page */}
                        {isLastPage && data.rows.length > 0 && (
                          <tfoot>
                            <tr className="bg-gray-100 font-bold border-t-2 border-gray-400 text-gray-900 text-[11px]">
                              <td className="border border-gray-300 px-2.5 py-2 text-center" colSpan={2}>รวมทั้งสิ้น</td>
                              {printColumns.slice(1).map(c => {
                                const isNum = isColumnNumeric(c);
                                const hasTotal = totals[c.key] !== undefined;
                                return (
                                  <td
                                    key={c.key}
                                    className={`border border-gray-300 px-3 py-2 ${hasTotal && isNum ? 'text-right font-mono font-bold text-blue-900' : 'text-left'}`}
                                  >
                                    {hasTotal ? formatReportTotal(totals[c.key], c) : ''}
                                  </td>
                                );
                              })}
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>

                  {/* Document Footer (Rendered on Last Page) */}
                  {isLastPage && (
                    <div className="mt-4 pt-3 border-t-2 border-gray-800 space-y-3">
                      {/* Terms and Conditions Note */}
                      {resolvedHeader.termsAndConditions && (
                        <div className="text-[10px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2 leading-relaxed">
                          <span className="font-bold text-gray-700">เงื่อนไขและข้อกำหนด: </span>
                          {resolvedHeader.termsAndConditions}
                        </div>
                      )}

                      {/* Signature Blocks */}
                      {showSignaturesSection && (
                        <div className={`grid ${getGridColsClass(activeSigBoxesCount)} gap-4 text-center text-xs pb-1`}>
                          {showSalesBox && (
                            <div className="border border-black rounded-lg p-2.5 flex flex-col justify-between min-h-[90px] bg-white">
                              <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[30px]"></div>
                              <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                                <span className="font-bold shrink-0">(</span>
                                <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]"></div>
                                <span className="font-bold shrink-0">)</span>
                              </div>
                              <div className="mt-1 text-center">
                                <div className="text-[11px] font-semibold text-gray-700">{resolvedHeader.signatureSalesLabel}</div>
                                <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                              </div>
                            </div>
                          )}

                          {showApproverBox && (
                            <div className="border border-black rounded-lg p-2.5 flex flex-col justify-between min-h-[90px] bg-white">
                              <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[30px]"></div>
                              <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                                <span className="font-bold shrink-0">(</span>
                                <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]"></div>
                                <span className="font-bold shrink-0">)</span>
                              </div>
                              <div className="mt-1 text-center">
                                <div className="text-[11px] font-semibold text-gray-700">{resolvedHeader.signatureApprovedLabel}</div>
                                <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                              </div>
                            </div>
                          )}

                          {showWarehouseBox && (
                            <div className="border border-black rounded-lg p-2.5 flex flex-col justify-between min-h-[90px] bg-white">
                              <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[30px]"></div>
                              <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                                <span className="font-bold shrink-0">(</span>
                                <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]"></div>
                                <span className="font-bold shrink-0">)</span>
                              </div>
                              <div className="mt-1 text-center">
                                <div className="text-[11px] font-semibold text-gray-700">{resolvedHeader.signatureWarehouseLabel}</div>
                                <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Footer Notice & Page Count Bar */}
                      <div className="flex items-center justify-between text-xs text-gray-700 bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 font-medium">
                        <div>
                          {resolvedHeader.footerNote || `เอกสารนี้ออกโดยระบบอัตโนมัติ WINSpeed-Connect · ${resolvedHeader.companyNameTh}`}
                        </div>
                        <div>
                          {resolvedHeader.showPageNumber ? pageNumberStr : ''}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Non-last page bottom bar */}
                  {data.isoStamp && <div className="mt-auto pt-3 flex justify-end text-[10px] text-black" data-testid="report-iso-stamp">
                    {data.isoStamp.code} Rev.{data.isoStamp.revision}{data.isoStamp.effectiveDate ? ` (${formatThaiDate(data.isoStamp.effectiveDate)})` : ''}
                  </div>}
                  {!isLastPage && resolvedHeader.showPageNumber && (
                    <div className="mt-4 pt-2 border-t border-gray-200 flex justify-end text-xs text-gray-500 font-mono">
                      {pageNumberStr} (ต่อหน้าถัดไป)
                    </div>
                  )}

                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>,
    document.body
  );
}
