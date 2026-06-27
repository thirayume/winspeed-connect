import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, X, RefreshCw } from 'lucide-react';
import { fetchPaperDocument, printPaperCopies } from '../../services/api';
import type { PaperDocument, PrintedCopy } from '../../types';

const COLOR_META: Record<string, { name: string; accent: string; bg: string }> = {
  WHITE:  { name: 'ขาว — ต้นฉบับ (บัญชี)', accent: '#475569', bg: '#FFFFFF' },
  BLUE:   { name: 'ฟ้า — สำเนา (เก็บ)',     accent: '#2563EB', bg: '#EFF6FF' },
  PINK:   { name: 'ชมพู — ลูกค้า',          accent: '#DB2777', bg: '#FDF2F8' },
  YELLOW: { name: 'เหลือง — รปภ. (ประตู)',  accent: '#CA8A04', bg: '#FEFCE8' },
};

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .pt-print-area, .pt-print-area * { visibility: visible !important; }
  .pt-print-area { position: absolute; left: 0; top: 0; width: 100%; }
  .pt-no-print { display: none !important; }
  .pt-copy { page-break-after: always; }
  .pt-copy:last-child { page-break-after: auto; }
}`;

export function PaperDocModal({ soId, onClose }: { soId: string | number; onClose: () => void }) {
  const [doc, setDoc] = useState<PaperDocument | null>(null);
  const [copies, setCopies] = useState<PrintedCopy[]>([]);
  const [qr, setQr] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [d, p] = await Promise.all([fetchPaperDocument(soId), printPaperCopies(soId, 'ISSUE')]);
        setDoc(d); setCopies(p.copies);
        const qrMap: Record<string, string> = {};
        for (const c of p.copies) qrMap[c.color] = await QRCode.toDataURL(c.qrNonce, { width: 130, margin: 1 });
        setQr(qrMap);
      } catch (e) { console.error(e); alert((e as Error).message); }
      setLoading(false);
    })();
  }, [soId]);

  const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <style>{PRINT_CSS}</style>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* toolbar */}
        <div className="pt-no-print px-5 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Printer size={18} className="text-[#0C447C]" /> เอกสารจ่ายของ 4 สี + QR {doc ? `· ${doc.WfRef}` : ''}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} disabled={loading}
              className="px-4 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50" style={{ background: '#0C447C' }}>
              <Printer size={15} /> พิมพ์ (4 สำเนา)
            </button>
            <button onClick={onClose} className="h-9 w-9 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"><X size={16} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 bg-gray-100">
          {loading || !doc ? (
            <div className="py-20 flex justify-center"><RefreshCw size={28} className="animate-spin text-gray-300" /></div>
          ) : (
            <div className="pt-print-area space-y-5">
              {copies.map(c => {
                const m = COLOR_META[c.color] || COLOR_META.WHITE;
                return (
                  <div key={c.color} className="pt-copy bg-white border rounded-lg p-5 mx-auto" style={{ borderColor: m.accent, borderTopWidth: 6, maxWidth: 720 }}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-lg font-black" style={{ color: '#0C447C' }}>บริษัท เวิลด์ เฟอท จำกัด</div>
                        <div className="text-sm font-bold text-gray-700">ใบจ่ายสินค้า / Delivery Order</div>
                        <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold text-white" style={{ background: m.accent }}>{m.name}</span>
                      </div>
                      <div className="text-right">
                        {qr[c.color] && <img src={qr[c.color]} alt="QR" width={96} height={96} className="ml-auto" />}
                        <div className="font-mono text-[10px] text-gray-500 mt-1">{c.qrNonce}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mt-3 border-t pt-3" style={{ borderColor: '#E5E7EB' }}>
                      <div><span className="text-gray-400">เลขที่:</span> <b className="font-mono">{doc.WfRef}</b></div>
                      <div><span className="text-gray-400">วันที่:</span> {fmtDate(doc.CreatedAt)}</div>
                      <div className="col-span-2"><span className="text-gray-400">ลูกค้า:</span> <b>{doc.CustName}</b></div>
                      <div><span className="text-gray-400">ทะเบียนรถ:</span> {doc.TruckPlate || '-'}</div>
                      <div><span className="text-gray-400">ตั๋วคุม:</span> {doc.ControlTicketNo || '-'}</div>
                      <div><span className="text-gray-400">พนักงานขาย:</span> {doc.SalesName || '-'}</div>
                      <div><span className="text-gray-400">วันส่ง:</span> {fmtDate(doc.DeliveryDate)}</div>
                    </div>

                    <table className="w-full text-sm mt-3">
                      <thead>
                        <tr className="text-xs text-white" style={{ background: '#1F3864' }}>
                          <th className="px-2 py-1.5 text-left">ลำดับ</th>
                          <th className="px-2 py-1.5 text-left">รหัส/สูตร</th>
                          <th className="px-2 py-1.5 text-right">ตัน</th>
                          <th className="px-2 py-1.5 text-right">กระสอบ</th>
                          <th className="px-2 py-1.5 text-center">โหลด</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doc.lines.map(l => (
                          <tr key={l.LineNum} className="border-b" style={{ borderColor: '#F0F0F0' }}>
                            <td className="px-2 py-1.5">{l.LineNum}</td>
                            <td className="px-2 py-1.5">{l.GoodName || l.GoodCode}{l.IsGiveaway ? ' (แถม)' : ''}</td>
                            <td className="px-2 py-1.5 text-right">{Number(l.QtyTon).toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right">{l.QtyBag}</td>
                            <td className="px-2 py-1.5 text-center">{l.LoadSequence ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-bold" style={{ background: '#F8FAFC' }}>
                          <td className="px-2 py-1.5" colSpan={2}>รวม</td>
                          <td className="px-2 py-1.5 text-right">{doc.lines.reduce((s, l) => s + Number(l.QtyTon), 0).toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right">{doc.lines.reduce((s, l) => s + Number(l.QtyBag), 0)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>

                    <div className="grid grid-cols-3 gap-4 mt-6 text-xs text-gray-500">
                      <div className="text-center"><div className="border-t border-gray-400 pt-1 mt-8">ผู้จ่ายสินค้า</div></div>
                      <div className="text-center"><div className="border-t border-gray-400 pt-1 mt-8">ผู้ขับรถ / ผู้รับ</div></div>
                      <div className="text-center"><div className="border-t border-gray-400 pt-1 mt-8">รปภ. (ประตู)</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
