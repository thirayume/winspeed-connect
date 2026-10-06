import { canDo } from '../../utils/capabilities';
import { AccountBooksPanel } from './AccountBooksPanel';
import { useEffect, useState, useCallback } from 'react';
import { Scale, RefreshCw, AlertTriangle, CheckCircle, ShieldCheck, FileCheck2, Info, Ticket, CheckCircle2, AlertCircle, X } from 'lucide-react';
import {
  fetchReconCases, fetchReconSummary, resolveReconCase,
  settleCouponCuts, manualSettleCouponCut, type CouponSettlementResult,
  type UnmatchedCut,
  type ReconCase, type ReconSummary, type ReconCheck,
} from '../../services/api';
import { useSocketEvent } from '../../hooks/useSocket';
import { appPrompt } from '../ui/AppAlert';
import { useAuthStore } from '../../store/auth-store';

const UNMATCHED_REASON_LABEL: Record<string, { label: string; badgeClass: string }> = {
  CUT_BEFORE_CONFIRM: {
    label: 'วันที่ตัดตั๋วก่อนวันยืนยันการจอง (WinSpeed ข้ามเที่ยงคืน)',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
  },
  QTY_MISMATCH: {
    label: 'จำนวนตัดตั๋วไม่ตรงกับยอดจองคงเหลือ',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  RECEIVER_MISMATCH: {
    label: 'ผู้รับไม่ตรงกับการจอง',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  NO_CANDIDATE: {
    label: 'ไม่พบรายการจองที่ตรงกัน',
    badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
  },
};

const WEIGH_LABEL: Record<ReconCase['weigh'], string> = {
  MATCHED: 'ตรงกัน', VARIANCE: 'น้ำหนักต่าง', NO_WEIGH: 'ไม่มีตั๋วชั่ง',
  UNLINKED: 'ไม่ผูก movebill', TS_NOT_FOUND: 'ไม่พบใน TruckScale', TS_UNAVAILABLE: 'TruckScale ไม่พร้อม',
  CANDIDATE_MATCH: 'จับคู่ด้วยทะเบียน/วัน (Candidate)',
};

const INVOICE_STATUS_LABEL: Record<ReconCase['invoiceStatus'], string> = {
  INVOICE_FOUND: 'พบใบกำกับ',
  PARTIAL_INVOICED: 'ใบกำกับบางส่วน',
  NO_INVOICE: 'ยังไม่มีใบกำกับ',
  CANCELLED: 'ใบกำกับยกเลิก',
  CANDIDATE_INVOICE: 'พบ Candidate',
};

const GL_STATUS_LABEL: Record<ReconCase['verifiedGlStatus'], string> = {
  VERIFIED_GL: 'GL ลงบัญชีแล้ว',
  UNPOSTED_GL: 'ยังไม่ Post GL',
  FLAGGED_BUT_NO_GL: 'PostGL=Y แต่ไม่พบ Journal',
  INCONSISTENT: 'สถานะ GL ขัดแย้ง',
  NO_GL: 'ไม่มี GL',
  PARTIAL_GL: 'GL บางส่วน',
};

function badge(kind: 'ok' | 'warn' | 'exc' | 'muted' | 'resolved' | 'info') {
  return {
    ok: 'bg-green-100 text-green-700 border border-green-200',
    warn: 'bg-amber-100 text-amber-700 border border-amber-200',
    exc: 'bg-red-100 text-red-600 border border-red-200',
    muted: 'bg-gray-100 text-gray-500 border border-gray-200',
    resolved: 'bg-blue-100 text-blue-700 border border-blue-200',
    info: 'bg-cyan-100 text-cyan-700 border border-cyan-200',
  }[kind];
}

function weighKind(s: ReconCase['weigh']) {
  if (s === 'MATCHED') return 'ok';
  if (s === 'CANDIDATE_MATCH') return 'warn';
  if (s === 'VARIANCE' || s === 'TS_NOT_FOUND' || s === 'NO_WEIGH') return 'exc';
  return 'muted';
}

function glKind(s: ReconCase['verifiedGlStatus']) {
  if (s === 'VERIFIED_GL') return 'ok';
  if (s === 'UNPOSTED_GL') return 'muted';
  if (s === 'INCONSISTENT' || s === 'FLAGGED_BUT_NO_GL') return 'exc';
  if (s === 'PARTIAL_GL') return 'warn';
  return 'muted';
}

export function ReconciliationPage() {
  const [cases, setCases]     = useState<ReconCase[]>([]);
  const [summary, setSummary] = useState<ReconSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays]       = useState(7);
  const [filter, setFilter]   = useState<'' | 'EXCEPTION' | 'RESOLVED' | 'OK' | 'AMBIGUOUS'>('');
  const [busy, setBusy]       = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'SO_WEIGH' | 'COUPON_SETTLEMENT'>('SO_WEIGH');
  const [settleResult, setSettleResult] = useState<CouponSettlementResult | null>(null);
  const [settling, setSettling] = useState(false);
  const currentUser = useAuthStore(s => s.user);
  // O-3 / R12 item 6: ADMIN, MANAGER, C_LEVEL and ACCOUNTING (shared capability 'coupon.settle')
  const canSettle = canDo(currentUser, 'coupon.settle');

  async function handleSettleCuts() {
    setSettling(true);
    try {
      const res = await settleCouponCuts();
      setSettleResult(res);
    } catch (err: unknown) {
      alert((err as Error).message || 'ไม่สามารถตรวจการตัดตั๋วได้');
    } finally {
      setSettling(false);
    }
  }

  const [manualCut, setManualCut] = useState<UnmatchedCut | null>(null);
  const [manualResId, setManualResId] = useState<string>('');
  const [manualReason, setManualReason] = useState<string>('');
  const [manualQty, setManualQty] = useState<string>('');
  const [manualOverridePlate, setManualOverridePlate] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  function openManualSettle(cut: UnmatchedCut) {
    setManualCut(cut);
    setManualReason('');
    setManualOverridePlate(false);
    setManualError(null);
    setManualQty(cut.goodQty ? String(cut.goodQty) : '');
    if (cut.candidateReservations && cut.candidateReservations.length > 0) {
      setManualResId(String(cut.candidateReservations[0].id));
    } else {
      setManualResId('');
    }
  }

  async function submitManualSettle() {
    if (!manualCut || !manualResId || manualReason.trim().length < 10) return;
    setManualSubmitting(true);
    setManualError(null);
    try {
      const selectedCand = manualCut.candidateReservations?.find(c => String(c.id) === String(manualResId));
      await manualSettleCouponCut({
        reservationId: manualResId,
        redemptionId: manualCut.redemptionId,
        reason: manualReason.trim(),
        qty: manualQty ? Number(manualQty) : undefined,
        beneficiaryCustId: selectedCand?.beneficiaryCustId,
        overridePlate: manualOverridePlate || undefined,
      });
      setManualCut(null);
      await handleSettleCuts();
    } catch (e: unknown) {
      setManualError((e as Error).message || 'บันทึกการตัดตั๋วไม่สำเร็จ');
    } finally {
      setManualSubmitting(false);
    }
  }

  const load = useCallback(async (d = days, f = filter) => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([fetchReconSummary(d), fetchReconCases(d, f || undefined)]);
      setSummary(s);
      setCases(Array.isArray(c) ? c : []);
    } catch (e) { console.error(e); setCases([]); }
    setLoading(false);
  }, [days, filter]);

  useEffect(() => { load(days, filter); /* eslint-disable-next-line */ }, [days, filter]);
  useSocketEvent('so_updated', () => { load(days, filter); });

  async function doResolve(c: ReconCase, checkType: ReconCheck, action: 'RESOLVE' | 'IGNORE') {
    const verb = action === 'IGNORE' ? 'ละเว้น (ไม่ถือเป็นปัญหา)' : 'แก้ไขแล้ว';
    const docLabel = c.soDocuNo || c.wsDocuNo || c.wfRef || c.soId;
    const note = await appPrompt(`บันทึกเหตุผลการ${verb} — ${docLabel} (${checkType === 'WEIGH' ? 'น้ำหนัก' : 'ใบกำกับ'}):`);
    if (note === null) return;
    setBusy(`${c.soId}|${checkType}`);
    try { await resolveReconCase(c.soId, { checkType, action, note: note || undefined, wfRef: c.wfRef }); await load(days, filter); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setBusy(null); }
  }

  const card = (icon: React.ReactNode, label: string, value: number | string, tone: string) => (
    <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tone}`}>{icon}</div>
      <div><div className="text-xs text-gray-400">{label}</div><div className="text-2xl font-bold text-gray-800">{value}</div></div>
    </div>
  );

  const ResolveBtns = ({ c, type, info }: { c: ReconCase; type: ReconCheck; info: ReconCase['weighResolution'] }) => {
    if (info) return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${badge('resolved')}`} title={info.note || ''}>{info.status === 'IGNORED' ? 'ละเว้น' : 'แก้แล้ว'}</span>;
    const k = `${c.soId}|${type}`;
    return (
      <div className="flex gap-1">
        <button disabled={busy === k} onClick={() => doResolve(c, type, 'RESOLVE')}
          className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40">แก้แล้ว</button>
        <button disabled={busy === k} onClick={() => doResolve(c, type, 'IGNORE')}
          className="px-2 py-0.5 rounded-md text-[11px] font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">ละเว้น</button>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col w-full overflow-hidden max-w-full" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-200 bg-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> กระทบยอด (Reconciliation Workbench)
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">ส่งสินค้า · ตรวจชั่งน้ำหนัก · สอบทานใบกำกับ WINSpeed · ตรวจสอบสมุดรายวัน GL จริง · FR-027</p>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C] flex-1 sm:flex-none">
            <option value={7}>7 วันล่าสุด</option><option value={14}>14 วัน</option><option value={30}>30 วัน</option><option value={60}>60 วัน</option>
          </select>
          <button onClick={() => load(days, filter)} className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex gap-2">
        <button
          onClick={() => setActiveTab('SO_WEIGH')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'SO_WEIGH'
              ? 'bg-[#0C447C] text-white shadow-sm'
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
          }`}
        >
          กระทบยอดขายและชั่งน้ำหนัก (SO & Weigh Recon)
        </button>
        <button
          onClick={() => setActiveTab('COUPON_SETTLEMENT')}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
            activeTab === 'COUPON_SETTLEMENT'
              ? 'bg-[#0C447C] text-white shadow-sm'
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
          }`}
        >
          <Ticket size={14} />
          กระทบยอดการตัดตั๋วปุ๋ย (Coupon Settlement & Audit)
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        {activeTab === 'COUPON_SETTLEMENT' ? (
          <div className="space-y-4 sm:space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <Ticket className="text-[#0C447C]" size={18} />
                  ระบบกระทบยอดและตรวจการตัดตั๋วคูปอง (Coupon Settlement)
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  ตรวจสอบการตัดตั๋วปุ๋ยจาก WINSpeed (WFRedemtion) เทียบกับการจองคูปอง (wf.CouponReservation) ตามเกณฑ์ R6-5 / D4
                </p>
              </div>
              <button
                disabled={settling || !canSettle}
                onClick={handleSettleCuts}
                className="px-4 py-2.5 rounded-xl text-white text-xs font-bold bg-[#0C447C] hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shrink-0 shadow-sm transition-opacity"
              >
                <RefreshCw size={14} className={settling ? 'animate-spin' : ''} />
                {settling ? 'กำลังตรวจสอบการตัดตั๋ว...' : 'ตรวจการตัดตั๋ว (Settle Cuts)'}
              </button>
            </div>

            <AccountBooksPanel />

            {settleResult && (
              <div className="space-y-4">
                <div className={`p-4 rounded-xl border text-sm flex items-start gap-3 ${
                  settleResult.settledCount > 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-blue-50 border-blue-200 text-blue-800'
                }`}>
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-bold">
                      {settleResult.settledCount > 0
                        ? `ตัดตั๋วสำเร็จ ${settleResult.settledCount} รายการ (จากตั๋วที่มีการจอง ${settleResult.processedCoupons ?? 0} ใบ)`
                        : `ตรวจสอบเรียบร้อย — ไม่พบการตัดตั๋วใหม่ที่ต้องบันทึก (ตรวจไป ${settleResult.processedCoupons ?? 0} ใบ)`}
                    </div>
                    {settleResult.note && (
                      <div className="text-xs mt-1 text-gray-600">{settleResult.note}</div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  {card(<Ticket size={20} />, 'ตั๋วที่ตรวจสอบ', settleResult.processedCoupons ?? 0, 'bg-blue-50 text-blue-600')}
                  {card(<CheckCircle size={20} />, 'บันทึกตัดตั๋วสำเร็จ', settleResult.settledCount, 'bg-emerald-50 text-emerald-600')}
                  {card(<AlertTriangle size={20} />, 'ตัดตั๋วกำกวมต้องตรวจ', settleResult.ambiguous?.length ?? 0, 'bg-amber-50 text-amber-600')}
                  {card(<AlertCircle size={20} />, 'ตัดตั๋วที่จับคู่ไม่ได้', settleResult.unmatched?.length ?? 0, 'bg-rose-50 text-rose-600')}
                </div>

                {/* Unmatched cuts table (FR-1) */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 bg-rose-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-rose-900 flex items-center gap-2">
                        <AlertCircle size={16} className="text-rose-600" />
                        รายการตัดตั๋วที่จับคู่ไม่ได้ (Unmatched Ticket Cuts)
                      </h3>
                      <p className="text-xs text-rose-700/80 mt-0.5">
                        รายการตัดตั๋วจาก WINSpeed ที่ยังไม่สามารถจับคู่อัตโนมัติได้ — บัญชี/ผู้จัดการสามารถตรวจสอบและเลือกจับคู่แบบแมนนวล (Manual Settle) ได้ตามสิทธิ์
                      </p>
                    </div>
                    {settleResult.unmatched && settleResult.unmatched.length > 0 && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200 self-start sm:self-auto">
                        {settleResult.unmatched.length} รายการ
                      </span>
                    )}
                  </div>
                  {(!settleResult.unmatched || settleResult.unmatched.length === 0) ? (
                    <div className="py-8 text-center text-xs text-gray-400">
                      ไม่พบรายการตัดตั๋วที่จับคู่ไม่ได้
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-full">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                          <tr>
                            <th className="px-4 py-3 text-left">เลขที่ตัดตั๋ว (Redemption ID) / เลขที่เอกสาร</th>
                            <th className="px-4 py-3 text-left">วันที่ตัดตั๋ว</th>
                            <th className="px-4 py-3 text-right">จำนวนตัด (ตัน)</th>
                            <th className="px-4 py-3 text-left">ผู้รับ (Receiver)</th>
                            <th className="px-4 py-3 text-left">ทะเบียนรถ (Plate)</th>
                            <th className="px-4 py-3 text-left">สาเหตุที่ไม่จับคู่</th>
                            <th className="px-4 py-3 text-left">รายการจองที่เกี่ยวข้อง (Candidates)</th>
                            <th className="px-4 py-3 text-center">จัดการ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {settleResult.unmatched.map((cut, idx) => {
                            const reasonMeta = UNMATCHED_REASON_LABEL[cut.reason] || {
                              label: cut.reason,
                              badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
                            };
                            return (
                              <tr key={idx} className="hover:bg-rose-50/20">
                                <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                                  <div className="font-semibold text-gray-800">{cut.docuNo || '-'}</div>
                                  <div className="text-[11px] text-gray-400">ID: {cut.redemptionId}</div>
                                </td>
                                <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                                  {cut.docuDate ? new Date(cut.docuDate).toLocaleDateString('th-TH') : '-'}
                                </td>
                                <td className="px-4 py-2.5 text-right font-bold text-gray-800 tabular-nums whitespace-nowrap">
                                  {cut.goodQty != null ? `${Number(cut.goodQty).toFixed(3)}` : '-'}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-gray-700 max-w-[140px] truncate" title={cut.receiver || ''}>
                                  {cut.receiver || '-'}
                                </td>
                                <td className="px-4 py-2.5 font-mono text-xs text-gray-700 whitespace-nowrap">
                                  {cut.plate || '-'}
                                </td>
                                <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${reasonMeta.badgeClass}`}>
                                    {reasonMeta.label}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-xs text-gray-600">
                                  {cut.candidateReservations && cut.candidateReservations.length > 0 ? (
                                    <div className="space-y-1 max-w-[260px]">
                                      {cut.candidateReservations.map(c => (
                                        <div key={c.id} className="bg-gray-50 p-1.5 rounded border border-gray-100 text-[11px] leading-tight">
                                          <span className="font-bold text-gray-700">จอง #{c.id}</span>
                                          {c.carrierDocuNo && <span className="ml-1 text-[#0C447C]">({c.carrierDocuNo})</span>}
                                          <div>ทะเบียน: {c.plate || '-'} | เหลือ: {c.remainingReservedQty ?? c.reservedQty} ตัน</div>
                                          {c.beneficiaryName && <div className="text-gray-500 truncate">ผู้รับสิทธิ์: {c.beneficiaryName}</div>}
                                          {c.confirmDate && <div className="text-gray-400 text-[10px]">ยืนยัน: {new Date(c.confirmDate).toLocaleDateString('th-TH')}</div>}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-gray-400 italic text-[11px]">ไม่พบรายการจอง</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-center whitespace-nowrap">
                                  <button
                                    disabled={!canSettle}
                                    onClick={() => openManualSettle(cut)}
                                    title={canSettle ? 'เลือกจับคู่การตัดตั๋วนี้แบบแมนนวล' : 'เฉพาะบทบาท ADMIN, MANAGER, C_LEVEL, ACCOUNTING เท่านั้น'}
                                    className="px-3 py-1 rounded-lg text-xs font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition"
                                  >
                                    ตัดตั๋วแบบแมนนวล
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Ambiguous cuts table */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 bg-amber-50/50">
                    <h3 className="text-sm font-bold text-amber-900 flex items-center gap-2">
                      <AlertTriangle size={16} className="text-amber-600" />
                      รายการตัดตั๋วกำกวม (Ambiguous Cuts) — รอการตรวจสอบ
                    </h3>
                    <p className="text-xs text-amber-700/80 mt-0.5">
                      รายการตัดตั๋วจาก WINSpeed ที่ยอดไม่ตรง หรือมีการจองที่ตรงกันหลายใบ ระบบปฏิเสธการตัดอัตโนมัติเพื่อป้องกันข้อมูลคลาดเคลื่อน
                    </p>
                  </div>
                  {(!settleResult.ambiguous || settleResult.ambiguous.length === 0) ? (
                    <div className="py-8 text-center text-xs text-gray-400">
                      ไม่พบรายการตัดตั๋วกำกวม
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-full">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                          <tr>
                            <th className="px-4 py-3 text-left">เลขที่ตัดตั๋ว (Redemption ID)</th>
                            <th className="px-4 py-3 text-left">เลขที่เอกสารตัดตั๋ว</th>
                            <th className="px-4 py-3 text-right">จำนวนตัน</th>
                            <th className="px-4 py-3 text-left">สาเหตุที่ระบบไม่ตัดอัตโนมัติ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {settleResult.ambiguous.map((amb, idx) => (
                            <tr key={idx} className="hover:bg-amber-50/30">
                              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-700 whitespace-nowrap">
                                {amb.redemptionId ?? '-'}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap">
                                {amb.docuNo ?? '-'}
                              </td>
                              <td className="px-4 py-2.5 text-right font-bold text-gray-800 tabular-nums whitespace-nowrap">
                                {amb.qty != null ? `${Number(amb.qty).toFixed(3)} ตัน` : '-'}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-amber-800 font-medium">
                                {amb.reason || 'ยอดไม่ตรงหรือพบการจองตรงกันหลายรายการ'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Settled cuts table */}
                {settleResult.settlements && settleResult.settlements.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 bg-emerald-50/50">
                      <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                        <CheckCircle size={16} className="text-emerald-600" />
                        รายการตัดตั๋วสำเร็จในรอบนี้ (Settled / Consumed)
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-full">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                          <tr>
                            <th className="px-4 py-3 text-left">Reservation ID</th>
                            <th className="px-4 py-3 text-left">Redemption ID</th>
                            <th className="px-4 py-3 text-left">เลขที่เอกสารตัดตั๋ว</th>
                            <th className="px-4 py-3 text-right">จำนวนตัน</th>
                            <th className="px-4 py-3 text-center">สถานะ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {settleResult.settlements.map((st, idx) => (
                            <tr key={idx} className="hover:bg-emerald-50/30">
                              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-700 whitespace-nowrap">
                                #{st.reservationId}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap">
                                {st.redemptionId}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-[#0C447C] whitespace-nowrap">
                                {st.redemptionDocuNo || st.nativeDocuNo || st.docuNo || '-'}
                              </td>
                              <td className="px-4 py-2.5 text-right font-bold text-gray-800 tabular-nums whitespace-nowrap">
                                {(st.matchedQty ?? st.settledQty ?? st.qty) != null
                                  ? `${Number(st.matchedQty ?? st.settledQty ?? st.qty).toFixed(3)} ตัน`
                                  : '-'}
                              </td>
                              <td className="px-4 py-2.5 text-center whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                  CONSUMED
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Manual settle dialog modal (FR-1) */}
            {manualCut && (
              <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-[#0C447C] text-white">
                    <h3 className="font-bold text-base flex items-center gap-2">
                      <Ticket size={18} /> จับคู่ตัดตั๋วแบบแมนนวล (Manual Settle)
                    </h3>
                    <button onClick={() => setManualCut(null)} className="text-white/80 hover:text-white">
                      <X size={18} />
                    </button>
                  </div>

                  <div className="p-6 space-y-4 overflow-y-auto flex-1">
                    {manualError && (
                      <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                        <span>{manualError}</span>
                      </div>
                    )}

                    <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100 space-y-1.5 text-xs text-gray-700">
                      <div className="font-bold text-gray-800 text-sm">ข้อมูลการตัดตั๋วจาก WINSpeed</div>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div><span className="text-gray-400">เลขที่เอกสาร:</span> <span className="font-mono font-bold">{manualCut.docuNo}</span></div>
                        <div><span className="text-gray-400">Redemption ID:</span> <span className="font-mono">{manualCut.redemptionId}</span></div>
                        <div><span className="text-gray-400">วันที่ตัดตั๋ว:</span> <span>{manualCut.docuDate ? new Date(manualCut.docuDate).toLocaleDateString('th-TH') : '-'}</span></div>
                        <div><span className="text-gray-400">จำนวนตัด:</span> <span className="font-bold text-emerald-700">{manualCut.goodQty} ตัน</span></div>
                        <div><span className="text-gray-400">ทะเบียนรถ:</span> <span className="font-mono">{manualCut.plate || '-'}</span></div>
                        <div><span className="text-gray-400">ผู้รับ:</span> <span>{manualCut.receiver || '-'}</span></div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        เลือกรายการจองคูปอง (Reservation) <span className="text-red-500">*</span>
                      </label>
                      {manualCut.candidateReservations && manualCut.candidateReservations.length > 0 ? (
                        <select
                          value={manualResId}
                          onChange={e => setManualResId(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
                        >
                          <option value="">-- เลือกรายการจอง --</option>
                          {manualCut.candidateReservations.map(c => (
                            <option key={c.id} value={String(c.id)}>
                              จอง #{c.id} - SO: {c.carrierDocuNo || c.carrierSoId || '-'} | ทะเบียน: {c.plate || '-'} | ยอดคงเหลือ: {c.remainingReservedQty ?? c.reservedQty} ตัน {c.beneficiaryName ? `(${c.beneficiaryName})` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder="ระบุ Reservation ID เช่น 18"
                          value={manualResId}
                          onChange={e => setManualResId(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
                        />
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        จำนวนตัดที่บันทึก (ตัน)
                      </label>
                      <input
                        type="number"
                        step="0.001"
                        value={manualQty}
                        onChange={e => setManualQty(e.target.value)}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-bold text-gray-700">
                          เหตุผลการจับคู่แบบแมนนวล <span className="text-red-500">*</span>
                        </label>
                        <span className={`text-[11px] ${manualReason.trim().length >= 10 ? 'text-emerald-600 font-bold' : 'text-gray-400'}`}>
                          {manualReason.trim().length}/10 ตัวอักษร
                        </span>
                      </div>
                      <textarea
                        rows={3}
                        value={manualReason}
                        onChange={e => setManualReason(e.target.value)}
                        placeholder="ระบุเหตุผล เช่น วันที่ตัดตั๋วบันทึกก่อนยืนยันเนื่องจาก WinSpeed ตัดรอบข้ามเที่ยงคืน ตรวจสอบทะเบียนและผู้รับสิทธิ์ตรงกัน ได้รับอนุมัติจากผู้จัดการแล้ว"
                        className="w-full border border-gray-300 rounded-xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
                      />
                      {manualReason.trim().length > 0 && manualReason.trim().length < 10 && (
                        <p className="text-[11px] text-amber-600 mt-1">
                          เหตุผลต้องมีความยาวอย่างน้อย 10 ตัวอักษร (เพื่อความถูกต้องในการตรวจสอบย้อนหลัง)
                        </p>
                      )}
                    </div>

                    <label className="flex items-start gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={manualOverridePlate}
                        onChange={e => setManualOverridePlate(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        ยืนยันจับคู่แม้ทะเบียนรถในใบตัดตั๋วไม่ตรงกับทะเบียนของเที่ยวที่จอง
                        <span className="block text-[11px] text-gray-400">ระบบจะบันทึกว่าเป็นการยกเว้นทะเบียนไว้ในหลักฐาน</span>
                      </span>
                    </label>
                  </div>

                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setManualCut(null)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-100"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      disabled={manualSubmitting || !manualResId || manualReason.trim().length < 10}
                      onClick={submitManualSettle}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm flex items-center gap-1.5"
                    >
                      {manualSubmitting ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                      {manualSubmitting ? 'กำลังบันทึก...' : 'ยืนยันการตัดตั๋ว'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {summary && !summary.tsAvailable && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-sm text-amber-700">
                <Info size={18} className="mt-0.5 shrink-0" /> TruckScale ไม่พร้อมใช้งาน — การกระทบยอดน้ำหนักจะแสดงเป็น "ไม่พร้อม" จนกว่าจะเชื่อมต่อได้
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {card(<Scale size={20} />, 'ใบสั่งขายทั้งหมด (SOHD)', summary !== null ? summary.total : '–', 'bg-blue-50 text-blue-600')}
              {card(<FileCheck2 size={20} />, 'ผ่านเกณฑ์ปฏิบัติการ', summary !== null ? (summary.operationallyQualified ?? '–') : '–', 'bg-cyan-50 text-cyan-600')}
              {card(<FileCheck2 size={20} />, 'พบใบกำกับ', summary !== null ? ((summary.invoiceFound ?? summary.postedInvoice ?? 0) + (summary.partialInvoiced ?? 0)) : '–', 'bg-amber-50 text-amber-600')}
              {card(<CheckCircle size={20} />, 'GL ยืนยันแล้ว', summary !== null ? (summary.glVerified ?? '–') : '–', 'bg-green-50 text-green-600')}
              {card(<AlertTriangle size={20} />, 'ต้องตรวจ / กำกวม', summary !== null ? ((summary.exception ?? 0) + (summary.ambiguous ?? 0)) : '–', 'bg-red-50 text-red-500')}
              {card(<CheckCircle size={20} />, 'ปกติ (OK)', summary !== null ? summary.ok : '–', 'bg-emerald-50 text-emerald-600')}
            </div>

            <div className="flex flex-wrap gap-2">
              {([['', 'ทั้งหมด'], ['EXCEPTION', 'ต้องตรวจ'], ['AMBIGUOUS', 'กำกวม (Candidate)'], ['RESOLVED', 'จัดการแล้ว'], ['OK', 'ปกติ']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setFilter(v)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${filter === v ? 'bg-[#0C447C] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>{l}</button>
              ))}
            </div>

            <div className="bg-white rounded-none sm:rounded-lg sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm sm:shadow-sm shadow-none overflow-hidden">
              <div className="overflow-x-auto w-full scrollbar-hide">
              <table className="w-full text-sm min-w-full">
                <thead className="whitespace-nowrap">
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <th className="text-left px-4 py-3 whitespace-nowrap">SO / วันที่</th>
                    <th className="text-left px-4 py-3 whitespace-nowrap">ลูกค้า / ทะเบียน</th>
                    <th className="text-left px-4 py-3 whitespace-nowrap">น้ำหนัก (App ↔ TS)</th>
                    <th className="text-left px-4 py-3 whitespace-nowrap">ใบกำกับ & Native GL</th>
                    <th className="text-left px-4 py-3 whitespace-nowrap">เกณฑ์ปฏิบัติการ</th>
                    <th className="text-right px-4 py-3 whitespace-nowrap">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 whitespace-nowrap">กำลังโหลด…</td></tr>}
                  {!loading && cases.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 whitespace-nowrap">ไม่พบรายการ</td></tr>}
                  {!loading && cases.map(c => (
                    <tr key={c.soId} className={c.overall === 'EXCEPTION' ? 'bg-red-50/40' : (c.overall === 'AMBIGUOUS' ? 'bg-amber-50/30' : '')}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-semibold text-gray-800">{c.soDocuNo || c.wsDocuNo || c.wfRef || c.soId}</div>
                        <div className="text-xs text-gray-400">{c.shipDate}</div>
                        {c.wfRef && c.wfRef !== (c.soDocuNo || c.wsDocuNo) && (
                          <div className="text-[10px] text-gray-400">Ref: {c.wfRef}</div>
                        )}
                        {c.fulfillmentStatus === 'UNKNOWN' && (
                          <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">หลักฐานส่งไม่ครบ</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-gray-700 font-medium">{c.custName}</div>
                        <div className="text-xs text-gray-400">{c.truckPlate || '–'} · movebill {c.movebill || '–'}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${badge(weighKind(c.weigh) as 'ok' | 'exc' | 'muted' | 'warn')}`}>{WEIGH_LABEL[c.weigh]}</span>
                        <div className="text-xs text-gray-500 mt-1">
                          {c.netApp != null ? `${c.netApp.toLocaleString()} kg` : '–'}
                          {c.netTs != null && <> ↔ {c.netTs.toLocaleString()} kg</>}
                          {c.variance != null && c.variance !== 0 && <span className={Math.abs(c.variance) > 50 ? 'text-red-500 font-semibold' : 'text-gray-400'}> ({c.variance > 0 ? '+' : ''}{c.variance})</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${badge(c.invoiceStatus === 'INVOICE_FOUND' ? 'info' : (c.invoiceStatus === 'PARTIAL_INVOICED' ? 'warn' : (c.invoiceStatus === 'CANCELLED' ? 'exc' : 'muted')))}`}>
                            {INVOICE_STATUS_LABEL[c.invoiceStatus] || c.invoiceStatus}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${badge(glKind(c.verifiedGlStatus) as 'ok' | 'exc' | 'muted' | 'warn')}`}>
                            {GL_STATUS_LABEL[c.verifiedGlStatus] || c.verifiedGlStatus}
                          </span>
                        </div>
                        {c.invoices && c.invoices.length > 0 ? (
                          <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                            {c.invoices.map((inv, idx) => (
                              <div key={idx} className="font-mono text-[11px] flex items-center gap-1">
                                <span className={inv.docuStatus === 'C' ? 'line-through text-red-500' : ''}>{inv.docuNo}</span>
                                {inv.docuStatus === 'C' && (
                                  <span className="text-[10px] px-1 py-0.2 rounded bg-red-100 text-red-700 font-sans">ยกเลิก</span>
                                )}
                                {inv.provenance === 'CANDIDATE_FALLBACK' && (
                                  <span className="text-[10px] px-1 py-0.2 rounded bg-amber-100 text-amber-700 font-sans">Candidate</span>
                                )}
                                {inv.provenance === 'HEADER_SO_REF_UNALLOCATED' && (
                                  <span className="text-[10px] px-1 py-0.2 rounded bg-gray-100 text-gray-600 font-sans">ยอดไม่ระบุบรรทัด</span>
                                )}
                                {inv.lineQty != null ? ` · ${inv.lineQty} ตัน` : ''}
                                {inv.lineAmnt != null ? ` · ฿${inv.lineAmnt.toLocaleString()}` : ''}
                                {inv.postGL ? ` · GL:${inv.postGL}` : ''}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 mt-1">ยังไม่มีเอกสารใบกำกับ</div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${badge(c.operationalReadiness === 'QUALIFIED' ? 'ok' : 'muted')}`}>
                          {c.operationalReadiness === 'QUALIFIED' ? 'ผ่านเกณฑ์ปฏิบัติการ' : 'ยังไม่พร้อม'}
                        </span>
                        {c.readinessReasons && c.readinessReasons.length > 0 && (
                          <div className="text-[11px] text-amber-700 mt-1 max-w-[200px] truncate" title={c.readinessReasons.join(' | ')}>
                            {c.readinessReasons[0]}{c.readinessReasons.length > 1 ? ` (+${c.readinessReasons.length - 1})` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col items-end gap-1.5">
                          {(['VARIANCE', 'TS_NOT_FOUND', 'NO_WEIGH', 'UNLINKED', 'TS_UNAVAILABLE', 'CANDIDATE_MATCH'].includes(c.weigh) || c.weighResolution) &&
                            <div className="flex items-center gap-1"><span className="text-[10px] text-gray-400">น้ำหนัก</span><ResolveBtns c={c} type="WEIGH" info={c.weighResolution} /></div>}
                          {(c.invoiceStatus === 'NO_INVOICE' || c.invoiceStatus === 'CANCELLED' || c.invoiceResolution) &&
                            <div className="flex items-center gap-1"><span className="text-[10px] text-gray-400">ใบกำกับ</span><ResolveBtns c={c} type="INVOICE" info={c.invoiceResolution} /></div>}
                          {c.overall === 'OK' && <CheckCircle size={16} className="text-green-500" />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
