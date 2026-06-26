const fs = require('fs');

const code = import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Minus, Truck, AlertTriangle, Package, Search, Calendar, FileText, CheckCircle2 } from 'lucide-react';
import { fetchCustomers, fetchGoods, fetchGiveawayGoods, fetchPrices, createSO, fetchTruckPlates, fetchControlTickets, fetchControlTicketDetails, listUsers } from '../../services/api';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { useAuthStore } from '../../store/auth-store';
import type { EMCust, EMGood, CurrentPrice, SalesOrderLine, SOPrefix, AdminUser } from '../../types';

type DraftLine = SalesOrderLine & { tempId: string; refControlTicketNo?: string; isControlTicketDrawn?: boolean };
type DraftBill = { id: string; soPrefix: SOPrefix; lines: DraftLine[]; remark: string };

const PREFIX_LABELS: Record<SOPrefix, string> = {
  I: 'I — ??????? (Invoice)',
  K: 'K — ????????',
  AI: 'AI — ???????',
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
  const [goods, setGoods] = useState<EMGood[]>([]);
  const [prices, setPrices] = useState<CurrentPrice[]>([]);
  const [truckPlates, setTruckPlates] = useState<string[]>([]);
  const [controlTickets, setControlTickets] = useState<{ DocuNo: string; DocuDate: string; TruckPlate?: string; Desc1?: string }[]>([]);
  
  // Grouped Order State
  const [custId, setCustId] = useState('');
  const [custSearch, setCustSearch] = useState('');
  const [isCustOpen, setIsCustOpen] = useState(false);
  const [truckPlate, setTruckPlate] = useState('');
  const [isTruckOpen, setIsTruckOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [salesUserId, setSalesUserId] = useState<string | number>('');
  
  // Multi-Bill State
  const [bills, setBills] = useState<DraftBill[]>([{ id: 'bill-1', soPrefix: 'I', lines: [], remark: '' }]);
  const [activeBillId, setActiveBillId] = useState('bill-1');
  const [useControlTicket, setUseControlTicket] = useState(false);
  const [selectedTicketForDraw, setSelectedTicketForDraw] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [salesUsers, setSalesUsers] = useState<AdminUser[]>([]);
  const userRole = useAuthStore(s => s.user?.role);

  const [activeTab, setActiveTab] = useState('???????');
  const [goodSearch, setGoodSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;

  useEffect(() => {
    if (!isOpen) return;
    fetchCustomers().then(setCustomers).catch(console.error);
    Promise.all([fetchGoods(), fetchGiveawayGoods()])
      .then(([g, gw]) => setGoods([...g, ...gw.map(x => ({ ...x, GoodGroupName: '??????' }))]))
      .catch(console.error);
    
    if (userRole === 'ADMIN') {
      listUsers().then(users => setSalesUsers(users.filter(u => u.Role === 'SALES' || u.Role === 'COUNTER_SALES'))).catch(console.error);
    }

    setBills([{ id: 'bill-1', soPrefix: 'I', lines: [], remark: '' }]);
    setActiveBillId('bill-1');
    setCustId(''); setTruckPlate(''); setSalesUserId('');
    setUseControlTicket(false); setSelectedTicketForDraw('');
    setActiveTab('???????'); setGoodSearch(''); setCurrentPage(1);
    
    const d = new Date(); d.setDate(d.getDate() + 7);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    setDeliveryDate(local.toISOString().slice(0, 10));
    setError(''); setCustSearch(''); setTruckPlates([]);
  }, [isOpen, userRole]);

  useEffect(() => {
    fetchPrices({ custId }).then(setPrices).catch(console.error);
    if (custId) {
      fetchTruckPlates(custId).then(setTruckPlates).catch(console.error);
      fetchControlTickets(custId).then(setControlTickets).catch(console.error);
    } else {
      setTruckPlates([]); setControlTickets([]);
    }
  }, [custId]);

  const priceObj = useCallback((goodId: string) => prices.find(p => p.GoodID === goodId), [prices]);
  const getNetPrice = useCallback((goodId: string, _qtyTon: number) => {
    return priceObj(goodId)?.GoodPriceNet ?? 0;
  }, [priceObj]);

  const categories = ['???????', ...Array.from(new Set(goods.map(g => g.GoodGroupName || '?????'))).filter(c => c !== '??????').sort(), '??????'];
  const filteredGoods = goods.filter(g => {
    if (activeTab !== '???????' && (g.GoodGroupName || '?????') !== activeTab) return false;
    if (goodSearch) {
      const q = goodSearch.toLowerCase();
      return g.GoodName.toLowerCase().includes(q) || g.GoodCode.toLowerCase().includes(q);
    }
    return true;
  });
  const totalPages = Math.ceil(filteredGoods.length / itemsPerPage) || 1;
  const paginatedGoods = filteredGoods.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => { setCurrentPage(1); }, [activeTab, goodSearch]);

  const activeBill = bills.find(b => b.id === activeBillId) || bills[0];

  function addGoodToActiveBill(good: EMGood) {
    if (!activeBill) return;
    const net = getNetPrice(good.GoodID, 1);
    
    setBills(prevBills => prevBills.map(b => {
      if (b.id !== activeBillId) return b;
      
      const isDrawn = useControlTicket && !!selectedTicketForDraw;
      const ticketRef = isDrawn ? selectedTicketForDraw : undefined;
      const defaultPrice = good.GoodGroupName === '??????' ? 0 : net;
      
      // Separate drawn and non-drawn items
      const existing = b.lines.find(l => l.goodId === good.GoodID && !l.isGiveaway && l.isControlTicketDrawn === isDrawn && l.refControlTicketNo === ticketRef);
      
      if (existing) {
        const newQty = existing.qtyTon + 1;
        const newNet = getNetPrice(good.GoodID, newQty);
        return {
          ...b,
          lines: b.lines.map(l => l.tempId === existing.tempId 
            ? { ...l, qtyTon: newQty, qtyBag: newQty * good.BagPerTon, netPricePerTon: newNet }
            : l
          )
        };
      }
      
      const newLine: DraftLine = {
        tempId: \\-\\,
        lineNo: b.lines.length + 1,
        goodId: good.GoodID,
        goodCode: good.GoodCode,
        goodName: good.GoodName,
        qtyTon: 1,
        qtyBag: good.BagPerTon || 0,
        pricePerTon: defaultPrice,
        netPricePerTon: defaultPrice,
        isGiveaway: good.GoodGroupName === '??????',
        isControlTicketDrawn: isDrawn,
        refControlTicketNo: ticketRef
      };
      return { ...b, lines: [newLine, ...b.lines] };
    }));
  }

  function updateActiveLine(tempId: string, patch: Partial<DraftLine>) {
    setBills(prevBills => prevBills.map(b => {
      if (b.id !== activeBillId) return b;
      return {
        ...b,
        lines: b.lines.map(l => {
          if (l.tempId !== tempId) return l;
          const updated = { ...l, ...patch };
          if (patch.qtyTon !== undefined) {
            const good = goods.find(g => g.GoodID === updated.goodId);
            updated.qtyBag = Math.round(updated.qtyTon * (good?.BagPerTon ?? 20));
            updated.netPricePerTon = getNetPrice(updated.goodId, updated.qtyTon);
          }
          return updated;
        })
      };
    }));
  }

  function removeActiveLine(tempId: string) {
    setBills(prevBills => prevBills.map(b => {
      if (b.id !== activeBillId) return b;
      return {
        ...b,
        lines: b.lines.filter(l => l.tempId !== tempId).map((l, i) => ({ ...l, lineNo: i + 1 }))
      };
    }));
  }

  function addNewBill() {
    const newId = \ill-\\;
    setBills(prev => [...prev, { id: newId, soPrefix: 'I', lines: [], remark: '' }]);
    setActiveBillId(newId);
  }

  function removeBill(id: string) {
    if (bills.length === 1) return;
    const newBills = bills.filter(b => b.id !== id);
    setBills(newBills);
    if (activeBillId === id) setActiveBillId(newBills[0].id);
  }

  function updateBillInfo(id: string, patch: Partial<DraftBill>) {
    setBills(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }

  const selectedCust = customers.find(c => c.CustID === custId);

  // Totals calculation
  const totalTons = bills.reduce((s, b) => s + b.lines.reduce((ls, l) => ls + (Number(l.qtyTon) || 0), 0), 0);
  const totalPayable = bills.reduce((s, b) => s + b.lines.reduce((ls, l) => ls + (l.isControlTicketDrawn ? 0 : (Number(l.qtyTon) || 0) * (Number(l.pricePerTon) || 0)), 0), 0);
  const totalOffset = bills.reduce((s, b) => s + b.lines.reduce((ls, l) => ls + (l.isControlTicketDrawn ? (Number(l.qtyTon) || 0) * (Number(l.pricePerTon) || 0) : 0), 0), 0);

  async function handleSubmit() {
    if (!custId) { setError('????????????????'); return; }
    const emptyBills = bills.filter(b => b.lines.length === 0);
    if (emptyBills.length > 0) { setError(\???????????????????????????? (\ ???)\); return; }

    const isNewTruck = truckPlate && truckPlates.length > 0 && !truckPlates.includes(truckPlate);
    if (isNewTruck) {
      if (!window.confirm(\????????? "\" ????????????????????????????????\\n\\n????????????????????????????????????????\\n\\n??????????????????????????????????\)) {
        return;
      }
    }

    setError(''); setSubmitting(true);
    try {
      // Build grouped payload (Array of orders)
      const payload = bills.map(b => ({
        soPrefix: b.soPrefix,
        custId,
        custName: selectedCust?.CustName || custId,
        truckPlate: truckPlate || undefined,
        deliveryDate: deliveryDate || undefined,
        remark: b.remark || undefined,
        salesUserId: salesUserId || undefined,
        lines: b.lines.map(({ tempId, ...l }) => ({
          ...l,
          qtyTon: Number(l.qtyTon) || 0,
          pricePerTon: Number(l.pricePerTon) || 0,
          isControlTicketDrawn: l.isControlTicketDrawn,
          refControlTicketNo: l.refControlTicketNo
        }))
      }));

      const res = await createSO(payload);
      if (res.needsApproval) alert(\? ?????????????????????? NET\\n????????????????? ???. ???? confirm\);
      else alert(\? ????????????????????????? (????? \ ???)\);
      onCreated?.();
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message || '??????????????');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-[96vw] h-[96vh] max-w-none flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-[#0C447C] text-white">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Truck size={24}/> ???????? (Grouped Bills)</h2>
            <p className="text-xs text-blue-200 mt-1">??????????? I, K ??????????????? ????????????????????</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white rounded-full p-2 hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#f9fafb]">
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-0 h-full">
            
            {/* LEFT PANEL: Bill Tabs & Items Picker */}
            <div className="lg:col-span-8 flex flex-col h-full bg-white border-r border-gray-200">
              
              {/* Tabs */}
              <div className="flex items-center px-4 pt-3 border-b border-gray-200 bg-gray-50 overflow-x-auto">
                {bills.map((b, i) => (
                  <div 
                    key={b.id} 
                    onClick={() => setActiveBillId(b.id)}
                    className={\lex items-center gap-2 px-4 py-2 rounded-t-lg border-t border-x cursor-pointer transition-colors \\}
                    style={{ marginBottom: '-1px' }}
                  >
                    <FileText size={16} /> ?????? {i+1} ({b.soPrefix})
                    {bills.length > 1 && (
                      <X size={14} className="ml-2 text-gray-400 hover:text-red-500" onClick={(e) => { e.stopPropagation(); removeBill(b.id); }} />
                    )}
                  </div>
                ))}
                <button onClick={addNewBill} className="ml-2 px-3 py-2 text-sm text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1">
                  <Plus size={16} /> ??????????????????
                </button>
              </div>

              {/* Product Picker */}
              <div className="p-4 flex flex-col flex-1 overflow-hidden">
                <div className="flex flex-col sm:flex-row justify-between gap-4 mb-4">
                  {/* Category Filter */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-2 scrollbar-hide flex-1">
                    {categories.map(cat => (
                      <button
                        key={cat}
                        onClick={() => { setActiveTab(cat); setCurrentPage(1); }}
                        className={\px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap \\}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  
                  {/* Control Ticket Toggle for Active Bill */}
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2 shrink-0">
                    <label className="flex items-center gap-2 text-xs font-bold text-amber-800 cursor-pointer">
                      <input type="checkbox" checked={useControlTicket} onChange={e => setUseControlTicket(e.target.checked)} className="rounded text-amber-600 focus:ring-amber-500"/>
                      ?????????????? (AI)
                    </label>
                    {useControlTicket && (
                      <select 
                        value={selectedTicketForDraw} onChange={e => setSelectedTicketForDraw(e.target.value)}
                        className="border border-amber-300 rounded px-2 py-1 text-xs bg-white focus:outline-none"
                      >
                        <option value="">-- ????????? --</option>
                        {controlTickets.map(t => <option key={t.DocuNo} value={t.DocuNo}>{t.DocuNo}</option>)}
                      </select>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 overflow-y-auto flex-1 content-start pr-1">
                  {paginatedGoods.map(g => {
                    const pObj = priceObj(g.GoodID);
                    const net = pObj?.GoodPriceNet ?? 0;
                    return (
                      <button key={g.GoodID} onClick={() => addGoodToActiveBill(g)} className="text-left p-3 rounded-xl border border-gray-100 bg-gray-50 hover:border-blue-300 hover:bg-blue-50 transition-all">
                        <div className="text-sm font-bold text-[#0C447C] line-clamp-2 h-10">{g.GoodName}</div>
                        {net > 0 ? <div className="text-xs font-bold text-gray-700">?{net.toLocaleString()}</div> : <div className="text-[10px] text-orange-400">????????? NET</div>}
                        <div className="text-[9px] text-gray-400 mt-1">{g.BagPerTon} ??????/???</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RIGHT PANEL: Truck Details & Active Bill Lines */}
            <div className="lg:col-span-4 p-4 flex flex-col gap-4 overflow-y-auto bg-[#f9fafb]">
              
              {/* Truck Header Info */}
              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 border-b pb-2"><Truck size={18}/> ???????????????</h3>
                
                <div className="relative">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">?????? *</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={custSearch}
                      onChange={e => { setCustSearch(e.target.value); if (custId) setCustId(''); }}
                      onFocus={() => setIsCustOpen(true)} onBlur={() => setTimeout(() => setIsCustOpen(false), 200)}
                      placeholder="???????????????..."
                      className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {isCustOpen && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                        {customers.filter(c => c.CustName.toLowerCase().includes(custSearch.toLowerCase()) || c.CustID.toLowerCase().includes(custSearch.toLowerCase())).map(c => (
                          <div key={c.CustID} className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b" onClick={() => { setCustId(c.CustID); setCustSearch(c.CustName); setIsCustOpen(false); }}>
                            <div className="font-bold">{c.CustName}</div><div className="text-[10px] text-gray-500">{c.CustID}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <label className="text-xs font-semibold text-gray-500 block mb-1">????????? *</label>
                    <input
                      value={truckPlate} onChange={e => setTruckPlate(e.target.value)}
                      onFocus={() => setIsTruckOpen(true)} onBlur={() => setTimeout(() => setIsTruckOpen(false), 200)}
                      placeholder="70-1087/88"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
                    />
                    {isTruckOpen && truckPlates.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border rounded shadow max-h-32 overflow-y-auto">
                        {truckPlates.filter(p => p.toLowerCase().includes(truckPlate.toLowerCase())).map(p => (
                          <div key={p} className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer" onClick={() => { setTruckPlate(p); setIsTruckOpen(false); }}>{p}</div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">????????????</label>
                    <ThaiDatePicker value={deliveryDate} onChange={setDeliveryDate} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none" />
                  </div>
                </div>
              </div>

              {/* Active Bill Config */}
              <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm border-t-4 border-t-[#0C447C] flex flex-col flex-1 min-h-[300px]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-[#0C447C]">??????????? {activeBill?.soPrefix}</h3>
                  <select 
                    value={activeBill?.soPrefix} 
                    onChange={e => updateBillInfo(activeBillId, { soPrefix: e.target.value as SOPrefix })}
                    className="border border-gray-200 rounded text-sm px-2 py-1 font-bold bg-gray-50"
                  >
                    <option value="I">I - ???????</option>
                    <option value="K">K - ????????</option>
                    <option value="AI">AI - ???????</option>
                  </select>
                </div>

                {activeBill?.lines.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                    <Package size={32} className="mb-2 opacity-50"/>
                    <p className="text-sm">??????????????????????</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {activeBill?.lines.map(l => (
                      <div key={l.tempId} className={\p-3 rounded-lg border \\}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="text-xs font-bold text-gray-800 line-clamp-2">{l.goodName}</div>
                            {l.isControlTicketDrawn && (
                              <div className="text-[10px] text-amber-700 font-bold bg-amber-100 inline-block px-1.5 py-0.5 rounded mt-1">
                                ????????: {l.refControlTicketNo}
                              </div>
                            )}
                          </div>
                          <button onClick={() => removeActiveLine(l.tempId)} className="text-gray-400 hover:text-red-500 shrink-0"><X size={14}/></button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center border border-gray-200 rounded bg-white">
                            <button onClick={() => updateActiveLine(l.tempId, { qtyTon: Math.max(0.5, l.qtyTon - 1) })} className="px-2 py-1 text-gray-500 hover:bg-gray-100"><Minus size={12} /></button>
                            <input type="number" value={l.qtyTon || ''} onChange={e => updateActiveLine(l.tempId, { qtyTon: Number(e.target.value) })} className="w-12 text-center text-xs font-mono font-bold py-1 focus:outline-none" />
                            <button onClick={() => updateActiveLine(l.tempId, { qtyTon: l.qtyTon + 1 })} className="px-2 py-1 text-gray-500 hover:bg-gray-100"><Plus size={12} /></button>
                          </div>
                          <span className="text-[10px] text-gray-500 font-medium">???</span>
                          
                          <div className="ml-auto text-right">
                            <div className="text-xs font-bold text-gray-700">?{(l.pricePerTon * l.qtyTon).toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="mt-3 pt-3 border-t">
                  <input type="text" placeholder="??????????????..." value={activeBill?.remark} onChange={e => updateBillInfo(activeBillId, { remark: e.target.value })} className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="border-t border-gray-200 bg-white p-4 px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex gap-6">
            <div>
              <div className="text-xs text-gray-500 font-bold">????????????</div>
              <div className="text-lg font-black text-[#0C447C]">{totalTons.toLocaleString()} <span className="text-xs font-normal">???</span></div>
            </div>
            <div>
              <div className="text-xs text-amber-600 font-bold">????????????? (AI)</div>
              <div className="text-lg font-black text-amber-600">?{totalOffset.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-green-600 font-bold">????????????</div>
              <div className="text-xl font-black text-green-600">?{totalPayable.toLocaleString()}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {error && <div className="text-red-500 text-xs font-bold bg-red-50 px-3 py-1.5 rounded-lg border border-red-100">{error}</div>}
            <button onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">??????</button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-6 py-2.5 text-sm font-bold text-white bg-[#0C447C] hover:bg-[#0a3663] rounded-xl flex items-center gap-2 shadow-lg disabled:opacity-50 transition-colors"
            >
              {submitting ? '???????????...' : <><CheckCircle2 size={16}/> ??????????????</>}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}


fs.writeFileSync('WSSale-App/src/components/sales/CreateSODialog.tsx', code);
console.log('Successfully generated CreateSODialog.tsx');
