import { useEffect, useState, useCallback } from 'react';
import { BarChart3, RefreshCw, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { fetchReportTypes, fetchReport, exportReport } from '../../services/api';
import type { ReportData } from '../../services/api';

const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)));
const fmt = (v: unknown) => isNum(v) ? Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 }) : (v ?? '-');

export function ReportsPage() {
  const [types, setTypes] = useState<{ key: string; title: string }[]>([]);
  const [active, setActive] = useState<string>('');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchReportTypes().then(t => { setTypes(t); if (t[0]) setActive(t[0].key); }).catch(console.error);
  }, []);

  const load = useCallback(async (type: string) => {
    if (!type) return;
    setLoading(true);
    try { setData(await fetchReport(type)); } catch (e) { console.error(e); setData(null); }
    setLoading(false);
  }, []);
  useEffect(() => { load(active); }, [active, load]);

  async function doExport() {
    if (!active) return;
    setExporting(true);
    try { await exportReport(active); } catch (e) { alert((e as Error).message); }
    setExporting(false);
  }

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}><BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> รายงาน (Reports)</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">สรุปข้อมูล + ส่งออก Excel (FR-017)</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => {}} disabled={!data || exporting}
            className="px-3 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50" style={{ background: '#E53935' }}>
            <FileText size={16} /> Export PDF
          </button>
          <button onClick={doExport} disabled={!data || exporting}
            className="px-3 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50" style={{ background: '#3B6D11' }}>
            <Download size={16} /> Export Excel
          </button>
          <button onClick={() => load(active)} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white"><RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
        {/* report list (Mobile Dropdown) */}
        <div className="md:hidden p-3 bg-white border-b border-gray-200 shrink-0">
          <select 
            value={active} 
            onChange={(e) => setActive(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 text-gray-700 rounded-xl px-4 py-3 font-medium outline-none focus:ring-2 focus:ring-[#0C447C]"
          >
            {types.map(t => <option key={t.key} value={t.key}>{t.title}</option>)}
          </select>
        </div>

        {/* report list (Desktop Sidebar) */}
        <div className="hidden md:block w-64 border-r border-gray-200 bg-white/60 overflow-y-auto p-3 space-y-1 shrink-0">
          {types.map(t => (
            <button key={t.key} onClick={() => setActive(t.key)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors ${active === t.key ? 'bg-[#0C447C] text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              <FileSpreadsheet size={15} /> {t.title}
            </button>
          ))}
        </div>

        {/* report table */}
        <div className="flex-1 overflow-auto p-0 sm:p-6">
          {loading ? (
            <div className="py-20 flex justify-center"><RefreshCw size={28} className="animate-spin text-gray-300" /></div>
          ) : !data ? (
            <p className="py-12 text-center text-sm text-gray-400">เลือกรายงาน</p>
          ) : (
            <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-700">{data.title}</h2>
                <span className="text-xs text-gray-400">{data.rows.length} แถว</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-full">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                    <tr>{data.columns.map(c => <th key={c.key} className={`px-4 py-3 ${isNum(data.rows[0]?.[c.key]) ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50/60">
                        {data.columns.map(c => <td key={c.key} className={`px-4 py-2.5 ${isNum(row[c.key]) ? 'text-right tabular-nums' : 'text-left text-gray-700'}`}>{fmt(row[c.key])}</td>)}
                      </tr>
                    ))}
                    {data.rows.length === 0 && <tr><td colSpan={data.columns.length} className="py-10 text-center text-gray-300 whitespace-nowrap">ไม่มีข้อมูล</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
