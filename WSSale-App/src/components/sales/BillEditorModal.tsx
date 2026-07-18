import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Minus, Truck, AlertTriangle, Package, Search, Calendar, FileText, CheckCircle2, ChevronLeft, ChevronRight, ShoppingCart, ChevronUp, ChevronDown } from 'lucide-react';
import { fetchCustomers, fetchGoods, fetchGiveawayGoods, fetchPrices, createSO, updateSO, fetchSalesOrder, fetchTruckPlates, fetchControlTickets, fetchControlTicketDetails, listUsers, getRebateBalance, apiFetch } from '../../services/api';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { GiveawayBorrowModal } from './GiveawayBorrowModal';
import { useAuthStore } from '../../store/auth-store';
import type { EMCust, EMGood, CurrentPrice, SalesOrderLine, SOPrefix, AdminUser } from '../../types';

type DraftLine = SalesOrderLine & { tempId: string; refControlTicketNo?: string; isControlTicketDrawn?: boolean; maxQtyTon?: number };
type DraftBill = { id: string; soPrefix: SOPrefix; lines: DraftLine[]; remark: string; rebateDiscountAmt?: number; wfRef?: string };

const PREFIX_LABELS: Record<SOPrefix, string> = {
  I: 'I — ขายปกติ (Invoice)',
  K: 'K — ขายพิเศษ',
  AI: 'AI — ตั๋วคุม',
};

