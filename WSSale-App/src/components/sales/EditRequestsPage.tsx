/**
 * คำขอแก้ไขหลังยืนยัน — หน้าอนุมัติ (เฟส 5)
 *
 * ใครใช้หน้านี้
 *   ผู้อนุมัติ  — ดูคิวคำขอที่รอ ตัดสินอนุมัติหรือปฏิเสธ
 *   ผู้ขอ      — ติดตามคำขอของตัวเอง และถอนได้ถ้ายังไม่มีใครตัดสิน
 *
 * ทำไมคำขอที่ Hold รถต้องอยู่บนสุดเสมอ
 *   คำขอที่ Hold แปลว่ามีรถจอดรออยู่จริงที่ลาน ต้นทุนของการช้าคือรถติดคิว
 *   ส่วนคำขอที่ไม่ Hold รอได้ จึงเรียงให้เห็นตัวที่มีรถรอก่อน ไม่เรียงตามเวลาล้วน
 *
 * ⚠ การ Hold ที่นี่เป็นธงฝั่งแอป ไม่ได้สั่งเครื่องชั่งให้หยุด
 *   ระบบเราเขียน dbo ไม่ได้ หน้าที่หยุดรถจริงยังเป็นของคนคุมลาน
 *   หน้านี้ทำได้แค่ทำให้ "รู้" เร็วที่สุด
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck, RefreshCw, AlertTriangle, Check, X, Clock,
  PauseOctagon, Truck, Undo2, Filter,
} from 'lucide-react';
import {
  fetchEditRequests, approveEditRequest, rejectEditRequest, cancelEditRequest,
  fetchPriceApprovals, approvePriceApproval, rejectPriceApproval,
  type EditRequestRow, type PriceApprovalRow,
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import {
  useHoldCapability, HoldCapabilityBanner, HoldScopeChip,
} from '../common/HoldCapabilityBanner';
import type { HoldCapability } from '../../services/api';

const NAVY = '#0C447C';

const STAGE_STYLE: Record<string, string> = {
  CONFIRMED:  'bg-blue-50 text-blue-800 border-blue-200',
  REGISTERED: 'bg-sky-50 text-sky-800 border-sky-200',
  LOADING:    'bg-amber-50 text-amber-900 border-amber-200',
  SHIPPED:    'bg-emerald-50 text-emerald-800 border-emerald-200',
};
const STAGE_LABEL: Record<string, string> = {
  CONFIRMED:  'ยืนยันแล้ว',
  REGISTERED: 'รถลงทะเบียนแล้ว',
  LOADING:    'กำลังโหลดสินค้า',
  SHIPPED:    'ชั่งออกแล้ว',
};
const STATUS_STYLE: Record<string, string> = {
  PENDING:   'bg-amber-50 text-amber-900 border-amber-300',
  APPROVED:  'bg-emerald-50 text-emerald-800 border-emerald-300',
  REJECTED:  'bg-red-50 text-red-800 border-red-300',
  CANCELLED: 'bg-gray-100 text-gray-600 border-gray-300',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ปฏิเสธ', CANCELLED: 'ถอนแล้ว',
};

const APPROVER_ROLES = ['APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL'];

const thTime = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function RequestCard({ r, onDone, cap }: { r: EditRequestRow; onDone: () => void; cap: HoldCapability | null }) {
  const user = useAuthStore(s => s.user);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<null | 'approve' | 'reject'>(null);

  const canApprove = APPROVER_ROLES.includes(String(user?.role || ''))
    && Number(r.requestedBy) !== Number(user?.id);
  const isMine = Number(r.requestedBy) === Number(user?.id);
  const pending = r.status === 'PENDING';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); onDone(); }
    catch (e: any) { setErr(e?.message || 'ทำรายการไม่สำเร็จ'); }
    setBusy(false);
  };

  return (
    <div className={`rounded-lg border bg-white p-3 shadow-sm ${r.holdTruck && pending ? 'border-red-300' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-mono text-xs text-gray-400">#{r.id}</span>

        {!!r.holdTruck && pending && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
              <PauseOctagon size={12} /> รถถูก Hold
            </span>
            <HoldScopeChip cap={cap} />
          </span>
        )}

        <span className={`rounded border px-1.5 py-0.5 text-[11px] ${STAGE_STYLE[r.stageAtRequest] || ''}`}>
          {STAGE_LABEL[r.stageAtRequest] || r.stageAtRequest}
        </span>

        <span className="font-mono text-sm font-medium text-gray-800">{r.docuNo || r.soid}</span>
        {r.custName && <span className="text-xs text-gray-600">{r.custName}</span>}

        {r.tripCode && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Truck size={12} /> {r.tripCode}
            {r.transRegistration ? ` · ${r.transRegistration}` : ''}
          </span>
        )}

        <span className={`ml-auto rounded border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status]}`}>
          {STATUS_LABEL[r.status]}
        </span>
      </div>

      <div className="mt-2 text-sm text-gray-800">
        {r.reasonText || r.reasonCode}
        {r.reasonDetail && <span className="text-gray-600"> — {r.reasonDetail}</span>}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1">
          <Clock size={11} /> ขอเมื่อ {thTime(r.requestedAt)} โดย {r.requestedByName || '—'}
        </span>
        {r.reviewedAt && (
          <span>ตัดสิน {thTime(r.reviewedAt)} โดย {r.reviewedByName || '—'}</span>
        )}
      </div>

      {r.reviewNote && (
        <p className="mt-1 rounded bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
          หมายเหตุผู้ตัดสิน: {r.reviewNote}
        </p>
      )}

      {err && (
        <p className="mt-2 flex items-center gap-1 text-xs text-red-600">
          <AlertTriangle size={12} /> {err}
        </p>
      )}

      {pending && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          {mode === null ? (
            <div className="flex flex-wrap gap-2">
              {canApprove && (
                <>
                  <button type="button" disabled={busy} onClick={() => setMode('approve')}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                    <Check size={13} /> อนุมัติ
                  </button>
                  <button type="button" disabled={busy} onClick={() => setMode('reject')}
                    className="inline-flex items-center gap-1 rounded border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                    <X size={13} /> ปฏิเสธ
                  </button>
                </>
              )}
              {isMine && (
                <button type="button" disabled={busy} onClick={() => run(() => cancelEditRequest(r.id))}
                  className="inline-flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  <Undo2 size={13} /> ถอนคำขอ
                </button>
              )}
              {!canApprove && !isMine && (
                <span className="text-[11px] text-gray-400">
                  {APPROVER_ROLES.includes(String(user?.role || ''))
                    ? 'อนุมัติคำขอของตัวเองไม่ได้'
                    : 'บทบาทของคุณไม่มีสิทธิ์อนุมัติ'}
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder={mode === 'reject' ? 'เหตุผลที่ปฏิเสธ (อย่างน้อย 5 ตัวอักษร)' : 'หมายเหตุการอนุมัติ (ไม่บังคับ)'}
                className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1"
              />
              <div className="flex gap-2">
                <button
                  type="button" disabled={busy || (mode === 'reject' && note.trim().length < 5)}
                  onClick={() => run(() => mode === 'approve'
                    ? approveEditRequest(r.id, note.trim() || undefined)
                    : rejectEditRequest(r.id, note.trim()))}
                  className={`rounded px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 ${
                    mode === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
                >
                  ยืนยัน{mode === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}
                </button>
                <button type="button" disabled={busy} onClick={() => { setMode(null); setNote(''); setErr(null); }}
                  className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
                  ยกเลิก
                </button>
              </div>
              {mode === 'approve' && !!r.holdTruck && (
                <p className="text-[11px] text-gray-500">
                  อนุมัติแล้วจะยกเลิก Hold และปลดล็อกใบสั่งขายให้กลับมาแก้ไขได้
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PriceApprovalCard({ pa, onDone }: { pa: PriceApprovalRow; onDone: () => void }) {
  const user = useAuthStore(s => s.user);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<null | 'approve' | 'reject'>(null);

  const canApprove = APPROVER_ROLES.includes(String(user?.role || ''))
    && (user?.role === 'ADMIN' || user?.role === 'C_LEVEL' || Number(pa.requestedBy) !== Number(user?.id));
  const pending = pa.status === 'PENDING';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); onDone(); }
    catch (e: any) { setErr(e?.message || 'ทำรายการไม่สำเร็จ'); }
    setBusy(false);
  };

  return (
    <div className={`rounded-lg border bg-white p-3 shadow-sm ${pending ? 'border-amber-300' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-mono text-xs text-gray-400">#{pa.id}</span>
        <span className="font-bold text-sm text-[#0C447C]">{pa.wfRef || pa.soDocuNo || `SO #${pa.soId}`}</span>
        {pa.custName && <span className="text-xs text-gray-700 font-medium">ลูกค้า: {pa.custName}</span>}
        <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[pa.status] || ''}`}>
          {STATUS_LABEL[pa.status] || pa.status}
        </span>
      </div>

      <div className="mt-2.5 rounded-lg bg-gray-50 p-2.5 border border-gray-100 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <span className="text-gray-500 block text-[10px]">สินค้า:</span>
          <span className="font-bold text-gray-800">{pa.goodCode}</span>
          <span className="text-gray-500 text-[10px] block truncate">{pa.goodName}</span>
        </div>
        <div>
          <span className="text-gray-500 block text-[10px]">จำนวน:</span>
          <span className="font-bold text-gray-800">{Number(pa.qtyTon).toLocaleString('th-TH', { maximumFractionDigits: 3 })} ตัน</span>
        </div>
        <div>
          <span className="text-gray-500 block text-[10px]">ราคาเสนอ / ราคาประกาศ:</span>
          <span className="font-bold text-red-600">฿{Number(pa.requestedPrice).toLocaleString()}</span>
          <span className="text-gray-400 text-[10px]"> / ฿{Number(pa.announcedPrice).toLocaleString()}</span>
        </div>
        <div>
          <span className="text-gray-500 block text-[10px]">ส่วนต่างรวม:</span>
          <span className="font-bold text-amber-700">฿{Number(pa.totalDeviationAmt).toLocaleString()}</span>
          <span className="text-gray-500 text-[10px] block">(-฿{Number(pa.priceDeviationPerTon).toLocaleString()}/ตัน)</span>
        </div>
      </div>

      {pa.reasonText && (
        <div className="mt-2 text-xs text-gray-600 bg-amber-50/60 p-2 rounded border border-amber-100">
          <span className="font-semibold text-amber-800">เหตุผล/รายละเอียด:</span> {pa.reasonText}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between text-[11px] text-gray-400">
        <span>ขอโดย <strong className="text-gray-600">{pa.requestedByName || `User #${pa.requestedBy}`}</strong> · {thTime(pa.createdAt)}</span>
        {pa.approvedAt && (
          <span>
            {pa.status === 'APPROVED' ? 'อนุมัติ' : 'ปฏิเสธ'}โดย <strong className="text-gray-600">{pa.approvedByName || `User #${pa.approvedBy}`}</strong> · {thTime(pa.approvedAt)}
            {pa.approvalNote && <span className="ml-1 text-gray-500">({pa.approvalNote})</span>}
          </span>
        )}
      </div>

      {err && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>
      )}

      {pending && canApprove && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          {mode === null && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('approve')}
                className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Check size={12} /> อนุมัติราคา
              </button>
              <button
                type="button"
                onClick={() => setMode('reject')}
                className="flex items-center gap-1 rounded border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                <X size={12} /> ปฏิเสธ
              </button>
            </div>
          )}

          {mode === 'approve' && (
            <div className="space-y-1.5 rounded border border-emerald-200 bg-emerald-50/50 p-2 text-xs">
              <div className="font-semibold text-emerald-900">ยืนยันอนุมัติราคาขายต่ำกว่าประกาศ</div>
              <input
                type="text"
                placeholder="หมายเหตุการอนุมัติ (ไม่บังคับ)"
                value={note}
                onChange={e => setNote(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none"
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => approvePriceApproval(pa.id, note))}
                  className="rounded bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? 'กำลังบันทึก...' : 'ยืนยันอนุมัติ'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode(null); setNote(''); }}
                  className="rounded border border-gray-300 bg-white px-2.5 py-1 text-gray-700 hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          {mode === 'reject' && (
            <div className="space-y-1.5 rounded border border-red-200 bg-red-50/50 p-2 text-xs">
              <div className="font-semibold text-red-900">ปฏิเสธราคาขาย (ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร)</div>
              <input
                type="text"
                placeholder="ระบุเหตุผลที่ปฏิเสธ..."
                value={note}
                onChange={e => setNote(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none"
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy || note.trim().length < 5}
                  onClick={() => run(() => rejectPriceApproval(pa.id, note))}
                  className="rounded bg-red-600 px-2.5 py-1 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? 'กำลังบันทึก...' : 'ยืนยันปฏิเสธ'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode(null); setNote(''); }}
                  className="rounded border border-gray-300 bg-white px-2.5 py-1 text-gray-700 hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EditRequestsPage() {
  const [activeTab, setActiveTab] = useState<'stage' | 'price'>('stage');
  const [rows, setRows] = useState<EditRequestRow[]>([]);
  const [priceRows, setPriceRows] = useState<PriceApprovalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [onlyMine, setOnlyMine] = useState(false);
  const cap = useHoldCapability();

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [r, p] = await Promise.all([
        fetchEditRequests({
          status: statusFilter || undefined,
          mine: onlyMine || undefined,
        }),
        fetchPriceApprovals({
          status: statusFilter || undefined,
          mine: onlyMine || undefined,
        }),
      ]);
      setRows(r.data || []);
      setPriceRows(p.data || []);
    } catch (e: any) {
      setErr(e?.message || 'โหลดคำขอไม่สำเร็จ');
    }
    setLoading(false);
  }, [statusFilter, onlyMine]);

  useEffect(() => { load(); }, [load]);

  // คำขอที่มีรถจอดรอต้องมาก่อนเสมอ ไม่เรียงตามเวลาล้วน
  const sorted = useMemo(() => {
    const weight = (r: EditRequestRow) =>
      (r.status === 'PENDING' ? 0 : 2) + (r.status === 'PENDING' && r.holdTruck ? -1 : 0);
    return [...rows].sort((a, b) =>
      weight(a) - weight(b) || new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }, [rows]);

  const heldCount = rows.filter(r => r.status === 'PENDING' && r.holdTruck).length;
  const pendingCount = rows.filter(r => r.status === 'PENDING').length;
  const pricePendingCount = priceRows.filter(r => r.status === 'PENDING').length;

  return (
    <div className="space-y-3 p-4">
      {/* Tab Switcher */}
      <div className="flex border-b border-gray-200 gap-6">
        <button
          type="button"
          onClick={() => setActiveTab('stage')}
          className={`pb-2 text-sm font-bold flex items-center gap-1.5 border-b-2 transition-all ${activeTab === 'stage' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <PauseOctagon size={16} /> ขอแก้ไขขั้นตอน / Hold รถ
          {pendingCount > 0 && <span className="bg-amber-100 text-amber-800 text-[11px] px-2 py-0.5 rounded-full font-bold">{pendingCount}</span>}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('price')}
          className={`pb-2 text-sm font-bold flex items-center gap-1.5 border-b-2 transition-all ${activeTab === 'price' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <ClipboardCheck size={16} /> ขออนุมัติราคาต่ำกว่าประกาศ
          {pricePendingCount > 0 && <span className="bg-amber-100 text-amber-800 text-[11px] px-2 py-0.5 rounded-full font-bold">{pricePendingCount}</span>}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: NAVY }}>
          {activeTab === 'stage' ? <PauseOctagon size={19} /> : <ClipboardCheck size={19} />}
          {activeTab === 'stage' ? 'คำขอแก้ไขหลังยืนยัน / Hold รถ' : 'คำขออนุมัติราคาขายต่ำกว่าราคาประกาศ'}
        </h2>
        <span className="text-xs text-gray-500">
          รออนุมัติ {activeTab === 'stage' ? pendingCount : pricePendingCount} รายการ
          {activeTab === 'stage' && heldCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 font-semibold text-red-600">
              <PauseOctagon size={12} /> มีรถถูก Hold {heldCount} คัน
            </span>
          )}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} />
            เฉพาะของฉัน
          </label>
          <div className="relative">
            <Filter size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="rounded border border-gray-300 py-1 pl-7 pr-2 text-xs"
            >
              <option value="PENDING">รออนุมัติ</option>
              <option value="APPROVED">อนุมัติแล้ว</option>
              <option value="REJECTED">ปฏิเสธ</option>
              {activeTab === 'stage' && <option value="CANCELLED">ถอนแล้ว</option>}
              <option value="">ทั้งหมด</option>
            </select>
          </div>
          <button
            type="button" onClick={load} disabled={loading}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </button>
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={15} /> {err}
        </div>
      )}

      {activeTab === 'stage' && (
        <>
          {!loading && sorted.length === 0 && !err && (
            <div className="rounded border border-dashed border-gray-300 bg-white px-4 py-10 text-center">
              <ClipboardCheck size={26} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm text-gray-500">ไม่มีคำขอที่ตรงกับเงื่อนไข</p>
            </div>
          )}

          <HoldCapabilityBanner cap={cap} />

          <div className="space-y-2">
            {sorted.map(r => <RequestCard key={String(r.id)} r={r} onDone={load} cap={cap} />)}
          </div>
        </>
      )}

      {activeTab === 'price' && (
        <>
          {!loading && priceRows.length === 0 && !err && (
            <div className="rounded border border-dashed border-gray-300 bg-white px-4 py-10 text-center">
              <ClipboardCheck size={26} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm text-gray-500">ไม่มีคำขออนุมัติราคาที่ตรงกับเงื่อนไข</p>
            </div>
          )}

          <div className="space-y-2">
            {priceRows.map(pa => <PriceApprovalCard key={String(pa.id)} pa={pa} onDone={load} />)}
          </div>
        </>
      )}
    </div>
  );
}

export default EditRequestsPage;
