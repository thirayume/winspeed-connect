import React, { useEffect, useState, useCallback } from 'react';
import { Ticket, RefreshCw, Search, ChevronLeft, ChevronRight, Truck, ArrowDownToLine, Calendar, AlertTriangle, AlertCircle, CheckCircle2, HelpCircle, GitFork, Edit3, Info, X } from 'lucide-react';
import {
  fetchControlTickets,
  fetchControlTicketDetails,
  fetchControlTicketDraws,
  fetchControlTicketTrace,
  fetchControlTicketAlerts,
  updateControlTicketExpiry,
} from '../../services/api';
import type { ControlTicketDraw } from '../../types';

type Line = { ListNo: number; GoodCode: string; GoodName: string; QtyTon: number; PricePerTon: number };

export function ControlTicketPage() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'ACTIVE' | 'RESERVED_FULL' | 'HISTORY' | 'PENDING' | 'ALERTS' | 'UNKNOWN'>('ACTIVE');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
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
      const [ticketResp, alertData] = await Promise.all([
        fetchControlTickets({
          tab,
          q: q.trim() || undefined,
          page,
          pageSize,
          paginated: true,
        }),
        fetchControlTicketAlerts().catch(() => []),
      ]);
      if (ticketResp && ticketResp.data) {
        setTickets(ticketResp.data);
        setTotalCount(ticketResp.total);
        setTotalPages(ticketResp.totalPages);
      } else if (Array.isArray(ticketResp)) {
        setTickets(ticketResp);
        setTotalCount(ticketResp.length);
        setTotalPages(1);
      }
      setAlerts(alertData || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [tab, q, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  async function open(t: any) {
    setSel(t);
    setDetailLoading(true);
    try {
      const exactId = t.exactId || t.CouponID || t.SOID;
      const entityType = t.entityType || (t.CouponID ? 'COUPON' : undefined);
      const [ls, ds] = await Promise.all([
        fetchControlTicketDetails(t.CouponNo || t.DocuNo, { exactId, entityType }) as Promise<Line[]>,
        fetchControlTicketDraws(t.CouponNo || t.DocuNo, { exactId, entityType }),
      ]);
      setLines(ls);
      setDraws(ds);
    } catch (e) {
      console.error(e);
    }
    setDetailLoading(false);
  }

  async function handleOpenTrace(docuNo: string, e?: React.MouseEvent, exactId?: number, entityType?: string) {
    if (e) e.stopPropagation();
    setTraceModal({ isOpen: true, loading: true, data: null });
    try {
      const trace = await fetchControlTicketTrace(docuNo, exactId ? { exactId, entityType } : undefined);
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
      const exactId = editModal.ticket.exactId || editModal.ticket.CouponID || editModal.ticket.SOID;
      await updateControlTicketExpiry(editModal.ticket.CouponNo || editModal.ticket.DocuNo, {
        exactId: exactId ? Number(exactId) : undefined,
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

  const rem = (t: any) => {
    if (t.AvailableQtyTon != null) return Number(t.AvailableQtyTon);
    return Math.max(0, Number(t.TotalQtyTon || 0) - Number(t.DrawnQtyTon || 0));
  };

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
                ? `${sel.CustName} · พร้อมใช้ ${rem(sel).toFixed(2)} ${sel.GoodUnitName || 'ไม่ระบุ'} · ติดตามอายุและการเบิกใช้ตามสายเอกสารแท้`
                : 'Universal Native Trace (I/K 103 → AI → I/K 104 → C/D → 116 → J/N 107) · R1-02 Balance Engine'}
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
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden flex flex-col">
            <div className="flex border-b border-gray-100 px-2 pt-2 bg-gray-50/50 overflow-x-auto">
              <button
                onClick={() => { setTab('ACTIVE'); setPage(1); }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === 'ACTIVE'
                    ? 'border-[#0C447C] text-[#0C447C]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                คงเหลือพร้อมใช้ (Active)
              </button>
              <button
                onClick={() => { setTab('RESERVED_FULL'); setPage(1); }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === 'RESERVED_FULL'
                    ? 'border-[#0C447C] text-[#0C447C]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                ถูกจองเต็ม (Reserved)
              </button>
              <button
                onClick={() => { setTab('HISTORY'); setPage(1); }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === 'HISTORY'
                    ? 'border-[#0C447C] text-[#0C447C]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                ประวัติ (ใช้หมดแล้ว)
              </button>
              <button
                onClick={() => { setTab('PENDING'); setPage(1); }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === 'PENDING'
                    ? 'border-[#0C447C] text-[#0C447C]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                รอยืนยัน / รอออกตั๋ว
              </button>
              <button
                onClick={() => { setTab('ALERTS'); setPage(1); }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === 'ALERTS'
                    ? 'border-[#0C447C] text-[#0C447C]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                เตือนหมดอายุ
              </button>
              <button
                onClick={() => { setTab('UNKNOWN'); setPage(1); }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === 'UNKNOWN'
                    ? 'border-[#0C447C] text-[#0C447C]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                รอตรวจสอบ (Review)
              </button>
            </div>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4">
              <div className="flex-1 flex items-center gap-2">
                <Search size={14} className="text-gray-400" />
                <input
                  value={q}
                  onChange={e => { setQ(e.target.value); setPage(1); }}
                  placeholder="ค้นหา ลูกค้า / เลขตั๋ว / เลขที่ยืนยัน / สินค้า..."
                  className="flex-1 text-sm outline-none bg-transparent"
                />
              </div>
              <span className="text-xs text-gray-400 font-medium">{totalCount} ตั๋ว</span>
            </div>
            {loading ? (
              <div className="py-16 flex justify-center">
                <RefreshCw size={26} className="animate-spin text-gray-300" />
              </div>
            ) : tickets.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">ไม่พบตั๋วคุมในหมวดนี้</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-full">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                    <tr>
                      <th className="px-4 py-3 text-left whitespace-nowrap">เลขตั๋ว / คูปอง</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">ลูกค้า</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">สินค้า</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">สถานะอายุตั๋ว</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">ออกตั๋ว</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">คงเหลือจริง</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">จองค้าง</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">พร้อมใช้</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tickets.map(t => {
                      const total = Number(t.IssuedQtyTon || t.TotalQtyTon || 0);
                      const nativeRem = Number(t.NativeRemainingQtyTon != null ? t.NativeRemainingQtyTon : rem(t));
                      const reserved = Number(t.ReservedQtyTon || 0);
                      const available = Number(t.AvailableQtyTon != null ? t.AvailableQtyTon : rem(t));
                      const expStatus = t.expiryStatus || t.expiry?.status || 'UNKNOWN';
                      const unit = t.GoodUnitName || 'ไม่ระบุ';
                      const stableKey = t.entityKey || (t.CouponID ? `coupon:${t.CouponID}` : `booking:${t.SOID}:${t.ListNo || 1}`);

                      return (
                        <tr
                          key={stableKey}
                          onClick={() => open(t)}
                          className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="font-mono font-bold text-[#0C447C] flex items-center gap-1.5">
                              <span>{t.CouponNo || t.DisplayDocuNo || t.DocuNo}</span>
                              {t.CouponID && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 font-mono font-medium">
                                  #{t.CouponID}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono">
                              {t.BookingDocuNo && <span>จอง: {t.BookingDocuNo} </span>}
                              {t.AppvDocuNo && <span className="text-blue-600">AI: {t.AppvDocuNo}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate" title={t.CustName}>
                            <div className="font-medium text-xs sm:text-sm">{t.CustName}</div>
                            <div className="text-[10px] text-gray-400 font-mono">ID: {t.CustID}</div>
                          </td>
                          <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate" title={t.GoodName}>
                            <div className="font-medium text-xs truncate">{t.GoodName || '-'}</div>
                            <div className="text-[10px] text-gray-400 font-mono">{t.GoodCode || ''}</div>
                          </td>
                          <td className="px-4 py-2.5 text-center whitespace-nowrap">
                            <ExpiryBadge status={expStatus} daysRemaining={t.daysRemaining} expiryDate={t.expiryDate} />
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-600 whitespace-nowrap font-medium">
                            {total.toFixed(2)} <span className="text-[10px] text-gray-400">{unit}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap font-medium">
                            {t.NativeRemainingQtyTon != null ? `${nativeRem.toFixed(2)} ` : '-'}
                            {t.NativeRemainingQtyTon != null && <span className="text-[10px] text-gray-400">{unit}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right text-amber-600 whitespace-nowrap font-medium">
                            {reserved > 0 ? `${reserved.toFixed(2)} ` : '-'}
                            {reserved > 0 && <span className="text-[10px] text-amber-500">{unit}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap font-bold">
                            {t.AvailableQtyTon != null ? (
                              <span className={available > 0 ? 'text-green-600' : 'text-gray-400'}>
                                {available.toFixed(2)} <span className="text-[10px] text-gray-400">{unit}</span>
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs font-normal">รอออกตั๋ว</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={e => handleOpenTrace(t.CouponNo || t.DocuNo, e, t.exactId || t.CouponID || t.SOID, t.entityType)}
                                title="สืบย้อนเส้นทาง Universal Native Chain (R1-03)"
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
              </div>
            )}

            {/* Server-Side Pagination Controls */}
            <div className="px-4 py-3 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500 bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span>แสดงหน้า <strong>{page}</strong> จาก <strong>{totalPages}</strong> (ทั้งหมด {totalCount} รายการ)</span>
                <span className="text-gray-300">|</span>
                <div className="flex items-center gap-1">
                  <span>แถวต่อหน้า:</span>
                  <select
                    value={pageSize}
                    onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="border border-gray-200 rounded px-1.5 py-0.5 bg-white text-xs"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 font-medium"
                >
                  <ChevronLeft size={14} /> ก่อนหน้า
                </button>
                <span className="px-2 font-mono font-bold text-gray-700">{page}</span>
                <button
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 font-medium"
                >
                  ถัดไป <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Detail View for Selected Ticket */
          <div className="space-y-5">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Stat label={`ออกตั๋วทั้งหมด (${sel.GoodUnitName || 'ไม่ระบุ'})`} value={Number(sel.IssuedQtyTon || sel.TotalQtyTon || 0).toFixed(2)} color="#0C447C" />
              <Stat label={`คงเหลือในคลัง (${sel.GoodUnitName || 'ไม่ระบุ'})`} value={Number(sel.NativeRemainingQtyTon != null ? sel.NativeRemainingQtyTon : rem(sel)).toFixed(2)} color="#3B82F6" />
              <Stat label={`จองค้าง (${sel.GoodUnitName || 'ไม่ระบุ'})`} value={Number(sel.ReservedQtyTon || 0).toFixed(2)} color="#D97706" />
              <Stat label={`พร้อมใช้ (${sel.GoodUnitName || 'ไม่ระบุ'})`} value={Number(sel.AvailableQtyTon != null ? sel.AvailableQtyTon : rem(sel)).toFixed(2)} color="#059669" />
            </div>
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
                    <th className="px-4 py-2 text-right whitespace-nowrap">จำนวน ({sel.GoodUnitName || 'หน่วย'})</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">กระสอบ / {sel.GoodUnitName || 'หน่วย'}</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">ราคา/{sel.GoodUnitName || 'หน่วย'} (บาท)</th>
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
                    <th className="px-4 py-2 text-right whitespace-nowrap">ตัดออก ({sel.GoodUnitName || 'หน่วย'})</th>
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
                      <span>6. ใบแจ้งหนี้ / ใบกำกับภาษี (Invoice 107)</span>
                    </div>
                  </div>

                  {/* Truncated Graph Warning Banner (R2-04) */}
                  {traceModal.data.truncated && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs flex items-start gap-2.5">
                      <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <div className="font-bold">ข้อมูลเส้นทางยังไม่ครบ (Truncated Graph)</div>
                        <div className="text-amber-800 text-[11px]">
                          ตรวจพบเอกสารเกี่ยวเนื่องเกินขอบเขตจำกัดการสืบค้น ({traceModal.data.reasons?.join(', ') || 'Budget limit reached'}) — กรุณาอย่ายึดถือข้อมูลนี้เป็นหลักฐานสรุปยอดสมบูรณ์หรือการส่งมอบครบถ้วน
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Chain Details */}
                  <div className="space-y-4">
                    {/* 1. Booking */}
                    <div className="border border-gray-200 rounded-2xl p-4 bg-white space-y-2">
                      <div className="text-xs font-bold text-gray-400 uppercase">1. ใบจองและการอนุมัติ (SOHD 103)</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>เลขที่ใบจอง: <strong className="font-mono">{traceModal.data.chain?.booking?.docuNo || '-'}</strong></div>
                        <div>เลขที่ยืนยัน AI: <strong className="font-mono text-[#0C447C]">{traceModal.data.chain?.booking?.appvDocuNo || '-'}</strong></div>
                        <div>ลูกค้า: <strong>{traceModal.data.chain?.booking?.custName || '-'}</strong></div>
                        <div>สถานะอนุมัติ: <strong>{traceModal.data.chain?.booking?.appvFlag || '-'}</strong></div>
                      </div>
                    </div>

                    {/* 2. Delivery */}
                    <div className="border border-gray-200 rounded-2xl p-4 bg-white space-y-2">
                      <div className="text-xs font-bold text-gray-400 uppercase">2. เอกสารส่งของ / ออกตั๋วแท้ (SOHD 104)</div>
                      {traceModal.data.chain?.deliveries?.length > 0 ? (
                        traceModal.data.chain.deliveries.map((d: any) => (
                          <div key={d.soId} className="p-2.5 bg-gray-50 rounded-xl text-xs flex items-center justify-between">
                            <div>
                              <span className="font-mono font-bold text-blue-700 mr-2">{d.docuNo}</span>
                              <span className="text-gray-500">SOID: {d.soId} · {d.docuDate?.slice(0, 10)}</span>
                            </div>
                            <div className="text-gray-600 font-medium">
                              สถานะ: <span className="font-mono font-bold">{d.docuStatus}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-gray-400">ไม่พบเอกสารส่งของ 104</p>
                      )}
                    </div>

                    {/* 3. Coupon */}
                    <div className="border border-gray-200 rounded-2xl p-4 bg-white space-y-2">
                      <div className="text-xs font-bold text-gray-400 uppercase">3. ตั๋วคุม / คูปอง (WFCoupon C/D)</div>
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

                    {/* 4. Redemptions & 5. Invoices */}
                    <div className="border border-gray-200 rounded-2xl p-4 bg-white space-y-2">
                      <div className="text-xs font-bold text-gray-400 uppercase">
                        4. ประวัติการเบิกและเอกสารปลายทาง (WFRedemtionDT 116 → SOInvHD 107)
                      </div>
                      {traceModal.data.chain?.redemptions?.length > 0 ? (
                        traceModal.data.chain.redemptions.map((r: any, idx: number) => (
                          <div key={idx} className="p-2 bg-gray-50 rounded-xl text-xs flex items-center justify-between">
                            <div>
                              <span className="font-mono text-gray-600 mr-2">{r.docuNo || `116-#${r.redemtionId}`}</span>
                            </div>
                            <div className="font-bold text-amber-700">
                              {r.lines?.map((l: any, li: number) => (
                                <span key={li} className="ml-2">-{l.redeemedQtyTon} {l.unitName || 'ไม่ระบุ'} {l.soInvId ? `(➔ Inv #${l.soInvId})` : ''}</span>
                              ))}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-gray-400">ยังไม่มีรายการเบิกใช้ใน WFRedemtionDT</p>
                      )}


                      {traceModal.data.chain?.invoices?.length > 0 && (
                        <div className="pt-2 border-t border-gray-100 space-y-1">
                          <div className="text-[11px] font-bold text-gray-500">ใบแจ้งหนี้ / ใบกำกับภาษี (Invoice 107):</div>
                          {traceModal.data.chain.invoices.map((inv: any) => (
                            <div key={inv.soInvId} className="p-2 bg-emerald-50/50 rounded-lg text-xs flex items-center justify-between text-emerald-900">
                              <div>
                                <span className="font-mono font-bold mr-2">{inv.docuNo}</span>
                                <span>{inv.docuDate?.slice(0, 10)}</span>
                              </div>
                              <div className="font-mono font-bold">
                                {Number(inv.netAmnt || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} บาท
                              </div>
                            </div>
                          ))}
                        </div>
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
