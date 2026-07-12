import { useEffect, useState, useMemo } from 'react';
import { LayoutDashboard, RefreshCw, Package, Clock, TrendingUp, AlertTriangle, Truck, Database, Search, X, Calendar } from 'lucide-react';
import { fetchSoStats, fetchAgingOrders, fetchRebateSummary, fetchSalesOrders } from '../../services/api';
import { useSocketEvent } from '../../hooks/useSocket';
import { useAuthStore } from '../../store/auth-store';
import { canViewAllRebateAmounts } from '../../utils/permissions';
import type { AgingRow, RebateSummary, SalesOrder } from '../../types';
import { SO_STATUS_META, SO_STATUS_ORDER } from '../../constants/soStatus';


function agingColor(days: number) {
  if (days > 45) return { bg: 'bg-red-50', text: 'text-red-700', dot: '#EF4444', label: '>45 วัน' };
  if (days > 30) return { bg: 'bg-amber-50', text: 'text-amber-700', dot: '#F59E0B', label: '>30 วัน' };
  return { bg: 'bg-gray-50', text: 'text-gray-600', dot: '#9CA3AF', label: 'ปกติ' };
}

export function DashboardPage() {
  const canSeeRebate = canViewAllRebateAmounts(useAuthStore(s => s.user));
  const [stats, setStats]     = useState<{ byStatus: Record<string, number>; total: number }>({ byStatus: {}, total: 0 });
  const [aging, setAging]     = useState<AgingRow[]>([]);
  const [rebate, setRebate]   = useState<RebateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchRows, setSearchRows] = useState<SalesOrder[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);

  async function load(bustCache = false) {
    setLoading(true);
    try {
      const [s, a, r] = await Promise.all([
        fetchSoStats(bustCache),
        fetchAgingOrders(bustCache).catch(() => []),
        canSeeRebate ? fetchRebateSummary().catch(() => []) : Promise.resolve([]),
      ]);
      setStats(s);
      setAging(a as AgingRow[]);
      setRebate(r as RebateSummary[]);
    } catch (e) { console.error(e); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Listen for real-time updates from Backend Polling
  useSocketEvent('so_updated', () => {
    console.log('[Socket] so_updated event received. Refreshing Dashboard...');
    load();
  });

  const warnAging = aging.filter(a => a.DaysOpen > 30);
  const groupedAging = useMemo(() => {
    const groups: Record<string, {
      truckPlate: string;
      custName: string;
      maxDays: number;
      wfRefs: Set<string>;
      items: { code: string; name?: string; qty: number; wfRef: string }[];
      totalQty: number;
    }> = {};
    for (const a of aging) {
      const truck = a.TruckPlate || 'ไม่ระบุรถ';
      let key = `${truck}-${a.CustName}`;
      if (truck === 'ไม่ระบุรถ') {
        key = `NO_TRUCK-${a.WfRef}-${a.CustName}`;
      }
      
      if (!groups[key]) {
        groups[key] = {
          truckPlate: truck,
          custName: a.CustName,
          maxDays: a.DaysOpen,
          wfRefs: new Set<string>(),
          items: [],
          totalQty: 0
        };
      }
      if (a.DaysOpen > groups[key].maxDays) {
        groups[key].maxDays = a.DaysOpen;
      }
      if (a.WfRef) groups[key].wfRefs.add(a.WfRef);
      
      const qty = Number(a.QtyTon || 0);
      groups[key].totalQty += qty;
      
      const existingItem = groups[key].items.find(i => i.code === a.GoodCode && i.wfRef === a.WfRef);
      if (existingItem) {
        existingItem.qty += qty;
      } else {
        groups[key].items.push({
          code: a.GoodCode,
          name: a.GoodName,
          qty: qty,
          wfRef: a.WfRef
        });
      }
    }
    return Object.values(groups).map(g => ({
      ...g,
      wfRefs: Array.from(g.wfRefs)
    })).sort((a, b) => b.maxDays - a.maxDays);
  }, [aging]);
  const totalRebateAvailable = rebate.reduce((s, r) => s + Number(r.TotalAvailable || 0), 0);
  const hasSearch = !!(searchQuery.trim() || dateFrom || dateTo);

  async function runSearch() {
    if (!hasSearch) {
      setSearchRows([]);
      setSearchTotal(0);
      return;
    }
    setSearchLoading(true);
    try {
      const r = await fetchSalesOrders({
        search: searchQuery.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page: 1,
        limit: 12,
        silent: true,
      });
      setSearchRows(r.data || []);
      setSearchTotal(r.total || 0);
    } catch (e) {
      console.error(e);
      setSearchRows([]);
      setSearchTotal(0);
    } finally {
      setSearchLoading(false);
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setSearchRows([]);
    setSearchTotal(0);
  }

  return (
    <div className="h-full flex flex-col w-full overflow-hidden max-w-full" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <LayoutDashboard className="w-5 h-5 sm:w-6 sm:h-6" /> Dashboard
          </h1>
          <p className="hidden sm:block text-sm text-gray-500 mt-0.5">ภาพรวมใบสั่งขาย · SO ค้างจัดส่ง · รีเบท</p>
        </div>
        <button onClick={() => load(true)} className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white shrink-0">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-4">
          <KpiCard icon={<Package size={20} />} label="ทั้งหมด" value={stats.total.toLocaleString()} color="#0C447C" />
          <KpiCard icon={<Clock size={20} />} label="รอจัดส่ง/รับสินค้า"
            value={((stats.byStatus.CONFIRMED || 0) + (stats.byStatus.PICKING || 0) + (stats.byStatus.LOADED || 0)).toLocaleString()} color="#F59E0B" />
          <KpiCard icon={<Truck size={20} />} label="ส่งออกจากตาชั่ง" value={(stats.byStatus.SHIPPED || 0).toLocaleString()} color="#059669" />
          <KpiCard icon={<Database size={20} />} label="ปิด SO ใน WINSpeed" value={(stats.byStatus.IMPORTED || 0).toLocaleString()} color="#10B981" />
          <KpiCard icon={<AlertTriangle size={20} />} label="SO ค้าง >30 วัน" value={warnAging.length.toLocaleString()} color="#EF4444" />
          {canSeeRebate && (
            <KpiCard icon={<TrendingUp size={20} />} label="รีเบท (฿)"
              value={totalRebateAvailable.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} color="#059669" />
          )}
        </div>

        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <div className="flex-1 min-w-0">
              <label className="text-[10px] font-bold text-gray-500 block mb-1">ค้นหา Dashboard</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="ชื่อลูกค้า / ทะเบียนรถ / เลขเอกสาร"
                  className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:w-[320px]">
              <label className="block">
                <span className="text-[10px] font-bold text-gray-500 block mb-1"><Calendar size={10} className="inline mr-0.5" />จากวันที่</span>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]" />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-gray-500 block mb-1">ถึงวันที่</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]" />
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={runSearch} disabled={!hasSearch || searchLoading} className="h-10 px-4 rounded-xl text-white text-sm font-bold disabled:opacity-40" style={{ background: '#0C447C' }}>
                {searchLoading ? 'กำลังค้นหา...' : 'ค้นหา'}
              </button>
              <button onClick={clearSearch} disabled={!hasSearch && searchRows.length === 0} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 disabled:opacity-40">
                <X size={16} />
              </button>
            </div>
          </div>

          {(searchRows.length > 0 || (hasSearch && !searchLoading)) && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-bold text-gray-600">ผลการค้นหา SO</h2>
                <span className="text-[10px] text-gray-400">แสดง {searchRows.length.toLocaleString()} จาก {searchTotal.toLocaleString()} รายการ</span>
              </div>
              {searchRows.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">ไม่พบรายการที่ตรงกับเงื่อนไข</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[760px]">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left py-2 pr-3">เลขอ้างอิง</th>
                        <th className="text-left py-2 px-3">ลูกค้า</th>
                        <th className="text-left py-2 px-3">ทะเบียน</th>
                        <th className="text-left py-2 px-3">วันที่แจ้ง/นัด</th>
                        <th className="text-left py-2 px-3">วันรับของ</th>
                        <th className="text-left py-2 pl-3">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {searchRows.map(row => (
                        <tr key={String(row.id)} className="text-gray-700">
                          <td className="py-2 pr-3 font-mono font-bold text-[#0C447C] whitespace-nowrap">{row.wfRef || row.importedDocuNo || row.id}</td>
                          <td className="py-2 px-3 max-w-[220px] truncate" title={row.custName}>{row.custName}</td>
                          <td className="py-2 px-3 font-mono whitespace-nowrap">{row.truckPlate || (row.noTruckRequired ? 'ไม่ต้องระบุรถ' : '-')}</td>
                          <td className="py-2 px-3 whitespace-nowrap">{row.requestedAt ? new Date(row.requestedAt).toLocaleString('th-TH') : '-'}</td>
                          <td className="py-2 px-3 whitespace-nowrap">{row.deliveryDate ? new Date(row.deliveryDate).toLocaleDateString('th-TH') : '-'}</td>
                          <td className="py-2 pl-3 whitespace-nowrap">{SO_STATUS_META[row.status]?.label || row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* SO status breakdown */}
        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 p-4 sm:p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700 mb-4">สถานะใบสั่งขาย</h2>
          <div className="space-y-2">
            {SO_STATUS_ORDER.map(st => {
              const count = stats.byStatus[st] || 0;
              const pct = stats.total ? (count / stats.total) * 100 : 0;
              const m = SO_STATUS_META[st];
              return (
                <div key={st} className="flex items-center gap-3">
                  <span className="w-24 text-xs text-gray-600 shrink-0">{m.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: m.color }} />
                  </div>
                  <span className="w-10 text-right text-xs font-bold text-gray-700 tabular-nums">{count.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Aging orders */}
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 p-4 sm:p-5 shadow-sm flex flex-col">
            <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              SO ค้างจัดส่งนาน
              <span className="text-[10px] font-normal text-gray-400">เหลือง &gt;30 · แดง &gt;45 วัน</span>
            </h2>
            {groupedAging.length === 0 ? (
              <p className="text-xs text-gray-400 py-6 text-center">ไม่มี SO ค้างจัดส่ง</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {groupedAging.slice(0, 30).map((g, i) => {
                  const c = agingColor(g.maxDays);
                  return (
                    <div key={i} className={`flex flex-col gap-1.5 p-3 rounded-xl border ${c.bg.replace('bg-', 'border-').replace('50', '200')} ${c.bg}`}>
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm" style={{ background: c.dot }} />
                        <span className="font-mono text-xs font-bold text-[#0C447C] w-24 shrink-0 truncate flex items-center gap-1"><Truck size={12}/> {g.truckPlate}</span>
                        <span className="flex-1 text-xs font-semibold text-gray-700 truncate">{g.custName}</span>
                        <span className="text-xs font-bold text-gray-500 w-16 text-right shrink-0">{g.totalQty.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ตัน</span>
                        <span className={`text-xs font-bold ${c.text} w-16 text-right shrink-0`}>{g.maxDays} วัน</span>
                      </div>
                      {g.wfRefs.length > 0 && (
                        <div className="mt-0.5 ml-4 text-[10px] text-gray-400 font-mono flex gap-1 flex-wrap">
                          {g.wfRefs.map(ref => <span key={ref} className="bg-gray-100 px-1 rounded">{ref}</span>)}
                        </div>
                      )}
                      <div className="mt-1 ml-4 pl-3 border-l-2 border-gray-200/60 space-y-1">
                        {g.items.map((item, idx) => (
                           <div key={idx} className="flex justify-between items-center text-[11px] text-gray-600 gap-2">
                             <div className="flex flex-1 items-center gap-2 min-w-0">
                               <span className="truncate font-medium flex-1" title={item.name}>{item.name || 'ไม่ระบุชื่อสินค้า'}</span>
                             </div>
                             <span className="w-16 text-right tabular-nums font-medium shrink-0">
                               {Number(item.qty || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ตัน
                             </span>
                           </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Rebate summary per salesperson */}
          {canSeeRebate && <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 p-4 sm:p-5 shadow-sm overflow-hidden flex flex-col w-full">
            <h2 className="text-sm font-bold text-gray-700 mb-3">รีเบทต่อพนักงานขาย</h2>
            {rebate.length === 0 ? (
              <p className="text-xs text-gray-400 py-6 text-center">ยังไม่มีข้อมูลรีเบท</p>
            ) : (
              <div className="overflow-x-auto w-full scrollbar-hide">
              <table className="w-full text-xs min-w-full">
                <thead className="whitespace-nowrap">
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left py-1.5 font-medium whitespace-nowrap">พนักงาน</th>
                    <th className="text-right py-1.5 font-medium whitespace-nowrap">สะสม</th>
                    <th className="text-right py-1.5 font-medium whitespace-nowrap">เคลมแล้ว</th>
                    <th className="text-right py-1.5 font-medium whitespace-nowrap">ใช้ได้</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rebate.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2 text-gray-700 whitespace-nowrap">{r.SalesName}</td>
                      <td className="py-2 text-right tabular-nums text-gray-600 whitespace-nowrap">฿{Number(r.TotalAccrued).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-2 text-right tabular-nums text-gray-400 whitespace-nowrap">฿{Number(r.TotalClaimed).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-2 text-right tabular-nums font-bold whitespace-nowrap" style={{ color: '#059669' }}>฿{Number(r.TotalAvailable).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 p-3 sm:p-4 shadow-sm flex flex-col justify-between">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-7 w-7 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl flex items-center justify-center text-white" style={{ background: color }}>
          {icon}
        </div>
      </div>
      <div>
        <div className="text-xl sm:text-2xl font-black text-gray-800 tabular-nums leading-none">{value}</div>
        <div className="text-[10px] sm:text-xs text-gray-400 mt-1 line-clamp-1">{label}</div>
      </div>
    </div>
  );
}
