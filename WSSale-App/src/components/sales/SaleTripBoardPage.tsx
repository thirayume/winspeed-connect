/**
 * กระดาน Sale Trip — หน้าจอหลักของ Document Flow (เฟส 4)
 *
 * ทำไมต้องเป็น "กระดาน" ไม่ใช่ตาราง
 *   หน่วยงานจริงไม่ได้ทำงานทีละใบจอง แต่ทำงานทีละ **คันรถ**
 *   คนจัดเที่ยวต้องเห็นพร้อมกันว่า รถคันนี้บรรทุกให้ใครบ้าง กี่ใบจอง กี่ตัน
 *   เต็มคันหรือยัง และตอนนี้รถอยู่ขั้นไหนแล้ว ตารางแบนราบตอบไม่ได้
 *   จึงจัดเป็นลำดับชั้น เที่ยวรถ → ลูกค้า → ใบจอง (เล่ม I/K) → รายการสินค้า
 *   ตรงตามผังที่ตกลงกันไว้
 *
 * สถานะรถอ่านจาก dbo.WGHD เท่านั้น
 *   1 = ลงทะเบียน · 2 = กำลังโหลด · 3 = ชั่งออกแล้ว
 *   ทั้งหน้าเป็นการอ่านอย่างเดียว ไม่มีปุ่มไหนเขียนกลับไปที่ WINSpeed
 *
 * ⚠ ใบจองที่ยืนยันแล้วไม่ได้อยู่ที่ wf.SalesOrder อีกต่อไป
 *   sp_ConfirmSalesOrder ลบแถวร่างทิ้งหลังยืนยัน ตัวที่เหลือคือ wf.SalesOrderExt
 *   backend รวมสองฝั่งให้แล้วผ่าน wf.v_TripMember หน้านี้จึงไม่ต้องรู้เรื่องนี้
 *   แต่ถ้าเห็นเที่ยวที่ "ใบจอง 0" ทั้งที่ควรมี ให้สงสัยตรงนั้นก่อน
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Truck, RefreshCw, Search, ChevronRight, ChevronDown, AlertTriangle,
  Package, Gift, Layers, ClipboardList, Ticket, X, Info, CircleAlert,
} from 'lucide-react';
import {
  fetchTripBoard, fetchLoadingPlan,
  type TripBoardRow, type TripBooking, type TripLine, type LoadingPlan,
} from '../../services/api';

const NAVY = '#0C447C';

const ton = (v: unknown) =>
  Number(v ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const thDate = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** สีของแต่ละขั้นในสายงาน ให้กวาดตาทั้งกระดานแล้วรู้ทันทีว่าคันไหนติดอยู่ตรงไหน */
const PHASE_STYLE: Record<string, string> = {
  PLANNED:    'bg-gray-100 text-gray-700 border-gray-300',
  REGISTERED: 'bg-sky-50 text-sky-800 border-sky-300',
  LOADING:    'bg-amber-50 text-amber-900 border-amber-300',
  PARTIAL:    'bg-orange-50 text-orange-900 border-orange-300',
  SHIPPED:    'bg-emerald-50 text-emerald-800 border-emerald-300',
};

/** เล่มเอกสาร — I และ K แยกสีกัน เพราะเป็นคนละสายเลขที่และคนละเส้นทางใบกำกับ */
const prefixClass = (p?: string | null) =>
  p === 'K' ? 'bg-violet-50 text-violet-800 border-violet-200'
            : 'bg-blue-50 text-blue-800 border-blue-200';

function CapacityBar({ cap }: { cap: TripBoardRow['capacity'] }) {
  if (!cap.capacityTon) {
    return <span className="text-xs text-gray-400">ยังไม่ระบุความจุรถ</span>;
  }
  const pct = Math.min(Number(cap.usedPct ?? 0), 100);
  // เส้นประคือความจุป้าย ส่วนแถบยืดได้ถึงเพดาน +5% ที่ตกลงกันไว้
  const nominalMark = cap.maxTon > 0 ? (cap.capacityTon / cap.maxTon) * 100 : 100;
  return (
    <div className="min-w-[210px]">
      <div className="relative h-2.5 w-full rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${cap.over ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
        <div className="absolute inset-y-0 w-px bg-gray-500/70" style={{ left: `${nominalMark}%` }} />
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] leading-none">
        <span className={cap.over ? 'font-semibold text-red-600' : 'text-gray-600'}>
          {ton(cap.plannedTon)} / {ton(cap.maxTon)} ตัน
        </span>
        <span className="text-gray-400">
          (ป้าย {ton(cap.capacityTon)} +{cap.tolerancePct}%)
        </span>
        {cap.over && (
          <span className="inline-flex items-center gap-1 font-semibold text-red-600">
            <AlertTriangle size={11} /> เกินความจุ
          </span>
        )}
      </div>
    </div>
  );
}

