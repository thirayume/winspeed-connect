import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Search, RefreshCw, ChevronRight, Filter, ChevronLeft, Package, Calendar, User, X, Clock, Truck, Gift, Trash2, FileText, Download } from 'lucide-react';
import { Button, Card, cn } from '../ui/Base';
import { useExport } from '../../hooks/useExport';
import { useErpStore } from '../../store/erp-store';
import { useAppStore } from '../../store/app-store';
import { fetchSalesOrders, fetchSalesOrder, cancelSO, deleteSO, fetchCustomers, confirmSO } from '../../services/api';
import { appConfirm } from '../ui/AppAlert';
import { useSocketEvent } from '../../hooks/useSocket';
import { SOStatusBadge } from './SOStatusBadge';
import { CreateSODialog } from './CreateSODialog';
import { SODetailsPanel } from './SODetailsPanel';
import { TripSetupModal } from './TripSetupModal';
import { TripSummaryModal } from './TripSummaryModal';
import { SaleTripManager } from './SaleTripManager';
import { useTripStore } from '../../store/trip-store';
import { formatThaiDate } from '../../utils/date';
import { CheckCircle } from 'lucide-react';
import type { SalesOrder, SOStatus } from '../../types';
import { SO_STATUS_META, SO_STATUS_ORDER } from '../../constants/soStatus';

