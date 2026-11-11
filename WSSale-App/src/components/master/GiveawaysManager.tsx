import { useEffect, useState, useMemo } from 'react';
import { Gift, Search, RefreshCw, History, X, Calendar, MapPin, User, ArrowUpDown, Image as ImageIcon, Edit2, Save, Upload, Ban, RotateCcw } from 'lucide-react';
import { fetchGiveawayItems, fetchGiveawayWithdrawals, fetchGiveawayRegions, updateGood, toggleGoodStatus } from '../../services/api';
import { formatThaiDate } from '../../utils/date';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import { appAlert } from '../ui/AppAlert';
import type { GiveawayItem, GiveawayWithdrawal } from '../../types';

export const GiveawaysManager = () => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<GiveawayItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState<string>('ALL');
  const [showInactive, setShowInactive] = useState(false);
  
  // History Modal
  const [selectedItem, setSelectedItem] = useState<GiveawayItem | null>(null);
  const [withdrawals, setWithdrawals] = useState<GiveawayWithdrawal[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [regionsMap, setRegionsMap] = useState<Record<string, string>>({});

  // Edit Modal
  const [editingItem, setEditingItem] = useState<GiveawayItem | null>(null);
  const [editForm, setEditForm] = useState<{
    GoodName?: string;
    BagPerTon?: number;
    WeightKgPerBag?: number;
    ImageUrl?: string;
  }>({});
  const [saving, setSaving] = useState(false);

  // Status Change Modal (Soft Delete / Restore)
  const [statusModal, setStatusModal] = useState<{
    item: GiveawayItem;
    targetStatus: 'A' | 'I';
  } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'GoodCode', direction: 'asc' });

  async function loadData() {
    setLoading(true);
    try {
      const [data, regionsData] = await Promise.all([
        fetchGiveawayItems({ includeInactive: showInactive }),
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
  }, [showInactive]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedBrand]);

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

  const handleStartEdit = (item: GiveawayItem) => {
    setEditingItem(item);
    setEditForm({
      GoodName: item.GoodName || item.ItemName,
      BagPerTon: item.BagPerTon ?? 20,
      WeightKgPerBag: item.WeightKgPerBag ?? 50.0,
      ImageUrl: item.ImageUrl || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const goodId = String(editingItem.GoodID || editingItem.Id);
    setSaving(true);
    try {
      await updateGood(goodId, {
        GoodName: editForm.GoodName,
        BagPerTon: editForm.BagPerTon,
        WeightKgPerBag: editForm.WeightKgPerBag,
        ImageUrl: editForm.ImageUrl,
      });
      setItems(prev => prev.map(i => {
        if (String(i.GoodID || i.Id) === goodId) {
          return {
            ...i,
            GoodName: editForm.GoodName || i.GoodName,
            ItemName: editForm.GoodName || i.ItemName,
            BagPerTon: editForm.BagPerTon,
            WeightKgPerBag: editForm.WeightKgPerBag,
            ImageUrl: editForm.ImageUrl,
          };
        }
        return i;
      }));
      setEditingItem(null);
    } catch (err: any) {
      await appAlert('บันทึกไม่สำเร็จ: ' + (err?.message || 'ข้อผิดพลาดระบบ'), 'error');
    }
    setSaving(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setEditForm(prev => ({ ...prev, ImageUrl: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const handleStatusConfirm = async () => {
    if (!statusModal) return;
    const goodId = String(statusModal.item.GoodID || statusModal.item.Id);
    setStatusLoading(true);
    try {
      await toggleGoodStatus(goodId, statusModal.targetStatus);
      if (statusModal.targetStatus === 'I' && !showInactive) {
        setItems(prev => prev.filter(i => String(i.GoodID || i.Id) !== goodId));
      } else {
        setItems(prev => prev.map(i => String(i.GoodID || i.Id) === goodId ? { ...i, Inactive: statusModal.targetStatus } : i));
      }
      setStatusModal(null);
    } catch (err: any) {
      await appAlert('ไม่สามารถเปลี่ยนสถานะได้: ' + (err?.message || 'ข้อผิดพลาดระบบ'), 'error');
    }
    setStatusLoading(false);
  };

  const brandCounts = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach(i => {
      const b = i.Brand || 'ส่วนกลาง';
      map.set(b, (map.get(b) || 0) + 1);
    });
    return map;
  }, [items]);

  const brands = useMemo(() => {
    const list = Array.from(brandCounts.keys());
    return list.sort();
  }, [brandCounts]);

  const filteredItems = useMemo(() => {
    return items.filter(i => {
      const matchesSearch = 
        (i.ItemName ?? '').toLowerCase().includes(searchQuery.toLowerCase()) || 
        (i.GoodCode ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (i.Brand ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesBrand = selectedBrand === 'ALL' || (i.Brand || 'ส่วนกลาง') === selectedBrand;
      return matchesSearch && matchesBrand;
    });
  }, [items, searchQuery, selectedBrand]);

  const sortedItems = useMemo(() => {
    const sortableItems = [...filteredItems];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        let aVal: any = a[sortConfig.key as keyof GiveawayItem];
        let bVal: any = b[sortConfig.key as keyof GiveawayItem];
        if (sortConfig.key === 'StockQty' || sortConfig.key === 'Id') {
           aVal = Number(aVal) || 0;
           bVal = Number(bVal) || 0;
        } else {
           aVal = String(aVal || '');
           bVal = String(bVal || '');
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

  const SortableHeader = ({ title, sortKey, align = 'left' }: { title: string; sortKey: string; align?: 'left'|'center'|'right' }) => (
    <th className={`px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors text-${align}`} onClick={() => requestSort(sortKey)}>
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        {title}
        <ArrowUpDown size={12} className={`text-gray-400 ${sortConfig.key === sortKey ? 'text-[#0C447C] font-bold' : ''}`} />
      </div>
    </th>
  );

  const totalStockQty = useMemo(() => {
    return items.reduce((sum, i) => sum + (Number(i.StockQty) || 0), 0);
  }, [items]);

  const inactiveCount = useMemo(() => {
    return items.filter(i => i.Inactive === 'I').length;
  }, [items]);

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 shrink-0">
        <DataSummaryCard
          title="ของแถมทั้งหมด"
          value={items.length.toLocaleString()}
          icon={<Gift size={24} />}
          subtitle="กลุ่มส่งเสริมการขาย"
          colorClass="bg-blue-100 text-blue-600"
        />
        <DataSummaryCard
          title="ค้นพบ"
          value={filteredItems.length.toLocaleString()}
          icon={<Search size={24} />}
          subtitle="ตามเงื่อนไขค้นหา"
          colorClass="bg-emerald-100 text-emerald-600"
        />
        <DataSummaryCard
          title="สต็อกคงเหลือรวม"
          value={totalStockQty.toLocaleString()}
          icon={<Gift size={24} />}
          subtitle="ชิ้น / หน่วย"
          colorClass="bg-indigo-100 text-indigo-600"
        />
        <DataSummaryCard
          title="งดจำหน่าย / ซ่อน"
          value={inactiveCount.toLocaleString()}
          icon={<Ban size={24} />}
          subtitle="Inactive items"
          colorClass="bg-red-100 text-red-600"
        />
      </div>

      <div className="flex-1 grid grid-rows-[auto_auto_1fr_auto] bg-white rounded-none sm:rounded-2xl shadow-sm border-y sm:border border-gray-100 overflow-hidden relative min-h-0">
        {/* Brand Filter Pills */}
        <div className="px-3 sm:px-4 py-2 border-b border-gray-100 bg-white flex items-center gap-1.5 overflow-x-auto scrollbar-hide shrink-0">
          <button
            onClick={() => setSelectedBrand('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
              selectedBrand === 'ALL'
                ? 'bg-[#0C447C] text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span>ทั้งหมด</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${selectedBrand === 'ALL' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
              {items.length}
            </span>
          </button>
          {brands.map(b => {
            const count = brandCounts.get(b) || 0;
            const isSelected = selectedBrand === b;
            return (
              <button
                key={b}
                onClick={() => setSelectedBrand(b)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-[#0C447C] text-white shadow-xs'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span>{b}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${isSelected ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Toolbar */}
        <div className="p-2 sm:p-4 border-b border-gray-100 flex flex-row items-center gap-2 bg-gray-50/50 overflow-x-auto scrollbar-hide w-full">
          <div className="relative flex-1 min-w-[140px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="ค้นหารหัส หรือ ชื่อของแถม หรือ แบรนด์..."
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
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={e => setShowInactive(e.target.checked)}
                className="rounded text-[#0C447C] focus:ring-[#0C447C] w-3.5 h-3.5"
              />
              <span className="font-medium whitespace-nowrap">รวมของแถมงดจำหน่าย</span>
            </label>
            <button onClick={loadData} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors" title="โหลดข้อมูลใหม่">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="overflow-auto min-h-0 relative">
          <table className="w-full text-sm text-left min-w-full">
            <thead className="bg-gray-50 sticky top-0 z-10 text-gray-600 font-semibold text-xs uppercase tracking-wider shadow-sm whitespace-nowrap">
              <tr>
                <th className="px-6 py-4 border-b border-gray-100 w-16 whitespace-nowrap">รูปภาพ</th>
                <SortableHeader title="รหัส / ชื่อของแถม" sortKey="GoodCode" />
                <SortableHeader title="แบรนด์" sortKey="Brand" />
                <SortableHeader title="ประเภท" sortKey="ItemType" />
                <SortableHeader title="คงเหลือ" sortKey="StockQty" align="right" />
                <th className="px-6 py-4 border-b border-gray-100 whitespace-nowrap">สเปค</th>
                <th className="px-6 py-4 border-b border-gray-100 text-right whitespace-nowrap">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center whitespace-nowrap">
                    <div className="flex flex-col items-center justify-center text-[#0C447C]">
                      <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
                      <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูลของแถม...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400 whitespace-nowrap">
                    <Gift size={32} className="mx-auto mb-3 opacity-30" />
                    <p>ไม่พบรายการของแถม</p>
                  </td>
                </tr>
              ) : (
                paginatedItems.map(item => (
                  <tr key={item.Id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-3 whitespace-nowrap">
                      <div className="h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden border border-gray-200">
                        {item.ImageUrl ? (
                          <img src={item.ImageUrl} alt={item.GoodCode || item.ItemName} className="h-full w-full object-cover" />
                        ) : (
                          <ImageIcon className="text-gray-400" size={16} />
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <div className="font-bold text-gray-800 text-sm whitespace-normal">{item.ItemName}</div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {item.GoodCode && (
                          <span className="text-xs text-gray-400 font-mono">{item.GoodCode}</span>
                        )}
                        <span className="text-[10px] text-gray-400 font-mono">ID: {item.Id}</span>
                        {item.Inactive === 'I' && (
                          <span className="bg-red-50 text-red-700 text-[10px] px-2 py-0.5 rounded-full font-semibold border border-red-200">
                            งดจำหน่ายชั่วคราว
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <span className="bg-blue-50 text-[#0C447C] border border-blue-200 px-2.5 py-1 rounded-full text-xs font-semibold">
                        {item.Brand}
                      </span>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">
                        {item.ItemType}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right whitespace-nowrap">
                      <div className="font-bold text-[#0C447C]">
                        {item.StockQty ? item.StockQty.toLocaleString() : '0'}
                      </div>
                      <div className="text-[11px] text-gray-400">{item.Unit || 'ชิ้น'}</div>
                    </td>
                    <td className="px-6 py-3 text-gray-600 whitespace-nowrap text-xs">
                      <div>{item.BagPerTon ?? 20} กระสอบ/ตัน</div>
                      <div className="text-gray-400">{item.WeightKgPerBag ?? 50} กก./กระสอบ</div>
                    </td>
                    <td className="px-6 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          title="แก้ไขสเปค / รูปภาพ"
                          onClick={() => handleStartEdit(item)}
                          className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          title="ดูประวัติการเบิกของแถม"
                          onClick={() => handleViewHistory(item)}
                          className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center"
                        >
                          <History size={16} />
                        </button>
                        {item.Inactive === 'I' ? (
                          <button 
                            onClick={() => setStatusModal({ item, targetStatus: 'A' })} 
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors inline-flex items-center justify-center" 
                            title="เปิดใช้งานอีกครั้ง (Restore)"
                          >
                            <RotateCcw size={16} />
                          </button>
                        ) : (
                          <button 
                            onClick={() => setStatusModal({ item, targetStatus: 'I' })} 
                            className="p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors inline-flex items-center justify-center" 
                            title="งดจำหน่ายชั่วคราว (Soft-Delete)"
                          >
                            <Ban size={16} />
                          </button>
                        )}
                      </div>
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

      {/* Edit Specs & Image Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-[#0C447C] flex items-center justify-center">
                  <Edit2 size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-base">แก้ไขข้อมูลของแถม</h3>
                  <p className="text-xs text-gray-500 font-mono">[{editingItem.GoodCode || editingItem.Id}] {editingItem.ItemName}</p>
                </div>
              </div>
              <button onClick={() => setEditingItem(null)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">ชื่อของแถม</label>
                <input
                  type="text"
                  value={editForm.GoodName || ''}
                  onChange={e => setEditForm(prev => ({ ...prev, GoodName: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0C447C]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">จำนวนบรรจุ (กระสอบ/ตัน)</label>
                  <input
                    type="number"
                    value={editForm.BagPerTon ?? 20}
                    onChange={e => setEditForm(prev => ({ ...prev, BagPerTon: Number(e.target.value) || 20 }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0C447C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">น้ำหนัก (กก./กระสอบ)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editForm.WeightKgPerBag ?? 50.0}
                    onChange={e => setEditForm(prev => ({ ...prev, WeightKgPerBag: Number(e.target.value) || 50.0 }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0C447C]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">รูปภาพของแถม</label>
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden border border-gray-200 shrink-0">
                    {editForm.ImageUrl ? (
                      <img src={editForm.ImageUrl} alt="Preview" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="text-gray-400" size={24} />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-xs font-medium text-gray-700 shadow-2xs">
                      <Upload size={14} /> อัปโหลดไฟล์รูป
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    </label>
                    <input
                      type="text"
                      placeholder="หรือระบุ Image URL (https://...)"
                      value={editForm.ImageUrl || ''}
                      onChange={e => setEditForm(prev => ({ ...prev, ImageUrl: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#0C447C]"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-100 flex justify-end gap-2.5">
              <button
                onClick={() => setEditingItem(null)}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 rounded-lg transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold text-white bg-[#0C447C] hover:bg-[#093561] rounded-lg transition flex items-center gap-1.5 shadow-2xs"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                บันทึกการแก้ไข
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
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
                  <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
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

            <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-50/50">
              {historyLoading ? (
                <div className="flex flex-col items-center justify-center h-64 text-[#0C447C]">
                  <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
                  <p className="text-sm font-medium animate-pulse opacity-70">กำลังดึงประวัติการเบิก...</p>
                </div>
              ) : withdrawals.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <History size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-base font-medium">ยังไม่พบประวัติการเบิกสำหรับรายการนี้</p>
                  <p className="text-xs text-gray-400 mt-1">รายการนี้ยังไม่มีการบันทึกการเบิกใช้งานในระบบ</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-2">
                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
                      <div className="text-xs text-gray-500">จำนวนครั้งที่เบิก</div>
                      <div className="text-xl font-bold text-gray-800 mt-1">{withdrawals.length} ครั้ง</div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
                      <div className="text-xs text-gray-500">ยอดเบิกรวมทั้งหมด</div>
                      <div className="text-xl font-bold text-[#0C447C] mt-1">
                        {withdrawals.reduce((sum, w) => sum + w.Qty, 0).toLocaleString()} ชิ้น
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
                      <div className="text-xs text-gray-500">เบิกล่าสุดเมื่อ</div>
                      <div className="text-sm font-bold text-gray-800 mt-2">
                        {withdrawals[0]?.CreatedAt ? formatThaiDate(withdrawals[0].CreatedAt) : '-'}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-gray-50 text-gray-600 font-semibold text-xs uppercase tracking-wider border-b border-gray-100">
                        <tr>
                          <th className="px-6 py-3.5">วันที่เบิก</th>
                          <th className="px-6 py-3.5">ภาค</th>
                          <th className="px-6 py-3.5">ผู้รับผิดชอบภาค</th>
                          <th className="px-6 py-3.5 text-right">จำนวนที่เบิก</th>
                          <th className="px-6 py-3.5">หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {withdrawals.map((w, idx) => (
                          <tr key={w.Id || idx} className="hover:bg-gray-50/50">
                            <td className="px-6 py-3.5 whitespace-nowrap text-gray-600 flex items-center gap-2">
                              <Calendar size={14} className="text-gray-400" />
                              {formatThaiDate(w.CreatedAt)}
                            </td>
                            <td className="px-6 py-3.5 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                                <MapPin size={12} className="text-gray-500" />
                                {w.Region}
                              </span>
                            </td>
                            <td className="px-6 py-3.5 whitespace-nowrap text-gray-600">
                              <span className="inline-flex items-center gap-1.5">
                                <User size={14} className="text-gray-400" />
                                {regionsMap[w.Region] || '-'}
                              </span>
                            </td>
                            <td className="px-6 py-3.5 whitespace-nowrap text-right font-bold text-[#0C447C]">
                              {w.Qty.toLocaleString()} ชิ้น
                            </td>
                            <td className="px-6 py-3.5 text-gray-500 text-xs">
                              {w.Note || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end shrink-0">
              <button 
                onClick={() => setSelectedItem(null)}
                className="px-5 py-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-semibold transition-colors shadow-2xs"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Modal (Soft Delete / Restore) */}
      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${statusModal.targetStatus === 'I' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                {statusModal.targetStatus === 'I' ? <Ban size={20} /> : <RotateCcw size={20} />}
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-base">
                  {statusModal.targetStatus === 'I' ? 'ยืนยันงดจำหน่าย / ซ่อนของแถมนี้' : 'ยืนยันเปิดใช้งานของแถมอีกครั้ง'}
                </h3>
                <p className="text-xs text-gray-500 font-mono mt-0.5">
                  [{statusModal.item.GoodCode || statusModal.item.Id}] {statusModal.item.ItemName}
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-6 leading-relaxed">
              {statusModal.targetStatus === 'I'
                ? 'ระบบจะทำ Soft-Delete โดยกำหนด Inactive = \'I\' เพื่อซ่อนรายการนี้จากระบบของแถมและการเปิดบิล โดยไม่กระทบต่อประวัติการเบิกย้อนหลังใน WinSpeed และสามารถเปิดใช้งานใหม่ได้ตลอดเวลา'
                : 'รายการของแถมจะกลับมาแสดงและใช้งานในการเบิกหรือจัดแคมเปญได้ตามปกติ'}
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setStatusModal(null)}
                disabled={statusLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleStatusConfirm}
                disabled={statusLoading}
                className={`px-4 py-2 text-sm font-semibold text-white rounded-lg transition flex items-center gap-1.5 ${
                  statusModal.targetStatus === 'I'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {statusLoading && <RefreshCw size={14} className="animate-spin" />}
                {statusModal.targetStatus === 'I' ? 'งดจำหน่ายชั่วคราว' : 'เปิดใช้งาน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
