import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Printer, X, RefreshCw, AlertTriangle } from 'lucide-react';
import { fetchPaperDocument, printPaperCopies } from '../../services/api';
import type { PaperDocument, PrintedCopy } from '../../types';

const COLOR_META: Record<string, { name: string; accent: string; bg: string }> = {
  WHITE:  { name: 'ขาว — ต้นฉบับ (บัญชี)', accent: '#475569', bg: '#FFFFFF' },
  BLUE:   { name: 'ฟ้า — สำเนา (เก็บ)',     accent: '#2563EB', bg: '#EFF6FF' },
  PINK:   { name: 'ชมพู — ลูกค้า',          accent: '#DB2777', bg: '#FDF2F8' },
  GREEN:  { name: 'เขียว — รปภ. (ประตู)',  accent: '#059669', bg: '#ECFDF5' },
  YELLOW: { name: 'เหลือง — รปภ. (ประตู)',  accent: '#CA8A04', bg: '#FEFCE8' },
};

const PRICE_HIDDEN_COPY_COLORS = new Set(['PINK', 'GREEN', 'YELLOW']);

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 0; }
  body { margin: 0; padding: 0; background: white; }
  body > :not(.pt-modal-root) { display: none !important; }
  .pt-modal-root { display: block !important; position: static !important; }
  .pt-print-area { width: 100%; margin: 0 !important; display: block !important; }
  .pt-no-print { display: none !important; }
  .pt-copy { 
    page-break-after: always !important; 
    break-after: page !important; 
    width: 210mm;
    height: 297mm;
    box-sizing: border-box;
    margin: 0 auto !important;
    padding: 10mm !important;
    border: none !important;
    border-top: 6px solid var(--accent-color) !important;
  }
  .pt-copy:last-child { page-break-after: auto !important; break-after: auto !important; }
}`;

export function PaperDocModal({ soIds, onClose }: { soIds: (string | number)[]; onClose: () => void }) {
  const [jobs, setJobs] = useState<{ doc: PaperDocument; copies: PrintedCopy[]; qr: Record<string, string> }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const idsKey = soIds.join(',');

  useEffect(() => {
    (async () => {
      if (soIds.length === 0) return;
      setLoading(true);
      try {
        const results = await Promise.all(soIds.map(async id => {
          const [d, p] = await Promise.all([fetchPaperDocument(id), printPaperCopies(id, 'ISSUE')]);
          const qrMap: Record<string, string> = {};
          for (const c of p.copies) qrMap[c.color] = await QRCode.toDataURL(c.qrNonce, { width: 130, margin: 1 });
          return { doc: d, copies: p.copies, qr: qrMap };
        }));
        setJobs(results);
        setError(null);
      } catch (e) { 
        console.error(e); 
        setError((e as Error).message); 
      }
      setLoading(false);
    })();
  }, [idsKey]);

  const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

  return createPortal(
    <div className="pt-modal-root fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 print:static print:p-0 print:bg-transparent print:block" onClick={onClose}>
      <style>{PRINT_CSS}</style>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col print:max-w-none print:max-h-none print:shadow-none print:rounded-none print:bg-transparent print:block" onClick={e => e.stopPropagation()}>
        {/* toolbar */}
        <div className="pt-no-print px-5 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Printer size={18} className="text-[#0C447C]" /> เอกสารจ่ายของ 4 สี + QR {jobs.length > 0 ? `· ${jobs.map(j => j.doc.WfRef).join(', ')}` : ''}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => {
                const prevTitle = document.title;
                if (jobs.length > 0) document.title = jobs.map(j => j.doc.WfRef).join('_');
                window.print();
                document.title = prevTitle;
              }} disabled={loading || jobs.length === 0}
              className="px-4 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50" style={{ background: '#0C447C' }}>
              <Printer size={15} /> พิมพ์ {jobs.length > 1 ? `(${jobs.length} ใบ)` : ''}
            </button>
            <button onClick={onClose} className="h-9 w-9 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"><X size={16} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 bg-gray-100 print:overflow-visible print:p-0 print:bg-transparent print:block">
          {error ? (
            <div className="py-20 flex flex-col items-center justify-center text-center px-4">
              <div className="h-16 w-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">ไม่สามารถโหลดข้อมูลได้</h3>
              <p className="text-gray-500 max-w-md">{error}</p>
              <button 
                onClick={onClose} 
                className="mt-6 px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-lg transition-colors"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          ) : loading || jobs.length === 0 ? (
            <div className="py-20 flex justify-center"><RefreshCw size={28} className="animate-spin text-gray-300" /></div>
          ) : (
            <div className="pt-print-area">
              {jobs.map((job, jIdx) => (
                <div key={jIdx}>
                  {job.copies.map(c => {
                    const m = COLOR_META[c.color] || COLOR_META.WHITE;
                    const showPrices = !PRICE_HIDDEN_COPY_COLORS.has(c.color);
                    return (
                      <div key={c.color} className="pt-copy bg-white border rounded-lg p-4 sm:p-5 mx-auto mb-5" style={{ borderColor: m.accent, borderTopWidth: 6, maxWidth: 790, '--accent-color': m.accent } as React.CSSProperties}>
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-lg font-black" style={{ color: '#0C447C' }}>บริษัท เวิลด์ เฟอท จำกัด</div>
                            <div className="text-sm font-bold text-gray-700">ใบจ่ายสินค้า / Delivery Order</div>
                            <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold text-white" style={{ background: m.accent }}>{m.name}</span>
                          </div>
                          <div className="text-right">
                            {job.qr[c.color] && <img src={job.qr[c.color]} alt="QR" width={96} height={96} className="ml-auto" />}
                            <div className="font-mono text-[10px] text-gray-500 mt-1">{c.qrNonce}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mt-3 border-t pt-3" style={{ borderColor: '#E5E7EB' }}>
                          <div><span className="text-gray-400">เลขที่:</span> <b className="font-mono">{job.doc.WfRef}</b></div>
                          <div><span className="text-gray-400">วันที่:</span> {fmtDate(job.doc.CreatedAt)}</div>
                          <div className="col-span-2"><span className="text-gray-400">ลูกค้า:</span> <b>{job.doc.CustName}</b></div>
                          <div><span className="text-gray-400">ทะเบียนรถ:</span> {job.doc.TruckPlate || '-'}</div>
                          <div><span className="text-gray-400">ตั๋วคุม:</span> {job.doc.ControlTicketNo || '-'}</div>
                          <div><span className="text-gray-400">พนักงานขาย:</span> {job.doc.SalesName || '-'}</div>
                          <div><span className="text-gray-400">วันส่ง:</span> {fmtDate(job.doc.DeliveryDate)}</div>
                        </div>

                        <table className="w-full text-[11px] sm:text-xs mt-3 min-w-full leading-tight">
                          <thead className="whitespace-nowrap">
                            <tr className="text-[10px] sm:text-xs text-white" style={{ background: '#1F3864' }}>
                              <th className="px-1 py-1.5 text-center whitespace-nowrap w-8">ลำดับ</th>
                              <th className="px-2 py-1.5 text-left whitespace-nowrap">รหัส/สูตร</th>
                              <th className="px-2 py-1.5 text-right whitespace-nowrap w-12">ตัน</th>
                              <th className="px-2 py-1.5 text-right whitespace-nowrap w-14">กระสอบ</th>
                              {showPrices && <th className="px-2 py-1.5 text-right whitespace-nowrap w-16">ราคา/ตัน</th>}
                              {showPrices && <th className="px-2 py-1.5 text-right whitespace-nowrap w-24">จำนวนเงิน</th>}
                              <th className="px-2 py-1.5 text-center whitespace-nowrap w-12">โหลด</th>
                            </tr>
                          </thead>
                          <tbody>
                            {job.doc.lines.map(l => {
                              const price = Number(l.NetPricePerTon || l.PricePerTon || 0);
                              const total = Number(l.QtyTon) * price;
                              return (
                                <tr key={l.LineNum} className="border-b" style={{ borderColor: '#F0F0F0' }}>
                                  <td className="px-1 py-1.5 text-center whitespace-nowrap">{l.LineNum}</td>
                                  <td className="px-2 py-1.5 whitespace-nowrap font-medium">{l.GoodName || l.GoodCode}{l.IsGiveaway ? ' (แถม)' : ''}</td>
                                  <td className="px-2 py-1.5 text-right whitespace-nowrap">{Number(l.QtyTon).toFixed(2)}</td>
                                  <td className="px-2 py-1.5 text-right whitespace-nowrap">{l.QtyBag}</td>
                                  {showPrices && <td className="px-2 py-1.5 text-right whitespace-nowrap">{price > 0 ? price.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>}
                                  {showPrices && <td className="px-2 py-1.5 text-right whitespace-nowrap font-medium">{total > 0 ? total.toLocaleString(undefined, {minimumFractionDigits: 2}) : '-'}</td>}
                                  <td className="px-2 py-1.5 text-center whitespace-nowrap">{l.LoadSequence ?? '-'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="font-bold text-[11px] sm:text-xs" style={{ background: '#F8FAFC' }}>
                              <td className="px-2 py-2 whitespace-nowrap text-right" colSpan={2}>รวมทั้งหมด</td>
                              <td className="px-2 py-2 text-right whitespace-nowrap">{job.doc.lines.reduce((s, l) => s + Number(l.QtyTon), 0).toFixed(2)}</td>
                              <td className="px-2 py-2 text-right whitespace-nowrap">{job.doc.lines.reduce((s, l) => s + Number(l.QtyBag), 0).toLocaleString()}</td>
                              {showPrices && <td className="px-2 py-2 text-right whitespace-nowrap"></td>}
                              {showPrices && <td className="px-2 py-2 text-right whitespace-nowrap">{job.doc.lines.reduce((s, l) => s + (Number(l.QtyTon) * Number(l.NetPricePerTon || l.PricePerTon || 0)), 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>}
                              <td className="px-2 py-2 whitespace-nowrap"></td>
                            </tr>
                          </tfoot>
                        </table>

                        <div className="grid grid-cols-3 gap-4 mt-8 text-xs text-gray-500">
                          <div className="text-center"><div className="border-t border-gray-400 pt-1.5 mt-10">ผู้รับเงิน / พนักงานขาย</div></div>
                          <div className="text-center"><div className="border-t border-gray-400 pt-1.5 mt-10">ผู้จ่ายสินค้า</div></div>
                          <div className="text-center"><div className="border-t border-gray-400 pt-1.5 mt-10">ผู้รับสินค้า / รปภ. (ประตู)</div></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
