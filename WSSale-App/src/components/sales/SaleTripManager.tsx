import React, { useMemo, useState } from 'react';
import { Package, Truck, Clock, Trash2, FileText, Gift, Settings, Activity, Download } from 'lucide-react';
import { SOStatusBadge } from './SOStatusBadge';
import { cancelSO, deleteSO } from '../../services/api';
import { appConfirm } from '../ui/AppAlert';
import { useExport } from '../../hooks/useExport';
import type { SalesOrder } from '../../types';

interface GroupedTrip {
  dateDisplay: string;
  cust: string;
  custCount: number;
  truck: string;
  orders: SalesOrder[];
  totalAmt: number;
  totalTon: number;
}

export function SaleTripManager({
  groupedOrders,
  loading,
  unlockRequests,
  customersMap,
  onViewTrip,
  onOpenQuote,
  onLoadData,
}: {
  groupedOrders: GroupedTrip[];
  loading: boolean;
  unlockRequests: any[];
  customersMap: Record<string, string>;
  onViewTrip: (trip: GroupedTrip) => void;
  onOpenQuote: (quoteId: number, quoteNo?: string) => void;
  onLoadData: () => void;
}) {
  const [capacityMap, setCapacityMap] = useState<Record<string, number>>({});
  const { exportData } = useExport();

  const handleSetCapacity = (truckPlate: string, currentTotal: number) => {
    const defaultCap = currentTotal > 16 ? 32 : 16;
    const input = prompt(`ระบุน้ำหนักบรรทุกสูงสุด (ตัน) สำหรับทะเบียน ${truckPlate}`, (capacityMap[truckPlate] || defaultCap).toString());
    if (input && !isNaN(Number(input))) {
      setCapacityMap(prev => ({ ...prev, [truckPlate]: Number(input) }));
    }
  };

  const handleExportTrips = () => {
    const rows = groupedOrders.map(g => ({
      date: g.dateDisplay,
      truck: g.truck,
      destinationCount: g.custCount,
      customers: g.cust,
      orderCount: g.orders.length,
      totalTon: g.totalTon,
      totalAmount: g.totalAmt,
    }));

    exportData('excel', 'Sale_Trips_Export', [
      { key: 'date', label: 'วันที่จัดส่ง' },
      { key: 'truck', label: 'ทะเบียนรถ' },
      { key: 'destinationCount', label: 'จำนวนจุดหมาย' },
      { key: 'customers', label: 'ชื่อลูกค้า / จุดหมาย' },
      { key: 'orderCount', label: 'จำนวนบิล' },
      { key: 'totalTon', label: 'น้ำหนักรวม (ตัน)' },
      { key: 'totalAmount', label: 'ยอดรวม (บาท)' },
    ], rows, 'SaleTrips');
  };

  return (
    <div className="space-y-3 p-2 sm:p-4">
      {groupedOrders.length > 0 && (
        <div className="flex justify-end px-1">
          <button
            onClick={handleExportTrips}
            className="px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-[#0C447C] flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Download size={14} /> Export Sale Trips (Excel)
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-max">
      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-40 bg-white rounded-xl animate-pulse border border-gray-100 shadow-sm" />
        ))
      ) : groupedOrders.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center col-span-full">
          <div className="bg-gray-100 p-4 rounded-full mb-3 text-gray-400">
            <Package size={40} />
          </div>
          <p className="font-bold text-gray-500 text-lg">ไม่พบข้อมูลทริป</p>
          <p className="text-sm text-gray-400">ลองปรับตัวกรองหรือสร้างบิลใหม่</p>
        </div>
      ) : groupedOrders.map((g, idx) => {
        const linkedQuoteOrder = g.orders.find(o => o.linkedQuoteId && ['DRAFT', 'SENT', 'EXPIRED'].includes(String(o.linkedQuoteStatus || '')));
        const isQuoteLocked = !!linkedQuoteOrder;
        
        // Capacity logic
        const maxCapacity = capacityMap[g.truck] || (g.totalTon > 16 ? 32 : 16);
        const capacityPercent = Math.min(100, Math.round((g.totalTon / maxCapacity) * 100));
        let progressColor = 'bg-[#0C447C]';
        if (capacityPercent > 100) progressColor = 'bg-red-500';
        else if (capacityPercent > 90) progressColor = 'bg-amber-500';
        else if (capacityPercent < 50) progressColor = 'bg-blue-400';

        return (
          <div key={idx} className="rounded-2xl border border-gray-200/80 shadow-sm bg-white flex flex-col overflow-hidden hover:shadow-md transition-shadow">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex flex-col gap-2 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <SOStatusBadge status={g.orders[0]?.status || 'DRAFT'} isUnlockRequested={unlockRequests.some(r => g.orders.some(o => r.SoId === o.id))} />
                  <div className="text-[11px] font-bold text-[#0C447C] flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100/50">
                    <Clock size={10} /> {g.dateDisplay}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm font-black text-[#0C447C]">
                    ฿{g.totalAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                  </div>
                  <button
                    disabled={isQuoteLocked}
                    onClick={async () => {
                      if (isQuoteLocked) return;
                      if (await appConfirm(`ยืนยันลบ Sale Trip นี้ (รวม ${g.orders.length} บิล)?`)) {
                        try {
                          for (const o of g.orders) {
                            if (['DRAFT', 'CANCELLED'].includes(o.status)) {
                              await deleteSO(o.id!);
                            } else {
                              await cancelSO(o.id!, 'ลบทั้งทริป');
                            }
                          }
                          onLoadData();
                        } catch (e: any) {
                          alert('เกิดข้อผิดพลาดในการลบทริป: ' + (e?.message || ''));
                        }
                      }
                    }}
                    className="text-gray-400 hover:text-red-500 transition-colors shrink-0 disabled:opacity-30 p-1 rounded-md hover:bg-red-50"
                    title={isQuoteLocked ? 'ต้องยกเลิกใบเสนอราคาก่อน' : 'ลบ Sale Trip นี้'}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Truck Info */}
              <div className="flex items-center gap-3 mt-1">
                <div className="bg-gradient-to-br from-[#1F2937] to-gray-800 text-white p-2 rounded-xl shrink-0 shadow-sm">
                  <Truck size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-gray-900 truncate flex items-center gap-2">
                    {g.truck}
                    {g.truck !== 'ตั๋วคุม' && (
                      <button onClick={() => handleSetCapacity(g.truck, g.totalTon)} className="text-gray-400 hover:text-[#0C447C]" title="ตั้งค่าน้ำหนักบรรทุกสูงสุด">
                        <Settings size={12} />
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-0.5" title={g.custCount > 1 ? g.orders.map(o => customersMap[o.custId] || o.custName || o.custId).join(' · ') : g.cust}>
                    {g.custCount > 1 ? <span className="font-semibold text-blue-700">{g.custCount} จุดหมาย</span> : g.cust}
                  </div>
                </div>
                <button 
                  onClick={() => onViewTrip(g)}
                  className="shrink-0 text-xs text-white font-semibold px-3 py-1.5 bg-[#0C447C] rounded-lg hover:bg-blue-800 transition-all shadow-sm active:scale-95"
                >
                  จัดการทริป
                </button>
              </div>

              {/* Capacity Bar */}
              {g.truck !== 'ตั๋วคุม' && (
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-[10px] font-bold">
                    <span className="text-gray-500 flex items-center gap-1"><Activity size={10} /> น้ำหนักรวม</span>
                    <span className={capacityPercent > 100 ? 'text-red-600' : 'text-gray-700'}>
                      {g.totalTon.toLocaleString('th-TH', { maximumFractionDigits: 2 })} / {maxCapacity} ตัน ({capacityPercent}%)
                    </span>
                  </div>
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden shadow-inner">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                      style={{ width: `${Math.min(100, capacityPercent)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Quote Lock Alert */}
            {isQuoteLocked && (
              <div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold flex items-center gap-1.5">
                    <FileText size={14} className="text-amber-600" /> รอเสนอราคา {linkedQuoteOrder?.linkedQuoteNo}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenQuote(Number(linkedQuoteOrder.linkedQuoteId), linkedQuoteOrder.linkedQuoteNo || undefined)}
                    className="shrink-0 rounded-lg bg-white px-2 py-1 font-bold text-[#0C447C] border border-amber-200 hover:bg-amber-100 shadow-sm transition-colors"
                  >
                    เปิดใบเสนอราคา
                  </button>
                </div>
              </div>
            )}

            {/* Orders List */}
            <div className="p-3 space-y-2 overflow-y-auto custom-scrollbar flex-1 min-h-[100px] max-h-[180px] bg-gray-50/30">
              {g.orders.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-gray-400 font-medium">ไม่มีบิลในทริปนี้</div>
              ) : g.orders.map(order => {
                const totalAmt = (order.lines || []).reduce((s, l) => s + (l.qtyTon * l.pricePerTon), 0);
                const isGiveawayOnly = (order.lines || []).every(l => l.isGiveaway);
                
                return (
                  <div
                    key={order.id}
                    className={`relative p-2.5 rounded-xl border transition-colors hover:border-blue-200 ${order.truckPlate === 'ตั๋วคุม' ? 'border-purple-200 bg-purple-50/30' : 'border-gray-200 bg-white'}`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono text-xs font-black ${order.truckPlate === 'ตั๋วคุม' ? 'text-purple-700' : 'text-gray-800'}`}>
                          {order.wfRef || (order as any).docuNo || (order as any).importedDocuNo || `#${order.id}`}
                        </span>
                        {order.truckPlate === 'ตั๋วคุม' && <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold">ตั๋วคุม</span>}
                      </div>
                      <span className={`text-xs font-bold ${order.truckPlate === 'ตั๋วคุม' ? 'text-purple-700' : 'text-[#0C447C]'}`}>
                        ฿{totalAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 font-medium">
                          <Package size={12} className="text-gray-400" /> {(order.lines || []).filter(l => !l.isGiveaway).length} รายการ
                        </span>
                        {(order.lines || []).some(l => l.isGiveaway) && (
                          <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded text-[10px] font-bold">
                            <Gift size={10} /> ของแถม
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
