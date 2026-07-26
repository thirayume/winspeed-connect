import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Printer, X, FileText, Settings } from 'lucide-react';
import type { ReportData } from '../../services/api';
import { getDocHeaderConfig, type DocHeaderConfig, DEFAULT_WF_LOGO_DATA_URL } from '../../utils/docHeaderSettings';
import { DocHeaderSettingsModal } from '../common/DocHeaderSettingsModal';
import { useAuthStore } from '../../store/auth-store';
import { canManageDocHeaderSettings } from '../../utils/permissions';

const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)));
const fmt = (v: unknown) => isNum(v) ? Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 }) : (v ?? '-');

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body > :not(.report-modal-root) { display: none !important; }
  .report-modal-root { display: block !important; position: static !important; }
  .report-print-area { width: 100%; margin: 0 !important; display: block !important; }
  .report-no-print { display: none !important; }
  .report-page { 
    width: 210mm;
    min-height: 297mm;
    box-sizing: border-box;
    margin: 0 auto !important;
    padding: 10mm !important;
    border: none !important;
    box-shadow: none !important;
  }
  tfoot { display: table-row-group !important; }
  tfoot tr { page-break-inside: avoid !important; break-inside: avoid !important; }
}
`;

export function LegacyReportPdfModal({ data, onClose }: { data: ReportData; onClose: () => void }) {
  const currentUser = useAuthStore(s => s.user);
  const canManageHeader = canManageDocHeaderSettings(currentUser);

  const reportId = data?.key || data?.title;
  const [headerConfig, setHeaderConfig] = useState<DocHeaderConfig>(() => getDocHeaderConfig(reportId));
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

  useEffect(() => {
    if (data) {
      setHeaderConfig(getDocHeaderConfig(reportId));
    }
  }, [data, reportId]);

  useEffect(() => {
    const handleSettingsUpdate = (e: Event) => {
      const customEvt = e as CustomEvent<{ config: DocHeaderConfig; reportId?: string }>;
      if (customEvt.detail?.config) {
        setHeaderConfig(getDocHeaderConfig(reportId));
      }
    };
    window.addEventListener('doc-header-settings-updated', handleSettingsUpdate);
    return () => window.removeEventListener('doc-header-settings-updated', handleSettingsUpdate);
  }, [reportId]);

  useEffect(() => {
    if (!data) return;
    (async () => {
      try {
        const baseUrl = headerConfig.verificationBaseUrl || `${window.location.origin}/verify`;
        const verifyUrl = `${baseUrl}?type=REPORT&title=${encodeURIComponent(data.title)}`;
        const qr = await QRCode.toDataURL(verifyUrl, { width: 120, margin: 1 });
        setQrCodeUrl(qr);
      } catch (e) {
        console.error('Failed to generate QR code for report:', e);
      }
    })();
  }, [data, headerConfig.verificationBaseUrl]);

  if (!data) return null;

  const nowStr = new Date().toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Calculate column totals for numeric columns
  const totals: Record<string, number> = {};
  data.columns.forEach(c => {
    let sum = 0;
    let hasNumeric = false;
    data.rows.forEach(r => {
      const val = r[c.key];
      if (isNum(val)) {
        sum += Number(val);
        hasNumeric = true;
      }
    });
    if (hasNumeric) totals[c.key] = sum;
  });

  const handlePrint = () => {
    const prevTitle = document.title;
    document.title = `WINSpeed_Report_${data.title}_${new Date().toISOString().substring(0, 10)}`;
    window.print();
    document.title = prevTitle;
  };

  const activeLogo = headerConfig.logoUrl || DEFAULT_WF_LOGO_DATA_URL;

  return createPortal(
    <div className="report-modal-root fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:static print:p-0 print:bg-transparent print:block" onClick={onClose}>
      <style>{PRINT_CSS}</style>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col print:max-w-none print:max-h-none print:shadow-none print:rounded-none print:bg-transparent print:block" onClick={e => e.stopPropagation()}>
        
        {/* Modal Toolbar (No Print) */}
        <div className="report-no-print px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-red-50 rounded-xl flex items-center justify-center text-red-600">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="font-bold text-gray-800 text-base">แม่แบบรายงาน A4 PDF — {data.title}</h2>
              <p className="text-xs text-gray-500">รูปแบบเอกสาร A4 ตามมาตรฐาน WINSpeed Legacy Report</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {canManageHeader && (
              <button
                onClick={() => setShowSettingsModal(true)}
                className="px-3.5 py-2 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Settings size={14} className="text-[#0C447C]" /> ตั้งค่าหัวกระดาษ
              </button>
            )}
            <button
              onClick={handlePrint}
              className="px-5 py-2 rounded-xl text-white text-sm font-semibold flex items-center gap-2 shadow-md hover:bg-red-700 transition-colors"
              style={{ background: '#E53935' }}
            >
              <Printer size={16} /> พิมพ์ / บันทึกเป็น PDF (A4)
            </button>
            <button
              onClick={onClose}
              className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-500 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-100 print:overflow-visible print:p-0 print:bg-transparent print:block">
          <div className="report-page bg-white border border-gray-200 rounded-xl p-8 shadow-sm mx-auto max-w-[210mm] print:border-none print:shadow-none print:p-0">
            
            {/* Header Section — Standardized Layout matching Image 3 */}
            <div className="border-b border-black pb-3 mb-4">
              <div className="flex justify-between items-start">
                <div className="flex items-start gap-4">
                  {/* Logo (World Fert "W" Logo or Custom Logo) */}
                  <img src={activeLogo} alt="Logo" className="h-12 w-auto object-contain shrink-0 mt-0.5" />
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-black leading-none">{headerConfig.companyNameTh}</h1>
                    <p className="text-xs font-bold text-gray-800 mt-0.5 tracking-wide">{headerConfig.companyNameEn}</p>
                    <p className="text-[11px] text-gray-800 leading-tight mt-1 max-w-lg">{headerConfig.addressTh}</p>
                    <p className="text-[11px] text-gray-800 mt-0.5">
                      โทร. {headerConfig.tel} โทรสาร {headerConfig.fax} เลขประจำตัวผู้เสียภาษี {headerConfig.taxId}
                    </p>
                  </div>
                </div>

                {/* Right Side: Page Count & QR Code */}
                <div className="text-right shrink-0 flex flex-col items-end gap-1">
                  {headerConfig.showPageNumber !== false && (
                    <div className="text-[11px] font-mono text-gray-600 mb-0.5">หน้า 1 / 1</div>
                  )}
                  {qrCodeUrl && (
                    <div className="p-1 bg-white border border-black rounded text-center shadow-2xl">
                      <img src={qrCodeUrl} alt="QR Code" width={66} height={66} className="block" />
                      <span className="text-[8px] font-mono font-bold text-gray-800 block mt-0.5">สแกนตรวจสอบ</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Report Title */}
              <div className="mt-3 pt-2 text-center">
                <h2 className="text-xl font-bold text-black tracking-wide">{data.title}</h2>
                <p className="text-xs text-gray-600 mt-0.5">ข้อมูลระบบสะสมและกระทบยอดรายการ WINSpeed ERP · วันที่พิมพ์: {nowStr}</p>
              </div>
            </div>

            {/* Summary Metadata Bar */}
            <div className="flex items-center justify-between text-xs bg-gray-50 border border-gray-200 rounded-lg p-2.5 mb-4">
              <div><span className="text-gray-500">จำนวนรายการทั้งหมด:</span> <b className="font-semibold text-gray-800">{data.rows.length.toLocaleString()} รายการ</b></div>
              <div><span className="text-gray-500">สถานะข้อมูล:</span> <b className="font-semibold text-emerald-700">ตรวจสอบความถูกต้องแล้ว</b></div>
              <div><span className="text-gray-500">ระบบอ้างอิง:</span> <b className="font-mono text-gray-800">WINSpeed-Connect v1.4.0</b></div>
            </div>

            {/* Data Table */}
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-xs text-left border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-[#1F3864] text-white text-[11px] font-semibold uppercase tracking-wider">
                    <th className="border border-gray-400 px-2.5 py-2 text-center w-10">#</th>
                    {data.columns.map(c => (
                      <th
                        key={c.key}
                        className={`border border-gray-400 px-3 py-2 ${isNum(data.rows[0]?.[c.key]) ? 'text-right' : 'text-left'}`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                      <td className="border border-gray-300 px-2.5 py-1.5 text-center text-gray-400 text-[11px]">{i + 1}</td>
                      {data.columns.map(c => (
                        <td
                          key={c.key}
                          className={`border border-gray-300 px-3 py-1.5 ${isNum(row[c.key]) ? 'text-right font-mono font-medium' : 'text-left'}`}
                        >
                          {fmt(row[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={data.columns.length + 1} className="py-10 text-center text-gray-400">
                        ไม่มีข้อมูลสำหรับรายงานนี้
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-bold border-t-2 border-gray-400 text-gray-900 text-[11px]">
                    <td className="border border-gray-300 px-2.5 py-2 text-center" colSpan={2}>รวมทั้งสิ้น</td>
                    {data.columns.slice(1).map(c => (
                      <td key={c.key} className={`border border-gray-300 px-3 py-2 ${totals[c.key] !== undefined ? 'text-right font-mono font-bold text-blue-900' : 'text-left'}`}>
                        {totals[c.key] !== undefined ? totals[c.key].toLocaleString('th-TH', { maximumFractionDigits: 2 }) : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Document Footer Section */}
            {(showSignaturesSection || headerConfig.showFooterNote || headerConfig.showPageNumber) && (
              <div className="mt-8 pt-4 border-t-2 border-gray-800 space-y-4">
                {/* 1. Optional Signature Blocks */}
                {showSignaturesSection && (
                  <div className={`grid ${getGridColsClass(activeSigBoxesCount)} gap-4 text-center text-xs pb-1`}>
                    {showSalesBox && (
                      <div className="border border-black rounded-lg p-2.5 flex flex-col justify-between min-h-[95px] bg-white">
                        <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[35px]"></div>
                        <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                          <span className="font-bold shrink-0">(</span>
                          <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]"></div>
                          <span className="font-bold shrink-0">)</span>
                        </div>
                        <div className="mt-1 text-center">
                          <div className="text-[11px] font-semibold text-gray-700">{headerConfig.signatureSalesLabel}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                        </div>
                      </div>
                    )}

                    {showApproverBox && (
                      <div className="border border-black rounded-lg p-2.5 flex flex-col justify-between min-h-[95px] bg-white">
                        <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[35px]"></div>
                        <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                          <span className="font-bold shrink-0">(</span>
                          <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]"></div>
                          <span className="font-bold shrink-0">)</span>
                        </div>
                        <div className="mt-1 text-center">
                          <div className="text-[11px] font-semibold text-gray-700">{headerConfig.signatureApprovedLabel}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                        </div>
                      </div>
                    )}

                    {showWarehouseBox && (
                      <div className="border border-black rounded-lg p-2.5 flex flex-col justify-between min-h-[95px] bg-white">
                        <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[35px]"></div>
                        <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                          <span className="font-bold shrink-0">(</span>
                          <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]"></div>
                          <span className="font-bold shrink-0">)</span>
                        </div>
                        <div className="mt-1 text-center">
                          <div className="text-[11px] font-semibold text-gray-700">{headerConfig.signatureWarehouseLabel}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Footer Notice & Page Count Bar */}
                {(headerConfig.showFooterNote || headerConfig.showPageNumber) && (
                  <div className="flex items-center justify-between text-xs text-gray-700 bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 font-medium">
                    <div>
                      {headerConfig.showFooterNote ? (headerConfig.footerNote || 'เอกสารนี้ออกโดยระบบอัตโนมัติ WINSpeed-Connect · บริษัท เวิลด์ เฟอท จำกัด') : ''}
                    </div>
                    <div>
                      {headerConfig.showPageNumber ? 'หน้า 1 / 1' : ''}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

      </div>

      <DocHeaderSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        reportId={reportId}
        reportTitle={data.title}
      />
    </div>,
    document.body
  );
}