function LineRow({ l }: { l: TripLine }) {
  const split = Number(l.masterQty ?? 0) > 0 || Number(l.childQty ?? 0) > 0;
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50/60">
      <td className="px-2 py-1.5 text-center text-gray-400 tabular-nums">
        {l.loadSequence ?? '—'}
      </td>
      <td className="px-2 py-1.5 font-mono text-[11px] text-gray-600">{l.goodCode || '—'}</td>
      <td className="px-2 py-1.5">
        <span className="text-gray-800">{l.goodName || '—'}</span>
        <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
          {!!l.isGiveaway && (
            <span className="inline-flex items-center gap-0.5 rounded border border-pink-200 bg-pink-50 px-1 py-px text-[10px] text-pink-700">
              <Gift size={9} /> ของแถม
            </span>
          )}
          {split && (
            <span className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1 py-px text-[10px] text-indigo-700">
              <Layers size={9} /> แม่ {ton(l.masterQty)} / ลูก {ton(l.childQty)}
            </span>
          )}
          {l.refControlTicketNo && (
            <span className="inline-flex items-center gap-0.5 rounded border border-teal-200 bg-teal-50 px-1 py-px text-[10px] text-teal-700">
              <Ticket size={9} /> {l.refControlTicketNo}
            </span>
          )}
        </span>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-gray-800">{ton(l.qtyTon)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
        {l.qtyBag ? Number(l.qtyBag).toLocaleString('th-TH') : '—'}
      </td>
    </tr>
  );
}

