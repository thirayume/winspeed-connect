import { useEffect, useState, useMemo, Fragment } from 'react';
import { Tag, Search, RefreshCw, X, Edit2, Save, PlusCircle, AlertCircle, Clock, History, CheckSquare, Square, ChevronDown, ChevronRight, FileText, Calendar, ArrowUpDown } from 'lucide-react';
import { fetchPrices, fetchGoods, fetchCustomers, updatePrice, createPrice, bulkExtendPrices } from '../../services/api';
import type { CurrentPrice } from '../../types';
import { formatThaiDate } from '../../utils/date';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { DataSummaryCard } from '../ui/DataSummaryCard';

type GroupedPrice = {
  key: string;
  main: CurrentPrice;
  history: CurrentPrice[];
};

export const PricesManager = ({ initialSearch = '' }: { initialSearch?: string }) => {
  const [loading, setLoading] = useState(true);
  const [prices, setPrices] = useState<CurrentPrice[]>([]);
  const [goodsMap, setGoodsMap] = useState<Record<string, { name: string; category?: string }>>({});
  const [custMap, setCustMap] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'EXPIRED_SOON' | 'EXPIRED'>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ price: number; beginDate: string; endDate: string }>({ price: 0, beginDate: '', endDate: '' });
  
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [extendForm, setExtendForm] = useState<{ price: number; beginDate: string; endDate: string }>({ price: 0, beginDate: '', endDate: '' });

  const [saving, setSaving] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectedHistoryGroup, setSelectedHistoryGroup] = useState<GroupedPrice | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkEndDate, setBulkEndDate] = useState<string>(`${new Date().getFullYear()}-12-31`); // สิ้นปี
  const [bulkPrices, setBulkPrices] = useState<Record<string, number>>({});

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'GoodID', direction: 'asc' });

  async function loadData() {
    setLoading(true);
    setSelectedKeys(new Set());
    try {
      const [pricesData, goodsData, custData] = await Promise.all([
        fetchPrices(),
        fetchGoods(),
        fetchCustomers()
      ]);
      
      const gMap: Record<string, { name: string; category?: string }> = {};
      goodsData.forEach(g => { gMap[g.GoodID] = { name: g.GoodName, category: g.GoodGroupName }; });
      setGoodsMap(gMap);

      const cMap: Record<string, string> = {};
      custData.forEach(c => { cMap[c.CustID] = c.CustName; });
      setCustMap(cMap);

      setPrices(pricesData);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const getStatusInfo = (p: CurrentPrice) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();
    
    const bDate = p.BeginDate ? new Date(p.BeginDate).getTime() : 0;
    const eDate = p.EndDate ? new Date(p.EndDate).getTime() : 0;
    
    let statusObj = { label: 'ใช้งานอยู่', color: 'bg-green-100 text-green-700' };
    
    if (eDate && eDate < todayTime) {
      statusObj = { label: 'หมดอายุ', color: 'bg-red-100 text-red-700' };
    } else if (bDate && bDate > todayTime) {
      statusObj = { label: 'รอประกาศใช้', color: 'bg-yellow-100 text-yellow-700' };
    }

    let warning = null;
    if (statusObj.label === 'ใช้งานอยู่' && eDate) {
      const diffDays = Math.ceil((eDate - todayTime) / (1000 * 3600 * 24));
      if (diffDays <= 45 && diffDays > 0) {
        warning = `หมดอายุใน ${diffDays} วัน`;
      } else if (diffDays === 0) {
        warning = 'หมดอายุวันนี้';
      }
    }
    
    return { ...statusObj, warning };
  };

  const groupedPrices = useMemo(() => {
    const map = new Map<string, CurrentPrice[]>();
    prices.forEach(p => {
      const k = `${p.CustID || 'DEFAULT'}-${p.GoodID}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    });

    const groups: GroupedPrice[] = [];
    map.forEach((list, key) => {
      groups.push({ key, main: list[0], history: list.slice(1) });
    });
    return groups;
  }, [prices]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    Object.values(goodsMap).forEach(g => {
      if (g.category) cats.add(g.category);
    });
    return Array.from(cats).sort();
  }, [goodsMap]);

  const filteredGroups = useMemo(() => {
    return groupedPrices.filter(g => {
      const goodData = goodsMap[g.main.GoodID];
      const goodName = goodData?.name || g.main.GoodID;
      const custName = g.main.CustID ? (custMap[g.main.CustID] || g.main.CustID) : 'ราคากลาง (ทุกลูกค้า)';
      const query = searchQuery.toLowerCase();
      const matchesSearch = goodName.toLowerCase().includes(query) || custName.toLowerCase().includes(query);
      if (!matchesSearch) return false;

      if (selectedCategory !== 'ALL' && goodData?.category !== selectedCategory) return false;

      if (statusFilter !== 'ALL') {
        const statusInfo = getStatusInfo(g.main);
        if (statusFilter === 'EXPIRED' && statusInfo.label !== 'หมดอายุ') return false;
        if (statusFilter === 'ACTIVE' && statusInfo.label === 'หมดอายุ') return false;
        if (statusFilter === 'EXPIRED_SOON' && !(statusInfo.label === 'ใช้งานอยู่' && statusInfo.warning)) return false;
      }

      return true;
    });
  }, [groupedPrices, goodsMap, custMap, searchQuery, selectedCategory, statusFilter]);

  const sortedGroups = useMemo(() => {
    const sortableItems = [...filteredGroups];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        let aVal: any = a.main[sortConfig.key as keyof CurrentPrice];
        let bVal: any = b.main[sortConfig.key as keyof CurrentPrice];
        
        if (sortConfig.key === 'GoodName') {
           aVal = goodsMap[a.main.GoodID]?.name || a.main.GoodID;
           bVal = goodsMap[b.main.GoodID]?.name || b.main.GoodID;
        } else if (sortConfig.key === 'CustName') {
           aVal = a.main.CustID ? custMap[a.main.CustID] || a.main.CustID : '';
           bVal = b.main.CustID ? custMap[b.main.CustID] || b.main.CustID : '';
        } else if (sortConfig.key === 'GoodPriceNet') {
           aVal = Number(aVal) || 0;
           bVal = Number(bVal) || 0;
        }

        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredGroups, sortConfig, goodsMap, custMap]);

  const totalPages = Math.ceil(sortedGroups.length / itemsPerPage);
  const paginatedGroups = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedGroups.slice(start, start + itemsPerPage);
  }, [sortedGroups, currentPage]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const SortableHeader = ({ title, sortKey, align = 'left' }: { title: string, sortKey: string, align?: 'left'|'center'|'right' }) => (
    <th className={`px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors text-${align}`} onClick={() => requestSort(sortKey)}>
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        {title}
        <ArrowUpDown size={12} className={`text-gray-400 ${sortConfig.key === sortKey ? 'text-[#0C447C] font-bold' : ''}`} />
      </div>
    </th>
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory, statusFilter]);

  const toggleSelectAll = () => {
    if (selectedKeys.size === paginatedGroups.length && paginatedGroups.length > 0) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(paginatedGroups.map(g => g.key)));
    }
  };

  const toggleSelect = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const handleEdit = (p: CurrentPrice) => {
    if (!p.SetPriceID || !p.ListNo) return alert('ไม่สามารถแก้ไขราคานี้ได้');
    setEditingId(`${p.SetPriceID}-${p.ListNo}`);
    setExtendingId(null);
    setEditForm({
      price: p.GoodPriceNet,
      beginDate: p.BeginDate ? new Date(p.BeginDate).toISOString().split('T')[0] : '',
      endDate: p.EndDate ? new Date(p.EndDate).toISOString().split('T')[0] : ''
    });
  };

  const handleExtend = (p: CurrentPrice) => {
    const nextDay = p.EndDate ? new Date(p.EndDate) : new Date();
    if (p.EndDate) nextDay.setDate(nextDay.getDate() + 1);
    
    const endDay = new Date(nextDay);
    endDay.setMonth(endDay.getMonth() + 6); // default 6 months
    endDay.setDate(endDay.getDate() - 1);
    
    setExtendingId(`${p.SetPriceID}-${p.ListNo}`);
    setEditingId(null);
    setExtendForm({
      price: p.GoodPriceNet,
      beginDate: nextDay.toISOString().split('T')[0],
      endDate: endDay.toISOString().split('T')[0]
    });
  };

  const applyExtendMonths = (months: number) => {
    if (!extendForm.beginDate) return;
    const endDay = new Date(extendForm.beginDate);
    endDay.setMonth(endDay.getMonth() + months);
    endDay.setDate(endDay.getDate() - 1);
    setExtendForm({ ...extendForm, endDate: endDay.toISOString().split('T')[0] });
  };

  const handleSaveEdit = async (p: CurrentPrice) => {
    if (!p.SetPriceID || !p.ListNo) return;
    if (editForm.beginDate > editForm.endDate) return alert('วันที่เริ่มต้น ต้องน้อยกว่าหรือเท่ากับ วันที่สิ้นสุด');
    
    setSaving(true);
    try {
      await updatePrice({
        SetPriceID: p.SetPriceID,
        ListNo: p.ListNo,
        GoodPriceNet: editForm.price,
        BeginDate: editForm.beginDate || undefined,
        EndDate: editForm.endDate || undefined
      });
      setEditingId(null);
      await loadData();
    } catch (e: any) { alert('Error updating price: ' + e.message); }
    setSaving(false);
  };

  const handleSaveExtend = async (p: CurrentPrice) => {
    if (extendForm.beginDate > extendForm.endDate) return alert('วันที่เริ่มต้น ต้องน้อยกว่าหรือเท่ากับ วันที่สิ้นสุด');
    
    setSaving(true);
    try {
      await createPrice({
        GoodID: p.GoodID,
        CustID: p.CustID || null,
        GoodPriceNet: extendForm.price,
        BeginDate: extendForm.beginDate,
        EndDate: extendForm.endDate,
        startgoodqty: p.startgoodqty,
        endgoodqty: p.endgoodqty
      });
      setExtendingId(null);
      await loadData();
    } catch (e: any) { alert('Error extending price: ' + e.message); }
    setSaving(false);
  };

  const openBulkModal = () => {
    const itemsToExtend = groupedPrices
      .filter(g => selectedKeys.has(g.key))
      .map(g => g.main);
    
    const initialPrices: Record<string, number> = {};
    itemsToExtend.forEach(p => {
      initialPrices[`${p.SetPriceID}-${p.ListNo}`] = p.GoodPriceNet;
    });
    setBulkPrices(initialPrices);
    setShowBulkModal(true);
  };

  const handleBulkExtendSubmit = async () => {
    const itemsToExtend = groupedPrices
      .filter(g => selectedKeys.has(g.key))
      .map(g => g.main);

    if (itemsToExtend.length === 0) return;

    setSaving(true);
    try {
      const payloads = itemsToExtend.map(p => {
        const nextDay = p.EndDate ? new Date(p.EndDate) : new Date();
        if (p.EndDate) nextDay.setDate(nextDay.getDate() + 1);
        
        const key = `${p.SetPriceID}-${p.ListNo}`;
        const newPrice = bulkPrices[key] ?? p.GoodPriceNet;
        
        return {
          GoodID: p.GoodID,
          CustID: p.CustID || null,
          GoodPriceNet: newPrice,
          BeginDate: nextDay.toISOString().split('T')[0],
          EndDate: bulkEndDate,
          startgoodqty: p.startgoodqty,
          endgoodqty: p.endgoodqty
        };
      });

      await bulkExtendPrices(payloads);
      setShowBulkModal(false);
      setSelectedKeys(new Set());
      await loadData();
      alert(`ต่ออายุสำเร็จ ${payloads.length} รายการ`);
    } catch (e: any) {
      alert('Error bulk extending: ' + e.message);
    }
    setSaving(false);
  };

  const renderRow = (group: GroupedPrice) => {
    const p = group.main;
    const groupKey = group.key;
    const hasHistory = group.history.length > 0;
    const goodData = goodsMap[p.GoodID];
    const goodName = goodData?.name || p.GoodID;
    const custName = p.CustID ? (custMap[p.CustID] || p.CustID) : 'ราคากลาง (ทุกลูกค้า)';
    const isDefaultPrice = !p.CustID;
    
    const rowKey = `${p.SetPriceID}-${p.ListNo}`;
    const isEditing = editingId === rowKey;
    const isExtending = extendingId === rowKey;
    const statusInfo = getStatusInfo(p);
    
    const isSelected = selectedKeys.has(groupKey);
    return (
      <tr key={rowKey} className={`hover:bg-gray-50/50 transition-colors ${statusInfo.label === 'หมดอายุ' ? 'opacity-70 hover:opacity-100' : ''}`}>
        <td className="px-4 py-4 w-12 text-center">
          <button onClick={() => toggleSelect(groupKey)} className="text-gray-400 hover:text-[#0C447C] transition-colors">
            {isSelected ? <CheckSquare size={18} className="text-[#0C447C]" /> : <Square size={18} />}
          </button>
        </td>

        <td className="px-4 py-4">
          <div className="flex items-start gap-2">
            <div>
              <div className="font-bold text-gray-800">{goodName}</div>
              <div className="mt-1">
                {isDefaultPrice ? (
                  <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-semibold">ราคากลาง (ทุกลูกค้า)</span>
                ) : (
                  <span className="text-gray-500 text-xs">{custName}</span>
                )}
              </div>
            </div>
          </div>
        </td>
        <td className="px-4 py-4 text-center">
          <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
            {statusInfo.label}
          </div>
          {statusInfo.warning && (
            <div className="flex items-center justify-center gap-1 text-[11px] text-red-500 font-semibold mt-1.5">
              <AlertCircle size={12} /> {statusInfo.warning}
            </div>
          )}
        </td>
        <td className="px-4 py-4 text-right font-bold text-lg text-[#0C447C]">
          {isEditing || isExtending ? (
            <input 
              type="number" 
              value={isEditing ? editForm.price : extendForm.price} 
              onChange={e => {
                const val = Number(e.target.value);
                if (isEditing) setEditForm({ ...editForm, price: val });
                else setExtendForm({ ...extendForm, price: val });
              }}
              className="w-28 text-right border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#0C447C]"
            />
          ) : (
            p.GoodPriceNet?.toLocaleString() || '-'
          )}
          {(isEditing || isExtending) && (
            <div className="text-[10px] text-gray-400 mt-1 font-normal">บาท / ตัน</div>
          )}
        </td>
        <td className="px-4 py-4 text-center text-gray-500">
          {isEditing || isExtending ? (
            <div className="flex flex-col items-center gap-2 text-xs bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
              {isExtending && (
                <div className="flex gap-1 mb-1">
                  {[3, 6, 12, 24].map(m => (
                    <button key={m} onClick={() => applyExtendMonths(m)} className="px-2 py-1 bg-gray-50 border border-gray-200 rounded text-gray-600 hover:bg-white hover:border-[#0C447C] hover:text-[#0C447C] transition-colors">
                      +{m} ด.
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 w-full justify-center">
                <span className="w-10 text-right">เริ่ม:</span>
                <ThaiDatePicker 
                  value={isEditing ? editForm.beginDate : extendForm.beginDate} 
                  onChange={val => {
                    if (isEditing) setEditForm({ ...editForm, beginDate: val });
                    else setExtendForm({ ...extendForm, beginDate: val });
                  }}
                  className="w-32 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-[#0C447C]"
                />
              </div>
              <div className="flex items-center gap-2 w-full justify-center">
                <span className="w-10 text-right">สิ้นสุด:</span>
                <ThaiDatePicker 
                  value={isEditing ? editForm.endDate : extendForm.endDate} 
                  onChange={val => {
                    if (isEditing) setEditForm({ ...editForm, endDate: val });
                    else setExtendForm({ ...extendForm, endDate: val });
                  }}
                  className="w-32 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-[#0C447C]"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1.5 text-xs">
              <Clock size={14} className="text-gray-400" />
              {p.BeginDate && p.EndDate 
                ? `${formatThaiDate(p.BeginDate)} - ${formatThaiDate(p.EndDate)}` 
                : 'ไม่มีกำหนด'}
            </div>
          )}
        </td>
        <td className="px-4 py-4 text-right">
          {isEditing || isExtending ? (
            <div className="flex flex-col items-end gap-2">
              <button onClick={() => isEditing ? handleSaveEdit(p) : handleSaveExtend(p)} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 text-white bg-[#0C447C] hover:bg-[#0a3866] rounded-md disabled:opacity-50 text-xs font-semibold">
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                บันทึก
              </button>
              <button onClick={() => { setEditingId(null); setExtendingId(null); }} className="text-gray-400 hover:text-gray-600 text-xs px-2">
                ยกเลิก
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1">
              <button onClick={() => handleEdit(p)} className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors flex items-center justify-center" title="แก้ไขราคานี้">
                <Edit2 size={16} />
              </button>
              <button onClick={() => handleExtend(p)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors flex items-center justify-center" title="ต่ออายุ / เพิ่มราคาล่วงหน้า">
                <PlusCircle size={16} />
              </button>
              {hasHistory && (
                <button onClick={() => setSelectedHistoryGroup(group)} className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors flex items-center justify-center" title="ดูประวัติราคา">
                  <History size={16} />
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
    );
  };

  const activePrices = groupedPrices.filter(g => getStatusInfo(g.main).label === 'ใช้งานอยู่').length;
  const expiredPrices = groupedPrices.filter(g => getStatusInfo(g.main).label === 'หมดอายุ').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[#0C447C] flex items-center gap-3">
          <Tag className="text-[#0C447C]" />
          จัดการราคาขาย
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DataSummaryCard
          title="ราคาทั้งหมด"
          value={groupedPrices.length.toLocaleString()}
          icon={<Tag />}
          trend="รวมสินค้าและรายลูกค้า"
        />
        <DataSummaryCard
          title="ใช้งานอยู่"
          value={activePrices.toLocaleString()}
          icon={<CheckSquare />}
          color="green"
        />
        <DataSummaryCard
          title="หมดอายุ"
          value={expiredPrices.toLocaleString()}
          icon={<X />}
          color="red"
        />
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="ค้นหาชื่อสินค้า รหัส หรือลูกค้า..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0C447C]/20 focus:border-[#0C447C] transition-all shadow-sm"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-[#0C447C] min-w-[150px] shadow-sm"
          >
            <option value="ALL">ทุกสถานะ</option>
            <option value="ACTIVE">ใช้งานอยู่</option>
            <option value="EXPIRED_SOON">ใกล้หมดอายุ</option>
            <option value="EXPIRED">หมดอายุแล้ว</option>
          </select>
          <select 
            value={selectedCategory} 
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-[#0C447C] min-w-[150px] shadow-sm"
          >
            <option value="ALL">ทุกหมวดหมู่</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-[#0C447C] transition-colors font-medium px-2 py-1 rounded hover:bg-gray-100"
            >
              {selectedKeys.size === paginatedGroups.length && paginatedGroups.length > 0 
                ? <CheckSquare size={18} className="text-[#0C447C]" /> 
                : <Square size={18} />
              }
              เลือกทั้งหมดหน้านี้
            </button>
            {selectedKeys.size > 0 && (
              <span className="text-sm font-semibold text-[#0C447C] bg-blue-50 px-3 py-1 rounded-full">
                เลือกแล้ว {selectedKeys.size} รายการ
              </span>
            )}
          </div>
          <button onClick={loadData} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors ml-auto">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm text-left border-collapse">
          <thead className="bg-gray-50 sticky top-0 z-10 text-gray-600 font-semibold text-xs uppercase tracking-wider shadow-sm">
            <tr>
              <th className="px-4 py-3 w-12 text-center border-b border-gray-100"></th>
              <SortableHeader title="สินค้า / ลูกค้า" sortKey="GoodName" />
              <th className="px-4 py-3 text-center w-32 border-b border-gray-100">สถานะ</th>
              <SortableHeader title="ราคา NET" sortKey="GoodPriceNet" align="right" />
              <SortableHeader title="เริ่มใช้งาน" sortKey="BeginDate" align="center" />
              <th className="px-4 py-3 text-right w-24 border-b border-gray-100">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-16 text-center">
                  <div className="flex flex-col items-center justify-center text-[#0C447C]">
                    <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
                    <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูลราคาขาย...</p>
                  </div>
                </td>
              </tr>
            ) : filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                  <Tag size={32} className="mx-auto mb-3 opacity-30" />
                  <p>ไม่พบข้อมูลราคาขาย</p>
                </td>
              </tr>
            ) : (
              paginatedGroups.map(group => (
                <Fragment key={group.key}>
                  {renderRow(group)}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <span className="text-sm text-gray-500">
              แสดง {((currentPage - 1) * itemsPerPage) + 1} ถึง {Math.min(currentPage * itemsPerPage, filteredGroups.length)} จาก {filteredGroups.length}
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

      {/* Bulk Action Bar */}
      {selectedKeys.size > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#0C447C] text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-6 animate-in slide-in-from-bottom-5">
          <div className="font-bold">
            เลือกแล้ว {selectedKeys.size} รายการ
          </div>
          <div className="flex items-center gap-2 border-l border-white/20 pl-6">
            <button 
              onClick={openBulkModal}
              className="px-4 py-1.5 bg-white text-[#0C447C] rounded-full text-sm font-bold hover:bg-gray-100 transition-colors shadow-sm flex items-center gap-2"
            >
              <PlusCircle size={16} /> ต่ออายุราคากลุ่ม
            </button>
            <button onClick={() => setSelectedKeys(new Set())} className="p-1.5 hover:bg-white/10 rounded-full transition-colors ml-2">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Bulk Extend Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-xl font-bold text-[#0C447C] mb-2">ตั้งค่าราคากลุ่ม ({selectedKeys.size} รายการ)</h3>
            <p className="text-sm text-gray-500 mb-4">ระบบจะสร้างใบประกาศราคาใหม่ให้สินค้าที่เลือกทั้งหมด โดยอิงตามราคาใหม่ที่ระบุ และเริ่มต่อจากวันหมดอายุเดิมอัตโนมัติ</p>
            
            <div className="max-h-[40vh] overflow-y-auto pr-2 mb-4 space-y-2">
              {groupedPrices.filter(g => selectedKeys.has(g.key)).map(g => {
                const p = g.main;
                const key = `${p.SetPriceID}-${p.ListNo}`;
                const goodData = goodsMap[p.GoodID];
                const goodName = goodData?.name || p.GoodID;
                const custName = p.CustID ? (custMap[p.CustID] || p.CustID) : '';
                return (
                  <div key={key} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="text-xs min-w-0 pr-2">
                      <div className="font-semibold text-gray-700 truncate">{goodName}</div>
                      {custName && <div className="text-gray-500 text-[10px] truncate">{custName}</div>}
                      <div className="text-gray-400 text-[10px]">ราคาเดิม: ฿{p.GoodPriceNet?.toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <input 
                        type="number"
                        value={bulkPrices[key] === undefined ? '' : bulkPrices[key]}
                        onChange={e => setBulkPrices(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                        className="w-24 text-right border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-[#0C447C]"
                      />
                      <span className="text-[10px] text-gray-400 font-semibold w-3">฿</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-4 mb-6 border-t border-gray-100 pt-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">สิ้นสุดวันที่</label>
                <ThaiDatePicker 
                  value={bulkEndDate} 
                  onChange={setBulkEndDate}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowBulkModal(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50">
                ยกเลิก
              </button>
              <button disabled={saving} onClick={handleBulkExtendSubmit} className="flex-1 py-2.5 rounded-xl bg-[#0C447C] text-white font-bold hover:bg-[#0a3866] disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                ยืนยันการต่ออายุ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price History Modal */}
      {selectedHistoryGroup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-2 sm:p-6 z-50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-[96vw] h-[96vh] max-w-none flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 rounded-t-2xl shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-[#0C447C] text-white px-3 py-1.5 rounded-md font-bold text-lg shadow-sm">
                  {goodsMap[selectedHistoryGroup.main.GoodID]?.name || selectedHistoryGroup.main.GoodID}
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                    <History size={20} className="text-[#0C447C]" />
                    ประวัติราคาขาย (Price History)
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    ลูกค้า: <span className="font-semibold text-gray-700">{selectedHistoryGroup.main.CustID ? (custMap[selectedHistoryGroup.main.CustID] || selectedHistoryGroup.main.CustID) : 'ราคากลาง (ทุกลูกค้า)'}</span> • 
                    ทั้งหมด <span className="font-semibold text-[#0C447C]">{selectedHistoryGroup.history.length + 1}</span> รายการ
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedHistoryGroup(null)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-colors bg-white shadow-sm border border-gray-100">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-gray-50 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {[selectedHistoryGroup.main, ...selectedHistoryGroup.history]
                  .sort((a, b) => {
                    const dateA = a.BeginDate ? new Date(a.BeginDate).getTime() : 0;
                    const dateB = b.BeginDate ? new Date(b.BeginDate).getTime() : 0;
                    return dateB - dateA; // Sort newest to oldest (ปัจจุบัน ไปอดีต)
                  })
                  .map((h, i) => {
                    const statusInfo = getStatusInfo(h);
                    const isLatest = i === 0;
                    return (
                      <div key={`${h.SetPriceID}-${h.ListNo}-${i}`} className={`bg-white border ${statusInfo.label === 'ใช้งานอยู่' ? 'border-[#0C447C] shadow-md ring-1 ring-[#0C447C]/10' : 'border-gray-200 shadow-sm'} rounded-xl p-5 flex flex-col justify-between hover:shadow-lg transition-all relative overflow-hidden group`}>
                        {statusInfo.label === 'ใช้งานอยู่' && (
                          <div className="absolute top-0 left-0 w-full h-1.5 bg-[#0C447C]"></div>
                        )}
                        <div className="flex items-start gap-3 mb-4">
                          <div className={`mt-0.5 h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${statusInfo.label === 'ใช้งานอยู่' ? 'bg-blue-50 text-[#0C447C]' : 'bg-gray-50 text-gray-400'}`}>
                            <Calendar size={18} />
                          </div>
                          <div>
                            <div className="font-bold text-gray-800 text-sm leading-snug">
                              {h.BeginDate && h.EndDate ? `${formatThaiDate(h.BeginDate)} - \n${formatThaiDate(h.EndDate)}` : 'ไม่มีกำหนด'}
                            </div>
                            <div className="mt-1.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold text-[10px] ${statusInfo.color}`}>
                                {statusInfo.label}
                              </span>
                              {isLatest && statusInfo.label !== 'ใช้งานอยู่' && (
                                <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full font-bold text-[10px] bg-gray-100 text-gray-600">
                                  ล่าสุด
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right mt-2 border-t border-gray-100 pt-4">
                          <div className={`text-3xl font-black tracking-tight ${statusInfo.label === 'ใช้งานอยู่' ? 'text-[#0C447C]' : 'text-gray-600 group-hover:text-gray-800 transition-colors'}`}>
                            {h.GoodPriceNet?.toLocaleString() || '-'}
                          </div>
                          <div className="text-xs text-gray-400 font-medium mt-1">บาท / ตัน</div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
