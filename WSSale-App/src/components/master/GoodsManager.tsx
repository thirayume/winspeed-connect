import { useEffect, useState, Fragment, useMemo } from 'react';
import { Package, Search, Image as ImageIcon, Edit2, Save, X, RefreshCw, Upload, Tag, Trash2, ArrowUpDown } from 'lucide-react';
import { fetchGoods, updateGood, fetchPrices, getToken } from '../../services/api';
import { useAppStore } from '../../store/app-store';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import { DeleteConfirmModal } from '../ui/DeleteConfirmModal';
import type { EMGood, EMSetPriceDT } from '../../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';


export const GoodsManager = ({ onViewPrices }: { onViewPrices?: (goodName: string) => void }) => {
  const [goods, setGoods] = useState<EMGood[]>([]);
  const [prices, setPrices] = useState<EMSetPriceDT[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<EMGood>>({});
  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'TotalQtyTon', direction: 'desc' });

  async function loadData() {
    setLoading(true);
    try {
      const [goodsData, pricesData] = await Promise.all([
        fetchGoods(),
        fetchPrices({ custId: '' })
      ]);
      setGoods(goodsData.filter(g => g.Inactive !== 'I'));
      setPrices(pricesData);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    goods.forEach(g => {
      if (g.GoodGroupName) cats.add(g.GoodGroupName);
    });
    return Array.from(cats).sort();
  }, [goods]);

  const filteredGoods = useMemo(() => {
    return goods.filter(g => {
      const matchesSearch = (g.GoodCode ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (g.GoodName ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'ALL' || g.GoodGroupName === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [goods, searchQuery, selectedCategory]);

  const sortedGoods = useMemo(() => {
    const sortableItems = [...filteredGoods];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        let aVal: any = a[sortConfig.key as keyof EMGood];
        let bVal: any = b[sortConfig.key as keyof EMGood];
        
        if (sortConfig.key === 'StockQty') {
          aVal = Number(aVal) || 0;
          bVal = Number(bVal) || 0;
        }

        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredGoods, sortConfig]);

  const totalPages = Math.ceil(sortedGoods.length / itemsPerPage);
  const paginatedGoods = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedGoods.slice(start, start + itemsPerPage);
  }, [sortedGoods, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const handleEdit = (good: EMGood) => {
    setEditingId(good.GoodID);
    setEditForm({ ...good });
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await updateGood(editingId, editForm);
      setGoods(prev => prev.map(g => g.GoodID === editingId ? { ...g, ...editForm } as EMGood : g));
      setEditingId(null);
    } catch (err) {
      alert('บันทึกไม่สำเร็จ');
      console.error(err);
    }
    setSaving(false);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteLoading(true);
    try {
      await fetch(`${API_BASE}/master/goods/${deletingId}`, { 
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      setGoods(prev => prev.filter(g => g.GoodID !== deletingId));
      setDeletingId(null);
    } catch (err) {
      alert('ไม่สามารถลบข้อมูลได้');
      console.error(err);
    }
    setDeleteLoading(false);
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

  const SortableHeader = ({ title, sortKey, align = 'left' }: { title: string, sortKey: string, align?: 'left'|'center'|'right' }) => (
    <th className={`px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors text-${align}`} onClick={() => requestSort(sortKey)}>
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        {title}
        <ArrowUpDown size={12} className={`text-gray-400 ${sortConfig.key === sortKey ? 'text-[#0C447C] font-bold' : ''}`} />
      </div>
    </th>
  );

  const totalYtd = useMemo(() => goods.reduce((sum, g) => sum + (g.TotalQtyTonThisYear || 0), 0), [goods]);
  const activeCount = goods.length;

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        <DataSummaryCard
          title="สินค้าทั้งหมด"
          value={activeCount.toLocaleString()}
          icon={<Package size={24} />}
          colorClass="bg-blue-100 text-blue-600"
        />
        <DataSummaryCard
          title="ค้นพบ"
          value={filteredGoods.length.toLocaleString()}
          icon={<Search size={24} />}
          colorClass="bg-emerald-100 text-emerald-600"
        />
        <DataSummaryCard
          title="ยอดขายรวมปีนี้ (ตัน)"
          value={totalYtd.toLocaleString()}
          icon={<Tag size={24} />}
          colorClass="bg-orange-100 text-orange-600"
        />
      </div>

      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4 bg-gray-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="ค้นหารหัส หรือ ชื่อสินค้า..."
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
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <select 
              value={selectedCategory} 
              onChange={e => setSelectedCategory(e.target.value)}
              className="px-3 py-1.5 text-xs font-semibold rounded-md transition-colors bg-white text-gray-800 shadow-sm focus:outline-none cursor-pointer border-none"
            >
              <option value="ALL">ทุกหมวดหมู่</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={loadData} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors ml-auto">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 sticky top-0 z-10 text-gray-600 font-semibold text-xs uppercase tracking-wider shadow-sm">
              <tr>
                <th className="px-6 py-4 border-b border-gray-100 w-16">รูปภาพ</th>
                <SortableHeader title="รหัส/ชื่อสินค้า" sortKey="GoodCode" />
                <SortableHeader title="คงเหลือ" sortKey="StockQty" align="right" />
                <SortableHeader title="ยอดขายปีนี้ (ตัน)" sortKey="TotalQtyTonThisYear" align="center" />
                <SortableHeader title="ยอดขายรวม (ตัน)" sortKey="TotalQtyTon" align="center" />
                <th className="px-6 py-4 border-b border-gray-100 text-right">ราคาล่าสุด</th>
                <th className="px-6 py-4 border-b border-gray-100">สเปค</th>
                <th className="px-6 py-4 border-b border-gray-100 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-[#0C447C]">
                      <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
                      <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูลสินค้า...</p>
                    </div>
                  </td>
                </tr>
              ) : paginatedGoods.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                    <Package size={32} className="mx-auto mb-3 opacity-30" />
                    <p>ไม่พบข้อมูลสินค้า</p>
                  </td>
                </tr>
              ) : (
                paginatedGoods.map((good, idx) => {
                  const isEditing = editingId === good.GoodID;
                  const ytdSales = good.TotalQtyTonThisYear || 0;
                  const totalSales = good.TotalQtyTon || 0;
                  
                  return (
                    <Fragment key={good.GoodID}>
                      <tr className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-3">
                          <div className="h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden border border-gray-200">
                            {good.ImageUrl ? (
                              <img src={good.ImageUrl} alt={good.GoodCode} className="h-full w-full object-cover" />
                            ) : (
                              <ImageIcon className="text-gray-400" size={16} />
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-3">
                          {isEditing ? (
                            <div className="space-y-1">
                              <div className="text-xs text-gray-500 font-mono">{good.GoodCode}</div>
                              <input 
                                type="text" 
                                value={editForm.GoodName || ''} 
                                onChange={e => setEditForm({ ...editForm, GoodName: e.target.value })}
                                className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#0C447C]"
                              />
                            </div>
                          ) : (
                            <div>
                              <div className="font-bold text-gray-800 text-sm whitespace-normal">{good.GoodName}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <div className="text-xs text-gray-400 font-mono">{good.GoodCode}</div>
                                {good.GoodGroupName && (
                                  <span className="bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-semibold">
                                    {good.GoodGroupName}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <div className="font-bold text-[#0C447C]">{good.StockQty ? good.StockQty.toLocaleString() : '0'}</div>
                        </td>
                        <td className="px-6 py-3 text-center">
                          <span className={`inline-flex items-center justify-center font-bold h-7 min-w-[28px] rounded-full px-2 ${ytdSales > 0 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                            {ytdSales.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-center">
                          <span className={`inline-flex items-center justify-center font-bold h-7 min-w-[28px] rounded-full px-2 ${totalSales > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                            {totalSales.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          {(() => {
                            const pObj = prices.find(p => p.GoodID === good.GoodID);
                            if (!pObj || !pObj.GoodPriceNet) return <div className="text-xs text-orange-400 font-medium">ไม่มีข้อมูล</div>;
                            const isExpired = pObj.IsExpired === 1;
                            return (
                              <div>
                                <div className={`font-bold text-sm ${isExpired ? 'text-red-600' : 'text-[#0C447C]'}`}>
                                  ฿{pObj.GoodPriceNet.toLocaleString()}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-3 text-gray-600">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input 
                                type="number" 
                                value={editForm.BagPerTon || ''} 
                                onChange={e => setEditForm({ ...editForm, BagPerTon: Number(e.target.value) })}
                                className="w-16 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#0C447C]"
                              /> กระสอบ/ตัน
                              <input 
                                type="number" 
                                value={editForm.WeightKgPerBag || ''} 
                                onChange={e => setEditForm({ ...editForm, WeightKgPerBag: Number(e.target.value) })}
                                className="w-16 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#0C447C]"
                              /> กก.
                            </div>
                          ) : (
                            <div className="text-xs">
                              {good.BagPerTon} กระสอบ/ตัน <br/>
                              <span className="text-gray-400">{good.WeightKgPerBag} กก./กระสอบ</span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                                <X size={16} />
                              </button>
                              <button onClick={handleSave} disabled={saving} className="p-1.5 text-white bg-[#0C447C] hover:bg-[#0a3866] rounded disabled:opacity-50 flex items-center gap-1 text-xs">
                                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} บันทึก
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              {onViewPrices && (
                                <button onClick={() => onViewPrices(good.GoodName)} className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center" title="ดูประวัติการปรับราคา">
                                  <Tag size={16} />
                                </button>
                              )}
                              <button onClick={() => handleEdit(good)} className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center" title="แก้ไขราคากลาง">
                                <Edit2 size={16} />
                              </button>
                              <button onClick={() => setDeletingId(good.GoodID)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center justify-center" title="ปิดสถานะ (Inactive)">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isEditing && (
                        <tr className="bg-blue-50/30">
                          <td colSpan={7} className="px-6 py-4 border-t border-blue-100">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                              <span className="text-sm font-medium text-gray-700 whitespace-nowrap">รูปภาพสินค้า:</span>
                              <label className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm shadow-sm transition-colors">
                                <Upload size={14} className="text-gray-600" />
                                <span className="text-gray-700 font-medium">อัปโหลดรูปภาพ</span>
                                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                              </label>
                              <div className="flex-1 flex items-center gap-2">
                                <span className="text-xs text-gray-400">หรือระบุ URL:</span>
                                <input 
                                  type="text" 
                                  placeholder="https://example.com/image.png"
                                  value={editForm.ImageUrl || ''} 
                                  onChange={e => setEditForm({ ...editForm, ImageUrl: e.target.value })}
                                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#0C447C] focus:ring-1 focus:ring-[#0C447C]"
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <span className="text-sm text-gray-500">
              แสดง {((currentPage - 1) * itemsPerPage) + 1} ถึง {Math.min(currentPage * itemsPerPage, filteredGoods.length)} จาก {filteredGoods.length}
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

      <DeleteConfirmModal
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDeleteConfirm}
        title="ยืนยันการลบสินค้า"
        itemName={goods.find(g => g.GoodID === deletingId)?.GoodName || ''}
        loading={deleteLoading}
      />
    </div>
  );
};
