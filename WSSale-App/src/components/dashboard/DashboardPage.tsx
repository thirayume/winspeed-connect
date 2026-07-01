import { useEffect, useState } from 'react';
import { LayoutDashboard, RefreshCw, Package, Clock, TrendingUp, AlertTriangle, Truck, Database } from 'lucide-react';
import { fetchSoStats, fetchAgingOrders, fetchRebateSummary } from '../../services/api';
import { useSocketEvent } from '../../hooks/useSocket';
import type { AgingRow, RebateSummary, SOStatus } from '../../types';

const STATUS_META: Record<SOStatus, { label: string; color: string }> = {
  DRAFT:     { label: 'ร่าง',          color: '#9CA3AF' },
  CONFIRMED: { label: 'ยืนยัน',        color: '#0C447C' },
  PICKING:   { label: 'รอรับสินค้า',   color: '#F59E0B' },
  SHIPPED:   { label: 'ส่งออก',        color: '#059669' },
  IMPORTED:  { label: 'นำเข้า WS',     color: '#10B981' },
  CANCELLED: { label: 'ยกเลิก',        color: '#EF4444' },
};

const CHART_STATUSES: SOStatus[] = ['DRAFT', 'CONFIRMED', 'PICKING', 'CANCELLED'];

function agingColor(days: number) {
  if (days > 45) return { bg: 'bg-red-50', text: 'text-red-700', dot: '#EF4444', label: '>45 วัน' };
  if (days > 30) return { bg: 'bg-amber-50', text: 'text-amber-700', dot: '#F59E0B', label: '>30 วัน' };
  return { bg: 'bg-gray-50', text: 'text-gray-600', dot: '#9CA3AF', label: 'ปกติ' };
}

export function DashboardPage() {
  const [stats, setStats]     = useState<{ byStatus: Record<string, number>; total: number }>({ byStatus: {}, total: 0 });
  const [aging, setAging]     = useState<AgingRow[]>([]);
  const [rebate, setRebate]   = useState<RebateSummary[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(bustCache = false) {
    setLoading(true);
    try {
      const [s, a, r] = await Promise.all([
        fetchSoStats(bustCache),
        fetchAgingOrders(bustCache).catch(() => []),
        fetchRebateSummary().catch(() => []),
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
  const totalRebateAvailable = rebate.reduce((s, r) => s + Number(r.TotalAvailable || 0), 0);

  return (
    <div className="h-full flex flex-col w-full overflow-hidden max-w-full" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <LayoutDashboard className="w-5 h-5 sm:w-6 sm:h-6" /> Dashboard
          </h1>
          <p className="hidden sm:block text-sm text-gray-500 mt-0.5">ภาพรวมใบสั่งขาย · ตั๋วคงค้าง · รีเบท</p>
        </div>
        <button onClick={() => load(true)} className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white shrink-0">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-4">
          <KpiCard icon={<Package size={20} />} label="ทั้งหมด" value={stats.total.toLocaleString()} color="#0C447C" />
          <KpiCard icon={<Clock size={20} />} label="รอดำเนินการ"
            value={((stats.byStatus.CONFIRMED || 0) + (stats.byStatus.PICKING || 0)).toLocaleString()} color="#F59E0B" />
          <KpiCard icon={<Truck size={20} />} label="ส่งออกแล้ว" value={(stats.byStatus.SHIPPED || 0).toLocaleString()} color="#059669" />
          <KpiCard icon={<Database size={20} />} label="นำเข้า WS" value={(stats.byStatus.IMPORTED || 0).toLocaleString()} color="#10B981" />
          <KpiCard icon={<AlertTriangle size={20} />} label="ตั๋วค้าง >30 วัน" value={warnAging.length.toLocaleString()} color="#EF4444" />
          <KpiCard icon={<TrendingUp size={20} />} label="รีเบท (฿)"
            value={totalRebateAvailable.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} color="#059669" />
        </div>

        {/* SO status breakdown */}
        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 p-4 sm:p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700 mb-4">สถานะใบสั่งขาย</h2>
          <div className="space-y-2">
            {CHART_STATUSES.map(st => {
              const count = stats.byStatus[st] || 0;
              const pct = stats.total ? (count / stats.total) * 100 : 0;
              const m = STATUS_META[st];
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
          {/* Aging tickets */}
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 p-4 sm:p-5 shadow-sm flex flex-col">
            <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              ตั๋วคงค้าง (Aging)
              <span className="text-[10px] font-normal text-gray-400">เหลือง &gt;30 · แดง &gt;45 วัน</span>
            </h2>
            {aging.length === 0 ? (
              <p className="text-xs text-gray-400 py-6 text-center">ไม่มีตั๋วคงค้าง</p>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {aging.slice(0, 30).map((a, i) => {
                  const c = agingColor(a.DaysOpen);
                  return (
                    <div key={i} className={`flex items-center gap-2 p-2 rounded-lg ${c.bg}`}>
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: c.dot }} />
                      <span className="font-mono text-xs text-gray-700 w-24 shrink-0 truncate">{a.WfRef}</span>
                      <span className="flex-1 text-xs text-gray-600 truncate">{a.CustName}</span>
                      <span className="text-xs text-gray-400">{a.GoodCode}</span>
                      <span className={`text-xs font-bold ${c.text} w-16 text-right`}>{a.DaysOpen} วัน</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Rebate summary per salesperson */}
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 p-4 sm:p-5 shadow-sm overflow-hidden flex flex-col w-full">
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
          </div>
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
