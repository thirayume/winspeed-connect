import { useEffect, useState, useCallback, useMemo } from 'react';
import { Search, RefreshCw, X, Clock, Package, ChevronLeft, ChevronRight, Truck } from 'lucide-react';
import { searchAgingOrders } from '../../services/api';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import type { AgingRow, SOStatus } from '../../types';
import { SO_STATUS_META } from '../../constants/soStatus';

const PAGE_SIZE = 50;

const defaultDateFrom = () => `${new Date().getFullYear() - 2}-01-01`;

export const AgingPage = () => {
  const [data, setData]       = useState<AgingRow[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);

  const [search, setSearch]       = useState('');
  const [inputVal, setInputVal]   = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom]   = useState(defaultDateFrom());

  const load = useCallback(async (pg = page) => {
    setLoading(true);
    try {
      const res = await searchAgingOrders({
        q:        search || undefined,
        status:   statusFilter.length ? statusFilter.join(',') : undefined,
        page:     pg,
        pageSize: PAGE_SIZE,
        dateFrom,
      });
      setData(res.data);
      setTotal(res.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, dateFrom, page]);

  useEffect(() => { load(1); setPage(1); }, [search, statusFilter, dateFrom]);
  useEffect(() => { load(page); }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = () => { setSearch(inputVal.trim()); setPage(1); };
  const clearSearch  = () => { setInputVal(''); setSearch(''); setPage(1); };

  const toggleStatus = (s: string) =>
    setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const daysColor = (d: number) => {
    if (d >= 90) return { bg: 'bg-red-50', text: 'text-red-700', dot: '#EF4444' };
    if (d >= 45) return { bg: 'bg-orange-50', text: 'text-orange-700', dot: '#F97316' };
    if (d >= 30) return { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: '#EAB308' };
    return { bg: 'bg-gray-50', text: 'text-gray-600', dot: '#9CA3AF' };
  };

  const groupedData = useMemo(() => {
    const groups: Record<string, {
      truckPlate: string;
      custName: string;
      maxDays: number;
      wfRefs: Set<string>;
      items: { code: string; name?: string; qty: number; wfRef: string }[];
      totalQty: number;
    }> = {};
    for (const a of data) {
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
  }, [data]);

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Header summary */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 shrink-0">
        <DataSummaryCard
          title="SO ค้างจัดส่งทั้งหมด"
          value={total.toLocaleString()}
          icon={<Clock size={24} />}
          colorClass="bg-red-100 text-red-500"
        />
        <DataSummaryCard
          title="แสดงหน้านี้"
          value={groupedData.length.toLocaleString()}
          icon={<Package size={24} />}
          colorClass="bg-blue-100 text-blue-500"
        />
        <DataSummaryCard
          title="รวมตัน (หน้านี้)"
          value={data.reduce((s, r) => s + (Number(r.QtyTon) || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          icon={<Clock size={24} />}
          colorClass="bg-orange-100 text-orange-500"
        />
      </div>

      <div className="flex-1 bg-white border border-gray-200 rounded-xl sm:rounded-2xl shadow-sm grid grid-rows-[auto_1fr_auto] overflow-hidden min-h-0">
        {/* Toolbar */}
        <div className="p-2 sm:p-4 border-b border-gray-100 flex flex-row items-center gap-2 bg-gray-50/50 overflow-x-auto scrollbar-hide">
          {/* Search */}
          <div className="relative flex-1 min-w-[140px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="ค้นหา ลูกค้า / เลขเอกสาร / สินค้า..."
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="w-full pl-8 pr-8 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
            />
            {inputVal && (
              <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSearch}
              className="px-3 py-2 bg-[#0C447C] text-white rounded-lg text-sm hover:bg-[#0a3866] transition-colors whitespace-nowrap"
            >
              ค้นหา
            </button>

            {/* Status filter chips */}
            <div className="flex flex-row gap-1.5 items-center hidden sm:flex">
              {['CONFIRMED','LOADED','PICKING','SHIPPED'].map(s => (
                <button
                  key={s}
                  onClick={() => toggleStatus(s)}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium border transition-colors whitespace-nowrap ${
                    statusFilter.includes(s)
                      ? 'bg-[#0C447C] text-white border-[#0C447C]'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-[#0C447C]'
                  }`}
                >
                  {SO_STATUS_META[s as SOStatus]?.label || s}
                </button>
              ))}
            </div>

            {/* Date from */}
            <div className="flex items-center gap-1.5 text-sm text-gray-500 bg-white border border-gray-200 rounded-lg px-2 py-1 shrink-0">
              <span className="text-[10px] hidden sm:inline">จาก</span>
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                className="text-xs focus:outline-none bg-transparent"
              />
            </div>

            <button
              onClick={() => load(page)}
              className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title="รีเฟรช"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Card View */}
        <div className="overflow-auto min-h-0 relative p-4 bg-gray-50/50">
          {loading ? (
            <div className="flex flex-col justify-center items-center h-full opacity-50 py-16">
              <RefreshCw size={32} className="animate-spin text-[#0C447C]" />
              <p className="text-sm text-gray-500 mt-4 animate-pulse">กำลังโหลด...</p>
            </div>
          ) : groupedData.length === 0 ? (
            <div className="flex flex-col justify-center items-center h-full text-gray-400 py-16">
              <Clock size={40} className="mb-4 opacity-30" />
              <p>ไม่พบข้อมูล SO ค้างจัดส่ง</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4 items-stretch">
              {groupedData.map((g, i) => {
                const c = daysColor(g.maxDays);
                return (
                  <div key={i} className={`flex flex-col h-full gap-1.5 p-4 rounded-2xl border bg-white shadow-sm hover:shadow-md transition-shadow ${c.bg.replace('bg-', 'border-').replace('50', '200')}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="h-3 w-3 rounded-full shrink-0 shadow-sm" style={{ background: c.dot }} />
                      <span className="font-mono text-sm font-bold text-[#0C447C] shrink-0 truncate flex items-center gap-1.5"><Truck size={14}/> {g.truckPlate}</span>
                      <div className="flex-1"></div>
                      <span className="text-xs font-bold text-gray-500">{g.totalQty.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ตัน</span>
                      <span className={`text-xs font-bold ${c.text} bg-white px-2 py-0.5 rounded-full border border-gray-100 shadow-sm`}>{g.maxDays} วัน</span>
                    </div>
                    <div className="text-sm font-bold text-gray-800 line-clamp-1">{g.custName}</div>
                    
                    {g.wfRefs.length > 0 && (
                      <div className="mt-1 text-[10px] text-gray-400 font-mono flex gap-1 flex-wrap">
                        {g.wfRefs.map(ref => <span key={ref} className="bg-gray-100 border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded shadow-sm">{ref}</span>)}
                      </div>
                    )}
                    
                    <div className="mt-auto pt-3 border-t border-gray-100 flex flex-col gap-1.5 flex-1 justify-start max-h-[60px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                      {g.items.map((item, idx) => (
                         <div key={idx} className="flex justify-between items-center text-xs text-gray-600 gap-2 shrink-0">
                           <div className="flex flex-col flex-1 min-w-0">
                             <span className="truncate font-medium text-gray-700" title={item.name}>{item.name || 'ไม่ระบุชื่อสินค้า'}</span>
                           </div>
                           <span className="w-20 text-right tabular-nums font-bold text-[#0C447C] shrink-0 bg-[#0C447C]/5 px-2 py-1 rounded">
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-white shrink-0">
            <span className="text-sm text-gray-500">
              {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} จาก {total.toLocaleString()} บิล
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p-1))}
                disabled={page === 1}
                className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-3 py-1 text-sm text-gray-600">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p+1))}
                disabled={page === totalPages}
                className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
