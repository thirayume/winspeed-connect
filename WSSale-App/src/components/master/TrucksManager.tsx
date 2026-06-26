import { useEffect, useState, useMemo } from 'react';
import { Truck, Search, History, RefreshCw, X, Calendar, FileText, ArrowUpDown, TrendingUp } from 'lucide-react';
import { fetchTruckStats, fetchTruckHistory } from '../../services/api';
import { formatThaiDate } from '../../utils/date';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import type { TruckStats, TruckHistoryItem } from '../../types';

export const TrucksManager = ({ initialSearch = '' }: { initialSearch?: string }) => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TruckStats[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [truckHistory, setTruckHistory] = useState<TruckHistoryItem[]>([]);
  const [selectedTruck, setSelectedTruck] = useState<TruckStats | null>(null);
  const [searchQuery, setSearchQuery] = useState(initialSearch);

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'count', direction: 'desc' });

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetchTruckStats();
      setStats(res);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const loadHistory = async (stat: TruckStats) => {
    setSelectedTruck(stat);
    setHistoryLoading(true);
    try {
      const data = await fetchTruckHistory(stat.truckPlate);
      setTruckHistory(data);
    } catch (err) {
      console.error(err);
    }
    setHistoryLoading(false);
  };

  const filteredStats = useMemo(() => {
    return stats.filter(s => 
      (s.truckPlate ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.custName ?? '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [stats, searchQuery]);

  const sortedStats = useMemo(() => {
    const sortableItems = [...filteredStats];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        let aVal: any = a[sortConfig.key as keyof TruckStats];
        let bVal: any = b[sortConfig.key as keyof TruckStats];
        
        if (sortConfig.key === 'count') {
          aVal = Number(aVal) || 0;
          bVal = Number(bVal) || 0;
        }

        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredStats, sortConfig]);

  const totalPages = Math.ceil(sortedStats.length / itemsPerPage);
  const paginatedStats = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedStats.slice(start, start + itemsPerPage);
  }, [sortedStats, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    } else {
      direction = key === 'count' ? 'desc' : 'asc';
    }
    setSortConfig({ key, direction });
  };

  const SortableHeader = ({ title, sortKey, align = 'left' }: { title: string, sortKey: string, align?: 'left'|'center'|'right' }) => (
    <th className={`px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors text-${align}`} onClick={() => requestSort(sortKey)}>
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        {title}
        <ArrowUpDown size={12} className={`text-gray-400 ${sortConfig.key === sortKey ? 'text-[#0C447C] font-bold' : ''}`} />
      </div>
    </th>
  );

  const totalTrucks = stats.length;
  const totalVisits = useMemo(() => stats.reduce((sum, s) => sum + s.count, 0), [stats]);

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden relative">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        <DataSummaryCard
          title="รถบรรทุกทั้งหมด"
          value={totalTrucks.toLocaleString()}
          icon={<Truck size={24} />}
          colorClass="bg-blue-100 text-blue-600"
        />
        <DataSummaryCard
          title="ยอดรวมวิ่งงาน (ครั้ง)"
          value={totalVisits.toLocaleString()}
          icon={<TrendingUp size={24} />}
          colorClass="bg-orange-100 text-orange-600"
        />
        <DataSummaryCard
          title="ค้นพบ"
          value={filteredStats.length.toLocaleString()}
          icon={<Search size={24} />}
          colorClass="bg-emerald-100 text-emerald-600"
        />
      </div>

      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4 bg-gray-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="ค้นหาทะเบียนรถ หรือ ชื่อลูกค้า..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C] focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          <button onClick={loadData} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 sticky top-0 z-10 text-gray-600 font-semibold text-xs uppercase tracking-wider shadow-sm">
              <tr>
                <th className="px-6 py-4 border-b border-gray-100 w-16 text-center">ลำดับ</th>
                <SortableHeader title="ทะเบียนรถ" sortKey="truckPlate" />
                <SortableHeader title="ลูกค้าหลัก" sortKey="custName" />
                <SortableHeader title="ความถี่ (ครั้ง)" sortKey="count" align="center" />
                <SortableHeader title="เข้ารับของล่าสุด" sortKey="lastVisit" />
                <th className="px-6 py-4 border-b border-gray-100 text-right">Audit Trail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-[#0C447C]">
                      <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
                      <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูลรถบรรทุก...</p>
                    </div>
                  </td>
                </tr>
              ) : paginatedStats.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    <Truck size={32} className="mx-auto mb-3 opacity-30" />
                    <p>ไม่พบข้อมูลสถิติรถบรรทุก</p>
                  </td>
                </tr>
              ) : (
                paginatedStats.map((stat, idx) => (
                  <tr key={stat.truckPlate} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 text-center text-gray-400">{((currentPage - 1) * itemsPerPage) + idx + 1}</td>
                    <td className="px-6 py-4 font-bold text-gray-800">
                      <div className="inline-flex items-center gap-2 bg-yellow-100 text-yellow-800 border border-yellow-300 px-2 py-0.5 rounded text-xs">
                        {stat.truckPlate}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-700 truncate max-w-[200px]">{stat.custName}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center justify-center bg-blue-50 text-blue-700 font-semibold h-7 min-w-[28px] rounded-full px-2">
                        {stat.count.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {stat.lastVisit ? formatThaiDate(stat.lastVisit) : '-'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => loadHistory(stat)}
                        className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors flex items-center justify-center"
                        title="ดูประวัติ"
                      >
                        <History size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <span className="text-sm text-gray-500">
              แสดง {((currentPage - 1) * itemsPerPage) + 1} ถึง {Math.min(currentPage * itemsPerPage, filteredStats.length)} จาก {filteredStats.length}
            </span>
            <div className="flex gap-1">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 bg-white border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                ก่อนหน้า
              </button>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 bg-white border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Audit Trail Modal */}
      {selectedTruck && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-2 sm:p-6 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[96vw] h-[96vh] max-w-none flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 rounded-t-2xl shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-yellow-100 text-yellow-800 border border-yellow-300 px-3 py-1 rounded-md font-bold text-lg">
                  {selectedTruck.truckPlate}
                </div>
                <div>
                  <h3 className="font-bold text-gray-800">ประวัติการเข้ารับสินค้า (Audit Trail)</h3>
                  <p className="text-xs text-gray-500">ลูกค้า: {selectedTruck.custName} • ทั้งหมด {selectedTruck.count} ครั้ง</p>
                </div>
              </div>
              <button onClick={() => setSelectedTruck(null)} className="p-2 text-gray-400 hover:bg-gray-600 hover:bg-gray-200 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-gray-50">
              {historyLoading ? (
                <div className="flex justify-center items-center py-12 text-gray-400 h-full">
                  <RefreshCw size={32} className="animate-spin opacity-50" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {truckHistory.map((h, i) => (
                    <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-start gap-4">
                        <div className="mt-1 h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center text-[#0C447C]">
                          <Calendar size={16} />
                        </div>
                        <div>
                          <div className="font-semibold text-gray-800">
                            {h.date ? formatThaiDate(h.date, true) : 'ไม่ระบุวันที่'}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            <button 
                              onClick={() => alert(`คุณคลิกเพื่อดูเอกสารอ้างอิง: ${h.so}\n(ฟังก์ชันเปิดเอกสารจริงจะมาในเฟสถัดไป)`)}
                              className="flex items-center gap-1 hover:text-[#0C447C] hover:underline cursor-pointer transition-colors"
                            >
                              <FileText size={14} /> อ้างอิงเอกสาร: {h.so}
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold text-[#0C447C]">{h.qtyTon.toLocaleString()}</div>
                        <div className="text-xs text-gray-500">ตัน</div>
                      </div>
                    </div>
                  ))}
                  {truckHistory.length === 0 && (
                     <div className="text-center text-gray-400 py-6">ไม่มีประวัติวิ่งงาน</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
