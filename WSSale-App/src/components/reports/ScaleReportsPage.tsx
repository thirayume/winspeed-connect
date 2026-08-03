/**
 * ScaleReportsPage.tsx — รายงานเครื่องชั่งบนเว็บ (T6-02)
 *
 * แทนการเปิดโปรแกรม Crystal Reports เดิม 4 ฉบับที่ฝ่ายบัญชีและคลังใช้บ่อยที่สุด
 * ทุกฉบับใช้ช่วงวันที่ร่วมกัน สลับแท็บแล้วไม่ต้องเลือกวันใหม่
 *
 * ค่าเริ่มต้นคือ 30 วันล่าสุด เพราะ tblscale มีสี่แสนแถว การเปิดทั้งตารางโดยไม่ตั้งใจ
 * จะกินเวลาและรบกวนฐานของโรงงาน
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, RefreshCw, Download, CalendarDays } from 'lucide-react';
import { fetchScaleReport } from '../../services/api';

const NAVY = '#0C447C';
const num = (v: unknown, digits = 0) =>
  Number(v ?? 0).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });

type Col = { key: string; label: string; align?: 'right'; fmt?: (v: unknown, row: any) => string };

const DETAIL_COLS: Col[] = [
  { key: 'DateOut', label: 'วันที่' },
  { key: 'Movebill', label: 'เลขที่เที่ยว' },
  { key: 'Sequence', label: 'เลขใบชั่ง' },
  { key: 'Plate', label: 'ทะเบียนรถ' },
  { key: 'CustName', label: 'ลูกค้า' },
  { key: 'Formula', label: 'สูตรปุ๋ย' },
  { key: 'Godown', label: 'คลัง' },
  { key: 'Tons', label: 'ตัน', align: 'right', fmt: v => num(v, 3) },
  { key: 'Bags', label: 'ถุง', align: 'right', fmt: v => num(v) },
];

type Tab = { key: string; label: string; legacy: string; cols: Col[]; filterParam?: string; filterLabel?: string };

const TABS: Tab[] = [
  {
    key: 'by-date', label: 'ตามวัน', legacy: 'Report_ByDate',
    cols: [
      { key: 'DateOut', label: 'วันที่ชั่งออก' },
      { key: 'Trips', label: 'จำนวนเที่ยว', align: 'right', fmt: v => num(v) },
      { key: 'NetKg', label: 'น้ำหนักสุทธิ (ตัน)', align: 'right', fmt: v => num(Number(v) / 1000, 3) },
      { key: 'FromApp', label: 'มาจากแอป', align: 'right', fmt: v => num(v) },
    ],
  },
  {
    key: 'by-product', label: 'ตามสูตรปุ๋ย', legacy: 'Report_ByProductGroup',
    cols: [
      { key: 'Formula', label: 'สูตรปุ๋ย' },
      { key: 'Trips', label: 'จำนวนเที่ยว', align: 'right', fmt: v => num(v) },
      { key: 'Tons', label: 'น้ำหนัก (ตัน)', align: 'right', fmt: v => num(v, 3) },
      { key: 'Bags', label: 'จำนวนถุง', align: 'right', fmt: v => num(v) },
    ],
  },
  {
    key: 'by-movebill', label: 'ตามเที่ยว', legacy: 'ReportByMoveBillGroup',
    cols: [
      { key: 'DateOut', label: 'วันที่' },
      { key: 'Movebill', label: 'เลขที่เที่ยว' },
      { key: 'Sequence', label: 'เลขใบชั่ง' },
      { key: 'Plate', label: 'ทะเบียนรถ' },
      { key: 'CustName', label: 'ลูกค้า' },
      { key: 'NetKg', label: 'สุทธิ (ตัน)', align: 'right', fmt: v => num(Number(v) / 1000, 3) },
      { key: 'ProductLines', label: 'รายการย่อย', align: 'right', fmt: v => num(v) },
    ],
  },
  {
    key: 'by-godown', label: 'ตามคลัง', legacy: 'Report_ByGodownGroup',
    cols: [
      { key: 'Godown', label: 'คลัง / โกดัง' },
      { key: 'GodownCode', label: 'รหัส' },
      { key: 'Trips', label: 'จำนวนเที่ยว', align: 'right', fmt: v => num(v) },
      { key: 'Tons', label: 'น้ำหนัก (ตัน)', align: 'right', fmt: v => num(v, 3) },
    ],
  },
  {
    key: 'by-customer', label: 'ตามลูกค้า', legacy: 'Report_ByCustomerGroup',
    cols: [
      { key: 'CustName', label: 'ลูกค้า' },
      { key: 'Trips', label: 'จำนวนเที่ยว', align: 'right', fmt: v => num(v) },
      { key: 'NetKg', label: 'น้ำหนักสุทธิ (ตัน)', align: 'right', fmt: v => num(Number(v) / 1000, 3) },
    ],
  },
  // ระดับแจกแจง — ยอดรวมบอกว่าเท่าไร แต่ตอนตรวจสอบต้องเห็นว่ามาจากเที่ยวไหน
  ...(['detail-by-date', 'detail-by-product', 'detail-by-godown', 'detail-by-customer'] as const).map((key, i) => ({
    key,
    label: ['แจกแจงตามวัน', 'แจกแจงตามสูตร', 'แจกแจงตามคลัง', 'แจกแจงตามลูกค้า'][i],
    legacy: ['Report_ByDateDetail', 'Report_ByProductDetail', 'Report_ByGodownDetail', 'Report_ByCustomerDetail'][i],
    filterParam: [undefined, 'formula', 'godown', 'customer'][i],
    filterLabel: [undefined, 'กรองสูตรปุ๋ย', 'กรองคลัง', 'กรองลูกค้า'][i],
    cols: DETAIL_COLS,
  })),
];

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export function ScaleReportsPage() {
  const [tab, setTab] = useState(TABS[0].key);
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const active = useMemo(() => TABS.find(t => t.key === tab)!, [tab]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetchScaleReport(tab, from, to, active.filterParam, filter.trim());
      setRows(r.rows || []);
    } catch (e) {
      setErr((e as Error).message || 'โหลดรายงานไม่สำเร็จ');
      setRows([]);
    }
    setLoading(false);
  }, [tab, from, to, active.filterParam, filter]);

  useEffect(() => { load(); }, [load]);

  // ส่งออกเป็น CSV เพื่อให้บัญชีทำต่อใน Excel ได้เหมือนที่เคยทำจากโปรแกรมเดิม
  function exportCsv() {
    const head = active.cols.map(c => c.label).join(',');
    const body = rows.map(r => active.cols
      .map(c => `"${String(c.fmt ? c.fmt(r[c.key], r) : (r[c.key] ?? '')).replace(/"/g, '""')}"`)
      .join(',')).join('\n');
    const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${active.key}-${from}-ถึง-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ยอดรวมท้ายตาราง — ผู้ใช้เดิมคุ้นกับการเห็นยอดรวมในรายงานกระดาษ
  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of active.cols) {
      if (c.align !== 'right') continue;
      out[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    }
    return out;
  }, [rows, active]);

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2" style={{ color: NAVY }}>
              <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> รายงานเครื่องชั่ง
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              แทนรายงานเดิม · {active.legacy}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5">
              <CalendarDays size={15} className="text-gray-400 shrink-0" />
              <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
                className="bg-transparent text-sm outline-none w-[8.5rem]" aria-label="ตั้งแต่วันที่" />
              <span className="text-gray-400 text-sm">–</span>
              <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
                className="bg-transparent text-sm outline-none w-[8.5rem]" aria-label="ถึงวันที่" />
            </div>
            {active.filterParam && (
              <input value={filter} onChange={e => setFilter(e.target.value)}
                placeholder={active.filterLabel}
                className="h-10 border border-gray-200 rounded-xl px-3 text-sm w-44" />
            )}
            <button onClick={exportCsv} disabled={!rows.length}
              className="h-10 inline-flex items-center gap-1.5 px-3 rounded-xl border border-gray-200 bg-white text-sm font-semibold disabled:opacity-40"
              style={{ color: NAVY }}>
              <Download size={15} /> CSV
            </button>
            <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white"
              aria-label="โหลดใหม่">
              <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
            </button>
          </div>
        </div>

        <div className="flex gap-1.5 mt-3 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setFilter(''); }}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap border transition
                ${tab === t.key ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              style={tab === t.key ? { background: NAVY } : undefined}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {err && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-3 mb-3">{err}</p>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  {active.cols.map(c => (
                    <th key={c.key} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={active.cols.length} className="px-3 py-10 text-center text-gray-400">กำลังโหลด…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={active.cols.length} className="px-3 py-10 text-center text-gray-400">
                    ไม่พบข้อมูลในช่วงวันที่ที่เลือก
                  </td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i} className="border-t border-gray-100 hover:bg-blue-50/30">
                    {active.cols.map(c => (
                      <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                        {c.fmt ? c.fmt(r[c.key], r) : (r[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                    {active.cols.map((c, i) => (
                      <td key={c.key} className={`px-3 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                        {i === 0 ? `รวม ${rows.length} รายการ`
                          : c.align === 'right'
                            ? (c.key === 'NetKg' ? num(totals[c.key] / 1000, 3) : num(totals[c.key], c.key === 'Tons' ? 3 : 0))
                            : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <p className="text-[11px] text-gray-400 mt-2">
          นับเฉพาะใบที่ชั่งออกเสร็จแล้ว · แสดงสูงสุด 500 รายการต่อครั้ง · ข้อมูลจากฐานเครื่องชั่งโดยตรง (อ่านอย่างเดียว)
        </p>
      </div>
    </div>
  );
}
