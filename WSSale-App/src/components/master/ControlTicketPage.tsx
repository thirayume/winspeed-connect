import { useEffect, useState, useCallback } from 'react';
import { Ticket, RefreshCw, Search, ChevronLeft, ChevronRight, Truck, ArrowDownToLine } from 'lucide-react';
import { fetchControlTickets, fetchControlTicketDetails, fetchControlTicketDraws } from '../../services/api';
import type { ControlTicket, ControlTicketDraw } from '../../types';

type Line = { ListNo: number; GoodCode: string; GoodName: string; QtyTon: number; PricePerTon: number };

export function ControlTicketPage() {
  const [tickets, setTickets] = useState<ControlTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<ControlTicket | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draws, setDraws] = useState<ControlTicketDraw[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setTickets(await fetchControlTickets()); } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function open(t: ControlTicket) {
    setSel(t); setDetailLoading(true);
    try {
      const [ls, ds] = await Promise.all([
        fetchControlTicketDetails(t.DocuNo) as Promise<Line[]>,
        fetchControlTicketDraws(t.DocuNo),
      ]);
      setLines(ls); setDraws(ds);
    } catch (e) { console.error(e); }
    setDetailLoading(false);
  }

  const filtered = tickets.filter(t => !q || t.CustName?.includes(q) || t.DocuNo?.includes(q));
  const rem = (t: ControlTicket) => Math.max(0, Number(t.TotalQtyTon) - Number(t.DrawnQtyTon));

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {sel && <button onClick={() => setSel(null)} className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronLeft size={16} /></button>}
          <div>
            <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
              <Ticket className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> {sel ? `ตั๋วคุม ${sel.DocuNo}` : 'ชุดตั๋วคุม (Control Ticket)'}
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">{sel ? `${sel.CustName} · คงเหลือ ${rem(sel).toFixed(2)} ตัน` : 'ยอดคงค้าง (Total − Drawn) · เจาะดูรายการ+ประวัติการตัด (FR-021)'}</p>
          </div>
        </div>
        <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white"><RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} /></button>
      </div>

      <div className="flex-1 overflow-auto p-0 sm:p-6">
        {!sel ? (
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <Search size={14} className="text-gray-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา ลูกค้า / เลขตั๋ว (AI...)" className="flex-1 text-sm outline-none bg-transparent" />
              <span className="text-xs text-gray-400">{filtered.length} ตั๋ว</span>
            </div>
            {loading ? (
              <div className="py-16 flex justify-center"><RefreshCw size={26} className="animate-spin text-gray-300" /></div>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">ไม่พบตั๋วคุมคงค้าง</p>
            ) : (
              <table className="w-full text-sm min-w-full">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                  <tr>
                    <th className="px-4 py-3 text-left whitespace-nowrap">เลขตั๋ว (AI)</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">ลูกค้า</th>
                    <th className="px-4 py-3 text-center whitespace-nowrap">วันที่</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">จอง (ตัน)</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">ตัดแล้ว</th>
                    <th className="px-4 py-3 text-left w-48 whitespace-nowrap">คงเหลือ</th>
                    <th className="px-4 py-3 whitespace-nowrap"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(t => {
                    const total = Number(t.TotalQtyTon), drawn = Number(t.DrawnQtyTon), remain = rem(t);
                    const pct = total ? (drawn / total) * 100 : 0;
                    return (
                      <tr key={String(t.SOID)} onClick={() => open(t)} className="hover:bg-blue-50/40 cursor-pointer">
                        <td className="px-4 py-2.5 font-mono font-bold text-[#0C447C] whitespace-nowrap">{t.DocuNo}</td>
                        <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate" title={t.CustName}>{t.CustName}</td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-400 whitespace-nowrap">{t.DocuDate?.substring(0, 10)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 whitespace-nowrap">{total.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-400 whitespace-nowrap">{drawn.toFixed(2)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#0C447C] rounded-full" style={{ width: `${pct}%` }} /></div>
                            <span className="text-xs font-bold text-green-600 w-16 text-right">{remain.toFixed(2)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap"><ChevronRight size={16} className="text-gray-300 ml-auto" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4">
              <Stat label="จอง (ตัน)" value={Number(sel.TotalQtyTon).toFixed(2)} color="#0C447C" />
              <Stat label="ตัดแล้ว" value={Number(sel.DrawnQtyTon).toFixed(2)} color="#9CA3AF" />
              <Stat label="คงเหลือ" value={rem(sel).toFixed(2)} color="#059669" />
            </div>

            <Panel title="รายการในชุดตั๋ว" loading={detailLoading}>
              <table className="w-full text-sm min-w-full">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap"><tr>
                  <th className="px-4 py-2 text-left whitespace-nowrap">สูตร</th><th className="px-4 py-2 text-right whitespace-nowrap">ตัน</th><th className="px-4 py-2 text-right whitespace-nowrap">ราคา/ตัน</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {lines.map(l => <tr key={l.ListNo}><td className="px-4 py-2 whitespace-nowrap">{l.GoodName || l.GoodCode}</td><td className="px-4 py-2 text-right whitespace-nowrap">{Number(l.QtyTon).toFixed(2)}</td><td className="px-4 py-2 text-right text-gray-500 whitespace-nowrap">{Number(l.PricePerTon).toLocaleString()}</td></tr>)}
                  {lines.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-gray-300 whitespace-nowrap">—</td></tr>}
                </tbody>
              </table>
            </Panel>

            <Panel title={`ประวัติการตัด (${draws.length})`} loading={detailLoading}>
              <table className="w-full text-sm min-w-full">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap"><tr>
                  <th className="px-4 py-2 text-left whitespace-nowrap">เลข SO (104)</th><th className="px-4 py-2 text-center whitespace-nowrap">วันที่</th><th className="px-4 py-2 text-left whitespace-nowrap">รถ</th><th className="px-4 py-2 text-right whitespace-nowrap">ตัดออก (ตัน)</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {draws.map(d => <tr key={String(d.SOID)} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2 font-mono text-xs text-[#0C447C] whitespace-nowrap">{d.DocuNo}</td>
                    <td className="px-4 py-2 text-center text-xs text-gray-400 whitespace-nowrap">{d.DocuDate}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 flex items-center gap-1 whitespace-nowrap">{d.TruckPlate ? <><Truck size={11} />{d.TruckPlate}</> : '-'}</td>
                    <td className="px-4 py-2 text-right font-semibold whitespace-nowrap"><span className="inline-flex items-center gap-1"><ArrowDownToLine size={12} className="text-amber-500" />{Number(d.DrawnQtyTon).toFixed(2)}</span></td>
                  </tr>)}
                  {draws.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-300 whitespace-nowrap">ยังไม่มีการตัด</td></tr>}
                </tbody>
              </table>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4"><div className="text-xs text-gray-400">{label}</div><div className="text-2xl font-bold" style={{ color }}>{value}</div></div>;
}
function Panel({ title, loading, children }: { title: string; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100"><h2 className="text-sm font-bold text-gray-700">{title}</h2></div>
      {loading ? <div className="py-8 flex justify-center"><RefreshCw size={20} className="animate-spin text-gray-300" /></div> : <div className="overflow-x-auto">{children}</div>}
    </div>
  );
}
