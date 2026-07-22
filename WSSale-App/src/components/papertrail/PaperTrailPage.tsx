import { useEffect, useState, useCallback, useMemo } from 'react';
import { LayoutGrid, RefreshCw, Truck, FileText, ArrowRight, ArrowLeft, Clock, Printer, ScanLine, AlertTriangle, ShieldCheck, Unlock, X, Check, Search, Trash2, Edit } from 'lucide-react';
import { fetchPaperBoard, confirmSO, moveToPicking, shipSO, syncImported, fetchLostPapers, verifySO, createUnlockRequest, listUnlockRequests, resolveUnlockReq, cancelSO } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import { useAppStore } from '../../store/app-store';
import type { SalesOrder, UnlockReq } from '../../types';
import { fetchSalesOrders } from '../../services/api';
import { appConfirm, appPrompt } from '../ui/AppAlert';
import type { PaperBoard, PaperCard, SOStatus } from '../../types';
import { PaperDocModal } from './PaperDocModal';
import { ScanModal } from './ScanModal';
import { RequestActionModal, type RequestActionType } from './RequestActionModal';
import { useSocketEvent } from '../../hooks/useSocket';

import { UnlockReviewModal } from './UnlockReviewModal';
import { SO_STATUS_META, SO_STATUS_ORDER } from '../../constants/soStatus';
const CAN_VERIFY = ['COUNTER_SALES', 'ADMIN', 'MANAGER'];
const CAN_REQ_UNLOCK = ['SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN'];
const CAN_APPROVE_UNLOCK = ['APPROVER', 'ADMIN', 'MANAGER'];

const STATUS_NEXT: Record<string, { label: string; roles: string[] } | undefined> = {
  DRAFT:     { label: 'ยืนยันเป็นรอจัดส่ง', roles: ['SALES', 'COUNTER_SALES', 'ADMIN'] },
  CONFIRMED: { label: 'เริ่มรอรับสินค้า', roles: ['WAREHOUSE', 'ADMIN'] },
  PICKING:   { label: 'โหลดสินค้า', roles: ['WAREHOUSE', 'ADMIN'] },
  LOADED:    { label: 'ส่งออกจากตาชั่ง', roles: ['WAREHOUSE', 'ADMIN'] },
};

