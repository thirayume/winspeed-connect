import { useEffect, useState, useCallback } from 'react';
import { Scale, RefreshCw, AlertTriangle, CheckCircle, ShieldCheck, FileCheck2, Info } from 'lucide-react';
import {
  fetchReconCases, fetchReconSummary, resolveReconCase,
  type ReconCase, type ReconSummary, type ReconCheck,
} from '../../services/api';
import { useSocketEvent } from '../../hooks/useSocket';

const WEIGH_LABEL: Record<ReconCase['weigh'], string> = {
  MATCHED: 'ตรงกัน', VARIANCE: 'น้ำหนักต่าง', NO_WEIGH: 'ไม่มีตั๋วชั่ง',
  UNLINKED: 'ไม่ผูก movebill', TS_NOT_FOUND: 'ไม่พบใน TruckScale', TS_UNAVAILABLE: 'TruckScale ไม่พร้อม',
};
const INVOICE_LABEL: Record<ReconCase['invoice'], string> = { MATCHED: 'มีใบกำกับ', PENDING: 'รอใบกำกับ' };

function badge(kind: 'ok' | 'warn' | 'exc' | 'muted' | 'resolved') {
  return {
    ok: 'bg-green-100 text-green-700',
    warn: 'bg-amber-100 text-amber-700',
    exc: 'bg-red-100 text-red-600',
    muted: 'bg-gray-100 text-gray-500',
    resolved: 'bg-blue-100 text-blue-700',
  }[kind];
}
function weighKind(s: ReconCase['weigh']) {
  if (s === 'MATCHED') return 'ok';
  if (s === 'VARIANCE' || s === 'TS_NOT_FOUND' || s === 'NO_WEIGH') return 'exc';
  return 'muted';
}

export function ReconciliationPage() {
  const [cases, setCases]     = useState<ReconCase[]>([]);
  const [summary, setSummary] = useState<ReconSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays]       = useState(7);
  const [filter, setFilter]   = useState<'' | 'EXCEPTION' | 'RESOLVED' | 'OK'>('');
  const [busy, setBusy]       = useState<string | null>(null);

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
    const note = prompt(`บันทึกเหตุผลการ${verb} — ${c.wfRef || c.soId} (${checkType === 'WEIGH' ? 'น้ำหนัก' : 'ใบกำกับ'}):`);
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
            <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> กระทบยอด (Reconciliation)
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">ออกของ ↔ ใบกำกับ Winspeed ↔ น้ำหนัก TruckScale · FR-027</p>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C] flex-1 sm:flex-none">
            <option value={7}>7 วันล่าสุด</option><option value={14}>14 วัน</option><option value={30}>30 วัน</option>
          </select>
          <button onClick={() => load(days, filter)} className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        {summary && !summary.tsAvailable && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-sm text-amber-700">
            <Info size={18} className="mt-0.5 shrink-0" /> TruckScale (MySQL) ไม่พร้อมใช้งาน — การกระทบยอดน้ำหนักจะแสดงเป็น "ไม่พร้อม" จนกว่าจะเชื่อมต่อได้
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {card(<Scale size={20} />, 'ออกของทั้งหมด', summary?.total ?? '–', 'bg-blue-50 text-blue-600')}
          {card(<AlertTriangle size={20} />, 'ต้องตรวจ (Exception)', summary?.exception ?? '–', 'bg-red-50 text-red-500')}
          {card(<CheckCircle size={20} />, 'ปกติ (OK)', summary?.ok ?? '–', 'bg-green-50 text-green-600')}
          {card(<FileCheck2 size={20} />, 'จัดการแล้ว', summary?.resolved ?? '–', 'bg-blue-50 text-blue-600')}
        </div>

        <div className="flex flex-wrap gap-2">
          {([['', 'ทั้งหมด'], ['EXCEPTION', 'ต้องตรวจ'], ['RESOLVED', 'จัดการแล้ว'], ['OK', 'ปกติ']] as const).map(([v, l]) => (
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
                <th className="text-left px-4 py-3 whitespace-nowrap">ใบกำกับ Winspeed</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 whitespace-nowrap">กำลังโหลด…</td></tr>}
              {!loading && cases.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 whitespace-nowrap">ไม่พบรายการ</td></tr>}
              {!loading && cases.map(c => (
                <tr key={c.soId} className={c.overall === 'EXCEPTION' ? 'bg-red-50/40' : ''}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="font-semibold text-gray-800">{c.wfRef || c.soId}</div>
                    <div className="text-xs text-gray-400">{c.shipDate}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-gray-700">{c.custName}</div>
                    <div className="text-xs text-gray-400">{c.truckPlate || '–'} · movebill {c.movebill || '–'}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${badge(weighKind(c.weigh) as 'ok' | 'exc' | 'muted')}`}>{WEIGH_LABEL[c.weigh]}</span>
                    <div className="text-xs text-gray-500 mt-1">
                      {c.netApp != null ? `${c.netApp.toLocaleString()} kg` : '–'}
                      {c.netTs != null && <> ↔ {c.netTs.toLocaleString()} kg</>}
                      {c.variance != null && c.variance !== 0 && <span className={Math.abs(c.variance) > 50 ? 'text-red-500 font-semibold' : 'text-gray-400'}> ({c.variance > 0 ? '+' : ''}{c.variance})</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${badge(c.invoice === 'MATCHED' ? 'ok' : 'exc')}`}>{INVOICE_LABEL[c.invoice]}</span>
                    {c.wsInvoiceNo && <div className="text-xs text-gray-400 mt-1">{c.wsInvoiceNo}</div>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex flex-col items-end gap-1.5">
                      {(['VARIANCE', 'TS_NOT_FOUND', 'NO_WEIGH'].includes(c.weigh) || c.weighResolution) &&
                        <div className="flex items-center gap-1"><span className="text-[10px] text-gray-400">น้ำหนัก</span><ResolveBtns c={c} type="WEIGH" info={c.weighResolution} /></div>}
                      {(c.invoice === 'PENDING' || c.invoiceResolution) &&
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
      </div>
    </div>
  );
}
