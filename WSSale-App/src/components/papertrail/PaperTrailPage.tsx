import { useEffect, useState, useCallback } from 'react';
import { LayoutGrid, RefreshCw, Truck, FileText, ArrowRight, ArrowLeft, Clock, X } from 'lucide-react';
import { fetchPaperBoard, confirmSO, moveToPicking, shipSO, syncImported } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { SalesOrder } from '../../types';
import { fetchSalesOrders } from '../../services/api';
import type { PaperBoard, PaperCard, SOStatus } from '../../types';

const STAGE_META: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT:     { label: 'ร่าง',         color: '#6B7280', bg: '#F3F4F6' },
  CONFIRMED: { label: 'ยืนยัน',       color: '#0C447C', bg: '#EFF6FF' },
  PICKING:   { label: 'รอรับสินค้า',  color: '#B45309', bg: '#FFFBEB' },
  SHIPPED:   { label: 'ส่งออก',       color: '#047857', bg: '#ECFDF5' },
};
// next action per stage (role-gated server-side)
const NEXT: Record<string, { label: string; roles: string[] } | undefined> = {
  DRAFT:     { label: 'ยืนยัน', roles: ['SALES', 'COUNTER_SALES', 'ADMIN'] },
  CONFIRMED: { label: 'เริ่มรับสินค้า', roles: ['WAREHOUSE', 'ADMIN'] },
  PICKING:   { label: 'ส่งออก', roles: ['WAREHOUSE', 'ADMIN'] },
};

export function PaperTrailPage() {
  const role = useAuthStore(s => s.user?.role);
  const [data, setData]       = useState<PaperBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'cancelled'>('board');

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fetchPaperBoard()); } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function advance(card: PaperCard) {
    setBusyId(card.id);
    try {
      if (card.status === 'DRAFT') await confirmSO(card.id);
      else if (card.status === 'CONFIRMED') await moveToPicking(card.id);
      else if (card.status === 'PICKING') await shipSO(card.id);
      else if (card.status === 'SHIPPED') {
        const docuNo = prompt(`กรอกเลขใบกำกับ WINSpeed สำหรับ ${card.wfRef}:`);
        if (!docuNo) { setBusyId(null); return; }
        await syncImported(card.id, docuNo);
      }
      await load();
    } catch (e: unknown) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  const stages = data?.stages || ['DRAFT', 'CONFIRMED', 'PICKING', 'SHIPPED'];

  if (viewMode === 'cancelled') {
    return <CancelledOrdersView onBack={() => setViewMode('board')} />;
  }

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <LayoutGrid size={26} /> Paper Trail — เอกสารตามสถานะ
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">ติดตามใบสั่งขายข้าม 4 สถานะ (ย้อนหลัง 3 วันสำหรับใบส่งออก)</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setViewMode('cancelled')} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors flex items-center gap-1.5 border border-gray-200">
            <Clock size={16} /> ประวัติยกเลิก
          </button>
          <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex gap-3 h-full min-w-full">
          {stages.map(stage => {
            const cards = data?.board[stage] || [];
            const m = STAGE_META[stage];
            return (
              <div key={stage} className="flex-1 min-w-[280px] flex flex-col rounded-2xl border border-gray-200 bg-white/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between" style={{ background: m.bg }}>
                  <span className="text-sm font-bold" style={{ color: m.color }}>{m.label}</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/70" style={{ color: m.color }}>{cards.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {cards.map(card => {
                    const next = NEXT[card.status];
                    const canAdvance = next && role && next.roles.includes(role);
                    const overdue = card.daysOpen > 45 ? 'text-red-600' : card.daysOpen > 30 ? 'text-amber-600' : 'text-gray-400';
                    return (
                      <div key={card.id} className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-xs font-bold text-gray-700">{card.wfRef}</span>
                          <span className={`text-[10px] flex items-center gap-0.5 ${overdue}`}><Clock size={10} />{card.daysOpen}ว</span>
                        </div>
                        <div className="text-xs text-gray-700 truncate mb-1.5">{card.custName}</div>
                        <div className="flex flex-wrap gap-1.5 text-[10px] text-gray-400 mb-2">
                          {card.truckPlate && <span className="flex items-center gap-0.5"><Truck size={10} />{card.truckPlate}</span>}
                          {card.controlTicketNo && <span className="flex items-center gap-0.5"><FileText size={10} />{card.controlTicketNo}</span>}
                          <span>{Number(card.qtyTon || 0).toFixed(1)} ตัน</span>
                          {card.importedDocuNo && <span className="text-emerald-600">{card.importedDocuNo}</span>}
                        </div>
                        {canAdvance && (
                          <button disabled={busyId === card.id} onClick={() => advance(card)}
                            className="w-full py-1.5 rounded-lg text-white text-[11px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
                            style={{ background: m.color }}>
                            {next!.label} <ArrowRight size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {cards.length === 0 && <div className="text-center text-gray-300 text-xs py-6">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CancelledOrdersView({ onBack }: { onBack: () => void }) {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSalesOrders({ status: 'CANCELLED', limit: 100 })
      .then(res => setOrders(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-colors">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h2 className="text-2xl font-black text-gray-800 flex items-center gap-2">
              <FileText size={26} className="text-gray-400" /> เอกสารที่ถูกยกเลิก (100 รายการล่าสุด)
            </h2>
          </div>
        </div>
        <button onClick={() => { setLoading(true); fetchSalesOrders({ status: 'CANCELLED', limit: 100 }).then(res => setOrders(res.data)).finally(() => setLoading(false)); }} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto bg-gray-50/50 p-6">
        <div className="w-full bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-20 flex justify-center text-gray-400"><RefreshCw className="animate-spin" size={32} /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold">เลขที่ใบสั่งขาย</th>
                  <th className="px-6 py-4 text-left font-semibold">ลูกค้า</th>
                  <th className="px-6 py-4 text-right font-semibold">วันที่สร้าง / ยกเลิก</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map(o => (
                  <tr key={o.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-gray-700">{o.wfRef}</td>
                    <td className="px-6 py-4 text-gray-600">{o.custName}</td>
                    <td className="px-6 py-4 text-right text-gray-500">
                      {new Date(o.createdAt).toLocaleString('th-TH', { 
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center text-gray-400 font-medium">ไม่พบเอกสารที่ถูกยกเลิก</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
