import React, { useEffect, useState, useCallback } from 'react';
import {
  Ticket,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Truck,
  ArrowDownToLine,
  Calendar,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  GitFork,
  Edit3,
  ShieldAlert,
  Info,
  X,
} from 'lucide-react';
import {
  fetchControlTickets,
  fetchControlTicketDetails,
  fetchControlTicketDraws,
  fetchControlTicketTrace,
  fetchControlTicketAlerts,
  updateControlTicketExpiry,
} from '../../services/api';
import type { ControlTicket, ControlTicketDraw } from '../../types';

type Line = { ListNo: number; GoodCode: string; GoodName: string; QtyTon: number; PricePerTon: number };

export function ControlTicketPage() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'ACTIVE' | 'HISTORY' | 'PENDING'>('ACTIVE');
  const [sel, setSel] = useState<any | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draws, setDraws] = useState<ControlTicketDraw[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Trace Modal state
  const [traceModal, setTraceModal] = useState<{ isOpen: boolean; loading: boolean; data: any | null }>({
    isOpen: false,
    loading: false,
    data: null,
  });

  // Expiry Edit Modal state
  const [editModal, setEditModal] = useState<{
    isOpen: boolean;
    ticket: any | null;
    isUnknown: boolean;
    expiryDate: string;
    strictOverride: boolean;
    reasonCode: string;
    reasonText: string;
    saving: boolean;
    error: string | null;
  }>({
    isOpen: false,
    ticket: null,
    isUnknown: true,
    expiryDate: '',
    strictOverride: false,
    reasonCode: 'POLICY_ADJUSTMENT',
    reasonText: '',
    saving: false,
    error: null,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ticketData, alertData] = await Promise.all([
        fetchControlTickets(undefined, true),
        fetchControlTicketAlerts().catch(() => []),
      ]);
      setTickets(ticketData);
      setAlerts(alertData);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function open(t: any) {
    setSel(t);
    setDetailLoading(true);
    try {
      const [ls, ds] = await Promise.all([
        fetchControlTicketDetails(t.DocuNo) as Promise<Line[]>,
        fetchControlTicketDraws(t.DocuNo),
      ]);
      setLines(ls);
      setDraws(ds);
    } catch (e) {
      console.error(e);
    }
    setDetailLoading(false);
  }

  async function handleOpenTrace(docuNo: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    setTraceModal({ isOpen: true, loading: true, data: null });
    try {
      const trace = await fetchControlTicketTrace(docuNo);
      setTraceModal({ isOpen: true, loading: false, data: trace });
    } catch (err: any) {
      console.error(err);
      setTraceModal({ isOpen: true, loading: false, data: null });
    }
  }

  function handleOpenEditModal(ticket: any, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    const currentExp = ticket.expiryDate || ticket.ExpiryDate || '';
    setEditModal({
      isOpen: true,
      ticket,
      isUnknown: !currentExp,
      expiryDate: currentExp,
      strictOverride: Boolean(ticket.strictOverride || ticket.StrictOverrideFlag),
      reasonCode: 'POLICY_ADJUSTMENT',
      reasonText: '',
      saving: false,
      error: null,
    });
  }

  async function handleSaveExpiry() {
    if (!editModal.ticket) return;
    setEditModal(prev => ({ ...prev, saving: true, error: null }));
    try {
      await updateControlTicketExpiry(editModal.ticket.DocuNo, {
        expiryDate: editModal.isUnknown ? null : editModal.expiryDate,
        strictOverride: editModal.strictOverride,
        reasonCode: editModal.reasonCode,
        reasonText: editModal.reasonText,
      });
      setEditModal(prev => ({ ...prev, isOpen: false, saving: false }));
      load();
    } catch (err: any) {
      setEditModal(prev => ({ ...prev, saving: false, error: err?.message || 'บันทึกไม่สำเร็จ' }));
    }
  }

  const rem = (t: any) => Math.max(0, Number(t.TotalQtyTon || 0) - Number(t.DrawnQtyTon || 0));

  const tabFiltered = tickets.filter(t => {
    if (tab === 'ACTIVE') return t.DocuStatus === 'Y' && rem(t) > 0;
    if (tab === 'HISTORY') return t.DocuStatus === 'Y' && rem(t) <= 0;
    return t.DocuStatus !== 'Y'; // PENDING / DRAFT
  });

  const filtered = tabFiltered.filter(
    t => !q || t.CustName?.includes(q) || t.DocuNo?.includes(q) || t.DisplayDocuNo?.includes(q)
  );

  const activeAlertCount = alerts.filter(a => a.Status === 'ACTIVE').length;

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      {/* Header */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {sel && (
            <button
              onClick={() => setSel(null)}
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
              <Ticket className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
              {sel ? `ตั๋วคุม ${sel.DocuNo}` : 'ชุดตั๋วคุม (Control Ticket Management)'}
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
              {sel
                ? `${sel.CustName} · คงเหลือ ${rem(sel).toFixed(2)} ตัน · ติดตามอายุและการเบิกใช้ตามสายเอกสารแท้`
                : 'Native Trace (I/K → AI → C/D → 116 → J/N) · Expiry & Alert Lifecycle · SO-04'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="h-10 px-3.5 flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white text-xs font-bold text-[#0C447C] hover:bg-gray-50 shadow-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-gray-400' : 'text-[#0C447C]'} />
            รีเฟรช
          </button>
        </div>
      </div>

      {/* Alert Notification Banner */}
      {activeAlertCount > 0 && !sel && (
        <div className="mx-4 mt-4 sm:mx-6 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold">
            <AlertTriangle className="text-amber-600 shrink-0" size={18} />
            <span>
              พบตั๋วคุมที่มีการแจ้งเตือนใกล้หมดอายุหรือหมดอายุแล้วจำนวน <strong>{activeAlertCount}</strong> รายการ
            </span>
          </div>
          <span className="text-[11px] bg-amber-200/80 px-2 py-0.5 rounded-md font-mono font-bold text-amber-800">
            Deduplicated Alert
          </span>
        </div>
      )}

      {/* Body Area */}
      <div className="flex-1 overflow-auto p-0 sm:p-6">
        {!sel ? (
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex border-b border-gray-100 px-2 pt-2 bg-gray-50/50">
              <button
                onClick={() => setTab('ACTIVE')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === 'ACTIVE'
                    ? 'border-[#0C447C] text-[#0C447C]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                คงเหลือ (Active)
              </button>
              <button
                onClick={() => setTab('HISTORY')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === 'HISTORY'
                    ? 'border-[#0C447C] text-[#0C447C]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                ประวัติ (ใช้หมดแล้ว)
              </button>
              <button
                onClick={() => setTab('PENDING')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === 'PENDING'
                    ? 'border-[#0C447C] text-[#0C447C]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                รอยืนยัน / แบบร่าง
              </button>
            </div>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4">
              <div className="flex-1 flex items-center gap-2">
                <Search size={14} className="text-gray-400" />
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="ค้นหา ลูกค้า / เลขตั๋ว / เลขที่ยืนยัน..."
                  className="flex-1 text-sm outline-none bg-transparent"
                />
              </div>
              <span className="text-xs text-gray-400">{filtered.length} ตั๋ว</span>
            </div>
            {loading ? (
              <div className="py-16 flex justify-center">
                <RefreshCw size={26} className="animate-spin text-gray-300" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">ไม่พบตั๋วคุมคงค้าง</p>
            ) : (
              <table className="w-full text-sm min-w-full">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                  <tr>
                    <th className="px-4 py-3 text-left whitespace-nowrap">เลขตั๋ว / ใบจอง</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">ลูกค้า</th>
                    <th className="px-4 py-3 text-center whitespace-nowrap">สถานะอายุตั๋ว</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">จอง (ตัน)</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">ตัดแล้ว</th>
                    <th className="px-4 py-3 text-left w-44 whitespace-nowrap">คงเหลือ</th>
                    <th className="px-4 py-3 text-center whitespace-nowrap">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(t => {
                    const total = Number(t.TotalQtyTon || 0);
                    const drawn = Number(t.DrawnQtyTon || 0);
                    const remain = rem(t);
                    const pct = total ? (drawn / total) * 100 : 0;
                    const expStatus = t.expiryStatus || t.expiry?.status || 'UNKNOWN';

                    return (
                      <tr
                        key={String(t.SOID || t.DocuNo)}
                        onClick={() => open(t)}
                        className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="font-mono font-bold text-[#0C447C]">
                            {t.DisplayDocuNo || t.DocuNo}
                          </div>
                          {t.DisplayDocuNo && t.DocuNo !== t.DisplayDocuNo && (
                            <div className="text-[10px] text-gray-400 font-mono">Ref: {t.DocuNo}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate" title={t.CustName}>
                          <div className="font-medium text-xs sm:text-sm">{t.CustName}</div>
                          <div className="text-[10px] text-gray-400 font-mono">ID: {t.CustID}</div>
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          <ExpiryBadge status={expStatus} daysRemaining={t.daysRemaining} expiryDate={t.expiryDate} />
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600 whitespace-nowrap font-medium">
                          {total.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-400 whitespace-nowrap font-medium">
                          {drawn.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#0C447C] rounded-full"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-green-600 w-16 text-right">
                              {remain.toFixed(2)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={e => handleOpenTrace(t.DocuNo, e)}
                              title="สืบย้อนเส้นทาง Native Chain (SO-04)"
                              className="px-2 py-1 rounded-md text-[11px] font-bold border border-blue-200 bg-blue-50 text-[#0C447C] hover:bg-blue-100 flex items-center gap-1"
                            >
                              <GitFork size={12} /> Trace
                            </button>
                            <button
                              onClick={e => handleOpenEditModal(t, e)}
                              title="ตั้งค่า/แก้ไขวันหมดอายุ"
                              className="px-2 py-1 rounded-md text-[11px] font-bold border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 flex items-center gap-1"
                            >
                              <Edit3 size={12} /> อายุ
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          /* Detail View for Selected Ticket */
          <div className="space-y-5">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Stat label="จองทั้งหมด (ตัน)" value={Number(sel.TotalQtyTon || 0).toFixed(2)} color="#0C447C" />
              <Stat label="ตัดออกแล้ว (ตัน)" value={Number(sel.DrawnQtyTon || 0).toFixed(2)} color="#9CA3AF" />
              <Stat label="คงเหลือ (ตัน)" value={rem(sel).toFixed(2)} color="#059669" />
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col justify-between">
                <div className="text-xs text-gray-400">สถานะอายุตั๋ว</div>
                <div className="mt-1 flex items-center justify-between">
                  <ExpiryBadge
                    status={sel.expiryStatus || sel.expiry?.status || 'UNKNOWN'}
                    daysRemaining={sel.daysRemaining}
                    expiryDate={sel.expiryDate}
                  />
                  <button
                    onClick={() => handleOpenEditModal(sel)}
                    className="px-2.5 py-1 text-xs font-bold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-[#0C447C] flex items-center gap-1 shadow-xs"
                  >
                    <Edit3 size={12} /> แก้ไข
                  </button>
                </div>
              </div>
            </div>

            {/* Candidate Restriction Banner */}
            <div className="p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200 text-blue-900 text-xs flex items-center gap-2">
              <Info size={16} className="text-blue-600 shrink-0" />
              <span>
                <strong>นโยบายสิทธิ์การใช้ตั๋วคุม (SO-04):</strong> Prefix ของลูกค้า ({sel.CustID}) เป็นเพียง candidate
                ในการค้นหา ไม่ใช่สิทธิ์เบิกข้ามลูกค้าร่วมกันโดยอัตโนมัติ ห้ามแชร์สิทธิ์โดยไม่มี authorized relationship
              </span>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
                <Ticket size={16} /> รายการและประวัติการตัดของตั๋ว {sel.DocuNo}
              </h2>
              <button
                onClick={() => handleOpenTrace(sel.DocuNo)}
                className="px-3 py-1.5 rounded-xl border border-blue-300 bg-blue-600 text-white font-bold text-xs flex items-center gap-1.5 hover:bg-blue-700 shadow-sm transition-colors"
              >
                <GitFork size={14} /> ดูผังเส้นทางสมบูรณ์ (Native Trace Chain)
              </button>
            </div>

            {/* Product Lines in Ticket */}
            <Panel title="รายการสินค้าในตั๋วคุม (One Ticket Per Product Breakdown)" loading={detailLoading}>
              <table className="w-full text-sm min-w-full">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                  <tr>
                    <th className="px-4 py-2 text-left whitespace-nowrap">ลำดับ</th>
                    <th className="px-4 py-2 text-left whitespace-nowrap">รหัส/ชื่อสินค้า</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">จำนวน (ตัน)</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">กระสอบ/ตัน</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">ราคา/ตัน (บาท)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {lines.map(l => (
                    <tr key={l.ListNo}>
                      <td className="px-4 py-2 text-gray-400 font-mono text-xs">{l.ListNo}</td>
                      <td className="px-4 py-2 whitespace-nowrap font-medium text-gray-800">
                        {l.GoodName || l.GoodCode}
                      </td>
                      <td className="px-4 py-2 text-right font-bold text-[#0C447C] whitespace-nowrap">
                        {Number(l.QtyTon || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500 whitespace-nowrap">
                        {(l as any).BagPerTon || 20}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600 whitespace-nowrap">
                        {Number(l.PricePerTon || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-gray-400 whitespace-nowrap">
                        ไม่มีข้อมูลรายการสินค้า
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>

            {/* History of Draws (SO 104) */}
            <Panel title={`ประวัติการตัดเบิก (${draws.length} ครั้ง)`} loading={detailLoading}>
              <table className="w-full text-sm min-w-full">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                  <tr>
                    <th className="px-4 py-2 text-left whitespace-nowrap">เลขที่ SO ส่งของ (104)</th>
                    <th className="px-4 py-2 text-center whitespace-nowrap">วันที่ส่ง</th>
                    <th className="px-4 py-2 text-left whitespace-nowrap">ทะเบียนรถ</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">ตัดออก (ตัน)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {draws.map(d => (
                    <tr key={String(d.SOID)} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-xs font-bold text-[#0C447C] whitespace-nowrap">
                        {d.DocuNo}
                      </td>
                      <td className="px-4 py-2 text-center text-xs text-gray-500 whitespace-nowrap">
                        {d.DocuDate}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600 flex items-center gap-1 whitespace-nowrap">
                        {d.TruckPlate ? (
                          <>
                            <Truck size={12} className="text-gray-400" />
                            {d.TruckPlate}
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <ArrowDownToLine size={12} className="text-amber-500" />
                          {Number(d.DrawnQtyTon).toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {draws.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-gray-400 whitespace-nowrap">
                        ยังไม่มีประวัติการตัดเบิก
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>
          </div>
        )}
      </div>

      {/* ── Native Trace Modal (SO-04) ─────────────────────────────── */}
      {traceModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-3xl rounded-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-2">
                <GitFork size={18} className="text-[#0C447C]" />
                <h3 className="font-bold text-gray-800 text-base">ผังเส้นทาง Native Chain (SO-04)</h3>
              </div>
              <button
                onClick={() => setTraceModal({ isOpen: false, loading: false, data: null })}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {traceModal.loading ? (
                <div className="py-12 flex justify-center">
                  <RefreshCw size={28} className="animate-spin text-gray-300" />
                </div>
              ) : traceModal.data ? (
                <>
                  {/* Visual Breadcrumb Steps */}
                  <div className="p-4 rounded-2xl bg-blue-50/50 border border-blue-100 text-xs flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-[#0C447C]">
                      <span>1. ใบจอง (I/K)</span>
                      <ChevronRight size={14} className="text-gray-400" />
                      <span>2. ยืนยัน (AI)</span>
                      <ChevronRight size={14} className="text-gray-400" />
                      <span>3. ส่งของ (104)</span>
                      <ChevronRight size={14} className="text-gray-400" />
                      <span>4. คูปอง (C/D)</span>
                      <ChevronRight size={14} className="text-gray-400" />
                      <span>5. เบิก (116)</span>
                      <ChevronRight size={14} className="text-gray-400" />
                      <span>6. ใบเสร็จ (J/N)</span>
                    </div>
                  </div>

                  {/* Chain Details */}
                  <div className="space-y-4">
                    <div className="border border-gray-200 rounded-2xl p-4 bg-white space-y-2">
                      <div className="text-xs font-bold text-gray-400 uppercase">1. ใบจองและการอนุมัติ (SOHD 103)</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>เลขที่ใบจอง: <strong className="font-mono">{traceModal.data.chain?.booking?.docuNo || '-'}</strong></div>
                        <div>เลขที่ยืนยัน AI: <strong className="font-mono text-[#0C447C]">{traceModal.data.chain?.booking?.appvDocuNo || '-'}</strong></div>
                        <div>ลูกค้า: <strong>{traceModal.data.chain?.booking?.custName || '-'}</strong></div>
                        <div>สถานะอนุมัติ: <strong>{traceModal.data.chain?.booking?.appvFlag || '-'}</strong></div>
                      </div>
                    </div>

                    <div className="border border-gray-200 rounded-2xl p-4 bg-white space-y-2">
                      <div className="text-xs font-bold text-gray-400 uppercase">2. ตั๋วคุม / คูปอง (WFCoupon)</div>
                      {traceModal.data.chain?.coupons?.length > 0 ? (
                        traceModal.data.chain.coupons.map((c: any) => (
                          <div key={c.couponId} className="p-2.5 bg-gray-50 rounded-xl text-xs flex items-center justify-between">
                            <div>
                              <span className="font-mono font-bold text-[#0C447C] mr-2">{c.couponNo}</span>
                              <span className="text-gray-700">{c.goodName}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-gray-500">คงเหลือ: </span>
                              <strong className="text-green-700">{c.remainingQtyTon} {c.unitName}</strong>
                              <span className="text-gray-400 text-[11px] ml-1">/ {c.initialQtyTon}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-gray-400">ไม่พบแถวใน WFCoupon</p>
                      )}
                    </div>

                    <div className="border border-gray-200 rounded-2xl p-4 bg-white space-y-2">
                      <div className="text-xs font-bold text-gray-400 uppercase">
                        3. ประวัติการเบิกและเอกสารปลายทาง (WFRedemtionDT 116 → SOInvHD 107)
                      </div>
                      {traceModal.data.chain?.redemptions?.length > 0 ? (
                        traceModal.data.chain.redemptions.map((r: any, idx: number) => (
                          <div key={idx} className="p-2 bg-gray-50 rounded-xl text-xs flex items-center justify-between">
                            <div>
                              <span className="font-mono text-gray-600 mr-2">{r.redemptionDocuNo || `116-#${r.redemptionId}`}</span>
                              <span className="font-mono text-[#0C447C] font-bold">➔ Invoice: {r.invoiceDocuNo || '-'}</span>
                            </div>
                            <div className="font-bold text-amber-700">-{r.redeemedQtyTon} ตัน</div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-gray-400">ยังไม่มีรายการเบิกใช้ใน WFRedemtionDT</p>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-center text-sm text-gray-400 py-6">ไม่พบข้อมูลประวัติเส้นทาง</p>
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                onClick={() => setTraceModal({ isOpen: false, loading: false, data: null })}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-600 hover:bg-gray-100 shadow-xs"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Expiry Edit Modal (SO-04) ─────────────────────────────── */}
      {editModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="text-[#0C447C]" />
                <h3 className="font-bold text-gray-800 text-base">
                  ตั้งค่าวันหมดอายุตั๋ว {editModal.ticket?.DocuNo}
                </h3>
              </div>
              <button
                onClick={() => setEditModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {editModal.error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium">
                  {editModal.error}
                </div>
              )}

              {/* UNKNOWN Toggle */}
              <label className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-200 bg-gray-50/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editModal.isUnknown}
                  onChange={e => setEditModal(prev => ({ ...prev, isUnknown: e.target.checked }))}
                  className="rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
                />
                <span className="text-xs font-semibold text-gray-700">
                  ไม่ระบุวันหมดอายุ (สถานะ UNKNOWN ตามข้อตกลงธุรกิจ)
                </span>
              </label>

              {/* Expiry Date Input */}
              {!editModal.isUnknown && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">วันหมดอายุที่แน่นอน (YYYY-MM-DD)</label>
                  <input
                    type="date"
                    value={editModal.expiryDate}
                    onChange={e => setEditModal(prev => ({ ...prev, expiryDate: e.target.value }))}
                    className="w-full p-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#0C447C]"
                  />
                </div>
              )}

              {/* Strict Override Checkbox */}
              <label className="flex items-center gap-2.5 p-3 rounded-xl border border-amber-200 bg-amber-50/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editModal.strictOverride}
                  onChange={e => setEditModal(prev => ({ ...prev, strictOverride: e.target.checked }))}
                  className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                />
                <div>
                  <span className="text-xs font-bold text-amber-900 block">Strict Mode Override</span>
                  <span className="text-[11px] text-amber-700">อนุญาตให้ใช้งานเป็นกรณีพิเศษแม้หมดอายุ</span>
                </div>
              </label>

              {/* Reason Code from Active Master */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">เหตุผลการปรับปรุง (Reason Master)</label>
                <select
                  value={editModal.reasonCode}
                  onChange={e => setEditModal(prev => ({ ...prev, reasonCode: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-[#0C447C]"
                >
                  <option value="POLICY_ADJUSTMENT">POLICY_ADJUSTMENT — ปรับปรุงตามนโยบาย / ข้อตกลงลูกค้า</option>
                  <option value="OTHER">OTHER — เหตุผลอื่น ๆ (ต้องระบุรายละเอียด)</option>
                </select>
              </div>

              {/* Reason Detail Text */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">รายละเอียดเหตุผล (Audit Trail)</label>
                <input
                  type="text"
                  placeholder="ระบุเหตุผลเพื่อบันทึกประวัติ ChangeEvent..."
                  value={editModal.reasonText}
                  onChange={e => setEditModal(prev => ({ ...prev, reasonText: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#0C447C]"
                />
              </div>
            </div>

            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2">
              <button
                onClick={() => setEditModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-600 hover:bg-gray-100"
              >
                ยกเลิก
              </button>
              <button
                disabled={editModal.saving}
                onClick={handleSaveExpiry}
                className="px-4 py-2 rounded-xl border border-[#0C447C] bg-[#0C447C] text-white text-xs font-bold hover:bg-blue-900 disabled:opacity-50"
              >
                {editModal.saving ? 'กำลังบันทึก...' : 'บันทึกวันหมดอายุ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function Panel({ title, loading, children }: { title: string; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-700">{title}</h2>
      </div>
      {loading ? (
        <div className="py-8 flex justify-center">
          <RefreshCw size={20} className="animate-spin text-gray-300" />
        </div>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  );
}

function ExpiryBadge({
  status,
  daysRemaining,
  expiryDate,
}: {
  status: string;
  daysRemaining?: number | null;
  expiryDate?: string | null;
}) {
  switch (status) {
    case 'EXPIRED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200">
          <AlertCircle size={12} />
          หมดอายุแล้ว {expiryDate ? `(${expiryDate})` : ''}
        </span>
      );
    case 'NEAR_EXPIRY':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
          <AlertTriangle size={12} />
          ใกล้หมดอายุ {daysRemaining !== undefined && daysRemaining !== null ? `(อีก ${daysRemaining} วัน)` : ''}
        </span>
      );
    case 'VALID':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 size={12} />
          ยังไม่หมดอายุ {daysRemaining ? `(อีก ${daysRemaining} วัน)` : ''}
        </span>
      );
    case 'UNKNOWN':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
          <HelpCircle size={12} />
          ไม่ระบุวันหมดอายุ (UNKNOWN)
        </span>
      );
  }
}
