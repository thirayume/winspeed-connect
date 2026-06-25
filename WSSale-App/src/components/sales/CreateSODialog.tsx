import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Minus, Truck, AlertTriangle, Package, Search } from 'lucide-react';
import { fetchCustomers, fetchGoods, fetchGiveawayGoods, fetchPrices, createSO, fetchTruckPlates, fetchControlTickets, fetchControlTicketDetails, listUsers } from '../../services/api';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { useAuthStore } from '../../store/auth-store';
import type { EMCust, EMGood, CurrentPrice, SalesOrderLine, SOPrefix, AdminUser } from '../../types';

type DraftLine = SalesOrderLine & { tempId: string };

const PREFIX_LABELS: Record<SOPrefix, string> = {
  I: 'I — ขายปกติ (Invoice)',
  K: 'K — ขายพิเศษ',
  AI: 'AI — ตั๋วคุม',
};

export function CreateSODialog({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [customers, setCustomers] = useState<EMCust[]>([]);
  const [goods, setGoods]         = useState<EMGood[]>([]);
  const [prices, setPrices]       = useState<CurrentPrice[]>([]);
  const [lines, setLines]         = useState<DraftLine[]>([]);
  const [truckPlates, setTruckPlates] = useState<string[]>([]);
  const [custSearch, setCustSearch] = useState('');
  const [isCustOpen, setIsCustOpen] = useState(false);
  const [isTruckOpen, setIsTruckOpen] = useState(false);

  const [soPrefix, setSoPrefix]         = useState<SOPrefix>('I');
  const [custId, setCustId]             = useState('');
  const [truckPlate, setTruckPlate]     = useState('');
  const [controlTicket, setControlTicket] = useState('');
  const [controlTickets, setControlTickets] = useState<{ DocuNo: string; DocuDate: string; TruckPlate?: string; Desc1?: string }[]>([]);
  const [pendingTicket, setPendingTicket] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [remark, setRemark]             = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState('');

  const [salesUserId, setSalesUserId]   = useState<string | number>('');
  const [salesUsers, setSalesUsers]     = useState<AdminUser[]>([]);
  const userRole = useAuthStore(s => s.user?.role);

  const [activeTab, setActiveTab] = useState('ทั้งหมด');
  const [goodSearch, setGoodSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;

  useEffect(() => {
    if (!isOpen) return;
    fetchCustomers().then(setCustomers).catch(console.error);
    Promise.all([fetchGoods(), fetchGiveawayGoods()])
      .then(([g, gw]) => setGoods([...g, ...gw.map(x => ({ ...x, GoodGroupName: 'ของแถม' }))]))
      .catch(console.error);
    
    if (userRole === 'ADMIN') {
      listUsers().then(users => setSalesUsers(users.filter(u => u.Role === 'SALES' || u.Role === 'COUNTER_SALES'))).catch(console.error);
    }

    setLines([]);
    setCustId(''); setTruckPlate(''); setControlTicket(''); setRemark(''); setSalesUserId('');
    setActiveTab('ทั้งหมด'); setGoodSearch(''); setCurrentPage(1);
    
    const d = new Date(); d.setDate(d.getDate() + 7);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    setDeliveryDate(local.toISOString().slice(0, 10));
    
    setSoPrefix('I'); setError('');
    setCustSearch(''); setTruckPlates([]);
  }, [isOpen, userRole]);

  useEffect(() => {
    fetchPrices({ custId }).then(setPrices).catch(console.error);
    if (custId) {
      fetchTruckPlates(custId).then(setTruckPlates).catch(console.error);
      fetchControlTickets(custId).then(setControlTickets).catch(console.error);
    } else {
      setTruckPlates([]);
      setControlTickets([]);
    }
  }, [custId]);

  const priceObj = useCallback((goodId: string) => prices.find(p => p.GoodID === goodId), [prices]);
  const getNetPrice = useCallback((goodId: string, _qtyTon: number) => {
    return priceObj(goodId)?.GoodPriceNet ?? 0;
  }, [priceObj]);

  const getDiffDays = (dateStr: string) => {
    if (!dateStr) return 0;
    const target = new Date(dateStr); target.setHours(0,0,0,0);
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

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

  const loadTicketDetails = async (docuNo: string) => {
    try {
      if (!docuNo) {
        setLines([]);
        setControlTicket('');
        return;
      }
      const details = await fetchControlTicketDetails(docuNo);
      setLines(details.map((d, i) => ({
        tempId: `${d.GoodID}-${Date.now()}-${i}`,
        lineNo: i + 1,
        goodId: d.GoodID,
        goodCode: d.GoodCode,
        goodName: d.GoodName,
        qtyTon: Number(d.QtyTon) || 0,
        qtyBag: (Number(d.QtyTon) || 0) * (Number(d.BagPerTon) || 0),
        pricePerTon: Number(d.PricePerTon) || 0,
        netPricePerTon: Number(d.NetPricePerTon) || 0,
        isGiveaway: false
      })));
      setControlTicket(docuNo);
    } catch (e) {
      console.error(e);
      alert('ไม่สามารถดึงข้อมูลตั๋วคุมได้');
    }
  };

  const handleTicketSelect = (docuNo: string) => {
    if (lines.length > 0) {
      setPendingTicket(docuNo);
      setShowConfirm(true);
    } else {
      loadTicketDetails(docuNo);
    }
  };

  function addGood(good: EMGood) {
    const net = getNetPrice(good.GoodID, 1);
    setLines(prev => {
      const existing = prev.find(l => l.goodId === good.GoodID && !l.isGiveaway);
      if (existing) {
        const newQty = existing.qtyTon + 1;
        const newNet = getNetPrice(good.GoodID, newQty);
        return prev.map(l => l.goodId === good.GoodID && !l.isGiveaway
          ? { ...l, qtyTon: newQty, qtyBag: newQty * good.BagPerTon, netPricePerTon: newNet }
          : l
        );
      }
      const newLine: DraftLine = {
        tempId: `${good.GoodID}-${Date.now()}`,
        lineNo: prev.length + 1,
        goodId: good.GoodID,
        goodCode: good.GoodCode,
        goodName: good.GoodName,
        qtyTon: 1,
        qtyBag: good.BagPerTon || 0,
        pricePerTon: good.GoodGroupName === 'ของแถม' ? 0 : net,
        netPricePerTon: good.GoodGroupName === 'ของแถม' ? 0 : net,
        isGiveaway: good.GoodGroupName === 'ของแถม',
      };
      return [newLine, ...prev];
    });
  }

  function updateLine(tempId: string, patch: Partial<DraftLine>) {
    setLines(prev => prev.map(l => {
      if (l.tempId !== tempId) return l;
      const updated = { ...l, ...patch };
      // recalc qtyBag if qtyTon changed
      if (patch.qtyTon !== undefined) {
        const good = goods.find(g => g.GoodID === updated.goodId);
        updated.qtyBag = Math.round(updated.qtyTon * (good?.BagPerTon ?? 20));
        updated.netPricePerTon = getNetPrice(updated.goodId, updated.qtyTon);
      }
      return updated;
    }));
  }

  function removeLine(tempId: string) {
    setLines(prev => prev.filter(l => l.tempId !== tempId).map((l, i) => ({ ...l, lineNo: i + 1 })));
  }

  const totalAmt = lines.reduce((s, l) => s + (Number(l.qtyTon) || 0) * (Number(l.pricePerTon) || 0), 0);
  const totalRebate = lines.reduce((s, l) => s + (l.netPricePerTon > 0 && (Number(l.pricePerTon) || 0) > l.netPricePerTon ? ((Number(l.pricePerTon) || 0) - l.netPricePerTon) * (Number(l.qtyTon) || 0) : 0), 0);

  const selectedCust = customers.find(c => c.CustID === custId);

  async function handleSubmit() {
    if (!custId || lines.length === 0) { setError('กรุณาเลือกลูกค้า และเพิ่มสินค้าอย่างน้อย 1 รายการ'); return; }

    const isNewTruck = truckPlate && truckPlates.length > 0 && !truckPlates.includes(truckPlate);
    if (isNewTruck) {
      if (!window.confirm(`ทะเบียนรถ "${truckPlate}" เป็นรถใหม่ที่ไม่เคยเข้ารับบริการ\n\nระบบจะบันทึกเป็นรถคันใหม่ให้โดยอัตโนมัติ\n\nคุณแน่ใจหรือไม่ที่จะใช้ทะเบียนนี้?`)) {
        return;
      }
    }

    setError(''); setSubmitting(true);
    try {
      const payload = {
        soPrefix,
        custId,
        custName: selectedCust?.CustName || custId,
        truckPlate: truckPlate || undefined,
        controlTicketNo: controlTicket || undefined,
        deliveryDate: deliveryDate || undefined,
        remark: remark || undefined,
        lines: lines.map(({ tempId, ...l }) => ({
          ...l,
          qtyTon: Number(l.qtyTon) || 0,
          pricePerTon: Number(l.pricePerTon) || 0
        })),
        salesUserId: salesUserId || undefined,
      };
      const res = await createSO(payload);
      if (res.needsApproval) alert(`⚠ ราคาต่ำกว่า NET — WfRef: ${res.wfRef}\nต้องการอนุมัติจาก ผจก. ก่อน confirm`);
      else alert(`✓ สร้างใบสั่งขายสำเร็จ: ${res.wfRef}`);
      onCreated?.();
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message || 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-[96vw] h-[96vh] max-w-none flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold" style={{ color: '#0C447C' }}>สร้างใบสั่งขาย</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 rounded-full p-1.5 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-5 min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
            <div className="lg:col-span-3 p-4 flex flex-col h-full overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:block">ปุ๋ย FG (คลิกเพิ่ม)</p>
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
                  const inCart = lines.some(l => l.goodId === g.GoodID && !l.isGiveaway);
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
                        <div className="text-[10px] text-orange-400">ไม่มีราคา NET</div>
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

            <div className="lg:col-span-2 p-4 flex flex-col gap-4">
              {userRole === 'ADMIN' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <label className="text-xs font-bold text-amber-800 block mb-1">ทำรายการแทน (Admin Only)</label>
                  <select value={salesUserId} onChange={e => setSalesUserId(e.target.value)}
                    className="w-full border-amber-200 rounded px-2 py-1.5 text-sm bg-white text-amber-900 focus:ring-amber-500">
                    <option value="">-- เป็นตัวเอง (Admin) --</option>
                    {salesUsers.map(u => <option key={u.Id} value={u.Id}>{u.DisplayName} ({u.Username})</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">ประเภท SO</label>
                  <select value={soPrefix} onChange={e => setSoPrefix(e.target.value as SOPrefix)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    {(Object.keys(PREFIX_LABELS) as SOPrefix[]).map(p =>
                      <option key={p} value={p}>{PREFIX_LABELS[p]}</option>
                    )}
                  </select>
                </div>
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
                      {customers.filter(c => c.CustName.toLowerCase().includes(custSearch.toLowerCase()) || c.CustID.toLowerCase().includes(custSearch.toLowerCase())).map(c => (
                        <div
                          key={c.CustID}
                          className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0"
                          onClick={() => { setCustId(c.CustID); setCustSearch(c.CustName); setIsCustOpen(false); }}
                        >
                          <div className="font-bold text-gray-800">{c.CustName}</div>
                          <div className="text-[10px] text-gray-500">{c.CustID}</div>
                        </div>
                      ))}
                      {customers.filter(c => c.CustName.toLowerCase().includes(custSearch.toLowerCase()) || c.CustID.toLowerCase().includes(custSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-4 text-sm text-center text-gray-400">ไม่พบลูกค้า</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <label className="text-xs font-semibold text-gray-500 block mb-1">
                      <Truck size={10} className="inline mr-1" />ทะเบียนรถ
                    </label>
                    <input
                      value={truckPlate}
                      onChange={e => setTruckPlate(e.target.value)}
                      onFocus={() => setIsTruckOpen(true)}
                      onBlur={() => setTimeout(() => setIsTruckOpen(false), 200)}
                      placeholder="70-1087/88"
                      className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${truckPlate && truckPlates.length > 0 && !truckPlates.includes(truckPlate) ? 'border-red-400 text-red-600 bg-red-50' : 'border-gray-200'}`}
                    />
                    {isTruckOpen && truckPlates.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                        {truckPlates.filter(p => p.toLowerCase().includes(truckPlate.toLowerCase())).map(p => (
                          <div
                            key={p}
                            className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0 font-mono"
                            onClick={() => { setTruckPlate(p); setIsTruckOpen(false); }}
                          >
                            {p}
                          </div>
                        ))}
                      </div>
                    )}
                    {truckPlate && truckPlates.length > 0 && !truckPlates.includes(truckPlate) && (
                      <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 shadow-sm">
                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          <AlertTriangle size={14} className="shrink-0" /> รถใหม่ ไม่เคยเข้ารับบริการ
                        </div>
                        <div className="text-[10px] mt-1 leading-relaxed opacity-90">
                          ไม่ต้องกังวล ระบบจะบันทึกเป็นทะเบียนรถใหม่ให้โดยอัตโนมัติ
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">ตั๋วคุม AI</label>
                    {controlTickets.length > 0 ? (
                      <select value={controlTicket} onChange={e => handleTicketSelect(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-blue-500">
                        <option value="">-- ไม่ระบุ --</option>
                        {controlTickets.map(t => (
                          <option key={t.DocuNo} value={t.DocuNo}>
                            {t.DocuNo} {t.TruckPlate ? `(ทะเบียน: ${t.TruckPlate})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input value={controlTicket} onChange={e => handleTicketSelect(e.target.value)}
                        placeholder="AI68-XXXXX"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">วันส่งสินค้า</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <ThaiDatePicker value={deliveryDate} onChange={setDeliveryDate} />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const currentDiff = getDiffDays(deliveryDate);
                        let nextDiff = 7;
                        if (currentDiff === 7) nextDiff = 15;
                        else if (currentDiff === 15) nextDiff = 30;
                        const d = new Date(); d.setDate(d.getDate() + nextDiff);
                        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
                        setDeliveryDate(local.toISOString().slice(0, 10));
                      }}
                      className="px-3 py-2 border border-blue-200 bg-blue-50 text-[#0C447C] rounded-lg text-xs font-bold whitespace-nowrap hover:bg-blue-100 transition-colors"
                    >
                      +{getDiffDays(deliveryDate)} วัน
                    </button>
                  </div>
                </div>
              </div>

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
                                if (/^\d*\.?\d*$/.test(val)) updateLine(l.tempId, { qtyTon: val });
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
                                    if (/^\d*\.?\d*$/.test(val)) updateLine(l.tempId, { pricePerTon: val });
                                  }}
                                  className={`w-24 border rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none ${(Number(l.pricePerTon) || 0) < l.netPricePerTon ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                                />
                                <span className="text-[10px] text-gray-400">฿/ตัน</span>
                              </>
                            )}
                          </div>
                        </div>
                        {l.netPricePerTon > 0 && (
                          <div className={`text-[9px] mt-0.5 ${(Number(l.pricePerTon) || 0) < l.netPricePerTon - 500 ? 'text-red-500 font-bold' : 'text-orange-400'}`}>
                            NET ฿{l.netPricePerTon.toLocaleString()} • รีเบท ฿{Math.max(0, (Number(l.pricePerTon) || 0) - l.netPricePerTon).toFixed(0)}/ตัน
                            {(Number(l.pricePerTon) || 0) < l.netPricePerTon - 500 && ' ⚠ ต้องอนุมัติ'}
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
                      <button onClick={() => removeLine(l.tempId)} className="text-gray-300 hover:text-red-500 shrink-0">
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

            {/* Totals */}
              {lines.length > 0 && (
                <div className="border-t border-gray-100 pt-3 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">ยอดรวม</span>
                    <span className="font-bold" style={{ color: '#0C447C' }}>฿{totalAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                  </div>
                  {totalRebate > 0 && (
                    <div className="flex justify-between text-xs text-orange-500">
                      <span>รีเบทสะสม</span>
                      <span className="font-bold">฿{totalRebate.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-100 text-xs text-red-600">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                disabled={submitting || !custId || lines.length === 0}
                onClick={handleSubmit}
                className="w-full py-3 rounded-xl text-white text-sm font-bold transition-opacity disabled:opacity-50"
                style={{ background: '#0C447C' }}
              >
                {submitting ? 'กำลังบันทึก...' : 'บันทึกใบสั่งขาย (DRAFT)'}
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 text-center">
              <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-3">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">ยืนยันการเคลียร์ตะกร้า</h3>
              <p className="text-sm text-gray-500">การเปลี่ยนตั๋วคุมจะเคลียร์รายการสินค้าปัจจุบันทั้งหมด คุณต้องการดำเนินการต่อหรือไม่?</p>
            </div>
            <div className="flex border-t border-gray-100 divide-x divide-gray-100">
              <button
                className="flex-1 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
                onClick={() => {
                  setShowConfirm(false);
                  setPendingTicket('');
                }}
              >
                ยกเลิก
              </button>
              <button
                className="flex-1 py-3 text-sm font-bold text-amber-600 hover:bg-amber-50 transition-colors"
                onClick={() => {
                  setShowConfirm(false);
                  loadTicketDetails(pendingTicket);
                }}
              >
                ดำเนินการต่อ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
