import { useEffect, useState, useCallback } from 'react';
import { Inbox, RefreshCw, DownloadCloud, Link2, CheckCircle, AlertTriangle, Clock, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  fetchTsSyncStatus, runTsSync, fetchWeighInbox, matchWeighInbox,
  type TsSyncStatus, type WeighInboxRow,
} from '../../services/api';
import { useSocketEvent } from '../../hooks/useSocket';
import { useAppStore } from '../../store/app-store';

const MATCH_BADGE: Record<string, string> = {
  MATCHED: 'bg-green-100 text-green-700', MULTI: 'bg-amber-100 text-amber-700',
  UNMATCHED: 'bg-gray-100 text-gray-500',
};

export function WeighInboxPage() {
  const [status, setStatus] = useState<TsSyncStatus | null>(null);
  const [rows, setRows] = useState<WeighInboxRow[]>([]);
  const [filter, setFilter] = useState<'' | 'MATCHED' | 'MULTI' | 'UNMATCHED'>('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  
  const navigate = useAppStore(s => s.navigate);

  const load = useCallback(async (f = filter, s = search, p = page) => {
    setLoading(true);
    try {
      const [st, r] = await Promise.all([fetchTsSyncStatus(), fetchWeighInbox('COMPLETED', f || undefined, s || undefined, p, 20)]);
      setStatus(st); 
      if (r && r.data) {
        setRows(r.data);
        setPagination({ total: r.pagination.total, totalPages: r.pagination.totalPages });
      } else {
        setRows([]);
        setPagination({ total: 0, totalPages: 1 });
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [filter, search, page]);

  useEffect(() => { load(filter, search, page); /* eslint-disable-next-line */ }, [filter, search, page]);
  useSocketEvent('weigh_inbox', () => load(filter, search, page));

  async function doSync() {
    setSyncing(true);
    try { const r = await runTsSync(); if (r.error) alert('Sync error: ' + r.error); await load(filter); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setSyncing(false); }
  }
  async function doMatch(row: WeighInboxRow) {
    const soId = prompt(`จับคู่ใบชั่ง ${row.Sequence} (ทะเบียน ${row.Plate}) กับ SO Id:`);
    if (!soId) return;
    try { await matchWeighInbox(row.Id, soId.trim()); await load(filter); }
    catch (e: unknown) { alert((e as Error).message); }
  }

  const cnt = (st: string) => status?.counts.find(c => c.Status === st)?.n ?? 0;
  const mcnt = (st: string) => status?.matched.find(c => c.MatchStatus === st)?.n ?? 0;
  const card = (icon: React.ReactNode, label: string, value: React.ReactNode, tone: string) => (
    <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tone}`}>{icon}</div>
      <div className="min-w-0"><div className="text-xs text-gray-400">{label}</div><div className="text-xl font-bold text-gray-800 truncate">{value}</div></div>
    </div>
  );

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}><Inbox className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> Weigh Inbox (ดึงจาก TruckScale)</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
            ดึงรายการชั่งกลับเข้าระบบอัตโนมัติ + จับคู่ SO ด้วยทะเบียน · ทุก {Math.round((status?.intervalMs || 60000) / 1000)} วินาที
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={e => { e.preventDefault(); setSearch(searchInput); setPage(1); }} className="relative hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              type="text" 
              placeholder="ค้นหาทะเบียน, ชื่อ..." 
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-[#0C447C] focus:ring-1 focus:ring-[#0C447C] w-48 transition-all"
            />
          </form>
          <button onClick={doSync} disabled={syncing} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40">
            <DownloadCloud size={15} className={syncing ? 'animate-pulse' : ''} /> <span className="hidden sm:inline">ดึงเดี๋ยวนี้</span>
          </button>
          <button onClick={() => load()} className="h-10 w-10 flex shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-0 sm:p-6 space-y-2 sm:space-y-6">
        {status && !status.configured && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">TruckScale (MySQL) ไม่ได้ตั้งค่า — การดึงข้อมูลปิดอยู่</div>
        )}
        {status?.watermark?.LastError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">Sync error ล่าสุด: {status.watermark.LastError}</div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {card(<DownloadCloud size={20} />, 'ดึงสะสม', status?.watermark?.TotalIngested ?? '–', 'bg-blue-50 text-blue-600')}
          {card(<CheckCircle size={20} />, 'จับคู่ SO ได้', mcnt('MATCHED'), 'bg-green-50 text-green-600')}
          {card(<AlertTriangle size={20} />, 'ต้องเลือก (หลายคู่)', mcnt('MULTI'), 'bg-amber-50 text-amber-600')}
          {card(<Clock size={20} />, 'ยังไม่จับคู่', mcnt('UNMATCHED'), 'bg-gray-50 text-gray-500')}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {([['', 'ทั้งหมด'], ['MATCHED', 'จับคู่ได้'], ['MULTI', 'หลายคู่'], ['UNMATCHED', 'ยังไม่จับคู่']] as const).map(([v, l]) => (
              <button key={v} onClick={() => { setFilter(v); setPage(1); }} className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold ${filter === v ? 'bg-[#0C447C] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </div>
          <div className="text-xs text-gray-400">sync ล่าสุด: {status?.watermark?.LastSyncAt ? new Date(status.watermark.LastSyncAt).toLocaleString('th-TH') : '–'}</div>
        </div>

        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm min-w-full">
            <thead className="whitespace-nowrap"><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <th className="text-left px-4 py-3 whitespace-nowrap">ใบชั่ง / movebill</th><th className="text-left px-4 py-3 whitespace-nowrap">ทะเบียน / ลูกค้า</th>
              <th className="text-right px-4 py-3 whitespace-nowrap">น้ำหนักสุทธิ</th><th className="text-left px-4 py-3 whitespace-nowrap">ชั่งออก</th>
              <th className="text-center px-4 py-3 whitespace-nowrap">จับคู่</th><th className="text-right px-4 py-3 whitespace-nowrap"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 whitespace-nowrap">กำลังโหลด…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 whitespace-nowrap">ยังไม่มีรายการ — กด "ดึงเดี๋ยวนี้"</td></tr>}
              {!loading && rows.map(r => (
                <tr key={r.Id}>
                  <td className="px-4 py-3 whitespace-nowrap"><div className="font-semibold text-gray-800">{r.Sequence}</div><div className="text-xs text-gray-400">{r.Movebill || '–'}</div></td>
                  <td className="px-4 py-3 whitespace-nowrap"><div className="text-gray-700">{r.Plate}</div><div className="text-xs text-gray-400">{r.CustName}</div></td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{r.WeightNet != null ? `${(Number(r.WeightNet) / 1000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} Ton` : '–'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{r.DateOut || '–'}</td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${MATCH_BADGE[r.MatchStatus || 'UNMATCHED']}`}>{r.MatchStatus || '—'}</span>
                    {r.MatchedSoId && (
                      <div className="mt-0.5">
                        <button 
                          onClick={() => navigate('sales', { soId: Number(r.MatchedSoId), action: 'view' })}
                          className="text-[11px] text-blue-600 font-medium hover:underline focus:outline-none"
                          title="ดูรายละเอียดบิล"
                        >
                          {r.MatchedDocuNo || `SO ${r.MatchedSoId}`}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {r.MatchStatus !== 'MATCHED' && (
                      <button onClick={() => doMatch(r)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50"><Link2 size={12} /> จับคู่</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <div className="text-sm text-gray-500">
              พบทั้งหมด <span className="font-semibold text-gray-800">{pagination.total.toLocaleString()}</span> รายการ
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-md hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:border-transparent transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-gray-600">หน้า {page} / {pagination.totalPages}</span>
              <button 
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="p-1.5 rounded-md hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:border-transparent transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