export function CreateSODialog({
  isOpen,
  onClose,
  onCreated,
  editSoId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
  editSoId?: string;
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
  const [availableRebate, setAvailableRebate] = useState(0);
  
  // Multi-Bill State
  const [bills, setBills] = useState<DraftBill[]>([{ id: 'bill-1', soPrefix: 'I', lines: [], remark: '' }]);
  const [activeBillId, setActiveBillId] = useState('bill-1');
  const [useControlTicket, setUseControlTicket] = useState(false);
  const [selectedTicketForDraw, setSelectedTicketForDraw] = useState('');
  const [ticketSearch, setTicketSearch] = useState('');
  const [isTicketOpen, setIsTicketOpen] = useState(false);
  const [ticketDetails, setTicketDetails] = useState<{ ListNo: number; GoodID: string; GoodCode: string; GoodName: string; QtyTon: number; PricePerTon: number; NetPricePerTon: number; BagPerTon: number }[]>([]);
  const [ticketLoading, setTicketLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [salesUsers, setSalesUsers] = useState<AdminUser[]>([]);
  const userRole = useAuthStore(s => s.user?.role);

  const [activeTab, setActiveTab] = useState('ทั้งหมด');
  const [goodSearch, setGoodSearch] = useState('');
  
  // Giveaway Quota State
  const [myQuota, setMyQuota] = useState<{ Brand: string; ItemName: string; RemainingQty: number }[]>([]);
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [borrowReq, setBorrowReq] = useState({ brand: '', itemName: '', requiredQty: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Mobile UX State
  const [mobileView, setMobileView] = useState<'products' | 'cart'>('products');
  const [isTruckInfoCollapsed, setIsTruckInfoCollapsed] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetchCustomers().then(setCustomers).catch(console.error);
    Promise.all([fetchGoods(), fetchGiveawayGoods()])
      .then(([g, gw]) => setGoods([...g, ...gw.map(x => ({ ...x, GoodGroupName: 'ของแถม' }))]))
      .catch(console.error);
      
    const currentYear = new Date().getFullYear() + 543 - 2500 + 2500;
    apiFetch(`/giveaway/my-quota?year=${currentYear}`).then(setMyQuota).catch(console.error);
    
    if (userRole === 'ADMIN') {
      listUsers().then(setSalesUsers).catch(console.error);
    }

    if (editSoId && editSoId !== 'undefined') {
      fetchSalesOrder(editSoId).then(so => {
        setCustId((so as any).custId || (so as any).custID || (so as any).CustId || (so as any).CustID || '');
        setCustSearch((so as any).custName || (so as any).CustName || '');
        setTruckPlate((so as any).truckPlate || (so as any).TruckPlate || '');
        setSalesUserId((so as any).salesUserId || (so as any).salesUserID || (so as any).SalesUserId || (so as any).SalesUserID || '');
        setDeliveryDate(so.deliveryDate ? so.deliveryDate.split('T')[0] : '');
        setBills([{
          id: 'bill-1',
          soPrefix: so.soPrefix as SOPrefix,
          remark: so.remark || '',
          rebateDiscountAmt: so.rebateDiscountAmt || 0,
          wfRef: (so as any).wfRef || (so as any).WfRef || '',
          lines: (so.lines || []).map((l, i) => ({
            ...l,
            tempId: `${l.goodId}-${i}`,
            lineNo: i + 1,
            isGiveaway: !!l.isGiveaway,
            isControlTicketDrawn: !!l.isControlTicketDrawn
          }))
        }]);
      }).catch(console.error);
    } else {
      setBills([{ id: 'bill-1', soPrefix: 'I', lines: [], remark: '' }]);
      setActiveBillId('bill-1');
      setCustId(''); setTruckPlate(''); setSalesUserId('');
      setUseControlTicket(false); setSelectedTicketForDraw('');
      setActiveTab('ทั้งหมด'); setGoodSearch(''); setCurrentPage(1);
      
      const d = new Date(); d.setDate(d.getDate() + 7);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      setDeliveryDate(local.toISOString().slice(0, 10));
      setError(''); setCustSearch(''); setTruckPlates([]);
      setIsTruckInfoCollapsed(false); setMobileView('products');
    }
  }, [isOpen, userRole, editSoId]);

  useEffect(() => {
    fetchPrices({ custId }).then(setPrices).catch(console.error);
    if (custId) {
      fetchTruckPlates(custId).then(setTruckPlates).catch(console.error);
      fetchControlTickets(custId).then(setControlTickets).catch(console.error);
      getRebateBalance(custId).then(r => setAvailableRebate(r.availableRebate)).catch(console.error);
    } else {
      setTruckPlates([]); setControlTickets([]); setAvailableRebate(0);
    }
  }, [custId]);

  const priceObj = useCallback((goodId: string) => prices.find(p => p.GoodID === goodId), [prices]);
  const getNetPrice = useCallback((goodId: string, _qtyTon: number) => {
    return priceObj(goodId)?.GoodPriceNet ?? 0;
  }, [priceObj]);

  // Fetch ticket details when a ticket is selected for drawing
  useEffect(() => {
    if (!selectedTicketForDraw) { setTicketDetails([]); return; }
    setTicketLoading(true);
    fetchControlTicketDetails(selectedTicketForDraw)
      .then(setTicketDetails)
      .catch(e => { console.error(e); setTicketDetails([]); })
      .finally(() => setTicketLoading(false));
  }, [selectedTicketForDraw]);

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

  useEffect(() => { setCurrentPage(1); }, [activeTab, goodSearch]);

  const activeBill = bills.find(b => b.id === activeBillId) || bills[0];

  function addGoodToActiveBill(good: EMGood) {
    if (!activeBill) return;
    const net = getNetPrice(good.GoodID, 1);
    
    // Auto-collapse truck info on mobile when starting to add products
    if (window.innerWidth < 1024) setIsTruckInfoCollapsed(true);
    
    const isGiveaway = good.GoodGroupName === 'ของแถม';

    // Giveaway Quota Check
    if (isGiveaway) {
      const quota = myQuota.find(q => good.GoodName.includes(q.ItemName) || q.ItemName.includes(good.GoodName));
      const remaining = quota ? quota.RemainingQty : 0;
      
      const totalAdded = bills.reduce((sum, currB) => 
        sum + currB.lines.filter(l => l.goodId === good.GoodID && l.isGiveaway).reduce((s, l) => s + l.qtyTon, 0)
      , 0);

      if (totalAdded + 1 > remaining) {
        const brandMatch = good.GoodName.match(/ตรา([^\s]+)/);
        const parsedBrand = quota ? quota.Brand : (brandMatch ? `ตรา${brandMatch[1]}` : 'ทั่วไป');
        const parsedItemName = quota ? quota.ItemName : good.GoodName;
        
        setBorrowReq({ brand: parsedBrand, itemName: parsedItemName, requiredQty: (totalAdded + 1) - remaining });
        setBorrowModalOpen(true);
        return; // Prevent adding
      }
    }

    setBills(prevBills => prevBills.map(b => {
      if (b.id !== activeBillId) return b;
      
      const defaultPrice = isGiveaway ? 0 : net;
      
      // Separate drawn and non-drawn items, but allow merging identical giveaways
      const existing = b.lines.find(l => 
        l.goodId === good.GoodID && 
        l.isGiveaway === isGiveaway && 
        !l.isControlTicketDrawn
      );
      
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
        tempId: `${good.GoodID}-${Date.now()}`,
        lineNo: b.lines.length + 1,
        goodId: good.GoodID,
        goodCode: good.GoodCode,
        goodName: good.GoodName,
        qtyTon: 1,
        qtyBag: good.BagPerTon || 0,
        pricePerTon: defaultPrice,
        netPricePerTon: defaultPrice,
        isGiveaway: good.GoodGroupName === 'ของแถม',
        isControlTicketDrawn: false,
        refControlTicketNo: undefined
      };
      return { ...b, lines: [newLine, ...b.lines] };
    }));
  }

  function addTicketItemToActiveBill(td: { ListNo: number; GoodID: string; GoodCode: string; GoodName: string; QtyTon: number; PricePerTon: number; NetPricePerTon?: number; BagPerTon: number }) {
    if (!activeBill) return;
    
    setBills(prevBills => prevBills.map(b => {
      if (b.id !== activeBillId) return b;
      
      const ticketRef = selectedTicketForDraw;
      const existing = b.lines.find(l => l.goodId === td.GoodID && l.isControlTicketDrawn && l.refControlTicketNo === ticketRef);
      
      if (existing) {
        const newQty = existing.qtyTon + 1;
        if (existing.maxQtyTon !== undefined && newQty > existing.maxQtyTon) return b;
        return {
          ...b,
          lines: b.lines.map(l => l.tempId === existing.tempId 
            ? { ...l, qtyTon: newQty, qtyBag: newQty * td.BagPerTon }
            : l
          )
        };
      }
      
      const newLine: DraftLine = {
        tempId: `${td.GoodID}-${Date.now()}`,
        lineNo: b.lines.length + 1,
        goodId: td.GoodID,
        goodCode: td.GoodCode,
        goodName: td.GoodName,
        qtyTon: 1,
        qtyBag: td.BagPerTon || 20,
        pricePerTon: td.PricePerTon || 0,
        netPricePerTon: td.PricePerTon || 0, // Ticket price is fixed
        isGiveaway: false,
        isControlTicketDrawn: true,
        refControlTicketNo: ticketRef,
        maxQtyTon: td.QtyTon
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
            if (l.maxQtyTon !== undefined && patch.qtyTon > l.maxQtyTon) {
              patch.qtyTon = l.maxQtyTon;
            }
            const good = goods.find(g => g.GoodID === updated.goodId);
            updated.qtyBag = Math.round(updated.qtyTon * (good?.BagPerTon ?? 20));
            // Only recalculate net price if it's NOT drawn from a ticket
            if (!updated.isControlTicketDrawn) {
              updated.netPricePerTon = getNetPrice(updated.goodId, updated.qtyTon);
            }
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
    const newId = `bill-${Date.now()}`;
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
  const totalTons = bills.reduce((s, b) => s + b.lines.reduce((ls, l) => ls + (l.isGiveaway ? 0 : (Number(l.qtyTon) || 0)), 0), 0);
  const totalRebateDiscount = bills.reduce((s, b) => s + (Number(b.rebateDiscountAmt) || 0), 0);
  const totalPayable = bills.reduce((s, b) => s + b.lines.reduce((ls, l) => ls + (l.isControlTicketDrawn ? 0 : (Number(l.qtyTon) || 0) * (Number(l.pricePerTon) || 0)), 0), 0) - totalRebateDiscount;
  const totalOffset = bills.reduce((s, b) => s + b.lines.reduce((ls, l) => ls + (l.isControlTicketDrawn ? (Number(l.qtyTon) || 0) * (Number(l.pricePerTon) || 0) : 0), 0), 0);
  const totalCartItems = bills.reduce((s, b) => s + b.lines.length, 0);

  async function handleSubmit() {
    if (!custId) { setError('กรุณาเลือกลูกค้า'); return; }
    const emptyBills = bills.filter(b => b.lines.length === 0);
    if (emptyBills.length > 0) { setError(`มีบิลที่ยังไม่ได้เลือกสินค้า (${emptyBills.length} บิล)`); return; }

    if (!custId) { setError('กรุณาเลือกลูกค้าจากรายการ'); return; }

    if (totalPayable === 0) {
      if (!window.confirm(`ยอดรวมเป็น 0 บาท\n\nต้องการบันทึกเอกสารนี้หรือไม่?`)) {
        return;
      }
    }

    const isNewTruck = truckPlate && truckPlates.length > 0 && !truckPlates.includes(truckPlate);
    if (isNewTruck) {
      if (!window.confirm(`ทะเบียนรถ "${truckPlate}" เป็นรถใหม่ที่ไม่เคยเข้ารับบริการ\n\nระบบจะบันทึกเป็นรถคันใหม่ให้โดยอัตโนมัติ\n\nคุณแน่ใจหรือไม่ที่จะใช้ทะเบียนนี้?`)) {
        return;
      }
    }

    setError(''); setSubmitting(true);
    try {
      if (editSoId) {
        // Edit mode (single bill)
        const b = bills[0];
        const payload = {
          soPrefix: b.soPrefix,
          custId,
          custName: selectedCust?.CustName || custId,
          truckPlate: truckPlate || undefined,
          deliveryDate: deliveryDate || undefined,
          remark: b.remark || undefined,
          rebateDiscountAmt: b.rebateDiscountAmt || 0,
          salesUserId: salesUserId || undefined,
          lines: b.lines.map(({ tempId, ...l }) => ({
            ...l,
            qtyTon: Number(l.qtyTon) || 0,
            pricePerTon: Number(l.pricePerTon) || 0,
            isControlTicketDrawn: l.isControlTicketDrawn,
            refControlTicketNo: l.refControlTicketNo
          }))
        };
        const res = await updateSO(editSoId, payload);
        if (res.needsApproval) alert(`⚠ มีรายการที่ราคาต่ำกว่า NET\nต้องการอนุมัติจาก ผจก. ก่อน confirm`);
        else alert(`✓ แก้ไขใบสั่งขายสำเร็จ`);
      } else {
        // Build grouped payload (Array of orders)
        const payload = bills.map(b => ({
          soPrefix: b.soPrefix,
          custId,
          custName: selectedCust?.CustName || custId,
          truckPlate: truckPlate || undefined,
          deliveryDate: deliveryDate || undefined,
          remark: b.remark || undefined,
          rebateDiscountAmt: b.rebateDiscountAmt || 0,
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
        if (res.needsApproval) alert(`⚠ มีรายการที่ราคาต่ำกว่า NET\nต้องการอนุมัติจาก ผจก. ก่อน confirm`);
        else alert(`✓ สร้างกลุ่มใบสั่งขายสำเร็จ (จำนวน ${payload.length} บิล)`);
      }
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
      <div className="flex-1 flex flex-col h-full bg-white relative w-full overflow-hidden max-w-full">
        <div className="flex items-center justify-between px-4 py-2 sm:px-6 sm:py-3 border-b border-gray-100 bg-[#0C447C] text-white shrink-0">
          <div>
            <h2 className="text-base sm:text-xl font-bold flex items-center gap-2"><Truck size={20} className="sm:w-6 sm:h-6"/> ใบสั่งขาย</h2>
            <p className="hidden sm:block text-xs text-blue-200 mt-1">จัดเรียงบิล I, K ในรถคันเดียวกัน และจัดการเบิกตั๋วคุม</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white rounded-full p-1.5 sm:p-2 hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        {/* TRUCK INFO BAR — shared across all bills */}
        <div className="bg-white border-b border-gray-200 shrink-0 flex flex-col">
          <div 
            className="flex items-center justify-between px-4 sm:px-6 py-1.5 bg-gray-50 border-b border-gray-100 cursor-pointer lg:hidden"
            onClick={() => setIsTruckInfoCollapsed(!isTruckInfoCollapsed)}
          >
            <div className="flex items-center gap-2">
              <Truck size={14} className="text-gray-500" />
              <span className="text-xs font-bold text-gray-700">
                ลูกค้า {custSearch ? `(${custSearch})` : ''} {truckPlate ? `[${truckPlate}]` : ''}
              </span>
            </div>
            {isTruckInfoCollapsed ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronUp size={16} className="text-gray-400" />}
          </div>
          
          <div className={`px-4 sm:px-6 py-2 sm:py-3 transition-all overflow-hidden ${isTruckInfoCollapsed ? 'hidden lg:block' : 'block'}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:flex lg:flex-wrap items-end gap-2 sm:gap-4">
            {userRole === 'ADMIN' && (
              <div className="min-w-[200px]">
                <label className="text-[10px] font-bold text-amber-700 block mb-0.5">ทำรายการแทน (Admin)</label>
                <select value={salesUserId} onChange={e => setSalesUserId(e.target.value)}
                  className="w-full border border-amber-200 rounded-lg px-2 py-1.5 text-sm bg-amber-50 text-amber-900 focus:ring-amber-500 focus:outline-none">
                  <option value="">-- เป็นตัวเอง --</option>
                  {salesUsers.map(u => <option key={u.Id} value={u.Id}>{u.DisplayName} ({u.Username})</option>)}
                </select>
              </div>
            )}
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <label className="text-[10px] font-bold text-gray-500 block mb-0.5">ลูกค้า *</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={custSearch}
                  onChange={e => { setCustSearch(e.target.value); if (custId) setCustId(''); }}
                  onFocus={() => setIsCustOpen(true)} onBlur={() => setTimeout(() => setIsCustOpen(false), 200)}
                  placeholder="ค้นหาชื่อลูกค้า..."
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {isCustOpen && (
                  <div className="absolute z-30 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    {customers.filter(c => c.CustName.toLowerCase().includes(custSearch.toLowerCase()) || c.CustID.toLowerCase().includes(custSearch.toLowerCase())).map(c => (
                      <div key={c.CustID} className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b" onClick={() => { setCustId(c.CustID); setCustSearch(c.CustName); setIsCustOpen(false); }}>
                        <div className="font-bold">{c.CustName}</div><div className="text-[10px] text-gray-500">{c.CustID}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="relative min-w-[140px]">
              <label className="text-[10px] font-bold text-gray-500 block mb-0.5"><Truck size={10} className="inline mr-0.5"/>ทะเบียนรถ *</label>
              <input
                value={truckPlate} onChange={e => setTruckPlate(e.target.value)}
                onFocus={() => setIsTruckOpen(true)} onBlur={() => setTimeout(() => setIsTruckOpen(false), 200)}
                placeholder="70-1087/88"
                className={`w-full border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none ${truckPlate && truckPlates.length > 0 && !truckPlates.includes(truckPlate) ? 'border-red-400 text-red-600 bg-red-50' : 'border-gray-200'}`}
              />
              {isTruckOpen && truckPlates.length > 0 && (
                <div className="absolute z-30 w-full mt-1 bg-white border rounded shadow max-h-32 overflow-y-auto">
                  {truckPlates.filter(p => p.toLowerCase().includes(truckPlate.toLowerCase())).map(p => (
                    <div key={p} className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer font-mono" onClick={() => { setTruckPlate(p); setIsTruckOpen(false); }}>{p}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="min-w-[150px]">
              <label className="text-[10px] font-bold text-gray-500 block mb-0.5">วันที่รับของ</label>
              <ThaiDatePicker value={deliveryDate} onChange={setDeliveryDate} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none" />
            </div>
          </div>
        </div>
      </div>

        {/* MOBILE SEGMENTED CONTROL */}
        <div className="lg:hidden flex border-b border-gray-200 bg-white shrink-0">
          <button 
            onClick={() => setMobileView('products')}
            className={`flex-1 py-2 sm:py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors border-b-2 ${mobileView === 'products' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Package size={16} /> เลือกสินค้า
          </button>
          <button 
            onClick={() => setMobileView('cart')}
            className={`flex-1 py-2 sm:py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors border-b-2 relative ${mobileView === 'cart' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <ShoppingCart size={16} /> ตะกร้าบิล
            {totalCartItems > 0 && (
              <span className={`absolute top-2 right-1/4 translate-x-2 -translate-y-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${mobileView === 'cart' ? 'bg-[#0C447C]' : 'bg-red-500'}`}>
                {totalCartItems}
              </span>
            )}
          </button>
        </div>

        {/* MOBILE BILL TABS */}
        <div className="lg:hidden flex items-center px-2 sm:px-4 pt-1.5 sm:pt-3 border-b border-gray-200 bg-gray-50 overflow-x-auto scrollbar-hide shrink-0 w-full">
          {bills.map((b, i) => {
            const billTotal = b.lines.reduce((s, l) => s + (l.isControlTicketDrawn ? 0 : l.qtyTon * l.pricePerTon), 0);
            return (
            <div 
              key={b.id} 
              onClick={() => setActiveBillId(b.id)}
              className={`flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-t-lg border-t border-x cursor-pointer transition-colors whitespace-nowrap ${
                activeBillId === b.id 
                  ? `bg-white border-gray-200 font-bold border-b-white ${truckPlate === 'ตั๋วคุม' ? 'text-purple-800' : 'text-[#0C447C]'}` 
                  : `bg-transparent border-transparent ${truckPlate === 'ตั๋วคุม' ? 'text-purple-500 hover:text-purple-700' : 'text-gray-500 hover:text-gray-800'}`
              }`}
              style={{ marginBottom: '-1px' }}
            >
              <FileText size={16} /> 
              <span>บิลที่ {i+1} ({b.soPrefix})</span>
              {truckPlate === 'ตั๋วคุม' && <span className="ml-1 text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold">ตั๋วคุม</span>}
              <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full border ${billTotal > 0 ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>฿{billTotal.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
              {!editSoId && bills.length > 1 && (
                <X size={14} className="ml-2 text-gray-400 hover:text-red-500" onClick={(e) => { e.stopPropagation(); removeBill(b.id); }} />
              )}
            </div>
          )})}
          {!editSoId && (
            <button onClick={addNewBill} className="ml-2 px-3 py-2 text-sm text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 shrink-0">
              <Plus size={16} /> เพิ่มบิล
            </button>
          )}
        </div>

        <div className="flex-1 overflow-hidden bg-[#f9fafb]">
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-0 h-full">
            
            {/* LEFT PANEL: Bill Tabs & Items Picker */}
            <div className={`lg:col-span-8 flex-col border-r border-gray-200 bg-white flex-1 min-w-0 min-h-0 ${mobileView === 'products' ? 'flex' : 'hidden lg:flex'}`}>
              
              {/* PC Tabs */}
              <div className="hidden lg:flex items-center px-4 pt-1.5 sm:pt-3 border-b border-gray-200 bg-gray-50 overflow-x-auto scrollbar-hide w-full">
                {bills.map((b, i) => {
                  const billTotal = b.lines.reduce((s, l) => s + (l.isControlTicketDrawn ? 0 : l.qtyTon * l.pricePerTon), 0);
                  return (
                    <div 
                      key={b.id} 
                      onClick={() => setActiveBillId(b.id)}
                      className={`flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-t-lg border-t border-x cursor-pointer transition-colors whitespace-nowrap ${
                        activeBillId === b.id 
                          ? `bg-white border-gray-200 font-bold border-b-white ${truckPlate === 'ตั๋วคุม' ? 'text-purple-800' : 'text-[#0C447C]'}` 
                          : `bg-transparent border-transparent ${truckPlate === 'ตั๋วคุม' ? 'text-purple-500 hover:text-purple-700' : 'text-gray-500 hover:text-gray-800'}`
                      }`}
                      style={{ marginBottom: '-1px' }}
                    >
                      <FileText size={16} /> 
                      <span>บิลที่ {i+1} {b.wfRef ? `(เลขที่: ${b.wfRef})` : `(${b.soPrefix})`}</span>
                      {truckPlate === 'ตั๋วคุม' && <span className="ml-1 text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold">ตั๋วคุม</span>}
                      <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full border ${billTotal > 0 ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>฿{billTotal.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                    {!editSoId && bills.length > 1 && (
                      <X size={14} className="ml-2 text-gray-400 hover:text-red-500" onClick={(e) => { e.stopPropagation(); removeBill(b.id); }} />
                    )}
                  </div>
                )})}
                {!editSoId && (
                  <button onClick={addNewBill} className="ml-2 px-3 py-2 text-sm text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1">
                    <Plus size={16} /> เพิ่มบิลในรถคันนี้
                  </button>
                )}
              </div>

              {/* Product Picker */}
              <div className="p-2 sm:p-4 flex flex-col flex-1 overflow-hidden min-h-0">
                <div className="flex flex-col sm:flex-row justify-between gap-2 sm:gap-4 mb-2 sm:mb-4">
                  <div className="flex-1 flex flex-col gap-2">
                    {/* Search Input */}
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="ค้นหาสินค้า (ชื่อ, รหัส)..." 
                        value={goodSearch} 
                        onChange={e => setGoodSearch(e.target.value)}
                        className="border border-gray-200 rounded-lg pl-8 pr-8 py-1.5 text-sm w-full focus:ring-1 focus:ring-[#0C447C] outline-none"
                      />
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      {goodSearch && (
                        <button 
                          onClick={() => setGoodSearch('')} 
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    {/* Category Filter */}
                    <div className="flex flex-wrap items-center gap-1.5 pb-1">
                      {categories.map(cat => (
                      <button
                        key={cat}
                        onClick={() => { setActiveTab(cat); setCurrentPage(1); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${activeTab === cat ? 'bg-[#0C447C] text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  </div>
                  
                  {/* Control Ticket Toggle for Active Bill */}
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2 shrink-0">
                    <label className="flex items-center gap-2 text-xs font-bold text-amber-800 cursor-pointer">
                      <input type="checkbox" checked={useControlTicket} onChange={e => setUseControlTicket(e.target.checked)} className="rounded text-amber-600 focus:ring-amber-500"/>
                      เบิกจากตั๋วคุม (AI)
                    </label>
                    {useControlTicket && (
                      <div className="relative">
                        <input
                          type="text"
                          value={ticketSearch || selectedTicketForDraw}
                          onChange={e => {
                            setTicketSearch(e.target.value);
                            setSelectedTicketForDraw('');
                            setIsTicketOpen(true);
                          }}
                          onFocus={() => setIsTicketOpen(true)}
                          placeholder="ค้นหาเลขตั๋วคุม..."
                          className="border border-amber-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 w-40"
                        />
                        {selectedTicketForDraw && (
                           <button onClick={() => { setSelectedTicketForDraw(''); setTicketSearch(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                             <X size={12} />
                           </button>
                        )}
                        {isTicketOpen && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsTicketOpen(false)} />
                            <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
                              {controlTickets.filter(t => t.DocuNo.toLowerCase().includes(ticketSearch.toLowerCase())).length === 0 ? (
                                <div className="px-3 py-2 text-xs text-gray-500">ไม่พบตั๋วคุมที่ค้นหา</div>
                              ) : (
                                controlTickets
                                  .filter(t => t.DocuNo.toLowerCase().includes(ticketSearch.toLowerCase()))
                                  .map(t => (
                                    <button
                                      key={t.DocuNo}
                                      onClick={() => {
                                        setSelectedTicketForDraw(t.DocuNo);
                                        setTicketSearch('');
                                        setIsTicketOpen(false);
                                      }}
                                      className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-gray-50 last:border-0"
                                    >
                                      <div className="text-sm font-medium text-amber-900">{t.DocuNo}</div>
                                      {t.Desc1 && <div className="text-[10px] text-gray-500 truncate">{t.Desc1}</div>}
                                    </button>
                                  ))
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Control Ticket Details Preview */}
                {useControlTicket && selectedTicketForDraw && (
                  <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="text-xs font-bold text-amber-800 mb-2 flex items-center gap-2">
                      <FileText size={14}/> รายการในตั๋วคุม: {selectedTicketForDraw}
                    </div>
                    {ticketLoading ? (
                      <div className="text-xs text-amber-600 animate-pulse">กำลังโหลด...</div>
                    ) : ticketDetails.length === 0 ? (
                      <div className="text-xs text-gray-500">ไม่พบรายการสินค้าในตั๋วนี้</div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        {ticketDetails.map((td, i) => (
                          <button key={i} type="button" onClick={(e) => { e.preventDefault(); addTicketItemToActiveBill(td); }} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1.5 border border-amber-100 text-xs text-left hover:bg-amber-100/50 hover:border-amber-300 transition-colors cursor-pointer shadow-sm">
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-gray-800 truncate">{td.GoodName}</div>
                              <div className="text-[10px] text-gray-500">{td.GoodCode}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-amber-700">{td.QtyTon} ตัน</div>
                              <div className="text-[10px] text-gray-400">฿{td.PricePerTon?.toLocaleString()}/ตัน</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-amber-600 mt-2">คลิกสินค้าด้านบนเพื่อเพิ่มรายการที่ต้องการเบิกจากตั๋วคุมนี้ (ราคาสินค้าจะถูกล็อกตามตั๋วคุม)</p>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 flex-1 content-start overflow-y-auto scrollbar-hide pb-2">
                  {paginatedGoods.map(g => {
                    const pObj = priceObj(g.GoodID);
                    const net = pObj?.GoodPriceNet ?? 0;
                    const isExpired = pObj?.IsExpired === 1;
                    const isGiveaway = g.GoodGroupName === 'ของแถม';
                    const inCart = activeBill?.lines.some(l => l.goodId === g.GoodID);
                    return (
                      <button
                        key={g.GoodID}
                        onClick={() => addGoodToActiveBill(g)}
                        className={`text-left p-3 rounded-xl border transition-all ${
                          inCart 
                            ? 'border-blue-300 bg-blue-50' 
                            : isGiveaway && (g.RemainingQty || 0) <= 0
                              ? 'border-red-200 bg-red-50 hover:border-red-300 hover:bg-red-100'
                              : 'border-gray-100 bg-gray-50 hover:border-gray-200 hover:bg-white'
                        }`}
                      >
                        <div className="text-sm font-bold text-[#0C447C] line-clamp-2 leading-tight mb-1.5 h-10" title={g.GoodName}>{g.GoodName}</div>
                        {!isGiveaway ? (
                          <>
                            {net > 0 ? (
                              <div className="text-xs font-bold" style={{ color: isExpired ? '#DC2626' : '#0C447C' }}>
                                ฿{net.toLocaleString()}<span className="text-[9px] font-normal text-gray-400">/ตัน</span>
                              </div>
                            ) : (
                              <div className="text-[10px] text-orange-400">ไม่มีราคา NET</div>
                            )}
                            <div className="text-[9px] text-gray-300 mt-0.5">{g.BagPerTon} กระสอบ/ตัน · {g.WeightKgPerBag}kg</div>
                          </>
                        ) : (
                          <>
                            <div className={`text-[11px] font-bold ${(g.RemainingQty || 0) > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              โควต้าคงเหลือ: {(g.RemainingQty || 0).toLocaleString()} {g.UnitName || 'ชิ้น'}
                            </div>
                            <div className="text-[9px] text-gray-300 mt-0.5">หน่วยนับ: {g.UnitName || 'ชิ้น'}</div>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-2 sm:mt-4 pt-2 sm:pt-3 border-t border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">หน้า {currentPage} จาก {totalPages} <span className="text-gray-400">({filteredGoods.length} รายการ)</span></span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-7 w-7 flex items-center justify-center rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors"><ChevronLeft size={16}/></button>
                      <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="h-7 w-7 flex items-center justify-center rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors"><ChevronRight size={16}/></button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT PANEL: Active Bill Lines */}
            <div className={`lg:col-span-4 p-4 flex-col gap-4 overflow-y-auto bg-[#f9fafb] ${mobileView === 'cart' ? 'flex' : 'hidden lg:flex'}`}>

              {/* Active Bill Config */}
              <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm border-t-4 border-t-[#0C447C] flex flex-col flex-1 min-h-[300px]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-[#0C447C]">รายการในบิล {activeBill?.wfRef ? `(เลขที่: ${activeBill?.wfRef})` : activeBill?.soPrefix}</h3>
                  <select 
                    value={activeBill?.soPrefix} 
                    onChange={e => updateBillInfo(activeBillId, { soPrefix: e.target.value as SOPrefix })}
                    className="border border-gray-200 rounded text-sm px-2 py-1 font-bold bg-gray-50"
                  >
                    <option value="I">I - บัญชี 1</option>
                    <option value="K">K - บัญชี 2</option>
                    <option value="AI">AI - ตั๋วคุม</option>
                  </select>
                </div>

                {activeBill?.lines.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                    <Package size={32} className="mb-2 opacity-50"/>
                    <p className="text-sm">ยังไม่มีสินค้าในบิลนี้</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {activeBill?.lines.map(l => (
                      <div key={l.tempId} className={`p-3 rounded-lg border ${l.isControlTicketDrawn ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-white'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="text-xs font-bold text-gray-800 line-clamp-2">{l.goodName}</div>
                            {l.isControlTicketDrawn && (
                              <div className="text-[10px] text-amber-700 font-bold bg-amber-100 inline-block px-1.5 py-0.5 rounded mt-1">
                                เบิกตั๋ว: {l.refControlTicketNo}
                              </div>
                            )}
                          </div>
                          <button onClick={() => removeActiveLine(l.tempId)} className="text-gray-400 hover:text-red-500 shrink-0"><X size={14}/></button>
                        </div>
                        <div className="flex flex-col gap-1.5 mt-2">
                          <div className="flex justify-between items-end">
                            <div className="flex items-center gap-2">
                              <div className="flex items-center border border-gray-200 rounded bg-white">
                                <button onClick={() => updateActiveLine(l.tempId, { qtyTon: Math.max(0.5, l.qtyTon - 1) })} className="px-2 py-1 text-gray-500 hover:bg-gray-100"><Minus size={12} /></button>
                                <input type="number" max={l.maxQtyTon} value={l.qtyTon || ''} onChange={e => updateActiveLine(l.tempId, { qtyTon: Number(e.target.value) })} className="w-12 text-center text-xs font-mono font-bold py-1 focus:outline-none" />
                                <button onClick={() => updateActiveLine(l.tempId, { qtyTon: l.qtyTon + 1 })} disabled={l.maxQtyTon !== undefined && l.qtyTon >= l.maxQtyTon} className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"><Plus size={12} /></button>
                              </div>
                              <span className="text-[10px] text-gray-500 font-medium">{l.isGiveaway ? (goods.find(g => g.GoodID === l.goodId)?.UnitName || 'ชิ้น') : 'ตัน'}</span>
                            </div>
                            
                            <div className="flex flex-col items-end gap-1">
                              {l.isControlTicketDrawn ? (
                                  <div className="text-xs font-bold text-amber-600">฿0 (หักยอดตั๋ว)</div>
                              ) : l.isGiveaway ? (
                                  <div className="text-xs font-bold text-blue-600">ของแถม (฿0)</div>
                              ) : (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-gray-500">฿/ตัน</span>
                                    <input type="number" value={l.pricePerTon || ''} onChange={e => updateActiveLine(l.tempId, { pricePerTon: Number(e.target.value) })} className="w-20 text-right border border-gray-200 rounded px-1.5 py-1 text-xs font-mono font-bold focus:outline-none focus:border-blue-400" />
                                  </div>
                              )}
                            </div>
                          </div>
                          
                          {!l.isControlTicketDrawn && !l.isGiveaway && (
                            <div className="flex justify-between items-center mt-1 pt-1 border-t border-dashed border-gray-100">
                              <div className="text-[10px] text-orange-500 font-medium">
                                {l.pricePerTon > l.netPricePerTon ? `รีเบทสะสม: ฿${((l.pricePerTon - l.netPricePerTon) * l.qtyTon).toLocaleString('th-TH', { maximumFractionDigits: 0 })}` : ''}
                              </div>
                              <div className="text-xs font-bold text-[#0C447C]">
                                รวม: ฿{(l.pricePerTon * l.qtyTon).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="mt-3 pt-3 border-t">
                  {activeBill && activeBill.lines.length > 0 && (() => {
                    const totalAmt = activeBill.lines.reduce((s, l) => s + (l.isControlTicketDrawn ? 0 : l.qtyTon * l.pricePerTon), 0);
                    const totalRebate = activeBill.lines.reduce((s, l) => s + (!l.isControlTicketDrawn && l.pricePerTon > l.netPricePerTon ? (l.pricePerTon - l.netPricePerTon) * l.qtyTon : 0), 0);
                    return (
                      <div className="mb-2">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-gray-600">ยอดรวมบิลนี้</span>
                          <span className="text-sm font-bold text-[#0C447C]">฿{totalAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                        </div>
                        {totalRebate > 0 && (
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-orange-500 font-medium">รีเบทสะสมบิลนี้</span>
                            <span className="text-[10px] font-bold text-orange-500">฿{totalRebate.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-emerald-600">เบิก Rebate มาใช้ (฿)</span>
                            <span className="text-[10px] text-gray-400">คงเหลือ: ฿{availableRebate.toLocaleString()}</span>
                          </div>
                          <input 
                            type="number" 
                            max={Math.min(availableRebate, totalAmt)}
                            min={0}
                            placeholder="0"
                            disabled={availableRebate <= 0 || totalAmt <= 0}
                            value={activeBill?.rebateDiscountAmt || ''} 
                            onChange={e => {
                              const val = Math.min(Number(e.target.value) || 0, Math.min(availableRebate, totalAmt));
                              updateBillInfo(activeBillId, { rebateDiscountAmt: val });
                            }} 
                            className="w-24 text-right border border-emerald-300 rounded px-2 py-1 text-xs font-mono font-bold text-emerald-700 bg-emerald-50 focus:outline-none focus:border-emerald-500 disabled:opacity-50 disabled:bg-gray-100 disabled:border-gray-200" 
                          />
                        </div>
                        {(activeBill?.rebateDiscountAmt || 0) > 0 && (
                          <div className="flex justify-between items-center mt-2 bg-emerald-50 p-1.5 rounded">
                            <span className="text-xs font-bold text-emerald-800">ยอดสุทธิบิลนี้</span>
                            <span className="text-sm font-black text-emerald-800">฿{(totalAmt - (activeBill.rebateDiscountAmt || 0)).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <input type="text" placeholder="หมายเหตุบิลนี้..." value={activeBill?.remark} onChange={e => updateBillInfo(activeBillId, { remark: e.target.value })} className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 mt-1" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="border-t border-gray-200 bg-white p-2 sm:p-3 px-3 sm:px-4 flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-4 shrink-0">
          <div className="flex flex-wrap sm:flex-nowrap justify-between w-full sm:w-auto gap-3 sm:gap-6">
            <div className="flex-1 sm:flex-none">
              <div className="text-[10px] sm:text-xs text-gray-500 font-bold">น้ำหนักรวม</div>
              <div className="text-base sm:text-lg font-black text-[#0C447C]">{totalTons.toLocaleString()} <span className="text-[10px] sm:text-xs font-normal">ตัน</span></div>
            </div>
            <div className="flex-1 sm:flex-none text-center sm:text-left border-l sm:border-none border-gray-100 pl-4 sm:pl-0">
              <div className="text-[10px] sm:text-xs text-amber-600 font-bold">ยอดหัก (AI)</div>
              <div className="text-base sm:text-lg font-black text-amber-600">฿{totalOffset.toLocaleString()}</div>
            </div>
            <div className="flex-1 sm:flex-none text-right sm:text-left border-l sm:border-none border-gray-100 pl-4 sm:pl-0">
              <div className="text-[10px] sm:text-xs text-green-600 font-bold">ยอดสุทธิ</div>
              <div className="text-lg sm:text-xl font-black text-green-600">฿{totalPayable.toLocaleString()}</div>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-2 sm:gap-3">
            {error && <div className="text-red-500 text-[10px] sm:text-xs font-bold bg-red-50 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg border border-red-100">{error}</div>}
            <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg sm:rounded-xl transition-colors">ยกเลิก</button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-2 text-sm font-bold text-white bg-[#0C447C] hover:bg-[#0a3663] rounded-lg sm:rounded-xl flex items-center gap-2 shadow-lg disabled:opacity-50 transition-colors"
            >
              {submitting ? 'กำลังบันทึก...' : <><CheckCircle2 size={16}/> บันทึกการจัดรถ</>}
            </button>
          </div>
        </div>

      </div>

      <GiveawayBorrowModal
        isOpen={borrowModalOpen}
        onClose={() => setBorrowModalOpen(false)}
        brand={borrowReq.brand}
        itemName={borrowReq.itemName}
        requiredQty={borrowReq.requiredQty}
        region={(userRole === 'ADMIN' ? 'ภาคเหนือ' : 'ภาคเหนือ')} // Assuming hardcoded for now, or fetch user's region
        periodYear={new Date().getFullYear() + 543 - 2500 + 2500}
        onSuccess={() => {
          setBorrowModalOpen(false);
          // Refetch quota after borrowing
          const currentYear = new Date().getFullYear() + 543 - 2500 + 2500;
          apiFetch(`/giveaway/my-quota?year=${currentYear}`).then(setMyQuota).catch(console.error);
          alert('ส่งคำขอยืมเรียบร้อยแล้ว กรุณารอการอนุมัติ');
        }}
      />
    </>
  );
}
