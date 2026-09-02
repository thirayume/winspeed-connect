/**
 * สถานะการชั่งรถ — อ่านจาก WINSpeed โดยตรง (`dbo.WGHD` / `dbo.WGDT` / `dbo.WGDTReport`)
 *
 * ══ อ่านอย่างเดียว ═══════════════════════════════════════════════
 *   หน้านี้ไม่มีปุ่มที่เขียนอะไรลงสามตารางนั้นเลย และต้องไม่มีตลอดไป
 *   เครื่องชั่งเป็นผู้เดินสถานะ 1 → 2 → 3 เอง เราอ่านมาแสดงเท่านั้น
 *   (เจ้าของระบบสั่งไว้ 03/09/2569 พร้อมกับยกเลิก MySQL ของ TruckScale ทั้งหมด)
 * ═══════════════════════════════════════════════════════════════════
 *
 * แท็บ "สถานะสด" คือหน้าหลัก — รีเฟรชเองทุก 1 นาทีตามที่เจ้าของระบบกำหนด
 *
 * ทำไมแท็บสถานะสดไม่ผูกกับช่วงวันที่
 *   รถที่ลงทะเบียนเมื่อวานแล้วยังชั่งไม่จบ ต้องยังอยู่ในคิววันนี้
 *   ถ้ากรองด้วยวันที่ รถกลุ่มนี้จะหายไปเงียบ ๆ ซึ่งอันตรายกว่าการแสดงเกิน
 *   จึงแสดง "ทุกคันที่ยังไม่ถึงสถานะ 3" เสมอ บวกกับที่เพิ่งชั่งออกใน 24 ชม.
 *
 * แถบเตือนด้านบนจำเป็น เพราะเจ้าของระบบยืนยันว่าข้อมูลชุดนี้ยังเป็นชุดทดสอบ
 * ผู้ใช้ต้องเห็นว่าที่กำลังดูเชื่อได้แค่ไหน ไม่ใช่คิดว่าโรงงานชั่งน้อยลง
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Truck, RefreshCw, Download, AlertTriangle, FileText, Radio, Pause } from 'lucide-react';
import {
  fetchWeighingReport, fetchWeighCoverage, fetchWeighLive, fetchWeighAnomalies,
  type WeighCoverage, type WeighTally, type WgType,
} from '../../services/api';
import { WeighTicketPrint } from './WeighTicketPrint';

const NAVY = '#0C447C';
const POLL_MS = 60_000;          // เจ้าของระบบกำหนด: อ่านค่ามาแสดงทุกนาที
const KG_PER_SACK = 50;

const num = (v: unknown, d = 0) =>
  Number(v ?? 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
/** ค่าที่ยังไม่มีต้องขึ้นขีด ไม่ใช่ 0 — ศูนย์เป็นน้ำหนักที่ชั่งได้จริงได้เหมือนกัน */
const kg = (v: unknown) => (v == null ? '—' : num(v));

const WGTYPE_LABEL: Record<string, string> = { SO: 'ขายออก', PO: 'ซื้อเข้า', MO: 'ย้ายภายใน' };

