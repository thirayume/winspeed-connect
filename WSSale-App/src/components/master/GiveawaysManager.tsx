import { useEffect, useState, useMemo } from 'react';
import { Gift, Search, RefreshCw, History, Plus, X, Calendar, MapPin, Tag, Layers, User, ArrowUpDown } from 'lucide-react';
import { fetchGiveawayItems, fetchGiveawayWithdrawals, fetchGiveawayRegions } from '../../services/api';
import { formatThaiDate } from '../../utils/date';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import type { GiveawayItem, GiveawayWithdrawal } from '../../types';

export const GiveawaysManager = () => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<GiveawayItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedItem, setSelectedItem] = useState<GiveawayItem | null>(null);
  const [withdrawals, setWithdrawals] = useState<GiveawayWithdrawal[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [regionsMap, setRegionsMap] = useState<Record<string, string>>({});

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'Id', direction: 'asc' });

  async function loadData() {
    setLoading(true);
    try {
      const [data, regionsData] = await Promise.all([
        fetchGiveawayItems(),
        fetchGiveawayRegions()
      ]);
      setItems(data);
      const rMap: Record<string, string> = {};
      regionsData.forEach(r => {
        if (r.EmpName) rMap[r.Region] = r.EmpName;
      });
      setRegionsMap(rMap);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const handleViewHistory = async (item: GiveawayItem) => {
    setSelectedItem(item);
    setHistoryLoading(true);
    try {
      const data = await fetchGiveawayWithdrawals();
      const filtered = data.filter(w => w.ItemName === item.ItemName && w.Brand === item.Brand);
      setWithdrawals(filtered.sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime()));
    } catch (err) {
      console.error(err);
    }
    setHistoryLoading(false);
  };

  const handleAddMockItem = () => {
    const newItem: GiveawayItem = {
      Id: Math.floor(Math.random() * 1000) + 9000,
      Brand: 'แบรนด์ใหม่',
      ItemName: 'ของแถมใหม่ ' + Math.floor(Math.random() * 100),
      ItemType: 'OTHER'
    };
    setItems([newItem, ...items]);
    alert('เพิ่มของแถมใหม่แล้ว (Mock Data - จะหายไปเมื่อรีเฟรช)');
  };

  const filteredItems = items.filter(i => 
    i.ItemName.toLowerCase().includes(searchQuery.toLowerCase()) || 
    i.Brand.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedItems = useMemo(() => {
    const sortableItems = [...filteredItems];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        let aVal: any = a[sortConfig.key as keyof GiveawayItem];
        let bVal: any = b[sortConfig.key as keyof GiveawayItem];
        if (sortConfig.key === 'Id') {
           aVal = Number(aVal) || 0;
           bVal = Number(bVal) || 0;
        }
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredItems, sortConfig]);

  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedItems.slice(start, start + itemsPerPage);
  }, [sortedItems, currentPage]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
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

  const uniqueBrands = new Set(items.map(i => i.Brand)).size;
  const uniqueTypes = new Set(items.map(i => i.ItemType)).size;

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        <DataSummaryCard
          title="รายการของแถมทั้งหมด"
          value={items.length.toLocaleString()}
          icon={<Gift size={24} />}
          colorClass="bg-blue-100 text-blue-600"
        />
        <DataSummaryCard
          title="จำนวนแบรนด์"
          value={uniqueBrands.toLocaleString()}
          icon={<Tag size={24} />}
          colorClass="bg-emerald-100 text-emerald-600"
        />
        <DataSummaryCard
          title="ประเภทของแถม"
          value={uniqueTypes.toLocaleString()}
          icon={<Layers size={24} />}
          colorClass="bg-orange-100 text-orange-600"
        />
      </div>

      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4 bg-gray-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="ค้นหาชื่อของแถม หรือ แบรนด์..."
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
          <div className="flex gap-2">
            <button onClick={loadData} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={handleAddMockItem} className="px-3 py-2 bg-[#0C447C] text-white rounded-lg text-sm font-medium hover:bg-[#0a3866] flex items-center gap-2">
              <Plus size={16} /> เพิ่มของแถม
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 sticky top-0 z-10 text-gray-600 font-semibold text-xs uppercase tracking-wider shadow-sm">
              <tr>
                <SortableHeader title="ID" sortKey="Id" />
                <SortableHeader title="แบรนด์" sortKey="Brand" />
                <SortableHeader title="ชื่อรายการของแถม" sortKey="ItemName" />
                <SortableHeader title="ประเภท" sortKey="ItemType" />
                <th className="px-6 py-4 border-b border-gray-100 text-right">ประวัติการเบิก</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-[#0C447C]">
                      <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
                      <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูลของแถม...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    <Gift size={32} className="mx-auto mb-3 opacity-30" />
                    <p>ไม่พบรายการของแถม</p>
                  </td>
                </tr>
              ) : (
                paginatedItems.map(item => (
                  <tr key={item.Id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 text-gray-500">{item.Id}</td>
                    <td className="px-6 py-4">
                      <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs">{item.Brand}</span>
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-800">{item.ItemName}</td>
                    <td className="px-6 py-4 text-gray-600">{item.ItemType}</td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        title="ดูประวัติการเบิกของแถม"
                        onClick={() => handleViewHistory(item)}
                        className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors flex items-center justify-center ml-auto"
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
              แสดง {((currentPage - 1) * itemsPerPage) + 1} ถึง {Math.min(currentPage * itemsPerPage, filteredItems.length)} จาก {filteredItems.length}
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

      {selectedItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-2 sm:p-6 z-50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-[96vw] h-[96vh] max-w-none flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 rounded-t-2xl shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 text-[#0C447C] p-2 rounded-lg shadow-sm">
                  <Gift size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                    ประวัติการเบิก: {selectedItem.ItemName}
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    แบรนด์: <span className="font-semibold text-gray-700">{selectedItem.Brand}</span> • 
                    ประเภท: <span className="font-semibold text-gray-700">{selectedItem.ItemType}</span> • 
                    ทั้งหมด <span className="font-semibold text-[#0C447C]">{withdrawals.length}</span> รายการ
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedItem(null)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-colors bg-white shadow-sm border border-gray-100">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-gray-50 custom-scrollbar">
              {historyLoading ? (
                <div className="flex justify-center py-10 h-full items-center">
                  <RefreshCw size={32} className="animate-spin text-gray-400 opacity-50" />
                </div>
              ) : withdrawals.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {withdrawals.map(w => (
                    <div key={w.Id} className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col justify-between shadow-sm hover:shadow-lg transition-all relative overflow-hidden group">
                      <div className="flex items-start gap-3 mb-4">
                        <div className="mt-0.5 h-10 w-10 rounded-full flex items-center justify-center shrink-0 bg-green-50 text-green-600">
                          <Calendar size={18} />
                        </div>
                        <div>
                          <div className="font-bold text-gray-800 text-sm leading-snug">
                            {w.CreatedAt ? formatThaiDate(w.CreatedAt) : 'ไม่ระบุวันที่'}
                          </div>
                          <div className="text-xs text-gray-500 mt-1.5 flex flex-col gap-1">
                            <span className="flex items-center gap-1 font-bold text-gray-800">
                              <User size={12} className="text-[#0C447C]" /> {regionsMap[w.Region] || 'ไม่ระบุพนักงาน'}
                            </span>
                            <span className="flex items-center gap-1 font-medium text-gray-600">
                              <MapPin size={12} /> {w.Region}
                            </span>
                            {w.CustId && <span className="text-gray-500">ลูกค้า: {w.CustId}</span>}
                          </div>
                          {w.Note && <div className="text-[10px] text-gray-400 mt-1.5 italic bg-gray-50 p-1.5 rounded">"{w.Note}"</div>}
                        </div>
                      </div>
                      <div className="text-right mt-2 border-t border-gray-100 pt-4">
                        <div className="text-3xl font-black tracking-tight text-green-600 group-hover:text-green-700 transition-colors">
                          -{w.Qty.toLocaleString()}
                        </div>
                        <div className="text-xs text-gray-400 font-medium mt-1">ชิ้น</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <History size={48} className="mb-4 opacity-30" />
                  <p className="text-lg">ไม่พบประวัติการเบิกของแถมรายการนี้</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
