import { useEffect, useState, Fragment, useMemo } from 'react';
import { Package, Search, Image as ImageIcon, Edit2, Save, X, RefreshCw, Upload, Tag, ArrowUpDown, Ban, RotateCcw } from 'lucide-react';
import { fetchGoods, updateGood, toggleGoodStatus, fetchPrices } from '../../services/api';
import '../../store/app-store';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import type { EMGood, CurrentPrice } from '../../types';

export const GoodsManager = ({ onViewPrices }: { onViewPrices?: (target: { goodId: string; goodCode?: string; goodName?: string }) => void }) => {
  const [goods, setGoods] = useState<EMGood[]>([]);
  const [prices, setPrices] = useState<CurrentPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [showInactive, setShowInactive] = useState(false);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<EMGood>>({});
  const [saving, setSaving] = useState(false);

  const [statusModal, setStatusModal] = useState<{
    good: EMGood;
    targetStatus: 'A' | 'I';
  } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'TotalQtyTon', direction: 'desc' });

  async function loadData() {
    setLoading(true);
    try {
      const [goodsData, pricesData] = await Promise.all([
        fetchGoods({ includeInactive: showInactive }),
        fetchPrices({ custId: '' })
      ]);
      setGoods(goodsData);
      setPrices(pricesData);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [showInactive]);

  // Canonical category ordering matching billing / SO (ยกเว้นส่งเสริมการขายที่ย้ายไปแท็บของแถม)
  const categoryOrder = [
    'ปุ๋ยสูตร บรรจุกระสอบ',
    'แม่ปุ๋ย บรรจุกระสอบ',
    'ภาชนะบรรจุ',
    'วัตถุดิบ',
    'ธาตุอาหาร',
  ];

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    goods.forEach(g => {
      const name = g.GoodGroupName || 'ไม่ระบุกลุ่ม';
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return counts;
  }, [goods]);

  const categories = useMemo(() => {
    const existing = Array.from(categoryCounts.keys());
    existing.sort((a, b) => {
      const idxA = categoryOrder.findIndex(c => a.includes(c) || c.includes(a));
      const idxB = categoryOrder.findIndex(c => b.includes(c) || c.includes(b));
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b, 'th');
    });
    return existing;
  }, [categoryCounts]);

  const filteredGoods = useMemo(() => {
    return goods.filter(g => {
      const matchesSearch = (g.GoodCode ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (g.GoodName ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      const gGroup = g.GoodGroupName || 'ไม่ระบุกลุ่ม';
      const matchesCategory = selectedCategory === 'ALL' || gGroup === selectedCategory;
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
      // R12 item 15: show the server's reason (permission / validation / not found)
      alert('บันทึกไม่สำเร็จ: ' + ((err as Error)?.message || 'ไม่ทราบสาเหตุ'));
      console.error(err);
    }
    setSaving(false);
  };

  const handleStatusConfirm = async () => {
    if (!statusModal) return;
    setStatusLoading(true);
    try {
      await toggleGoodStatus(statusModal.good.GoodID, statusModal.targetStatus);
      if (statusModal.targetStatus === 'I' && !showInactive) {
        setGoods(prev => prev.filter(g => g.GoodID !== statusModal.good.GoodID));
      } else {
        setGoods(prev => prev.map(g => g.GoodID === statusModal.good.GoodID ? { ...g, Inactive: statusModal.targetStatus } : g));
      }
      setStatusModal(null);
    } catch (err: any) {
      alert('ไม่สามารถเปลี่ยนสถานะสินค้าได้: ' + (err?.message || 'ข้อผิดพลาดระบบ'));
      console.error(err);
    }
    setStatusLoading(false);
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
    <div className="h-full flex flex-col gap-4 overflow-hidden w-full max-w-full">
      
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 shrink-0">
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

      <div className="flex-1 grid grid-rows-[auto_auto_1fr_auto] bg-white rounded-none sm:rounded-lg sm:rounded-2xl shadow-sm sm:shadow-sm shadow-none border-y sm:border border-gray-100 overflow-hidden relative min-h-0">
        
        {/* Category Filter Pills (หมวดหมู่สินค้าเหมือนหน้าเปิดบิล) */}
        <div className="px-3 sm:px-4 py-2 border-b border-gray-100 bg-white flex items-center gap-1.5 overflow-x-auto scrollbar-hide shrink-0">
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
              selectedCategory === 'ALL'
                ? 'bg-[#0C447C] text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span>ทั้งหมด</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${selectedCategory === 'ALL' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
              {goods.length}
            </span>
          </button>
          {categories.map(c => {
            const count = categoryCounts.get(c) || 0;
            const isSelected = selectedCategory === c;
            return (
              <button
                key={c}
                onClick={() => setSelectedCategory(c)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-[#0C447C] text-white shadow-xs'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span>{c}</span>
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
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={e => setShowInactive(e.target.checked)}
                className="rounded text-[#0C447C] focus:ring-[#0C447C] w-3.5 h-3.5"
              />
              <span className="font-medium whitespace-nowrap">รวมสินค้างดจำหน่าย</span>
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
                <SortableHeader title="รหัส/ชื่อสินค้า" sortKey="GoodCode" />
                <SortableHeader title="คงเหลือ" sortKey="StockQty" align="right" />
                <SortableHeader title="ยอดขายปีนี้ (ตัน)" sortKey="TotalQtyTonThisYear" align="center" />
                <SortableHeader title="ยอดขายรวม (ตัน)" sortKey="TotalQtyTon" align="center" />
                <th className="px-6 py-4 border-b border-gray-100 text-right whitespace-nowrap">ราคาล่าสุด</th>
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
                      <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูลสินค้า...</p>
                    </div>
                  </td>
                </tr>
              ) : paginatedGoods.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400 whitespace-nowrap">
                    <Package size={32} className="mx-auto mb-3 opacity-30" />
                    <p>ไม่พบข้อมูลสินค้า</p>
                  </td>
                </tr>
              ) : (
                paginatedGoods.map((good) => {
                  const isEditing = editingId === good.GoodID;
                  const ytdSales = good.TotalQtyTonThisYear || 0;
                  const totalSales = good.TotalQtyTon || 0;
                  
                  return (
                    <Fragment key={good.GoodID}>
                      <tr className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-3 whitespace-nowrap">
                          <div className="h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden border border-gray-200">
                            {good.ImageUrl ? (
                              <img src={good.ImageUrl} alt={good.GoodCode} className="h-full w-full object-cover" />
                            ) : (
                              <ImageIcon className="text-gray-400" size={16} />
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap">
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
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <div className="text-xs text-gray-400 font-mono">{good.GoodCode}</div>
                                {good.GoodGroupName && (
                                  <span className="bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-semibold">
                                    {good.GoodGroupName}
                                  </span>
                                )}
                                {good.Inactive === 'I' && (
                                  <span className="bg-red-50 text-red-700 text-[10px] px-2 py-0.5 rounded-full font-semibold border border-red-200">
                                    งดจำหน่ายชั่วคราว
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right whitespace-nowrap">
                          <div className="font-bold text-[#0C447C]">{good.StockQty ? good.StockQty.toLocaleString() : '0'}</div>
                        </td>
                        <td className="px-6 py-3 text-center whitespace-nowrap">
                          <span className={`inline-flex items-center justify-center font-bold h-7 min-w-[28px] rounded-full px-2 ${ytdSales > 0 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                            {ytdSales.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-center whitespace-nowrap">
                          <span className={`inline-flex items-center justify-center font-bold h-7 min-w-[28px] rounded-full px-2 ${totalSales > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                            {totalSales.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right whitespace-nowrap">
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
                        <td className="px-6 py-3 text-gray-600 whitespace-nowrap">
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
                        <td className="px-6 py-3 text-right whitespace-nowrap">
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
                                <button 
                                  onClick={() => onViewPrices({ goodId: good.GoodID, goodCode: good.GoodCode, goodName: good.GoodName })} 
                                  className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center" 
                                  title="ดูราคาขาย (Pricelist)"
                                >
                                  <Tag size={16} />
                                </button>
                              )}
                              <button onClick={() => handleEdit(good)} className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center" title="แก้ไขสเปค/รูปภาพ">
                                <Edit2 size={16} />
                              </button>
                              {good.Inactive === 'I' ? (
                                <button 
                                  onClick={() => setStatusModal({ good, targetStatus: 'A' })} 
                                  className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors inline-flex items-center justify-center" 
                                  title="เปิดจำหน่ายอีกครั้ง (Restore)"
                                >
                                  <RotateCcw size={16} />
                                </button>
                              ) : (
                                <button 
                                  onClick={() => setStatusModal({ good, targetStatus: 'I' })} 
                                  className="p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors inline-flex items-center justify-center" 
                                  title="งดจำหน่ายชั่วคราว (Soft-Delete)"
                                >
                                  <Ban size={16} />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                      {isEditing && (
                        <tr className="bg-blue-50/30">
                          <td colSpan={7} className="px-6 py-4 border-t border-blue-100 whitespace-nowrap">
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

      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${statusModal.targetStatus === 'I' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                {statusModal.targetStatus === 'I' ? <Ban size={20} /> : <RotateCcw size={20} />}
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-base">
                  {statusModal.targetStatus === 'I' ? 'ยืนยันงดจำหน่ายสินค้านี้ชั่วคราว' : 'ยืนยันเปิดจำหน่ายสินค้าอีกครั้ง'}
                </h3>
                <p className="text-xs text-gray-500 font-mono mt-0.5">
                  [{statusModal.good.GoodCode}] {statusModal.good.GoodName}
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-6 leading-relaxed">
              {statusModal.targetStatus === 'I'
                ? 'ระบบจะทำ Soft-Delete โดยกำหนดสถานะเป็น Inactive เพื่อซ่อนสินค้านี้จากหน้ารายการสินค้า ใบเสนอราคา ออกบิลขาย และการจัดทำตารางราคา (Pricelist) โดยไม่กระทบต่อประวัติบิลย้อนหลังใน WinSpeed และสามารถเปิดจำหน่ายใหม่ได้ตลอดเวลา'
                : 'สินค้าจะกลับมาแสดงในรายการสินค้า ใบเสนอราคา ออกบิลขาย และสามารถทำตารางราคาได้ตามปกติ'}
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
                {statusModal.targetStatus === 'I' ? 'งดจำหน่ายชั่วคราว' : 'เปิดจำหน่าย'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