export function PaperTrailPage() {
  const role = useAuthStore(s => s.user?.role);
  const [data, setData]       = useState<PaperBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'cancelled'>('board');
  const [printSoIds, setPrintSoIds] = useState<(string | number)[] | null>(null);
  const [showScan, setShowScan]   = useState(false);
  const [lostCount, setLostCount] = useState(0);
  const [showUnlockReview, setShowUnlockReview] = useState(false);
  const [pendingUnlocks, setPendingUnlocks] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const canApproveUnlock = !!role && CAN_APPROVE_UNLOCK.includes(role);
  
  // New States for Edit and Cancel requests
  const [requestModalConfig, setRequestModalConfig] = useState<{ isOpen: boolean, type: RequestActionType, card: PaperCard | null }>({ isOpen: false, type: 'EDIT', card: null });

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
  useSocketEvent('so_updated', load);

  async function doVerify(card: PaperCard) {
    setBusyId(card.id);
    try { await verifySO(Number(card.id)); await load(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function doCancel(card: PaperCard) {
    if (!(await appConfirm(`⚠️ คุณแน่ใจหรือไม่ที่จะยกเลิก/ลบทิ้งเอกสาร ${card.wfRef} ?`))) return;
    const note = await appPrompt(`เหตุผลที่ยกเลิกเอกสาร ${card.wfRef}:`, 'ยกเลิกเอกสาร/ลบทิ้ง');
    if (note === null) return;
    
    setBusyId(card.id);
    try {
      await cancelSO(card.id, note);
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRequestSubmit(reason: string, type: RequestActionType) {
    const card = requestModalConfig.card;
    if (!card) return;
    try {
      await createUnlockRequest(card.id, reason, type);
      alert('ส่งคำขอแล้ว รออนุมัติจากหัวหน้างาน');
      setRequestModalConfig({ isOpen: false, type: 'EDIT', card: null });
      await load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function advance(card: PaperCard) {
    if (card.status === 'DRAFT' && (!card.lineCnt || card.lineCnt === 0)) {
      if (!(await appConfirm('⚠️ เอกสารนี้ไม่มีรายการสินค้าเลย (0 รายการ)\nคุณแน่ใจหรือไม่ว่าต้องการดำเนินการต่อ? (ปกติเอกสารเปล่าควรลบทิ้ง)'))) {
        return;
      }
    }

    setBusyId(card.id);
    try {
      if (card.status === 'DRAFT') await confirmSO(card.id);
      else if (card.status === 'CONFIRMED') await moveToPicking(card.id);
      else if (card.status === 'PICKING') await shipSO(card.id);
      else if (card.status === 'LOADED') await shipSO(card.id);
      else if (card.status === 'SHIPPED') {
        const docuNo = await appPrompt(`กรอกเลขใบกำกับ WINSpeed สำหรับ ${card.wfRef}:`);
        if (!docuNo) { setBusyId(null); return; }
        await syncImported(card.id, docuNo);
      }
      await load();
    } catch (e: unknown) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  const stages = useMemo(() => {
    const s = (data?.stages?.length ? data.stages : SO_STATUS_ORDER).filter(stage => stage !== 'CANCELLED');
    if (data?.board) {
      return ['CONTROL_TICKET', ...s];
    }
    return s;
  }, [data]);

  if (viewMode === 'cancelled') {
    return <CancelledOrdersView onBack={() => setViewMode('board')} />;
  }

  return (
    <div className="h-full flex flex-col w-full overflow-hidden max-w-full" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-200 bg-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <LayoutGrid className="w-5 h-5 sm:w-6 sm:h-6" /> Paper Trail
          </h1>
          <p className="hidden sm:block text-sm text-gray-500 mt-0.5">ติดตามสถานะใบสั่งขาย</p>
        </div>
        
        <div className="flex-1 w-full sm:w-auto sm:max-w-sm mt-2 sm:mt-0 sm:ml-4 order-3 sm:order-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 sm:top-2 text-gray-400 w-4 h-4 sm:w-5 sm:h-5" />
            <input 
              type="text" 
              placeholder="ค้นหา SO, ลูกค้า, ทะเบียนรถ..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 sm:py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/50 transition-all"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-2.5 sm:top-2.5 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide w-full sm:w-auto mt-2 sm:mt-0 order-2 sm:order-3">
          {lostCount > 0 && (
            <span className="whitespace-nowrap px-2.5 py-1.5 sm:px-3 sm:py-2 bg-red-50 text-red-700 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-1.5 border border-red-200">
              <AlertTriangle size={14} className="sm:w-4 sm:h-4" /> ใบค้าง/หาย {lostCount}
            </span>
          )}
          {canApproveUnlock && (
            <button onClick={() => setShowUnlockReview(true)} className="whitespace-nowrap px-2.5 py-1.5 sm:px-3 sm:py-2 bg-amber-500 text-white rounded-lg text-xs sm:text-sm font-semibold hover:opacity-90 transition-colors flex items-center gap-1.5">
              <Unlock size={14} className="sm:w-4 sm:h-4" /> คำขอปลดล็อก{pendingUnlocks > 0 ? ` (${pendingUnlocks})` : ''}
            </button>
          )}
          <button onClick={() => setShowScan(true)} className="whitespace-nowrap px-2.5 py-1.5 sm:px-3 sm:py-2 bg-[#0C447C] text-white rounded-lg text-xs sm:text-sm font-semibold hover:opacity-90 transition-colors flex items-center gap-1.5">
            <ScanLine size={14} className="sm:w-4 sm:h-4" /> สแกนเอกสาร
          </button>
          <button onClick={() => setViewMode('cancelled')} className="whitespace-nowrap px-2.5 py-1.5 sm:px-3 sm:py-2 bg-gray-100 text-gray-700 rounded-lg text-xs sm:text-sm font-semibold hover:bg-gray-200 transition-colors flex items-center gap-1.5 border border-gray-200">
            <Clock size={14} className="sm:w-4 sm:h-4" /> ประวัติยกเลิก
          </button>
          <button onClick={load} className="shrink-0 h-8 w-8 sm:h-10 sm:w-10 flex items-center justify-center rounded-lg sm:rounded-xl border border-gray-200 bg-white">
            <RefreshCw size={14} className={`sm:w-4 sm:h-4 ${loading ? 'animate-spin text-gray-400' : 'text-gray-500'}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 min-w-0 print:hidden">
        <div className="flex gap-4 h-full w-max min-w-full pb-2">
          {stages.map(stage => {
            const allCards = stage === 'CONTROL_TICKET'
              ? Object.values(data?.board || {}).flat().filter(c => c.truckPlate === 'ตั๋วคุม')
              : (data?.board[stage] || []).filter(c => c.truckPlate !== 'ตั๋วคุม');

            const cards = allCards.filter(c => {
              if (!searchQuery) return true;
              const q = searchQuery.toLowerCase();
              return (
                (c.wfRef && c.wfRef.toLowerCase().includes(q)) ||
                (c.custName && c.custName.toLowerCase().includes(q)) ||
                (c.truckPlate && c.truckPlate.toLowerCase().includes(q)) ||
                (c.controlTicketNo && c.controlTicketNo.toLowerCase().includes(q))
              );
            });
            const m = stage === 'CONTROL_TICKET' 
              ? { label: 'ตั๋วคุม (ล่วงหน้า)', color: '#6D28D9', bg: '#F5F3FF' }
              : SO_STATUS_META[stage as SOStatus] || { label: stage, color: '#6B7280', bg: '#F3F4F6' };
            
            // Group cards by DeliveryDate + Customer + TruckPlate
            const map = new Map<string, { dateDisplay: string; cust: string; truck: string; cards: PaperCard[]; totalTon: number }>();
            for (const card of cards) {
              const dateRaw = card.deliveryDate ? card.deliveryDate.split('T')[0] : '9999-12-31';
              const dateDisplay = card.deliveryDate ? new Date(card.deliveryDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'ไม่ระบุวันรับ';
              const truck = card.truckPlate || 'ไม่ระบุทะเบียนรถ';
              const cust = card.custName || 'ไม่ระบุลูกค้า';
              const key = `${dateRaw}::${cust}::${truck}`;
              
              if (!map.has(key)) map.set(key, { dateDisplay, cust, truck, cards: [], totalTon: 0 });
              const g = map.get(key)!;
              g.cards.push(card);
              g.totalTon += Number(card.qtyTon || 0);
            }
            const groups = Array.from(map.values());

            return (
              <div key={stage} className="w-[300px] shrink-0 flex flex-col rounded-xl sm:rounded-2xl border border-gray-200 bg-white/60 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between" style={{ background: m.bg }}>
                  <span className="text-sm font-bold" style={{ color: m.color }}>{m.label}</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/70" style={{ color: m.color }}>{cards.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-3">
                  {groups.map((g, idx) => (
                    <div key={idx} className="rounded-xl border border-gray-200 shadow-sm overflow-hidden" style={{ background: '#F9F9FB' }}>
                      <div className="px-3 py-2 border-b border-gray-100 bg-white flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="text-[11px] font-bold text-[#0C447C] flex items-center gap-1 bg-[#F0F4F8] px-2 py-0.5 rounded-md">
                            <Clock size={10} /> {g.dateDisplay}
                          </div>
                          <div className="text-[11px] font-bold text-gray-700 bg-[#F1F3F5] px-2 py-0.5 rounded-md">
                            รวม {g.totalTon.toFixed(2)} ตัน
                          </div>
                        </div>
                        {g.cards.length > 1 && (
                          <button onClick={() => setPrintSoIds(g.cards.map(c => c.id))}
                            className="text-[10px] flex items-center gap-1 text-gray-600 hover:text-[#0C447C] bg-gray-50 hover:bg-blue-50 px-2 py-1 rounded border border-gray-200 transition-colors">
                            <Printer size={10} /> พิมพ์ทั้งหมด ({g.cards.length})
                          </button>
                        )}
                      </div>
                      <div className="px-3 py-2 bg-white flex items-start gap-2">
                        <div className="bg-[#1F2937] text-white p-1.5 rounded-lg shrink-0 flex items-center justify-center">
                          <Truck size={14} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-gray-900 truncate" title={g.truck}>{g.truck}</div>
                          <div className="text-[10px] text-gray-500 truncate" title={g.cust}>{g.cust}</div>
                        </div>
                      </div>
                      <div className="p-1.5 space-y-1.5">
                        {g.cards.map(card => {
                          const next = STATUS_NEXT[card.status];
                          const canAdvance = next && role && next.roles.includes(role);
                          const overdue = card.daysOpen > 45 ? 'text-red-600' : card.daysOpen > 30 ? 'text-amber-600' : 'text-gray-400';
                          return (
                            <div key={card.id} data-testid={`paper-card-${card.id}`} className="rounded-lg bg-white p-2.5 shadow-sm relative overflow-hidden group border border-gray-100">
                              <div className="absolute top-0 left-0 w-1 h-full" style={{ background: m.color }} />
                              <div className="flex items-center justify-between mb-1 pl-1">
                                <span className="font-mono text-[11px] font-bold text-gray-800">{card.wfRef}</span>
                                {(() => {
                                  const cardMeta = stage === 'CONTROL_TICKET' && SO_STATUS_META[card.status as SOStatus]
                                    ? SO_STATUS_META[card.status as SOStatus]
                                    : m;
                                  return (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: cardMeta.color, background: cardMeta.bg }}>
                                      {cardMeta.label}
                                    </span>
                                  );
                                })()}
                              </div>
                              <div className="flex flex-wrap gap-1 text-[9px] text-gray-500 mb-2 pl-1">
                                <span className="bg-gray-100 px-1 rounded">{Number(card.qtyTon || 0).toFixed(2)} ตัน</span>
                                {card.controlTicketNo && <span className="flex items-center gap-0.5 bg-gray-100 px-1 rounded"><FileText size={9} />{card.controlTicketNo}</span>}
                                {card.importedDocuNo && <span className="text-emerald-600 font-medium">{card.importedDocuNo}</span>}
                                <span className={`flex items-center gap-0.5 ${overdue}`}><Clock size={9} />{card.daysOpen}ว</span>
                              </div>

                              {(!card.lineCnt || card.lineCnt === 0) ? (
                                <div className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded-md font-bold flex items-center gap-1 mb-2 border border-red-100 ml-1">
                                  <AlertTriangle size={10} className="shrink-0" /> เอกสารเปล่า ควรยกเลิก
                                </div>
                              ) : null}

                              {card.status === 'DRAFT' && card.verifiedAt && (
                                <div className="text-[9px] text-green-600 flex items-center gap-0.5 mb-1 ml-1"><ShieldCheck size={10} /> ตรวจแล้ว</div>
                              )}

                              <div className="flex flex-wrap items-center gap-1 mt-2 pl-1">
                                {card.status === 'DRAFT' && (
                                  <>
                                    <button disabled={busyId === card.id} onClick={() => useAppStore.getState().navigate('sales', { soId: card.id as number, action: 'edit' })} title="แก้ไขเอกสาร"
                                      className="flex-1 h-7 px-1.5 rounded-md text-[#0C447C] hover:text-white bg-blue-50 hover:bg-[#0C447C] border border-blue-200 flex items-center justify-center gap-1 shrink-0 disabled:opacity-50 text-[10px] font-bold whitespace-nowrap transition-colors">
                                      <Edit size={11} /> แก้ไข
                                    </button>
                                    <button disabled={busyId === card.id} onClick={() => doCancel(card)} title="ลบเอกสารร่าง"
                                      className="flex-1 h-7 px-1.5 rounded-md text-red-500 hover:text-white bg-red-50 hover:bg-red-500 border border-red-200 flex items-center justify-center gap-1 shrink-0 disabled:opacity-50 text-[10px] font-bold whitespace-nowrap transition-colors">
                                      <Trash2 size={11} /> ยกเลิก
                                    </button>
                                  </>
                                )}
                                
                                {['CONFIRMED', 'PICKING'].includes(card.status) && role && CAN_REQ_UNLOCK.includes(role) && (
                                  <>
                                    <button onClick={() => setRequestModalConfig({ isOpen: true, type: 'EDIT', card })} title="ขอแก้ไขเอกสาร"
                                      className="flex-1 h-7 px-1.5 rounded-md text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 flex items-center justify-center gap-1 shrink-0 text-[10px] font-bold whitespace-nowrap transition-colors">
                                      <Edit size={11} /> ขอแก้ไข
                                    </button>
                                    <button onClick={() => setRequestModalConfig({ isOpen: true, type: 'CANCEL', card })} title="ขอยกเลิกเอกสาร"
                                      className="flex-1 h-7 px-1.5 rounded-md text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-300 flex items-center justify-center gap-1 shrink-0 text-[10px] font-bold whitespace-nowrap transition-colors">
                                      <Trash2 size={11} /> ขอยกเลิก
                                    </button>
                                  </>
                                )}

                                <button onClick={() => setPrintSoIds([card.id])}
                                  className="flex-1 h-7 px-1.5 rounded-md text-[10px] font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-1 whitespace-nowrap">
                                  <Printer size={11} /> พิมพ์
                                </button>
                                {card.status === 'DRAFT' && !card.verifiedAt && role && CAN_VERIFY.includes(role) && (
                                  <button disabled={busyId === card.id} onClick={() => doVerify(card)}
                                    className="flex-1 h-7 px-1.5 rounded-md text-white text-[10px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1 bg-emerald-600 shadow-sm whitespace-nowrap">
                                    <ShieldCheck size={11} /> ตรวจ
                                  </button>
                                )}
                                {canAdvance && !(card.truckPlate === 'ตั๋วคุม' && card.status !== 'DRAFT') && (
                                  <button disabled={busyId === card.id} onClick={() => advance(card)}
                                    className="flex-1 h-7 px-1.5 rounded-md text-white text-[10px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1 shadow-sm whitespace-nowrap"
                                    style={{ background: m.color }}>
                                    {next!.label} <ArrowRight size={11} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {groups.length === 0 && <div className="text-center text-gray-300 text-xs py-6">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {printSoIds !== null && <PaperDocModal soIds={printSoIds} onClose={() => { setPrintSoIds(null); load(); }} />}
      {showScan && <ScanModal onClose={() => setShowScan(false)} onDone={load} />}
      <RequestActionModal
        isOpen={requestModalConfig.isOpen}
        actionType={requestModalConfig.type}
        wfRef={requestModalConfig.card?.wfRef || ''}
        onClose={() => setRequestModalConfig({ isOpen: false, type: 'EDIT', card: null })}
        onSubmit={handleRequestSubmit}
      />
      {showUnlockReview && <UnlockReviewModal onClose={() => setShowUnlockReview(false)} onDone={load} />}
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
    <div className="h-full flex flex-col w-full bg-white overflow-hidden max-w-full">
      <div className="px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-200 bg-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 sm:gap-4">
          <button onClick={onBack} className="p-1 sm:p-2 -ml-1 sm:-ml-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg sm:rounded-xl transition-colors">
            <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
          <div>
            <h2 className="text-lg sm:text-2xl font-black text-gray-800 flex items-center gap-2">
              <FileText className="w-5 h-5 sm:w-[26px] sm:h-[26px] text-gray-400" /> เอกสารที่ถูกยกเลิก (100 รายการล่าสุด)
            </h2>
          </div>
        </div>
        <button onClick={() => { setLoading(true); fetchSalesOrders({ status: 'CANCELLED', limit: 100 }).then(res => setOrders(res.data)).finally(() => setLoading(false)); }} className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-lg sm:rounded-xl border border-gray-200 bg-white hover:bg-gray-50 shrink-0">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto bg-gray-50/50 p-3 sm:p-6">
        <div className="w-full bg-white rounded-none sm:rounded-lg sm:rounded-2xl border-y sm:border border-gray-200 shadow-sm sm:shadow-sm shadow-none overflow-hidden flex flex-col">
          {loading ? (
            <div className="py-20 flex justify-center text-gray-400"><RefreshCw className="animate-spin" size={32} /></div>
          ) : (
            <div className="overflow-x-auto w-full scrollbar-hide">
            <table className="w-full text-sm min-w-full">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 whitespace-nowrap">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold whitespace-nowrap">เลขที่ใบสั่งขาย</th>
                  <th className="px-6 py-4 text-left font-semibold whitespace-nowrap">ลูกค้า</th>
                  <th className="px-6 py-4 text-right font-semibold whitespace-nowrap">วันที่สร้าง / ยกเลิก</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map(o => (
                  <tr key={o.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-gray-700 whitespace-nowrap">{o.wfRef}</td>
                    <td className="px-6 py-4 text-gray-600 whitespace-nowrap">{o.custName}</td>
                    <td className="px-6 py-4 text-right text-gray-500 whitespace-nowrap">
                      {new Date(o.createdAt).toLocaleString('th-TH', { 
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center text-gray-400 font-medium whitespace-nowrap">ไม่พบเอกสารที่ถูกยกเลิก</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

