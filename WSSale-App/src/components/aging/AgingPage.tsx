import { useEffect, useState, useCallback } from 'react';
import { Search, RefreshCw, X, Clock, Package, ChevronLeft, ChevronRight } from 'lucide-react';
import { searchAgingOrders } from '../../services/api';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import type { AgingRow } from '../../types';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  CONFIRMED:  { label: 'ยืนยัน',        color: 'bg-blue-100 text-blue-700' },
  LOADED:     { label: 'โหลดแล้ว',      color: 'bg-yellow-100 text-yellow-700' },
  PICKING:    { label: 'กำลัง Pick',     color: 'bg-orange-100 text-orange-700' },
  DRAFT:      { label: 'ร่าง',           color: 'bg-gray-100 text-gray-500' },
  SHIPPED:    { label: 'ส่งออกแล้ว',     color: 'bg-green-100 text-green-700' },
  IMPORTED:   { label: 'นำเข้า WS',      color: 'bg-purple-100 text-purple-700' },
  CANCELLED:  { label: 'ยกเลิก',         color: 'bg-red-100 text-red-500' },
};

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
    if (d >= 90) return 'text-red-600 font-bold';
    if (d >= 45) return 'text-orange-500 font-semibold';
    if (d >= 30) return 'text-yellow-600';
    return 'text-gray-500';
  };

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Header summary */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 shrink-0">
        <DataSummaryCard
          title="ตั๋วคงค้างทั้งหมด"
          value={total.toLocaleString()}
          icon={<Clock size={24} />}
          colorClass="bg-red-100 text-red-500"
        />
        <DataSummaryCard
          title="แสดงหน้านี้"
          value={data.length.toLocaleString()}
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
                  {STATUS_LABELS[s]?.label}
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

        {/* Table */}
        <div className="overflow-auto min-h-0 relative">
          <table className="w-full text-sm text-left min-w-full">
            <thead className="bg-gray-50 sticky top-0 z-10 text-gray-500 text-xs uppercase tracking-wider shadow-sm whitespace-nowrap">
              <tr>
                <th className="px-4 py-3 border-b border-gray-100 whitespace-nowrap">#</th>
                <th className="px-4 py-3 border-b border-gray-100 whitespace-nowrap">เลขเอกสาร</th>
                <th className="px-4 py-3 border-b border-gray-100 whitespace-nowrap">ลูกค้า</th>
                <th className="px-4 py-3 border-b border-gray-100 whitespace-nowrap">สินค้า</th>
                <th className="px-4 py-3 border-b border-gray-100 text-right whitespace-nowrap">ตัน</th>
                <th className="px-4 py-3 border-b border-gray-100 text-center whitespace-nowrap">วันที่สั่ง</th>
                <th className="px-4 py-3 border-b border-gray-100 text-center whitespace-nowrap">อายุ (วัน)</th>
                <th className="px-4 py-3 border-b border-gray-100 text-center whitespace-nowrap">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center whitespace-nowrap">
                    <RefreshCw size={28} className="animate-spin mx-auto text-[#0C447C] opacity-50" />
                    <p className="text-sm text-gray-400 mt-3 animate-pulse">กำลังโหลด...</p>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400 whitespace-nowrap">
                    <Clock size={32} className="mx-auto mb-3 opacity-30" />
                    <p>ไม่พบข้อมูลตั๋วคงค้าง</p>
                  </td>
                </tr>
              ) : (
                data.map((row, i) => {
                  const st = STATUS_LABELS[row.Status] || { label: row.Status, color: 'bg-gray-100 text-gray-500' };
                  return (
                    <tr key={`${row.SoId}-${row.GoodCode}-${i}`} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{(page - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                          {row.WfRef || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-800 font-medium max-w-[200px] truncate" title={row.CustName}>
                        {row.CustName}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[160px] whitespace-nowrap">
                        <div className="text-xs font-semibold text-[#0C447C]">{row.GoodCode}</div>
                        {row.GoodName && <div className="text-xs text-gray-400 truncate" title={row.GoodName}>{row.GoodName}</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">
                        {Number(row.QtyTon).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500 whitespace-nowrap">
                        {row.CreatedAt ? row.CreatedAt.substring(0, 10) : '-'}
                      </td>
                      <td className={`px-4 py-3 text-center font-mono text-sm ${daysColor(row.DaysOpen)}`}>
                        {row.DaysOpen}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50 shrink-0">
            <span className="text-sm text-gray-500">
              {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} จาก {total.toLocaleString()} รายการ
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
