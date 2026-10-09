/**
 * QuotationPrintModal.tsx — ใบเสนอราคา A4 (UAT QT-09, owner 2026-10-09: พิมพ์จาก Sale-App ได้)
 *
 * หัวกระดาษใช้การตั้งค่าเดียวกับเอกสารพิมพ์อื่น (reportId QUOTATION) · แสดงราคาขายต่อตันและจำนวนเงิน
 * ไม่แสดงราคาสุทธิ (NET) เพราะเป็นข้อมูลภายใน · เลขที่เอกสารคือเลข QU ใน WINSpeed
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, Settings, RefreshCw, AlertTriangle } from 'lucide-react';
import { getDocHeaderConfig, type DocHeaderConfig } from '../../utils/docHeaderSettings';
import { DocHeaderSettingsModal } from '../common/DocHeaderSettingsModal';
import { fetchQuotation } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import { canManageDocHeaderSettings } from '../../utils/permissions';
import { thaiBahtText } from '../../utils/thaiBahtText';
import type { Quotation } from '../../types';

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 0; }
  body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body > :not(.qt-doc-root) { display: none !important; }
  .qt-doc-root { display: block !important; position: static !important; }
  .qt-no-print { display: none !important; }
  .qt-page {
    width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 0 auto !important;
    padding: 12mm 15mm !important; border: none !important; box-shadow: none !important; background: white !important;
    font-family: "TH Sarabun PSK", "Sarabun", "Cordia New", sans-serif;
  }
}
`;

type PrintableQuote = Quotation & { CustCode?: string | null; CustAddress?: string | null; CustTel?: string | null };

const money = (n: unknown) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tons = (n: unknown) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const thaiDate = (d?: string | null) => {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x.getTime())) return String(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear() + 543}`;
};

export function QuotationPrintModal({ quoteId, onClose }: { quoteId: number; onClose: () => void }) {
  const currentUser = useAuthStore(s => s.user);
  const [quote, setQuote] = useState<PrintableQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [headerConfig, setHeaderConfig] = useState<DocHeaderConfig>(() => getDocHeaderConfig('QUOTATION'));
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const refresh = () => setHeaderConfig(getDocHeaderConfig('QUOTATION'));
    window.addEventListener('doc-header-settings-updated', refresh);
    return () => window.removeEventListener('doc-header-settings-updated', refresh);
  }, []);

  useEffect(() => {
    fetchQuotation(quoteId)
      .then(q => setQuote(q as PrintableQuote))
      .catch(e => setError((e as Error).message || 'โหลดใบเสนอราคาไม่สำเร็จ'));
  }, [quoteId]);

  const lines = quote?.lines || [];
  const lineAmount = (l: { LineAmount?: number; QtyTon: number; PricePerTon: number; IsGiveaway?: boolean }) =>
    l.IsGiveaway ? 0 : Number(l.LineAmount ?? Number(l.QtyTon || 0) * Number(l.PricePerTon || 0));
  const totalTon = lines.reduce((s, l) => s + Number(l.QtyTon || 0), 0);
  const totalAmount = lines.reduce((s, l) => s + lineAmount(l), 0);
  const docNo = quote ? (quote.WinspeedQuoteNo || quote.QuoteNo) : '';

  return createPortal(
    <div className="qt-doc-root fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:static print:p-0 print:bg-transparent print:block" onClick={onClose}>
      <style>{PRINT_CSS}</style>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col print:max-w-none print:max-h-none print:shadow-none print:rounded-none print:block"
        onClick={e => e.stopPropagation()}>
        <div className="qt-no-print px-6 py-3.5 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <h2 className="font-bold text-gray-800 text-base flex items-center gap-2">
            <Printer size={18} className="text-[#0C447C]" /> ใบเสนอราคา
            {docNo && <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-[#0C447C] font-mono text-xs font-semibold">{docNo}</span>}
          </h2>
          <div className="flex items-center gap-2">
            {canManageDocHeaderSettings(currentUser) && (
              <button onClick={() => setShowSettings(true)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1.5">
                <Settings size={14} className="text-[#0C447C]" /> ตั้งค่าหัวกระดาษ
              </button>
            )}
            <button data-testid="quotation-print-button"
              onClick={() => {
                const prev = document.title;
                document.title = `Quotation_${docNo || quoteId}`;
                window.print();
                document.title = prev;
              }}
              disabled={!quote}
              className="px-4 py-1.5 rounded-lg text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50" style={{ background: '#0C447C' }}>
              <Printer size={14} /> พิมพ์ / Export PDF (A4)
            </button>
            <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-200/70 print:overflow-visible print:p-0 print:bg-transparent">
          {error ? (
            <div className="py-20 flex flex-col items-center text-center bg-white rounded-xl">
              <AlertTriangle size={36} className="text-red-500 mb-3" />
              <p className="text-sm text-gray-600">{error}</p>
            </div>
          ) : !quote ? (
            <div className="py-20 flex justify-center bg-white rounded-xl"><RefreshCw size={28} className="animate-spin text-[#0C447C]" /></div>
          ) : (
            <div data-testid="quotation-print-page" className="qt-page bg-white shadow-xl p-8 mx-auto text-black border border-gray-300" style={{ maxWidth: '210mm' }}>
              <div className="flex items-start justify-between border-b pb-3 border-black">
                <div className="flex items-start gap-4">
                  {headerConfig.logoUrl && <img src={headerConfig.logoUrl} alt="Logo" className="h-12 w-auto object-contain" />}
                  <div>
                    <h1 className="text-xl font-bold leading-none">{headerConfig.companyNameTh}</h1>
                    <p className="text-xs font-semibold text-gray-700 mt-0.5">{headerConfig.companyNameEn}</p>
                    <p className="text-[11px] text-gray-800 leading-tight mt-1 max-w-lg">{headerConfig.addressTh}</p>
                    <p className="text-[11px] text-gray-800 mt-0.5">
                      โทร. {headerConfig.tel} โทรสาร {headerConfig.fax} เลขประจำตัวผู้เสียภาษี {headerConfig.taxId}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold">ใบเสนอราคา</div>
                  <div className="text-xs font-semibold text-gray-700">QUOTATION</div>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-2 text-xs mt-3 mb-3">
                <div className="col-span-7 border border-black rounded p-2.5 space-y-1">
                  <div className="flex"><span className="font-bold w-20 shrink-0">ลูกค้า</span><b>{quote.CustName}</b></div>
                  <div className="flex"><span className="font-bold w-20 shrink-0">รหัสลูกค้า</span><span>{quote.CustCode || quote.CustId}</span></div>
                  <div className="flex"><span className="font-bold w-20 shrink-0">ที่อยู่</span><span>{quote.CustAddress || '-'}</span></div>
                  <div className="flex"><span className="font-bold w-20 shrink-0">โทร.</span><span>{quote.CustTel || '-'}</span></div>
                </div>
                <div className="col-span-5 border border-black rounded p-2.5 space-y-1">
                  <div className="flex justify-between"><span className="font-bold">เลขที่</span><span className="font-mono font-bold">{docNo}</span></div>
                  <div className="flex justify-between"><span className="font-bold">วันที่</span><span>{thaiDate(quote.CreatedAt)}</span></div>
                  <div className="flex justify-between"><span className="font-bold">ยืนราคาถึง</span><b>{thaiDate(quote.ValidUntil)}</b></div>
                  <div className="flex justify-between"><span className="font-bold">พนักงานขาย</span><span>{quote.SalesName || '-'}</span></div>
                  {quote.CreditDays != null && (
                    <div className="flex justify-between"><span className="font-bold">เครดิต</span><span>{quote.CreditDays} วัน</span></div>
                  )}
                </div>
              </div>

              <p className="text-xs mb-2">บริษัทฯ ยินดีเสนอราคาสินค้าตามรายการดังต่อไปนี้</p>

              <table className="w-full text-xs border border-black border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-center font-bold">
                    <th className="py-2 px-2 border border-black w-12">ลำดับ</th>
                    <th className="py-2 px-2 border border-black w-40">รหัสสินค้า</th>
                    <th className="py-2 px-2 border border-black">รายการสินค้า</th>
                    <th className="py-2 px-2 border border-black w-24">จำนวน (ตัน)</th>
                    <th className="py-2 px-2 border border-black w-28">ราคา/ตัน (บาท)</th>
                    <th className="py-2 px-2 border border-black w-32">จำนวนเงิน (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={`${l.GoodId}-${i}`}>
                      <td className="py-1.5 px-2 border border-black text-center">{i + 1}</td>
                      <td className="py-1.5 px-2 border border-black font-mono whitespace-nowrap">{l.GoodCode}</td>
                      <td className="py-1.5 px-2 border border-black">{l.GoodName}{l.IsGiveaway ? ' (ของแถม)' : ''}</td>
                      <td className="py-1.5 px-2 border border-black text-right">{tons(l.QtyTon)}</td>
                      <td className="py-1.5 px-2 border border-black text-right">{l.IsGiveaway ? '-' : money(l.PricePerTon)}</td>
                      <td className="py-1.5 px-2 border border-black text-right font-semibold">{l.IsGiveaway ? '-' : money(lineAmount(l))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold bg-gray-50">
                    <td colSpan={3} className="py-2 px-2 border border-black text-right">รวม</td>
                    <td className="py-2 px-2 border border-black text-right">{tons(totalTon)}</td>
                    <td className="py-2 px-2 border border-black text-right">รวมเป็นเงิน</td>
                    <td data-testid="quotation-print-total" className="py-2 px-2 border border-black text-right">{money(totalAmount)}</td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="py-2 px-2 border border-black text-center font-semibold">({thaiBahtText(totalAmount)})</td>
                  </tr>
                </tfoot>
              </table>

              <div className="text-xs mt-3 space-y-1">
                <div><b>เงื่อนไข:</b> ราคานี้ยืนถึงวันที่ {thaiDate(quote.ValidUntil)} · การสั่งซื้อจะยืนยันเมื่อบริษัทฯ ออกใบสั่งจอง</div>
                {quote.Remark && <div><b>หมายเหตุ:</b> {quote.Remark}</div>}
              </div>

              <div className="grid grid-cols-2 gap-6 text-center text-xs mt-14">
                {['ผู้เสนอราคา', 'ผู้อนุมัติ'].map(label => (
                  <div key={label}>
                    <div className="border-b border-dotted border-gray-500 h-10 mx-8" />
                    <div className="mt-1">( {label === 'ผู้เสนอราคา' ? (quote.SalesName || '') : ''} )</div>
                    <div className="font-semibold mt-0.5">{label}</div>
                    <div className="text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                  </div>
                ))}
              </div>

              {headerConfig.showFooterNote && (
                <div className="text-[10px] text-gray-500 text-center mt-10">{headerConfig.footerNote}</div>
              )}
            </div>
          )}
        </div>
      </div>
      <DocHeaderSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} reportId="QUOTATION" reportTitle="ใบเสนอราคา (Quotation)" />
    </div>,
    document.body,
  );
}
