import { useEffect, useState, useCallback, useMemo } from 'react';
import { FileText, RefreshCw, Plus, X, ArrowRightCircle, AlertTriangle, Package, Send, Clock, User, ChevronRight, Gift } from 'lucide-react';
import {
  fetchQuotations, createQuotation, convertQuotation, updateQuotationStatus,
  fetchCustomers, fetchGoods, fetchGiveawayGoods, fetchPrices, listUsers
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { Quotation, QuoteStatus, EMCust, EMGood, CurrentPrice, AdminUser } from '../../types';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import { Search, ArrowUpDown, Tag, Check } from 'lucide-react';
import { CreateSODialog } from '../sales/CreateSODialog';

const STATUS_STYLE: Record<QuoteStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-600', SENT: 'bg-blue-50 text-blue-700', ACCEPTED: 'bg-green-50 text-green-700',
  CONVERTED: 'bg-emerald-50 text-emerald-700', EXPIRED: 'bg-amber-50 text-amber-700', CANCELLED: 'bg-red-50 text-red-600',
};

export function QuotationPage() {
  const [quotes, setQuotes]   = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId]   = useState<number | null>(null);
  const [convertQuoteId, setConvertQuoteId] = useState<number | null>(null);

  // Pagination & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'Id', direction: 'desc' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setQuotes(await fetchQuotations()); } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function doConvert(q: Quotation) {
    setConvertQuoteId(q.Id);
  }
  async function setStatus(q: Quotation, status: string) {
    setBusyId(q.Id);
    try { await updateQuotationStatus(q.Id, status); await load(); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  const filteredQuotes = quotes.filter(q => {
    if (statusFilter !== 'ALL' && q.Status !== statusFilter) return false;
    if (searchQuery) {
      const qLower = searchQuery.toLowerCase();
      if (!q.QuoteNo.toLowerCase().includes(qLower) && !q.CustName.toLowerCase().includes(qLower)) {
        return false;
      }
    }
    return true;
  });

  const sortedQuotes = [...filteredQuotes].sort((a, b) => {
    let aVal: any = a[sortConfig.key as keyof Quotation] || '';
    let bVal: any = b[sortConfig.key as keyof Quotation] || '';
    
    if (sortConfig.key === 'Total') {
      aVal = (a.lines || []).reduce((s, l) => s + l.QtyTon * l.PricePerTon, 0);
      bVal = (b.lines || []).reduce((s, l) => s + l.QtyTon * l.PricePerTon, 0);
    }
    
    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedQuotes.length / itemsPerPage);
  const paginatedQuotes = sortedQuotes.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const groupedQuotes = useMemo(() => {
    const map = new Map<string, { dateDisplay: string; cust: string; quotes: Quotation[]; totalAmt: number; totalTon: number }>();
    for (const q of paginatedQuotes) {
      const dateRaw = q.CreatedAt ? q.CreatedAt.split('T')[0] : '9999-12-31';
      const dateDisplay = q.CreatedAt ? new Date(q.CreatedAt).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'ไม่ระบุวันที่';
      const cust = q.CustName || 'ไม่ระบุลูกค้า';
      const key = `${dateRaw}::${cust}`;
      
      if (!map.has(key)) map.set(key, { dateDisplay, cust, quotes: [], totalAmt: 0, totalTon: 0 });
      const g = map.get(key)!;
      g.quotes.push(q);
      g.totalAmt += (q.lines || []).reduce((s, l) => s + (l.QtyTon * l.PricePerTon), 0);
      g.totalTon += (q.lines || []).reduce((s, l) => s + l.QtyTon, 0);
    }
    return Array.from(map.values());
  }, [paginatedQuotes]);

  const SortableHeader = ({ title, sortKey, align = 'left' }: { title: string, sortKey: string, align?: 'left'|'center'|'right' }) => (
    <th className={`px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors text-${align} text-xs font-semibold text-gray-500`} onClick={() => requestSort(sortKey)}>
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        {title}
        <ArrowUpDown size={12} className={`text-gray-400 ${sortConfig.key === sortKey ? 'text-[#0C447C] font-bold' : ''}`} />
      </div>
    </th>
  );

  return (
    <div className="h-full flex flex-col w-full overflow-hidden max-w-full" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <FileText className="w-5 h-5 sm:w-[26px] sm:h-[26px]" /> ใบเสนอราคา
          </h1>
          <p className="hidden sm:block text-sm text-gray-500 mt-0.5">
            จัดการใบเสนอราคา, แปลงเป็นใบสั่งขาย (SO) และติดตามสถานะ
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4 overflow-hidden p-2 sm:p-4 min-h-0">
        {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 shrink-0">
        <DataSummaryCard
          title="ใบเสนอราคาทั้งหมด"
          value={quotes.length.toLocaleString()}
          icon={<FileText size={24} />}
          colorClass="bg-blue-100 text-blue-600"
        />
        <DataSummaryCard
          title="รอดำเนินการ (Draft/Sent)"
          value={quotes.filter(q => q.Status === 'DRAFT' || q.Status === 'SENT').length.toLocaleString()}
          icon={<AlertTriangle size={24} />}
          colorClass="bg-amber-100 text-amber-600"
        />
        <DataSummaryCard
          title="แปลงเป็น SO แล้ว"
          value={quotes.filter(q => q.Status === 'CONVERTED').length.toLocaleString()}
          icon={<Check size={24} />}
          colorClass="bg-emerald-100 text-emerald-600"
        />
      </div>

      <div className="flex-1 grid grid-rows-[auto_1fr_auto] bg-white rounded-none sm:rounded-lg sm:rounded-2xl shadow-sm sm:shadow-sm shadow-none border-y sm:border border-gray-100 overflow-hidden relative min-h-0">
        <div className="p-2 sm:p-4 border-b border-gray-100 flex flex-row items-center gap-2 bg-gray-50/50 overflow-x-auto scrollbar-hide">
          <div className="relative flex-1 min-w-[140px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="ค้นหาเลขที่, ชื่อลูกค้า..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C] focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="ALL">ทุกสถานะ</option>
              <option value="DRAFT">DRAFT</option>
              <option value="SENT">SENT</option>
              <option value="CONVERTED">CONVERTED</option>
            </select>
            <button onClick={() => setShowCreate(true)} className="p-2 bg-[#0C447C] text-white rounded-lg hover:bg-[#0a3866] transition-colors flex items-center justify-center" title="สร้างใบเสนอราคา">
              <Plus size={18} />
            </button>
            <button onClick={load} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors" title="รีเฟรชข้อมูล">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="overflow-auto min-h-0 relative p-2 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 auto-rows-max gap-3 sm:gap-4 bg-gray-50/30">
          {paginatedQuotes.length === 0 ? (
            <div className="col-span-full h-full flex flex-col items-center justify-center opacity-30 text-center py-12">
              <Package size={48} className="mb-3 text-gray-400" />
              <p className="font-semibold text-gray-500">ไม่พบใบเสนอราคา</p>
            </div>
          ) : groupedQuotes.map((g, idx) => (
              <div key={idx} className="rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-[80px]" style={{ background: '#F9F9FB' }}>
                <div className="px-3 py-2 border-b border-gray-100 bg-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] font-bold text-[#0C447C] flex items-center gap-1 bg-[#F0F4F8] px-2 py-0.5 rounded-md">
                      <Clock size={10} /> สร้าง {g.dateDisplay}
                    </div>
                    <div className="text-[11px] font-bold text-gray-700 bg-[#F1F3F5] px-2 py-0.5 rounded-md">
                      รวม {g.totalTon.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ตัน
                    </div>
                  </div>
                  <div className="text-xs font-bold text-[#0C447C]">
                    ฿{g.totalAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                  </div>
                </div>
                <div className="px-3 py-2 bg-white flex items-start gap-2 border-b border-gray-100">
                  <div className="bg-[#1F2937] text-white p-1.5 rounded-lg shrink-0 flex items-center justify-center">
                    <User size={14} />
                  </div>
                  <div className="min-w-0 flex-1 flex items-center">
                    <div className="font-bold text-sm text-gray-900 truncate" title={g.cust}>{g.cust}</div>
                  </div>
                </div>
                <div className="p-1.5 space-y-1.5">
                  {g.quotes.map(q => {
                    const total = (q.lines || []).reduce((s, l) => s + l.QtyTon * l.PricePerTon, 0);
                    return (
                      <div key={q.Id} className="relative p-3 rounded-lg border border-gray-100 transition-all bg-white hover:shadow-sm hover:border-gray-200">
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-gray-700">{q.QuoteNo}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${STATUS_STYLE[q.Status]}`}>{q.Status}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {q.Status !== 'CONVERTED' && q.Status !== 'CANCELLED' && (
                              <div className="inline-flex gap-1.5 shrink-0">
                                {q.Status === 'DRAFT' && (
                                  <button disabled={busyId===q.Id} onClick={() => setStatus(q, 'SENT')} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50" title="ส่งใบเสนอราคา">
                                    <Send size={14} />
                                  </button>
                                )}
                                <button disabled={busyId===q.Id} onClick={() => doConvert(q)} className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50" title="แปลงเป็นใบสั่งขาย (SO)">
                                  <ArrowRightCircle size={14} />
                                </button>
                              </div>
                            )}
                            {q.ConvertedSoId && <span className="text-[10px] text-emerald-600 font-bold shrink-0">→ SO #{q.ConvertedSoId}</span>}
                            <span className="text-xs font-bold text-[#0C447C] min-w-[70px] text-right">
                              ฿{total.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1">
                              <Package size={11} /> {(q.lines || []).length} รายการ
                            </span>
                            {q.SalesName && (
                              <span className="flex items-center gap-1 text-gray-500">
                                โดย {q.SalesName}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>

        {/* Pagination Footer */}
        <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
          <span className="text-sm text-gray-500">
            แสดง {filteredQuotes.length > 0 ? ((currentPage - 1) * itemsPerPage) + 1 : 0} ถึง {Math.min(currentPage * itemsPerPage, filteredQuotes.length)} จาก {filteredQuotes.length}
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
        </div>
      </div>

      {showCreate && <CreateQuoteDialog onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />}
      {convertQuoteId && (
        <CreateSODialog
          isOpen={!!convertQuoteId}
          onClose={() => setConvertQuoteId(null)}
          onCreated={() => { setConvertQuoteId(null); load(); }}
          convertFromQuoteId={convertQuoteId}
        />
      )}
    </div>
  );
}

type DraftLine = { tempId: string; goodId: string; goodCode: string; goodName: string; qtyTon: number | string; pricePerTon: number | string; netPricePerTon: number; isGiveaway?: boolean };

function CreateQuoteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [custs, setCusts]   = useState<EMCust[]>([]);
  const [goods, setGoods]   = useState<EMGood[]>([]);
  const [prices, setPrices] = useState<CurrentPrice[]>([]);
  const [custId, setCustId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines]   = useState<DraftLine[]>([]);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');
  const [custSearch, setCustSearch] = useState('');
  const [isCustOpen, setIsCustOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('ทั้งหมด');
  const [goodSearch, setGoodSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;

  const [salesUserId, setSalesUserId]   = useState<string | number>('');
  const [salesUsers, setSalesUsers]     = useState<AdminUser[]>([]);
  const userRole = useAuthStore(s => s.user?.role);

  useEffect(() => { 
    fetchCustomers().then(setCusts).catch(()=>{}); 
    Promise.all([fetchGoods(), fetchGiveawayGoods()])
      .then(([g, gw]) => setGoods([...g, ...gw.map(x => ({ ...x, GoodGroupName: 'ของแถม' }))]))
      .catch(()=>{});
    if (userRole === 'ADMIN') {
      listUsers().then(setSalesUsers).catch(()=>{});
    }
  }, [userRole]);
  useEffect(() => { 
    fetchPrices({ custId }).then(setPrices).catch(()=>{});
  }, [custId]);
  
  useEffect(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    setValidUntil(local.toISOString().slice(0, 10));
  }, []);

  // Filter & Pagination Logic
  const categories = ['ทั้งหมด', ...Array.from(new Set(goods.map(g => g.GoodGroupName || 'อื่นๆ'))).filter(c => c !== 'ของแถม').sort(), 'ของแถม'];
  const filteredGoods = goods.filter(g => {
    if (activeTab !== 'ทั้งหมด' && (g.GoodGroupName || 'อื่นๆ') !== activeTab) return false;
    if (goodSearch) {
      const q = goodSearch.toLowerCase();
      return g.GoodName.toLowerCase().includes(q) || g.GoodCode.toLowerCase().includes(q);
    }
    return true;
  });
  const totalPages = Math.ceil(filteredGoods.length / itemsPerPage) || 1;
  const paginatedGoods = filteredGoods.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [activeTab, goodSearch]);

  const priceObj = (goodId: string) => prices.find(p => p.GoodID === goodId);
  const netOf = (goodId: string) => priceObj(goodId)?.GoodPriceNet ?? 0;

  const getDiffDays = (dateStr: string) => {
    if (!dateStr) return 0;
    const target = new Date(dateStr); target.setHours(0,0,0,0);
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  function addGood(g: EMGood) {
    const net = netOf(g.GoodID);
    setLines(prev => prev.some(l => l.goodId === g.GoodID && !l.isGiveaway)
      ? prev.map(l => l.goodId === g.GoodID && !l.isGiveaway ? { ...l, qtyTon: Number(l.qtyTon) + 1 } : l)
      : [{ tempId: `${g.GoodID}-${Date.now()}`, goodId: g.GoodID, goodCode: g.GoodCode, goodName: g.GoodName, qtyTon: 1, pricePerTon: g.GoodGroupName === 'ของแถม' ? 0 : net, netPricePerTon: g.GoodGroupName === 'ของแถม' ? 0 : net, isGiveaway: g.GoodGroupName === 'ของแถม' }, ...prev]);
  }
  function upd(id: string, patch: Partial<DraftLine>) { setLines(prev => prev.map(l => l.tempId === id ? { ...l, ...patch } : l)); }
  function rm(id: string) { setLines(prev => prev.filter(l => l.tempId !== id)); }

  const cust = custs.find(c => c.CustID === custId);
  const total = lines.reduce((sum, l) => sum + (Number(l.qtyTon) || 0) * (Number(l.pricePerTon) || 0), 0);

  async function submit() {
    if (!custId || lines.length === 0) { setErr('กรุณาเลือกลูกค้า และเพิ่มสินค้าอย่างน้อย 1 รายการ'); return; }
    setBusy(true); setErr('');
    try {
      const r = await createQuotation({ custId, custName: cust?.CustName || custId, validUntil: validUntil || undefined,
        lines: lines.map(({ tempId, ...l }) => ({
          ...l,
          qtyTon: Number(l.qtyTon) || 0,
          pricePerTon: Number(l.pricePerTon) || 0
        })),
        salesUserId: salesUserId || undefined
      });
      alert(`✓ สร้างใบเสนอราคาสำเร็จ: ${r.quoteNo}`); onDone();
    } catch (e: unknown) { setErr((e as Error).message || 'เกิดข้อผิดพลาด'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-[96vw] h-[96vh] max-w-none flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold" style={{ color: '#0C447C' }}>สร้างใบเสนอราคา</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 rounded-full p-1.5 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
            {/* Left: Product Grid */}
            <div className="lg:col-span-8 p-4 flex flex-col h-full overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:block">เลือกสินค้า</p>
                
                <div className="flex items-center gap-2 flex-1 max-w-sm">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="ค้นหาสินค้า..."
                      value={goodSearch}
                      onChange={e => setGoodSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                    />
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center justify-between mb-3 shrink-0 gap-4">
                <div className="flex items-center gap-1 overflow-x-auto pb-2 scrollbar-hide flex-1">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => { setActiveTab(cat); setCurrentPage(1); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${activeTab === cat ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                      style={activeTab === cat ? { background: '#0C447C' } : {}}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center gap-1 shrink-0 pb-2">
                    <span className="text-xs text-gray-400 mr-2 hidden sm:inline">หน้า {currentPage}/{totalPages}</span>
                    <button 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-2.5 py-1.5 rounded bg-gray-100 text-gray-600 disabled:opacity-50 text-xs hover:bg-gray-200 transition-colors"
                    >
                      ก่อนหน้า
                    </button>
                    <button 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-2.5 py-1.5 rounded bg-gray-100 text-gray-600 disabled:opacity-50 text-xs hover:bg-gray-200 transition-colors"
                    >
                      ถัดไป
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 overflow-y-auto flex-1 content-start pr-1">
                {paginatedGoods.map(g => {
                  const pObj = priceObj(g.GoodID);
                  const net = pObj?.GoodPriceNet ?? 0;
                  const isExpired = pObj?.IsExpired === 1;
                  const inCart = lines.some(l => l.goodId === g.GoodID);
                  return (
                    <button
                      key={g.GoodID}
                      onClick={() => addGood(g)}
                      className={`text-left p-3 rounded-xl border transition-all ${inCart ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50 hover:border-gray-200 hover:bg-white'}`}
                    >
                      <div className="text-sm font-bold text-[#0C447C] line-clamp-2 leading-tight mb-1.5 h-10" title={g.GoodName}>{g.GoodName}</div>
                      {net > 0 ? (
                        <div className="text-xs font-bold" style={{ color: isExpired ? '#DC2626' : '#0C447C' }}>
                          ฿{net.toLocaleString()}<span className="text-[9px] font-normal text-gray-400">/ตัน</span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-orange-400">ไม่มีราคากลาง</div>
                      )}
                      <div className="text-[9px] text-gray-300 mt-0.5">{g.BagPerTon} กระสอบ/ตัน · {g.WeightKgPerBag}kg</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-4 text-[10px] text-gray-500 shrink-0">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ background: '#0C447C' }}></div> ราคากลางปกติ</div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-600"></div> ราคากลางหมดอายุ (อ้างอิงราคาล่าสุด)</div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-orange-400"></div> ไม่มีข้อมูลราคากลาง</div>
              </div>
            </div>

            {/* Right: Order Summary */}
            <div className="lg:col-span-4 p-4 flex flex-col h-full overflow-hidden bg-white">
              <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                {userRole === 'ADMIN' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-2">
                    <label className="text-xs font-bold text-amber-800 block mb-1">ทำรายการแทน (Admin Only)</label>
                    <select value={salesUserId} onChange={e => setSalesUserId(e.target.value)}
                      className="w-full border-amber-200 rounded px-2 py-1.5 text-sm bg-white text-amber-900 focus:ring-amber-500">
                      <option value="">-- เป็นตัวเอง (Admin) --</option>
                      {salesUsers.map(u => <option key={u.Id} value={u.Id}>{u.DisplayName} ({u.Username})</option>)}
                    </select>
                  </div>
                )}
                <div className="relative">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">ลูกค้า *</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={custSearch}
                      onChange={e => {
                        setCustSearch(e.target.value);
                        if (custId) setCustId('');
                      }}
                      onFocus={() => setIsCustOpen(true)}
                      onBlur={() => setTimeout(() => setIsCustOpen(false), 200)}
                      placeholder="ค้นหาชื่อลูกค้า หรือ รหัสลูกค้า..."
                      className="w-full border border-gray-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                    />
                    {custSearch && (
                      <button 
                        onMouseDown={(e) => { e.preventDefault(); setCustSearch(''); setCustId(''); }} 
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 z-20"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {isCustOpen && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                      {custs.filter(c => c.CustName.toLowerCase().includes(custSearch.toLowerCase()) || c.CustID.toLowerCase().includes(custSearch.toLowerCase())).map(c => (
                        <div
                          key={c.CustID}
                          className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0"
                          onClick={() => { setCustId(c.CustID); setCustSearch(c.CustName); setIsCustOpen(false); }}
                        >
                          <div className="font-bold text-gray-800">{c.CustName}</div>
                          <div className="text-[10px] text-gray-500">{c.CustID}</div>
                        </div>
                      ))}
                      {custs.filter(c => c.CustName.toLowerCase().includes(custSearch.toLowerCase()) || c.CustID.toLowerCase().includes(custSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-4 text-sm text-center text-gray-400">ไม่พบลูกค้า</div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">ใช้ได้ถึง</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <ThaiDatePicker value={validUntil} onChange={setValidUntil} />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const currentDiff = getDiffDays(validUntil);
                        let nextDiff = 7;
                        if (currentDiff === 7) nextDiff = 15;
                        else if (currentDiff === 15) nextDiff = 30;
                        const d = new Date(); d.setDate(d.getDate() + nextDiff);
                        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
                        setValidUntil(local.toISOString().slice(0, 10));
                      }}
                      className="px-3 py-2 border border-blue-200 bg-blue-50 text-[#0C447C] rounded-lg text-xs font-bold whitespace-nowrap hover:bg-blue-100 transition-colors"
                    >
                      +{getDiffDays(validUntil)} วัน
                    </button>
                  </div>
                </div>

                {/* Line items */}
                {lines.length > 0 && (
                  <div className="space-y-2 mt-4 border-t border-gray-100 pt-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase">รายการ</p>
                    {lines.map(l => (
                      <div key={l.tempId} className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-100 bg-gray-50">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-gray-700 truncate flex items-center gap-1">
                          {l.isGiveaway && <span className="bg-green-100 text-green-700 px-1 py-0.5 rounded text-[8px] shrink-0">🎁 ของแถม</span>}
                          {l.goodName}
                        </div>
                          <div className="flex items-center gap-3 mt-1.5">
                            <div className="flex items-center gap-1.5">
                              <label className="text-[10px] text-gray-500">จำนวน:</label>
                              <input
                                type="text" inputMode="decimal"
                                value={l.qtyTon}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (/^\d*\.?\d*$/.test(val)) upd(l.tempId, { qtyTon: val });
                                }}
                                className="w-20 border border-gray-200 rounded px-2 py-1 text-sm text-center focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                              <span className="text-[10px] text-gray-400">{l.isGiveaway ? 'ชิ้น' : 'ตัน'}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <label className="text-[10px] text-gray-500">ราคา:</label>
                              {l.isGiveaway ? (
                                <span className="text-sm font-bold text-[#0C447C] ml-1 px-2">ฟรี (฿0)</span>
                              ) : (
                                <>
                                  <input
                                    type="text" inputMode="decimal"
                                    value={l.pricePerTon}
                                    onChange={e => {
                                      const val = e.target.value;
                                      if (/^\d*\.?\d*$/.test(val)) upd(l.tempId, { pricePerTon: val });
                                    }}
                                    className={`w-24 border rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none ${(Number(l.pricePerTon) || 0) < l.netPricePerTon ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                                  />
                                  <span className="text-[10px] text-gray-400">฿/ตัน</span>
                                </>
                              )}
                            </div>
                          </div>
                          {(Number(l.pricePerTon) || 0) < l.netPricePerTon && (
                            <div className="text-[9px] text-red-500 font-bold mt-0.5 flex items-center gap-1">
                              <AlertTriangle size={10} /> ต่ำกว่าราคากลาง ฿{l.netPricePerTon.toLocaleString()}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0 px-2 min-w-[70px]">
                          {l.isGiveaway ? (
                            <div className="text-sm font-bold text-[#0C447C]">฿0</div>
                          ) : (
                            <div className="text-sm font-bold text-[#0C447C]">
                              ฿{((Number(l.qtyTon) || 0) * (Number(l.pricePerTon) || 0)).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                            </div>
                          )}
                        </div>
                        <button onClick={() => rm(l.tempId)} className="text-gray-300 hover:text-red-500 shrink-0">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {lines.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 text-gray-300 border-t border-gray-100 mt-4">
                    <Package size={32} className="mb-2" />
                    <p className="text-xs">คลิกสินค้าเพื่อเพิ่ม</p>
                  </div>
                )}
              </div>

              {/* Totals */}
            {lines.length > 0 && (
              <div className="border-t border-gray-100 pt-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">ยอดรวม</span>
                  <span className="font-bold" style={{ color: '#0C447C' }}>฿{total.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            )}

              {/* Error */}
              {err && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-100 text-xs text-red-600">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  {err}
                </div>
              )}

              {/* Submit */}
              <button
                disabled={busy || !custId || lines.length === 0}
                onClick={submit}
                className="w-full py-3 rounded-xl text-white text-sm font-bold transition-opacity disabled:opacity-50"
                style={{ background: '#0C447C' }}
              >
                {busy ? 'กำลังบันทึก...' : 'บันทึกใบเสนอราคา'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