export const SalesPortal = () => {
  const [orders, setOrders]         = useState<SalesOrder[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingSoId, setEditingSoId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [externalSelectedSo, setExternalSelectedSo] = useState<SalesOrder | null>(null);
  const [returnToTripFromSoId, setReturnToTripFromSoId] = useState<string | null>(null);
  const [returnToTripKey, setReturnToTripKey] = useState<string | null>(null);
  const [shouldOpenActiveTripSummary, setShouldOpenActiveTripSummary] = useState(false);
  
  const [customersMap, setCustomersMap] = useState<Record<string, string>>({});

  const navParams = useAppStore(s => s.navParams);
  const clearNavParams = useAppStore(s => s.clearNavParams);
  const navigate = useAppStore(s => s.navigate);

  const { activeTrip, setTrip, clearTrip } = useTripStore();
  const [isTripSetupOpen, setIsTripSetupOpen] = useState(false);

  const [page, setPage]               = useState(1);
  const [limit]                        = useState(20);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SOStatus | ''>('');
  
  const [viewingTrip, setViewingTrip] = useState<any>(null);

  const unlockRequests  = useErpStore(s => s.unlockRequests);
  const setUnlockRequests = useErpStore(s => s.setUnlockRequests);
  const { exportData } = useExport();

  const handleExportOrders = () => {
    const rows = orders.map(o => {
      const totalAmt = (o.lines || []).reduce((s, l) => s + (l.qtyTon * l.pricePerTon), 0);
      const totalTon = (o.lines || []).reduce((s, l) => s + (l.isGiveaway ? 0 : l.qtyTon), 0);
      return {
        wfRef: o.wfRef || (o as any).docuNo || `#${o.id}`,
        custName: customersMap[o.custId] || o.custName || o.custId,
        truckPlate: o.truckPlate || 'ไม่ระบุ',
        status: SO_STATUS_META[o.status as SOStatus]?.label || o.status,
        totalTon,
        totalAmt,
        deliveryDate: o.deliveryDate ? o.deliveryDate.split('T')[0] : '',
      };
    });

    exportData('excel', 'Sales_Orders_Export', [
      { key: 'wfRef', label: 'เลขที่ใบสั่งขาย' },
      { key: 'custName', label: 'ชื่อลูกค้า' },
      { key: 'truckPlate', label: 'ทะเบียนรถ' },
      { key: 'status', label: 'สถานะ' },
      { key: 'totalTon', label: 'น้ำหนัก (ตัน)' },
      { key: 'totalAmt', label: 'ยอดเงิน (บาท)' },
      { key: 'deliveryDate', label: 'กำหนดส่ง' },
    ], rows, 'SalesOrders');
  };

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(searchQuery); setPage(1); }, 500);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSalesOrders({
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        page,
        limit,
      });
      setOrders(res.data || []);
      setTotalOrders(res.total || 0);
    } catch (e) {
      console.error('fetchSalesOrders failed', e);
      setOrders([]);
    }
    setLoading(false);
  }, [page, limit, debouncedSearch, statusFilter, setUnlockRequests]);

  const handleConfirmTrip = async () => {
    if (!activeTrip) return;
    
    // Find all draft orders that match the active trip's criteria
    const tripOrders = orders.filter(so => {
      // ไม่กรองด้วยลูกค้า — เที่ยวเดียวกันรับได้หลายลูกค้า (ดูหมายเหตุที่ groupedOrders)
      const matchTruck = so.truckPlate === activeTrip.truckPlate || (so.truckPlate === 'ตั๋วคุม');
      const soDate = so.deliveryDate ? so.deliveryDate.split('T')[0] : '';
      const matchDate = soDate === activeTrip.deliveryDate;
      return so.status === 'DRAFT' && matchTruck && matchDate;
    });

    if (tripOrders.length === 0) {
      alert('ไม่พบบิลในทริปนี้ กรุณาเพิ่มบิลก่อนยืนยัน');
      return;
    }
    const lockedByQuote = tripOrders.find(so => so.linkedQuoteId && ['DRAFT', 'SENT', 'EXPIRED'].includes(String(so.linkedQuoteStatus || '')));
    if (lockedByQuote) {
      alert(`ทริปนี้ผูกกับใบเสนอราคา ${lockedByQuote.linkedQuoteNo || ''} ที่ยังรอการยืนยันอยู่`);
      return;
    }

    if (await appConfirm(`ต้องการยืนยันออร์เดอร์ทริปนี้ทั้ง ${tripOrders.length} บิลใช่หรือไม่?`)) {
      try {
        setLoading(true);
        // Using existing confirmSO endpoint for each bill
        await Promise.all(tripOrders.map(so => confirmSO(so.id as number)));
        alert('ยืนยันออร์เดอร์ทริปสำเร็จ');
        clearTrip();
        loadData();
      } catch (e: any) {
        alert(e.message || 'เกิดข้อผิดพลาดในการยืนยัน');
        setLoading(false);
      }
    }
  };

  useEffect(() => { loadData(); }, [loadData]);
  
  useEffect(() => {
    fetchCustomers().then(custs => {
      const map: Record<string, string> = {};
      custs.forEach(c => {
        if (c.CustID) map[c.CustID] = c.CustName;
      });
      setCustomersMap(map);
    }).catch(console.error);
  }, []);

  const [attemptedCustIds] = useState(() => new Set<string>());

  useEffect(() => {
    const missingIds = Array.from(new Set(
      orders.map(o => o.custId).filter(id => id && !customersMap[id] && !attemptedCustIds.has(id))
    ));
    if (missingIds.length > 0) {
      missingIds.forEach(id => {
        attemptedCustIds.add(id);
        fetchCustomers(id).then(res => {
          const match = res.find(c => String(c.CustID) === String(id));
          if (match) {
            setCustomersMap(prev => ({ ...prev, [id]: match.CustName }));
          }
        }).catch(console.error);
      });
    }
  }, [orders, customersMap, attemptedCustIds]);

  // Listen for real-time updates
  useSocketEvent('so_updated', () => {
    console.log('[Socket] so_updated event received. Refreshing SalesPortal...');
    loadData();
  });

  // Handle Jump to SO
  useEffect(() => {
    if (navParams?.soId) {
      if (navParams.action === 'edit') {
        setEditingSoId(navParams.soId ? String(navParams.soId) : null);
      } else {
        setSelectedId(navParams.soId ? Number(navParams.soId) : null);
        if (navParams.soId) {
          fetchSalesOrder(Number(navParams.soId)).then(so => {
            setExternalSelectedSo(so);
          }).catch(console.error);
        }
      }
      clearNavParams();
    }
  }, [navParams, clearNavParams]);

  useEffect(() => {
    if (!selectedId) setExternalSelectedSo(null);
  }, [selectedId]);

  const totalPages = Math.ceil(totalOrders / limit) || 1;
  const selectedSo = orders.find(o => o.id === selectedId) || externalSelectedSo;

  const groupedOrders = useMemo(() => {
    const map = new Map<string, { dateDisplay: string; cust: string; custCount: number; truck: string; orders: SalesOrder[]; totalAmt: number; totalTon: number }>();
    for (const o of orders) {
      const dateRaw = o.deliveryDate ? o.deliveryDate.split('T')[0] : '9999-12-31';
      const dateDisplay = o.deliveryDate ? formatThaiDate(o.deliveryDate) : 'ไม่ระบุวันรับ';
      const truck = o.truckPlate || 'ไม่ระบุทะเบียนรถ';
      // เที่ยวรถ = วันที่ + ทะเบียน + สถานะ  — **ไม่รวมลูกค้า**
      //
      // รถหนึ่งคันวิ่งเที่ยวเดียวส่งลูกค้าหลายรายที่อยู่เส้นทางเดียวกันได้
      // และนั่นคือเรื่องปกติ ไม่ใช่ข้อยกเว้น — วัดจากใบสั่งขายจริงตั้งแต่ ม.ค. 2568:
      //   เที่ยวรถทั้งหมด           9,849
      //   เที่ยวที่มีมากกว่าหนึ่งใบ  1,297
      //   ในนั้นส่งหลายลูกค้า       1,203  (93%)
      //
      // เดิม key มี custId อยู่ด้วย ทำให้เที่ยวจริงหนึ่งเที่ยวถูกแตกเป็นหลายกลุ่มตามลูกค้า
      // คนจัดลำดับขึ้นของจึงมองไม่เห็นว่ารถคันนี้ต้องบรรทุกอะไรบ้างในเที่ยวเดียวกัน
      // ซึ่งเป็นเหตุผลทั้งหมดที่ฟีเจอร์นี้มีอยู่ (WINSpeed ทำ Sale Trip ไม่ได้)
      const key = `${dateRaw}::${truck}::${o.status}`;

      if (!map.has(key)) map.set(key, { dateDisplay, cust: '', custCount: 0, truck, orders: [], totalAmt: 0, totalTon: 0 });
      const g = map.get(key)!;
      g.orders.push(o);
      g.totalAmt += (o.lines || []).reduce((s, l) => s + (l.qtyTon * l.pricePerTon), 0);
      g.totalTon += (o.lines || []).reduce((s, l) => s + (l.isGiveaway ? 0 : l.qtyTon), 0);
    }
    // สรุปชื่อลูกค้าหลังจัดกลุ่มเสร็จ — เที่ยวหลายลูกค้าต้องบอกจำนวน ไม่ใช่โชว์รายแรกรายเดียว
    for (const g of map.values()) {
      const ids = Array.from(new Set(g.orders.map(o => String(o.custId || 'ไม่ระบุลูกค้า'))));
      g.custCount = ids.length;
      g.cust = ids.length === 1
        ? (customersMap[ids[0]] || g.orders[0]?.custName || ids[0])
        : `${ids.length} ลูกค้า`;
    }
    return Array.from(map.values());
  }, [orders, customersMap]);

  const activeTripGroup = useMemo(() => {
    if (!activeTrip) return null;
    const tripOrders = orders.filter(so => {
      const matchCust = String(so.custId) === String(activeTrip.custId);
      const matchTruck = so.truckPlate === activeTrip.truckPlate || (so.truckPlate === 'ตั๋วคุม');
      const soDate = so.deliveryDate ? so.deliveryDate.split('T')[0] : '';
      const matchDate = soDate === activeTrip.deliveryDate;
      return so.status === 'DRAFT' && matchCust && matchTruck && matchDate;
    });
    
    if (tripOrders.length === 0) return null;
    
    const totalAmt = tripOrders.reduce((s, l) => s + (l.lines || []).reduce((ss, ll) => ss + (ll.qtyTon * ll.pricePerTon), 0), 0);
    const totalTon = tripOrders.reduce((s, l) => s + (l.lines || []).reduce((ss, ll) => ss + (ll.isGiveaway ? 0 : ll.qtyTon), 0), 0);
    
    return {
      dateDisplay: activeTrip.deliveryDate ? formatThaiDate(activeTrip.deliveryDate) : 'ไม่ระบุวันรับ',
      cust: (() => {
        const ids = Array.from(new Set(tripOrders.map(o => String(o.custId || ''))));
        return ids.length === 1 ? (activeTrip.custName || ids[0]) : `${ids.length} ลูกค้า`;
      })(),
      custCount: new Set(tripOrders.map(o => String(o.custId || ''))).size,
      truck: activeTrip.truckPlate || 'ตั๋วคุม',
      orders: tripOrders,
      totalAmt,
      totalTon
    };
  }, [activeTrip, orders]);

  const displayGroupedOrders = useMemo(() => {
    if (!activeTripGroup) return groupedOrders;
    const activeIds = new Set(activeTripGroup.orders.map(o => o.id));
    return groupedOrders.map(g => ({
      ...g,
      orders: g.orders.filter(o => !activeIds.has(o.id))
    })).filter(g => g.orders.length > 0);
  }, [groupedOrders, activeTripGroup]);

  useEffect(() => {
    if (shouldOpenActiveTripSummary && !loading && activeTripGroup) {
      setViewingTrip(activeTripGroup);
      setShouldOpenActiveTripSummary(false);
    }
  }, [shouldOpenActiveTripSummary, loading, activeTripGroup]);

  // Auto-restore viewingTrip if returning from edit or create
  useEffect(() => {
    if (!isCreating && !editingSoId && !loading && orders.length > 0) {
      if (returnToTripFromSoId) {
        const group = groupedOrders.find(g => g.orders.some(o => String(o.id) === returnToTripFromSoId));
        if (group) setViewingTrip(group);
        setReturnToTripFromSoId(null);
      } else if (returnToTripKey) {
        const group = groupedOrders.find(g => {
          const dateRaw = g.orders[0]?.deliveryDate ? g.orders[0].deliveryDate.split('T')[0] : '9999-12-31';
          const key = `${dateRaw}::${g.truck}::${g.orders[0]?.status}`;
          return key === returnToTripKey;
        });
        if (group) setViewingTrip(group);
        setReturnToTripKey(null);
      }
    }
  }, [groupedOrders, returnToTripFromSoId, returnToTripKey, isCreating, editingSoId, orders.length, loading]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={{ background: '#F1EFE8' }}>
      {/* Header - hide on mobile when creating or viewing details to save space */}
      <div className={cn(
        "px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex-wrap items-center justify-between gap-4",
        (isCreating || selectedId) ? "hidden md:flex" : "flex"
      )}>
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Package className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
            Sales Portal
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">สั่งขายปุ๋ย · World Fert Co., Ltd.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadData} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
          {!isCreating && !editingSoId && (
            <button
              onClick={() => setIsTripSetupOpen(true)}
              className="h-10 px-5 flex items-center gap-2 rounded-xl text-white text-sm font-semibold hover:bg-blue-800 transition-colors shadow-sm"
              style={{ background: '#0C447C' }}
            >
              <Plus size={18} /> สร้างบิล
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {isCreating || editingSoId ? (
          <CreateSODialog 
             isOpen={isCreating || !!editingSoId} 
             editSoId={editingSoId || undefined}
             onClose={() => { setIsCreating(false); setEditingSoId(null); }} 
             onCreated={() => { loadData(); setIsCreating(false); setEditingSoId(null); setShouldOpenActiveTripSummary(true); }} 
          />
        ) : (
          <>
            {/* List pane */}
            <div className={cn('flex flex-col overflow-hidden border-r border-gray-200 bg-white/50', 'flex-1')}>
              
              {/* Active Trip Banner */}
              {activeTrip && (
                <div className="bg-blue-50 border-b border-blue-100 p-4 shrink-0 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#0C447C] font-bold">
                      <Truck size={18} />
                      กำลังจัดทริปส่งสินค้า {activeTripGroup ? `(${activeTripGroup.orders.length} บิล)` : ''}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setIsTripSetupOpen(true)} className="text-xs text-blue-600 font-bold hover:underline">แก้ไขทริป</button>
                      {activeTripGroup && <button onClick={() => setViewingTrip(activeTripGroup)} className="text-xs text-blue-600 font-bold hover:underline">ดูสรุปทริป</button>}
                      <button onClick={clearTrip} className="text-xs text-gray-500 font-bold hover:text-red-500 transition-colors">ยกเลิก</button>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3 text-sm shadow-sm border border-blue-100/50 flex flex-col gap-1.5">
                    <div className="flex justify-between">
                      <span className="text-gray-500">ลูกค้า:</span>
                      <span className="font-bold text-gray-900">{activeTrip.custName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">ทะเบียนรถ:</span>
                      <span className="font-mono font-bold text-gray-900">{activeTrip.truckPlate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">กำหนดส่ง:</span>
                      <span className="font-bold text-gray-900">
                        {activeTrip.deliveryDate ? formatThaiDate(activeTrip.deliveryDate) : 'ไม่ระบุ'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setIsCreating(true)} 
                      className="flex-1 bg-[#0C447C] text-white py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 hover:bg-blue-800 shadow-sm"
                    >
                      <Plus size={16} /> เพิ่มบิลในทริปนี้
                    </button>
                    <button 
                      onClick={handleConfirmTrip}
                      className="flex-1 bg-green-600 text-white py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 hover:bg-green-700 shadow-sm"
                    >
                      <CheckCircle size={16} /> ยืนยันออร์เดอร์
                    </button>
                  </div>
                </div>
              )}
          {/* Search */}
          <div className="p-4 space-y-3 bg-white border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="ค้นหา ลูกค้า / WfRef..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-8 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': '#0C447C' } as React.CSSProperties}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex gap-2 items-center justify-between">
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => setShowFilters(f => !f)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                    statusFilter ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 bg-white hover:bg-gray-50'
                  )}
                  style={statusFilter ? { background: '#0C447C' } : {}}
                >
                  <Filter size={12} /> ตัวกรอง
                </button>
                {statusFilter && (
                  <button onClick={() => setStatusFilter('')}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    {statusFilter ? SO_STATUS_META[statusFilter]?.label : ''} x
                  </button>
                )}
              </div>
              <button
                onClick={handleExportOrders}
                disabled={orders.length === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-[#0C447C] shadow-sm disabled:opacity-50"
              >
                <Download size={13} /> Export SO (Excel)
              </button>
            </div>
            {showFilters && (
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">สถานะ</label>
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value as SOStatus | ''); setPage(1); }}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2 px-3 text-sm"
                >
                  <option value="">ทุกสถานะ</option>
                  {SO_STATUS_ORDER.map(s =>
                    <option key={s} value={s}>{SO_STATUS_META[s].label}</option>
                  )}
                </select>
              </div>
            )}
          </div>

            <div className="flex-1 overflow-hidden flex flex-col bg-gray-50/50">
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <SaleTripManager
                  groupedOrders={displayGroupedOrders}
                  loading={loading}
                  unlockRequests={unlockRequests}
                  customersMap={customersMap}
                  onViewTrip={setViewingTrip}
                  onOpenQuote={(quoteId, quoteNo) => navigate('quotation', { quoteId, quoteNo })}
                  onLoadData={loadData}
                />
              </div>
            </div>

          {/* Pagination */}
          <div className="p-3 border-t border-gray-100 bg-white flex items-center justify-between">
            <span className="text-xs text-gray-400">หน้า {page} / {totalPages} ({totalOrders} รายการ)</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

          </>
        )}
      </div>

      <TripSummaryModal
        isOpen={!!viewingTrip}
        onClose={() => setViewingTrip(null)}
        trip={viewingTrip}
        onUpdate={() => {
          if (viewingTrip?.orders?.[0]?.id) {
            setReturnToTripFromSoId(String(viewingTrip.orders[0].id));
          }
          loadData();
          setViewingTrip(null); 
        }}
        onEditBill={(soId) => {
          setReturnToTripFromSoId(String(soId));
          setEditingSoId(String(soId));
          setViewingTrip(null);
        }}
        onAddBill={() => {
          if (viewingTrip) {
            setTrip({
              custId: viewingTrip.orders[0]?.custId || '',
              custName: viewingTrip.orders[0]?.custName || '',
              truckPlate: viewingTrip.truck,
              deliveryDate: viewingTrip.orders[0]?.deliveryDate?.split('T')[0] || ''
            });
            const dateRaw = viewingTrip.orders[0]?.deliveryDate ? viewingTrip.orders[0].deliveryDate.split('T')[0] : '9999-12-31';
            setReturnToTripKey(`${dateRaw}::${viewingTrip.truck}::${viewingTrip.orders[0]?.status}`);
            setViewingTrip(null);
            setIsCreating(true);
          }
        }}
      />

      <TripSetupModal
        isOpen={isTripSetupOpen}
        onClose={() => setIsTripSetupOpen(false)}
        initialData={activeTrip || undefined}
        onConfirm={(data) => {
          setTrip(data);
          setIsTripSetupOpen(false);
          setIsCreating(true);
        }}
      />
    </div>
  );
};