/** สีป้ายสถานะ — 1 รอ · 2 กำลังโหลด · 3 จบแล้ว */
const STATUS_STYLE: Record<number, string> = {
  1: 'bg-gray-100 text-gray-700 border-gray-200',
  2: 'bg-amber-50 text-amber-800 border-amber-200',
  3: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

function StatusChip({ status, text }: { status: number | string; text: string }) {
  const n = Number(status);
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${
      STATUS_STYLE[n] ?? 'bg-red-50 text-red-700 border-red-200'}`}>
      {n >= 1 && n <= 3 ? `${n} · ${text}` : text}
    </span>
  );
}

type Col = { key: string; label: string; align?: 'right'; fmt?: (v: unknown, row: any) => any };
type Tab = { key: string; label: string; source: string; live?: boolean; dated?: boolean; cols: Col[] };

const TABS: Tab[] = [
  {
    key: 'live', label: 'สถานะสด', source: 'WGHD', live: true,
    cols: [
      { key: 'Status', label: 'สถานะ', fmt: (v, r) => <StatusChip status={v as number} text={r.StatusText} /> },
      { key: 'WGType', label: 'ประเภท', fmt: v => WGTYPE_LABEL[String(v)] ?? (v ?? '—') },
      { key: 'MoveBill', label: 'เลขที่เที่ยว' },
      { key: 'Plate', label: 'ทะเบียนรถ' },
      { key: 'DriverName', label: 'คนขับ', fmt: v => v || '—' },
      { key: 'PartyName', label: 'ลูกค้า / ผู้ขาย' },
      { key: 'SODocuNo', label: 'ใบสั่งจอง', fmt: v => v || '—' },
      { key: 'DateReg', label: 'ลงทะเบียน' },
      { key: 'WeightIn', label: 'ชั่งเข้า (กก.)', align: 'right', fmt: kg },
      { key: 'WeightOut', label: 'ชั่งออก (กก.)', align: 'right', fmt: kg },
      { key: 'WeightNet', label: 'สุทธิ (กก.)', align: 'right', fmt: kg },
      { key: 'TotalTon', label: 'ตัน', align: 'right', fmt: v => num(v, 2) },
    ],
  },
  {
    key: 'anomalies', label: 'ผิดปกติ', source: 'WGHD',
    cols: [
      { key: 'Issue', label: 'อาการ' },
      { key: 'WGType', label: 'ประเภท', fmt: v => WGTYPE_LABEL[String(v)] ?? (v ?? '—') },
      { key: 'Status', label: 'สถานะ' },
      { key: 'MoveBill', label: 'เลขที่เที่ยว' },
      { key: 'Plate', label: 'ทะเบียนรถ' },
      { key: 'DateReg', label: 'ลงทะเบียน' },
      { key: 'WeightIn', label: 'ชั่งเข้า', align: 'right', fmt: kg },
      { key: 'WeightOut', label: 'ชั่งออก', align: 'right', fmt: kg },
      { key: 'WeightNet', label: 'สุทธิ', align: 'right', fmt: kg },
    ],
  },
  {
    key: 'tickets', label: 'ใบชั่ง', source: 'WGHD', dated: true,
    cols: [
      { key: 'DateReg', label: 'ลงทะเบียน' },
      { key: 'Status', label: 'สถานะ', fmt: (v, r) => <StatusChip status={v as number} text={r.StatusText} /> },
      { key: 'WGType', label: 'ประเภท', fmt: v => WGTYPE_LABEL[String(v)] ?? (v ?? '—') },
      { key: 'MoveBill', label: 'เลขที่เที่ยว' },
      { key: 'SODocuNo', label: 'ใบสั่งจอง', fmt: v => v || '—' },
      { key: 'Plate', label: 'ทะเบียนรถ' },
      { key: 'PartyName', label: 'ลูกค้า / ผู้ขาย' },
      { key: 'WeightIn', label: 'ชั่งเข้า (กก.)', align: 'right', fmt: kg },
      { key: 'WeightOut', label: 'ชั่งออก (กก.)', align: 'right', fmt: kg },
      { key: 'WeightNet', label: 'สุทธิ (กก.)', align: 'right', fmt: kg },
      { key: 'TotalTon', label: 'ตัน', align: 'right', fmt: v => num(v, 2) },
      { key: 'Lines', label: 'รายการ', align: 'right', fmt: v => num(v) },
    ],
  },
  {
    key: 'by-date', label: 'ตามวัน', source: 'WGHD', dated: true,
    cols: [
      { key: 'DateReg', label: 'วันที่' },
      { key: 'Registered', label: 'ลงทะเบียน', align: 'right', fmt: v => num(v) },
      { key: 'WeighedOut', label: 'ชั่งออกแล้ว', align: 'right', fmt: v => num(v) },
      { key: 'NetKg', label: 'น้ำหนักสุทธิ (กก.)', align: 'right', fmt: v => num(v) },
      { key: 'Tons', label: 'ตัน', align: 'right', fmt: v => num(v, 2) },
      { key: 'Kasob', label: 'กระสอบ', align: 'right', fmt: v => num(v) },
    ],
  },
  {
    key: 'by-product', label: 'ตามสินค้า', source: 'WGDT', dated: true,
    cols: [
      { key: 'GoodName', label: 'สินค้า' },
      { key: 'Trips', label: 'จำนวนเที่ยว', align: 'right', fmt: v => num(v) },
      { key: 'Tons', label: 'ตัน', align: 'right', fmt: v => num(v, 2) },
      { key: 'Kasob', label: 'กระสอบ', align: 'right', fmt: v => num(v) },
    ],
  },
  {
    key: 'by-godown', label: 'ตามคลัง', source: 'WGDT + EMSTOType', dated: true,
    cols: [
      { key: 'StoreName', label: 'คลัง' },
      { key: 'StoreCode', label: 'รหัส' },
      { key: 'Trips', label: 'จำนวนเที่ยว', align: 'right', fmt: v => num(v) },
      { key: 'Tons', label: 'ตัน', align: 'right', fmt: v => num(v, 2) },
      { key: 'Kasob', label: 'กระสอบ', align: 'right', fmt: v => num(v) },
    ],
  },
  {
    key: 'by-customer', label: 'ตามลูกค้า/ผู้ขาย', source: 'WGHD', dated: true,
    cols: [
      { key: 'PartyName', label: 'ลูกค้า / ผู้ขาย' },
      { key: 'CVCode', label: 'รหัส' },
      { key: 'WGType', label: 'ประเภท', fmt: v => WGTYPE_LABEL[String(v)] ?? (v ?? '—') },
      { key: 'Trips', label: 'จำนวนเที่ยว', align: 'right', fmt: v => num(v) },
      { key: 'WeighedOut', label: 'ชั่งออกแล้ว', align: 'right', fmt: v => num(v) },
      { key: 'Tons', label: 'ตัน', align: 'right', fmt: v => num(v, 2) },
    ],
  },
  {
    key: 'by-so', label: 'ตามใบสั่งขาย', source: 'WGHD → SOHD (SPID)', dated: true,
    cols: [
      { key: 'DateReg', label: 'ลงทะเบียน' },
      { key: 'Status', label: 'สถานะ', fmt: (v, r) => <StatusChip status={v as number} text={r.StatusText} /> },
      { key: 'BookingNo', label: 'ใบสั่งจอง (103)', fmt: v => v || '—' },
      { key: 'DeliveryNoteNo', label: 'ใบส่งขาย (104)', fmt: v => v || '—' },
      { key: 'AppvDocuNo', label: 'ใบอนุมัติ', fmt: v => v || '—' },
      { key: 'MoveBill', label: 'เลขที่เที่ยว' },
      { key: 'Plate', label: 'ทะเบียนรถ' },
      { key: 'CustName', label: 'ลูกค้า' },
      { key: 'WeightNet', label: 'สุทธิ (กก.)', align: 'right', fmt: kg },
      { key: 'TotalTon', label: 'ตัน', align: 'right', fmt: v => num(v, 2) },
    ],
  },
];

const TYPE_FILTERS: Array<{ key: '' | WgType; label: string }> = [
  { key: '', label: 'ทุกประเภท' },
  { key: 'SO', label: 'ขายออก' },
  { key: 'PO', label: 'ซื้อเข้า' },
  { key: 'MO', label: 'ย้ายภายใน' },
];

export function WeighingReportsPage() {
  const [tab, setTab] = useState('live');
  const [wgType, setWgType] = useState<'' | WgType>('');
  const [from, setFrom] = useState('2026-05-01');
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<any[]>([]);
  const [tally, setTally] = useState<WeighTally | null>(null);
  const [cov, setCov] = useState<WeighCoverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const active = useMemo(() => TABS.find(t => t.key === tab)!, [tab]);

  // ผูก load ไว้กับ ref เพื่อให้ตัวจับเวลาเรียกของล่าสุดเสมอ
  // โดยไม่ต้องตั้งตัวจับเวลาใหม่ทุกครั้งที่ตัวกรองเปลี่ยน (เดิมทำให้รีเฟรชถี่กว่าที่ตั้งไว้)
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      if (active.live) {
        const r = await fetchWeighLive(wgType || undefined);
        setRows(r.rows); setTally(r.tally);
      } else if (active.key === 'anomalies') {
        const r = await fetchWeighAnomalies();
        setRows(r.rows); setTally(null);
      } else {
        const r = await fetchWeighingReport(active.key, from, to, wgType || undefined);
        setRows(r.rows); setTally(null);
      }
      setUpdatedAt(new Date());
    } catch (e: any) {
      setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ');
      setRows([]);
    }
    setLoading(false);
  }, [active, wgType, from, to]);

  loadRef.current = load;
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchWeighCoverage().then(setCov).catch(() => setCov(null)); }, []);

  // อ่านค่ามาแสดงทุก 1 นาที — เฉพาะแท็บสถานะสด และเฉพาะตอนแท็บเบราว์เซอร์ยังเปิดอยู่
  // (หน้าที่ถูกซ่อนไม่ควรยิงคิวรีใส่ฐานผลิตทิ้งไว้ทั้งวัน)
  useEffect(() => {
    if (!active.live || !autoRefresh) return;
    const tick = () => { if (!document.hidden) loadRef.current(); };
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => { if (!document.hidden) loadRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [active.live, autoRefresh]);

  function exportCsv() {
    const head = active.cols.map(c => c.label).join(',');
    const cell = (c: Col, r: any) => {
      const raw = r[c.key];
      // ช่องที่ render เป็น element (ป้ายสถานะ) ต้อง export เป็นข้อความ ไม่ใช่ [object Object]
      if (c.key === 'Status') return `${raw ?? ''} ${r.StatusText ?? ''}`.trim();
      const out = c.fmt ? c.fmt(raw, r) : raw;
      return typeof out === 'object' && out !== null ? String(raw ?? '') : String(out ?? '');
    };
    const body = rows.map(r => active.cols.map(c => `"${cell(c, r).replace(/"/g, '""')}"`).join(',')).join('\n');
    // BOM นำหน้าเพื่อให้ Excel อ่านภาษาไทยถูก
    const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ชั่ง-${active.key}${active.dated ? `-${from}-ถึง-${to}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const showTicketButton = tab === 'live' || tab === 'tickets' || tab === 'anomalies';
  const stale = cov?.LastWeighOut ? (Date.now() - new Date(cov.LastWeighOut.replace(' ', 'T')).getTime()) / 86400000 : null;

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto flex items-center gap-2 text-lg font-bold" style={{ color: NAVY }}>
            <Truck size={20} /> สถานะการชั่งรถ
            <span className="text-xs font-normal text-gray-500">จาก WINSpeed · {active.source} · อ่านอย่างเดียว</span>
          </h1>

          <select value={wgType} onChange={e => setWgType(e.target.value as '' | WgType)}
            className="h-10 rounded-xl border border-gray-200 px-3 text-sm">
            {TYPE_FILTERS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>

          {active.dated && (
            <>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="h-10 rounded-xl border border-gray-200 px-3 text-sm" />
              <span className="text-gray-400">ถึง</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="h-10 rounded-xl border border-gray-200 px-3 text-sm" />
            </>
          )}

          {active.live && (
            <button onClick={() => setAutoRefresh(v => !v)}
              className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold ${
                autoRefresh ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600'}`}
              title={autoRefresh ? 'กำลังอ่านค่าใหม่ทุก 1 นาที' : 'หยุดอ่านค่าอัตโนมัติ'}>
              {autoRefresh ? <Radio size={15} /> : <Pause size={15} />}
              {autoRefresh ? 'สด · ทุก 1 นาที' : 'หยุดชั่วคราว'}
            </button>
          )}

          <button onClick={exportCsv} disabled={!rows.length}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold disabled:opacity-40"
            style={{ color: NAVY }}>
            <Download size={15} /> CSV
          </button>
          <button onClick={load} className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white"
            aria-label="โหลดใหม่">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-lg border px-3.5 py-1.5 text-sm font-semibold transition
                ${tab === t.key ? 'border-transparent text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              style={tab === t.key ? { background: NAVY } : undefined}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* แถบนับตามสถานะ — เห็นคิวทั้งลานได้ในบรรทัดเดียว */}
        {active.live && tally && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: '1 · รอเข้าชั่ง', n: tally.waiting, cls: 'border-gray-200 bg-white text-gray-800' },
              { label: '2 · ชั่งเข้าแล้ว', n: tally.weighedIn, cls: 'border-amber-200 bg-amber-50 text-amber-900' },
              { label: '3 · ชั่งออกแล้ว (24 ชม.)', n: tally.weighedOut, cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
              { label: 'สถานะไม่รู้จัก', n: tally.unknown, cls: 'border-red-200 bg-red-50 text-red-900' },
            ].map(c => (
              <div key={c.label} className={`rounded-xl border px-4 py-3 ${c.cls}`}>
                <div className="text-2xl font-bold tabular-nums">{num(c.n)}</div>
                <div className="text-xs font-medium">{c.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ข้อมูลต้นทางยังเป็นชุดทดสอบ — ต้องบอกตรง ๆ ไม่ให้เอาไปใช้ตัดสินใจ */}
        {cov && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <b>ข้อมูลชุดนี้ยังเป็นชุดทดสอบ ยังใช้ตัดสินใจไม่ได้</b> — มีทั้งหมด {num(cov.Registered)} คัน
              (รอเข้าชั่ง {num(cov.Waiting)} · ชั่งเข้าแล้ว {num(cov.WeighedIn)} · ชั่งออกแล้ว {num(cov.WeighedOut)})
              · ขายออก {num(cov.TypeSO)} · ซื้อเข้า {num(cov.TypePO)} · ย้ายภายใน {num(cov.TypeMO)}
              <div className="mt-0.5 text-amber-800">
                ช่วงข้อมูล {cov.FirstDate} ถึง {cov.LastDate}
                {cov.LastWeighOut && <> · ชั่งออกครั้งล่าสุด {cov.LastWeighOut}
                  {stale != null && stale > 7 && <b> (ผ่านมาแล้ว {num(stale)} วัน)</b>}</>}
                {cov.WithCoupon === 0 && <> · เลขตั๋วคุมยังว่างทั้ง {num(cov.DetailRows)} รายการ</>}
              </div>
            </div>
          </div>
        )}

        {err && <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  {active.cols.map(c => (
                    <th key={c.key} className={`whitespace-nowrap px-3 py-2.5 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                      {c.label}
                    </th>
                  ))}
                  {showTicketButton && <th className="px-3 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.Id ?? r.WeighId ?? i} className="border-t border-gray-100 hover:bg-gray-50">
                    {active.cols.map(c => (
                      <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                        {c.fmt ? c.fmt(r[c.key], r) : (r[c.key] ?? '')}
                      </td>
                    ))}
                    {showTicketButton && (
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => setTicketId(r.Id ?? r.WeighId)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold"
                          style={{ color: NAVY }}>
                          <FileText size={13} /> ใบชั่ง
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {!rows.length && !loading && (
                  <tr><td colSpan={active.cols.length + 1} className="px-3 py-10 text-center text-gray-400">
                    {active.key === 'anomalies' ? 'ไม่พบรายการผิดปกติ' : 'ไม่มีข้อมูล'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-2 text-xs text-gray-500">
          แสดง {num(rows.length)} แถว · แหล่งข้อมูล {active.source} ในฐาน WINSpeed · 1 กระสอบ = {KG_PER_SACK} กก.
          {updatedAt && <> · อ่านค่าล่าสุด {updatedAt.toLocaleTimeString('th-TH')}</>}
        </p>
      </div>

      {ticketId != null && <WeighTicketPrint id={ticketId} onClose={() => setTicketId(null)} />}
    </div>
  );
}