function BookingBlock({ b }: { b: TripBooking }) {
  const [open, setOpen] = useState(false);
  const weighStatus = b.weighing.length
    ? Math.max(...b.weighing.map(w => Number(w.status) || 0))
    : 0;
  const weighLabel = ['ยังไม่เข้าชั่ง', 'ลงทะเบียน', 'กำลังโหลด', 'ชั่งออกแล้ว'][weighStatus] || '—';

  return (
    <div className="rounded-md border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-gray-50"
      >
        {open ? <ChevronDown size={13} className="text-gray-400" />
              : <ChevronRight size={13} className="text-gray-400" />}
        <span className={`rounded border px-1.5 py-px text-[10px] font-semibold ${prefixClass(b.soPrefix)}`}>
          เล่ม {b.soPrefix || '?'}
        </span>
        <span className="font-mono text-xs font-medium text-gray-800">{b.docuNo || '(ยังไม่มีเลขที่)'}</span>
        {b.memberKind === 'DRAFT' && (
          <span className="rounded border border-gray-300 bg-gray-50 px-1.5 py-px text-[10px] text-gray-600">
            ฉบับร่าง
          </span>
        )}
        {b.status === 'PENDING_APPROVAL' && (
          <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] text-amber-800">
            รออนุมัติ
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-gray-500">
          <span className="tabular-nums">{ton(b.totalTon)} ตัน</span>
          <span>{b.lines.length} รายการ</span>
          <span className={weighStatus === 3 ? 'text-emerald-700' : weighStatus ? 'text-amber-700' : 'text-gray-400'}>
            {weighLabel}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-2.5 pb-2 pt-1">
          {b.lines.length === 0 ? (
            <p className="py-2 text-xs text-gray-400">ไม่มีรายการสินค้าในใบจองนี้</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-gray-400">
                  <th className="px-2 py-1 text-center font-medium">ลำดับขึ้น</th>
                  <th className="px-2 py-1 text-left font-medium">รหัส</th>
                  <th className="px-2 py-1 text-left font-medium">สินค้า</th>
                  <th className="px-2 py-1 text-right font-medium">ตัน</th>
                  <th className="px-2 py-1 text-right font-medium">กระสอบ</th>
                </tr>
              </thead>
              <tbody>{b.lines.map(l => <LineRow key={`${l.memberId}-${l.listNo}`} l={l} />)}</tbody>
            </table>
          )}

          {b.weighing.length > 0 && (
            <div className="mt-2 rounded border border-gray-100 bg-gray-50/70 px-2 py-1.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                ใบชั่งจาก WINSpeed (dbo.WGHD)
              </p>
              {b.weighing.map(w => (
                <div key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
                  <span className="font-mono">{w.docuNo || w.moveBill || `#${w.id}`}</span>
                  <span>ทะเบียน {w.carNo || '—'}</span>
                  <span>สถานะ {w.status}</span>
                  <span className="tabular-nums">
                    เข้า {ton(w.weightIn)} · ออก {ton(w.weightOut)} · สุทธิ {ton(w.weightNet)} กก.
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingPlanPanel({ tripId, onClose }: { tripId: number | string; onClose: () => void }) {
  const [data, setData] = useState<LoadingPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchLoadingPlan(tripId)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setErr(e?.message || 'โหลดผังการจัดของไม่สำเร็จ'); });
    return () => { alive = false; };
  }, [tripId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
          <ClipboardList size={16} style={{ color: NAVY }} />
          <h3 className="font-semibold" style={{ color: NAVY }}>ผังการจัดของ</h3>
          {data && (
            <span className="text-sm text-gray-500">
              {data.trip.tripCode} · {data.trip.transRegistration || '—'}
            </span>
          )}
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 hover:bg-gray-100">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="px-4 py-3">
          {err && <p className="text-sm text-red-600">{err}</p>}
          {!data && !err && <p className="text-sm text-gray-400">กำลังโหลด…</p>}

          {data && (
            <>
              {data.alerts.length > 0 && (
                <div className="mb-3 space-y-1">
                  {data.alerts.map((a, i) => {
                    const style = a.level === 'error' ? 'border-red-200 bg-red-50 text-red-800'
                      : a.level === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : 'border-sky-200 bg-sky-50 text-sky-900';
                    const Icon = a.level === 'info' ? Info : a.level === 'warn' ? AlertTriangle : CircleAlert;
                    return (
                      <div key={i} className={`flex items-start gap-2 rounded border px-2.5 py-1.5 text-xs ${style}`}>
                        <Icon size={13} className="mt-px shrink-0" />
                        <span>{a.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                <span>รวม <b className={data.totals.over ? 'text-red-600' : ''}>{ton(data.totals.totalTon)}</b> ตัน</span>
                <span>ความจุสูงสุด {ton(data.totals.maxTon)} ตัน</span>
                <span>{data.totals.lineCount} รายการ</span>
              </div>

              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-400">
                    <th className="px-2 py-1.5 text-center font-medium">ขั้นที่</th>
                    <th className="px-2 py-1.5 text-left font-medium">ใบจอง</th>
                    <th className="px-2 py-1.5 text-left font-medium">ลูกค้า</th>
                    <th className="px-2 py-1.5 text-left font-medium">สินค้า</th>
                    <th className="px-2 py-1.5 text-right font-medium">ตัน</th>
                  </tr>
                </thead>
                <tbody>
                  {data.plan.map(r => (
                    <tr key={`${r.memberId}-${r.listNo}`} className="border-b border-gray-100">
                      <td className="px-2 py-1.5 text-center">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-700">
                          {r.step}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`mr-1 rounded border px-1 py-px text-[10px] ${prefixClass(r.soPrefix)}`}>
                          {r.soPrefix || '?'}
                        </span>
                        <span className="font-mono text-[11px]">{r.docuNo || '—'}</span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-600">{r.custName || '—'}</td>
                      <td className="px-2 py-1.5">
                        {r.goodName || r.goodCode || '—'}
                        {!!r.isGiveaway && (
                          <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-pink-200 bg-pink-50 px-1 text-[10px] text-pink-700">
                            <Gift size={9} /> ของแถม
                          </span>
                        )}
                        {r.split && (
                          <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1 text-[10px] text-indigo-700">
                            <Layers size={9} /> แม่ {ton(r.split.masterQty)} / ลูก {ton(r.split.childQty)}
                          </span>
                        )}
                        {r.preSling && (
                          <span className="ml-1 rounded border border-orange-200 bg-orange-50 px-1 text-[10px] text-orange-800">
                            Pre-Sling
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{ton(r.qtyTon)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {data.plan.length === 0 && (
                <p className="py-4 text-center text-sm text-gray-400">ยังไม่มีรายการสินค้าในเที่ยวนี้</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TripCard({ t }: { t: TripBoardRow }) {
  const [open, setOpen] = useState(false);
  const [planFor, setPlanFor] = useState<number | string | null>(null);
  const phase = PHASE_STYLE[t.weighing.phase] || PHASE_STYLE.PLANNED;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 text-left"
        >
          {open ? <ChevronDown size={15} className="text-gray-400" />
                : <ChevronRight size={15} className="text-gray-400" />}
          <Truck size={16} style={{ color: NAVY }} />
          <span className="font-semibold" style={{ color: NAVY }}>{t.tripCode}</span>
        </button>

        <span className="font-mono text-sm text-gray-700">{t.transRegistration || '—'}</span>
        {t.driverName && <span className="text-xs text-gray-500">{t.driverName}</span>}

        <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${phase}`}>
          {t.weighing.label}
        </span>

        {!!t.preSlingRequired && (
          <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-800">
            Pre-Sling
          </span>
        )}

        <span className="text-xs text-gray-500">
          กำหนดรับ {thDate(t.pickupDueDate)}
        </span>

        <span className="text-xs text-gray-500">
          {t.customers.length} ลูกค้า · {t.orderCount} ใบจอง
        </span>

        <div className="ml-auto flex items-center gap-3">
          <CapacityBar cap={t.capacity} />
          <button
            type="button"
            onClick={() => setPlanFor(t.tripId)}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            <ClipboardList size={13} /> ผังการจัดของ
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-gray-100 bg-gray-50/50 px-3 py-2.5">
          {t.tripRemark && (
            <p className="text-xs text-gray-600">หมายเหตุเที่ยว: {t.tripRemark}</p>
          )}
          {t.customers.length === 0 ? (
            <p className="py-2 text-xs text-gray-400">
              เที่ยวนี้ยังไม่มีใบจองผูกอยู่
            </p>
          ) : (
            t.customers.map(c => (
              <div key={c.custId || 'none'}>
                <div className="mb-1 flex items-center gap-2">
                  <Package size={13} className="text-gray-400" />
                  <span className="text-xs font-semibold text-gray-700">{c.custName || '(ไม่ระบุชื่อ)'}</span>
                  <span className="font-mono text-[10px] text-gray-400">{c.custId}</span>
                  <span className="text-[11px] text-gray-400">
                    {c.bookings.length} ใบจอง ·{' '}
                    {ton(c.bookings.reduce((s, b) => s + Number(b.totalTon || 0), 0))} ตัน
                  </span>
                </div>
                <div className="space-y-1.5 pl-5">
                  {c.bookings.map(b => <BookingBlock key={`${b.memberKind}-${b.memberId}`} b={b} />)}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {planFor !== null && <LoadingPlanPanel tripId={planFor} onClose={() => setPlanFor(null)} />}
    </div>
  );
}

export function SaleTripBoardPage() {
  const [rows, setRows] = useState<TripBoardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetchTripBoard(q ? { search: q } : undefined);
      setRows(r.data || []);
    } catch (e: any) {
      setErr(e?.message || 'โหลดกระดานไม่สำเร็จ');
    }
    setLoading(false);
  }, [q]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(
    () => (phaseFilter ? rows.filter(r => r.weighing.phase === phaseFilter) : rows),
    [rows, phaseFilter],
  );

  const tally = useMemo(() => {
    const t = { total: rows.length, over: 0, loading: 0, shipped: 0, ton: 0 };
    for (const r of rows) {
      if (r.capacity.over) t.over++;
      if (r.weighing.phase === 'LOADING') t.loading++;
      if (r.weighing.phase === 'SHIPPED') t.shipped++;
      t.ton += Number(r.capacity.plannedTon || 0);
    }
    return t;
  }, [rows]);

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: NAVY }}>
          <Truck size={19} /> กระดาน Sale Trip
        </h2>
        <span className="text-xs text-gray-500">
          {tally.total} เที่ยว · {ton(tally.ton)} ตัน · กำลังโหลด {tally.loading} · ชั่งออกแล้ว {tally.shipped}
          {tally.over > 0 && (
            <span className="ml-2 font-semibold text-red-600">เกินความจุ {tally.over} เที่ยว</span>
          )}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') load(); }}
              placeholder="ค้นหาเลขเที่ยว / ทะเบียน / คนขับ"
              className="w-64 rounded border border-gray-300 py-1 pl-7 pr-2 text-xs focus:outline-none focus:ring-1"
            />
          </div>
          <select
            value={phaseFilter}
            onChange={e => setPhaseFilter(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="">ทุกสถานะ</option>
            <option value="PLANNED">ยังไม่เข้าชั่ง</option>
            <option value="REGISTERED">รถลงทะเบียนแล้ว</option>
            <option value="LOADING">กำลังโหลดสินค้า</option>
            <option value="PARTIAL">ชั่งออกบางส่วน</option>
            <option value="SHIPPED">ชั่งออกครบทุกใบ</option>
          </select>
          <button
            type="button"
            onClick={load}
            disabled={loading}
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

      {!loading && shown.length === 0 && !err && (
        <div className="rounded border border-dashed border-gray-300 bg-white px-4 py-10 text-center">
          <Truck size={26} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-500">ยังไม่มีเที่ยวรถที่ตรงกับเงื่อนไข</p>
        </div>
      )}

      <div className="space-y-2">
        {shown.map(t => <TripCard key={String(t.tripId)} t={t} />)}
      </div>
    </div>
  );
}

export default SaleTripBoardPage;
