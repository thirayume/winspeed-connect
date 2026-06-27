import { useEffect, useState, useCallback } from 'react';
import { LayoutGrid, RefreshCw, Truck, FileText, ArrowRight, ArrowLeft, Clock, Printer, ScanLine, AlertTriangle, ShieldCheck, Unlock, X, Check } from 'lucide-react';
import { fetchPaperBoard, confirmSO, moveToPicking, shipSO, syncImported, fetchLostPapers, verifySO, createUnlockRequest, listUnlockRequests, resolveUnlockReq } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { SalesOrder, UnlockReq } from '../../types';
import { fetchSalesOrders } from '../../services/api';
import type { PaperBoard, PaperCard, SOStatus } from '../../types';
import { PaperDocModal } from './PaperDocModal';
import { ScanModal } from './ScanModal';

const CAN_VERIFY = ['COUNTER_SALES', 'ADMIN', 'MANAGER'];
const CAN_REQ_UNLOCK = ['SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN'];
const CAN_APPROVE_UNLOCK = ['APPROVER', 'ADMIN', 'MANAGER'];

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
  const [printSoId, setPrintSoId] = useState<string | number | null>(null);
  const [showScan, setShowScan]   = useState(false);
  const [lostCount, setLostCount] = useState(0);
  const [showUnlockReview, setShowUnlockReview] = useState(false);
  const [pendingUnlocks, setPendingUnlocks] = useState(0);
  const canApproveUnlock = !!role && CAN_APPROVE_UNLOCK.includes(role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [board, lost] = await Promise.all([fetchPaperBoard(), fetchLostPapers().catch(() => [])]);
      setData(board);
      setLostCount(Array.isArray(lost) ? lost.length : 0);
      if (canApproveUnlock) {
        try { setPendingUnlocks((await listUnlockRequests('PENDING')).length); } catch { /* ignore */ }
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [canApproveUnlock]);
  useEffect(() => { load(); }, [load]);

  async function doVerify(card: PaperCard) {
    setBusyId(card.id);
    try { await verifySO(Number(card.id)); await load(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function doRequestUnlock(card: PaperCard) {
    const reason = prompt(`เหตุผลขอปลดล็อก ${card.wfRef} (อย่างน้อย 10 ตัวอักษร):`);
    if (reason === null) return;
    try { await createUnlockRequest(card.id, reason); alert('ส่งคำขอแล้ว รออนุมัติ'); await load(); }
    catch (e) { alert((e as Error).message); }
  }

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
          {lostCount > 0 && (
            <span className="px-3 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-semibold flex items-center gap-1.5 border border-red-200">
              <AlertTriangle size={16} /> ใบค้าง/หาย {lostCount}
            </span>
          )}
          {canApproveUnlock && (
            <button onClick={() => setShowUnlockReview(true)} className="px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-colors flex items-center gap-1.5">
              <Unlock size={16} /> คำขอปลดล็อก{pendingUnlocks > 0 ? ` (${pendingUnlocks})` : ''}
            </button>
          )}
          <button onClick={() => setShowScan(true)} className="px-3 py-2 bg-[#0C447C] text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-colors flex items-center gap-1.5">
            <ScanLine size={16} /> สแกนเอกสาร
          </button>
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
                        {card.status === 'DRAFT' && card.verifiedAt && (
                          <div className="text-[10px] text-green-600 flex items-center gap-0.5 mb-1"><ShieldCheck size={11} /> ตรวจแล้ว</div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setPrintSoId(card.id)}
                            className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-1">
                            <Printer size={12} /> พิมพ์ 4 สี
                          </button>
                          {card.status === 'DRAFT' && !card.verifiedAt && role && CAN_VERIFY.includes(role) && (
                            <button disabled={busyId === card.id} onClick={() => doVerify(card)}
                              className="flex-1 py-1.5 rounded-lg text-white text-[11px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1 bg-emerald-600">
                              <ShieldCheck size={12} /> ตรวจแล้ว
                            </button>
                          )}
                          {card.status === 'PICKING' && role && CAN_REQ_UNLOCK.includes(role) && (
                            <button onClick={() => doRequestUnlock(card)}
                              className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold border border-amber-300 text-amber-700 hover:bg-amber-50 flex items-center justify-center gap-1">
                              <Unlock size={12} /> ขอปลดล็อก
                            </button>
                          )}
                          {canAdvance && (
                            <button disabled={busyId === card.id} onClick={() => advance(card)}
                              className="flex-1 py-1.5 rounded-lg text-white text-[11px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
                              style={{ background: m.color }}>
                              {next!.label} <ArrowRight size={12} />
                            </button>
                          )}
                        </div>
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

      {printSoId !== null && <PaperDocModal soId={printSoId} onClose={() => { setPrintSoId(null); load(); }} />}
      {showScan && <ScanModal onClose={() => setShowScan(false)} onDone={load} />}
      {showUnlockReview && <UnlockReviewModal onClose={() => setShowUnlockReview(false)} onDone={load} />}
    </div>
  );
}

function UnlockReviewModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [reqs, setReqs] = useState<UnlockReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setReqs(await listUnlockRequests('PENDING')); } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function resolve(r: UnlockReq, approve: boolean) {
    const note = approve ? (prompt('หมายเหตุ (ถ้ามี):') ?? '') : (prompt('เหตุผลที่ปฏิเสธ:') ?? '');
    setBusyId(r.Id);
    try { await resolveUnlockReq(r.Id, approve, note); await reload(); onDone(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-800 flex items-center gap-2"><Unlock size={18} className="text-amber-600" /> คำขอปลดล็อก (รออนุมัติ)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-10 flex justify-center"><RefreshCw size={22} className="animate-spin text-gray-300" /></div>
          ) : reqs.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">ไม่มีคำขอที่รออนุมัติ</p>
          ) : reqs.map(r => (
            <div key={r.Id} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono font-bold text-sm text-[#0C447C]">{r.WfRef || r.SoId}</span>
                <span className="text-[11px] text-gray-400">{new Date(r.RequestedAt).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="text-xs text-gray-600 mb-1">เหตุผล: {r.Reason}</div>
              <div className="text-[11px] text-gray-400 mb-2">โดย: {r.RequesterName || '-'}</div>
              <div className="flex gap-2">
                <button disabled={busyId === r.Id} onClick={() => resolve(r, true)}
                  className="flex-1 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"><Check size={13} /> อนุมัติ (ปลดล็อก)</button>
                <button disabled={busyId === r.Id} onClick={() => resolve(r, false)}
                  className="flex-1 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold disabled:opacity-50">ปฏิเสธ</button>
              </div>
            </div>
          ))}
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
