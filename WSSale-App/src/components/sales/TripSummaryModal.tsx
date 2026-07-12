import { useState } from 'react';
import { X, Truck, Package, Clock, FileText, CheckCircle2, ShieldAlert, Printer, Edit, AlertTriangle, Plus, ChevronDown } from 'lucide-react';
import type { SalesOrder } from '../../types';
import { useErpStore } from '../../store/erp-store';
import { useAppStore } from '../../store/app-store';
import { confirmSO, cancelSO, shipSO, moveToPicking, createUnlockRequest, fetchSalesOrder, updateSO, createQuotationFromSoTrip } from '../../services/api';
import { appConfirm } from '../ui/AppAlert';
import { RequestActionModal, type RequestActionType } from '../papertrail/RequestActionModal';
import { TripSetupModal } from './TripSetupModal';
import { PaperDocModal } from '../papertrail/PaperDocModal';
import { SO_STATUS_META, soStatusLabel } from '../../constants/soStatus';

export function TripSummaryModal({
  isOpen,
  onClose,
  trip,
  onUpdate,
  onEditBill,
  onAddBill
}: {
  isOpen: boolean;
  onClose: () => void;
  trip: { dateDisplay: string; cust: string; truck: string; orders: SalesOrder[]; totalAmt: number; totalTon: number } | null;
  onUpdate?: () => void;
  onEditBill?: (soId: string | number) => void;
  onAddBill?: () => void;
}) {
  const unlockRequests = useErpStore(s => s.unlockRequests);
  const navigate = useAppStore(s => s.navigate);
  const [busy, setBusy] = useState(false);
  const [requestModalConfig, setRequestModalConfig] = useState<{ isOpen: boolean, type: RequestActionType }>({ isOpen: false, type: 'EDIT' });
  const [quoteDays, setQuoteDays] = useState<7 | 15 | 20 | 30 | 45>(15);
  
  const [isEditTripOpen, setIsEditTripOpen] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  if (!isOpen || !trip) return null;

  // Consolidate items across all bills in this trip
  const consolidatedItems = new Map<string, { goodName: string; goodCode: string; qtyTon: number; qtyBag: number; isGiveaway: boolean }>();
  
  for (const order of trip.orders) {
    for (const line of (order.lines || [])) {
      const key = `${line.goodId}-${line.isGiveaway ? 'FREE' : 'NORMAL'}`;
      if (!consolidatedItems.has(key)) {
        consolidatedItems.set(key, { 
          goodName: line.goodName || '', 
          goodCode: line.goodCode || '', 
          qtyTon: 0, 
          qtyBag: 0,
          isGiveaway: !!line.isGiveaway
        });
      }
      const existing = consolidatedItems.get(key)!;
      existing.qtyTon += line.qtyTon;
      existing.qtyBag += (line.qtyBag || Math.round(line.qtyTon * 20));
    }
  }

  const sortedItems = Array.from(consolidatedItems.values()).sort((a, b) => {
    if (a.isGiveaway !== b.isGiveaway) return a.isGiveaway ? 1 : -1;
    return b.qtyTon - a.qtyTon;
  });
  const linkedQuoteOrder = trip.orders.find(o => o.linkedQuoteId && ['DRAFT', 'SENT', 'EXPIRED'].includes(String(o.linkedQuoteStatus || '')));
  const isQuoteLocked = !!linkedQuoteOrder;
  const openLinkedQuotation = () => {
    if (!linkedQuoteOrder?.linkedQuoteId) return;
    navigate('quotation', {
      quoteId: Number(linkedQuoteOrder.linkedQuoteId),
      quoteNo: linkedQuoteOrder.linkedQuoteNo || undefined,
    });
    onClose();
  };

  async function doAction(fn: () => Promise<unknown>) {
    setBusy(true);
    try { 
      await fn(); 
      if (onUpdate) onUpdate(); 
    }
    catch (e: unknown) { alert((e as Error).message || 'เกิดข้อผิดพลาด'); }
    finally { setBusy(false); }
  }

  const handleBulkAction = async (actionFn: (id: string | number) => Promise<any>, confirmMsg: string) => {
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await Promise.all(trip.orders.filter(o => o.id && String(o.id) !== 'undefined').map(so => actionFn(so.id!)));
      if (onUpdate) onUpdate();
    } catch (e: any) {
      alert('ทำรายการล้มเหลว: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateQuotation = async () => {
    const soIds = trip.orders.map(o => o.id).filter((id): id is string | number => !!id && String(id) !== 'undefined');
    if (!soIds.length) return alert('ไม่พบ SO สำหรับสร้างใบเสนอราคา');
    if (isQuoteLocked) return alert(`ทริปนี้ผูกกับใบเสนอราคา ${linkedQuoteOrder?.linkedQuoteNo || ''} ที่ยังรอการยืนยันอยู่`);
    if (!allDraft) return alert('สร้างใบเสนอราคาได้เฉพาะบิลร่างทั้งหมดในทริปเท่านั้น');
    const ok = await appConfirm(`สร้างใบเสนอราคาจากทริปนี้ ${soIds.length} บิล?\nระบบจะรวมสินค้าเป็นใบเดียว และไม่รวมรายการของแถม`);
    if (!ok) return;
    await doAction(async () => {
      const sourceRefs = trip.orders
        .map(o => o.wfRef || (o as any).importedDocuNo || String(o.id || ''))
        .filter(ref => ref && ref !== 'undefined');
      const result = await createQuotationFromSoTrip({ soIds, sourceRefs, validDays: quoteDays });
      alert(`สร้างใบเสนอราคา ${result.quoteNo} สำเร็จ\nSO ในทริปจะยังเป็นร่างจนกว่าใบเสนอราคาจะถูกยืนยัน`);
    });
  };

  const handleEditTripMetadata = async (data: { custId: string; custName: string; truckPlate: string; deliveryDate: string }) => {
    setBusy(true);
    try {
      // For each order in the trip, update its metadata
      for (const o of trip.orders) {
        if (!o.id || String(o.id) === 'undefined') continue;
        const fullSo = await fetchSalesOrder(o.id);
        await updateSO(o.id, {
          ...fullSo,
          custId: data.custId,
          custName: data.custName,
          truckPlate: data.truckPlate,
          deliveryDate: data.deliveryDate
        });
      }
      setIsEditTripOpen(false);
      if (onUpdate) onUpdate();
    } catch (e: any) {
      alert('แก้ไขข้อมูลล้มเหลว: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const allDraft = trip.orders.every(o => o.status === 'DRAFT');
  const allConfirmed = trip.orders.every(o => o.status === 'CONFIRMED');
  const allPicking = trip.orders.every(o => o.status === 'PICKING');
  const hasAnyUnlockRequest = trip.orders.some(o => unlockRequests.some(r => r.SoId === o.id));
  
  // Checking if there are any non-draft bills that are NOT shipped/imported
  const hasActionableBills = trip.orders.some(o => ['CONFIRMED', 'PICKING'].includes(o.status));

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4 animate-in fade-in duration-200" onClick={onClose}>
        <div className="bg-[#F1EFE8] w-full h-[90vh] sm:w-[96vw] sm:h-[96vh] sm:rounded-2xl flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95" onClick={e => e.stopPropagation()}>
          
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-blue-800 bg-[#0C447C] text-white shrink-0">
            <div>
              <h2 className="text-base sm:text-xl font-bold flex items-center gap-2"><Truck size={20} className="sm:w-6 sm:h-6" /> รายการโหลดสินค้าสำหรับรถคันนี้</h2>
              <p className="text-xs sm:text-sm text-blue-200 mt-0.5 sm:mt-1">รวมบิลทั้งหมด {trip.orders.length} ใบ (รวม {trip.totalTon.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ตัน)</p>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white rounded-full p-2 hover:bg-white/10 transition-colors">
              <X size={20} className="sm:w-6 sm:h-6" />
            </button>
          </div>

          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Left Sidebar - Trip Actions */}
            <div className="w-full md:w-80 lg:w-96 bg-white shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-gray-200 overflow-y-auto">
              <div className="p-3 sm:p-6 flex flex-col gap-3 sm:gap-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="bg-gray-100 p-2.5 rounded-xl text-gray-700">
                      <Truck size={20} />
                    </div>
                    <div>
                      <div className="font-bold text-lg text-gray-900">{trip.truck}</div>
                      <div className="text-sm text-gray-500">{trip.orders[0]?.custName || trip.cust}</div>
                    </div>
                  </div>
                  {/* Edit Trip Metadata */}
                  <button
                    disabled={busy || isQuoteLocked}
                    onClick={() => setIsEditTripOpen(true)}
                    title={isQuoteLocked ? 'ต้องยืนยันหรือยกเลิกใบเสนอราคาก่อน' : undefined}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:hover:bg-white"
                  >
                    <Edit size={12} /> แก้ไขข้อมูล
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <div className="text-sm font-bold text-[#0C447C] flex items-center gap-1.5 bg-[#F0F4F8] px-3 py-1.5 rounded-lg border border-blue-100">
                    <Clock size={14} /> {trip.dateDisplay}
                  </div>
                  <div className="text-sm font-bold text-gray-700 bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">
                    มูลค่ารวม ฿{trip.totalAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                  </div>
                </div>

                {isQuoteLocked && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold flex items-center gap-2">
                        <FileText size={16} /> รอใบเสนอราคา {linkedQuoteOrder?.linkedQuoteNo} ยืนยัน
                      </div>
                      <button
                        type="button"
                        onClick={openLinkedQuotation}
                        className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#0C447C] border border-amber-200 hover:bg-amber-100"
                      >
                        เปิดใบเสนอราคา
                      </button>
                    </div>
                    {linkedQuoteOrder?.linkedQuoteRemark && (
                      <div className="mt-2 text-xs text-amber-700 line-clamp-3">{linkedQuoteOrder.linkedQuoteRemark}</div>
                    )}
                    <div className="mt-2 text-xs text-amber-700">ทริปนี้จะอยู่เป็นฉบับร่างจนกว่าใบเสนอราคาจะถูกยืนยัน หรือถูกยกเลิก</div>
                  </div>
                )}

                {/* Bulk Actions for the Trip */}
                <div className="mt-3 pt-3 sm:mt-4 sm:pt-4 border-t border-gray-200 space-y-2 sm:space-y-3">
                  {!hasAnyUnlockRequest && (
                    <div className="flex flex-col gap-2 sm:gap-3">
                      {allDraft && !isQuoteLocked && (
                        <button
                          disabled={busy}
                          onClick={() => handleBulkAction(confirmSO, `ยืนยันออร์เดอร์ทั้งหมด ${trip.orders.length} บิลในทริปนี้ใช่หรือไม่?`)}
                          className="w-full bg-green-600 text-white py-2.5 sm:py-3 rounded-xl font-bold text-sm sm:text-base flex items-center justify-center gap-2 hover:bg-green-700 shadow-sm disabled:opacity-50 transition-colors"
                        >
                          <CheckCircle2 size={18} /> ยืนยันออร์เดอร์ทั้งทริป
                        </button>
                      )}
                      {allDraft && !isQuoteLocked && (
                        <div className="rounded-xl border border-blue-100 bg-blue-50 p-2.5 space-y-2">
                          <div className="flex items-center gap-2">
                            <FileText size={15} className="text-[#0C447C]" />
                            <select
                              value={quoteDays}
                              onChange={e => setQuoteDays(Number(e.target.value) as 7 | 15 | 20 | 30 | 45)}
                              className="flex-1 rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs font-bold text-[#0C447C] outline-none"
                              disabled={busy}
                            >
                              {[7, 15, 20, 30, 45].map(days => (
                                <option key={days} value={days}>ยืนราคา +{days} วัน</option>
                              ))}
                            </select>
                          </div>
                          <button
                            disabled={busy}
                            onClick={handleCreateQuotation}
                            className="w-full bg-white text-[#0C447C] border border-blue-200 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                          >
                            <FileText size={16} /> สร้างใบเสนอราคาจากทริป
                          </button>
                        </div>
                      )}
                      {allConfirmed && (
                        <button
                          disabled={busy}
                          onClick={() => handleBulkAction(moveToPicking, `เริ่มรับสินค้า (Picking) ทั้งทริปใช่หรือไม่?`)}
                          className="w-full py-2.5 sm:py-3 rounded-xl text-white text-sm sm:text-base font-bold shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                          style={{ background: '#F59E0B' }}
                        >
                          <Package size={18} /> เริ่มรับสินค้า (Picking) ทั้งทริป
                        </button>
                      )}
                      {allPicking && (
                        <button
                          disabled={busy}
                          onClick={() => handleBulkAction(shipSO, `ยืนยันส่งออกสินค้าทั้งทริปใช่หรือไม่?`)}
                          className="w-full py-2.5 sm:py-3 rounded-xl text-white text-sm sm:text-base font-bold shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                          style={{ background: '#059669' }}
                        >
                          <Truck size={18} /> ส่งออก + สร้างไฟล์ WINSpeed
                        </button>
                      )}
                    </div>
                  )}
                  
                  {/* Trip-Level Request Actions (For non-draft) */}
                  {!hasAnyUnlockRequest && hasActionableBills && (
                    <div className="flex gap-2 mt-1">
                      <button
                        disabled={busy}
                        onClick={() => setRequestModalConfig({ isOpen: true, type: 'EDIT' })}
                        className="flex-1 py-2 sm:py-2.5 rounded-xl border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 text-xs sm:text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <AlertTriangle size={14} /> ขอแก้ไขทั้งทริป
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setRequestModalConfig({ isOpen: true, type: 'CANCEL' })}
                        className="flex-1 py-2 sm:py-2.5 rounded-xl border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 text-xs sm:text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <AlertTriangle size={14} /> ขอยกเลิกทั้งทริป
                      </button>
                    </div>
                  )}

                  <button
                    disabled={busy}
                    onClick={() => setIsPrinting(true)}
                    className="w-full py-2.5 rounded-xl border border-gray-300 bg-white text-[#0C447C] hover:bg-blue-50 text-sm sm:text-base font-bold shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors mt-1"
                  >
                    <Printer size={16} /> พิมพ์เอกสารทั้งหมด ({trip.orders.length} ใบ)
                  </button>
                  
                  {onAddBill && !isQuoteLocked && (
                    <button
                      disabled={busy}
                      onClick={onAddBill}
                      className="w-full py-2.5 sm:py-3 rounded-xl border-2 border-dashed border-[#0C447C] bg-white text-[#0C447C] hover:bg-[#0C447C] hover:text-white text-sm sm:text-base font-bold shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors mt-2"
                    >
                      <Plus size={16} /> เพิ่มบิลใหม่ในทริปนี้
                    </button>
                  )}
                </div>
              </div>
          </div>

          {/* Right Content Pane */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#F1EFE8] space-y-6">
            
            {/* Consolidated Summary */}
            <section className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2 text-base sm:text-lg">
                <Package size={20} className="text-[#0C447C]" /> สรุปสินค้าที่ต้องโหลดขึ้นรถ
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {sortedItems.map((item, i) => (
                  <div key={i} className={`p-2.5 sm:p-3 rounded-xl border flex items-center justify-between ${item.isGiveaway ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50 hover:bg-white transition-colors'}`}>
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-sm text-gray-900 truncate" title={item.goodName}>{item.goodName}</div>
                      {item.isGiveaway ? (
                        <div className="text-[10px] text-amber-700 font-bold bg-amber-100 inline-block px-1.5 py-0.5 rounded mt-0.5">ของแถม</div>
                      ) : (
                        <div className="text-[10px] text-gray-500">{item.goodCode}</div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-[#0C447C] text-lg sm:text-xl leading-none">{item.qtyTon.toLocaleString('th-TH', { maximumFractionDigits: 2 })}<span className="text-[11px] sm:text-xs text-gray-500 font-normal ml-1">{item.isGiveaway ? 'ชิ้น' : 'ตัน'}</span></div>
                      {!item.isGiveaway && item.qtyBag > 0 && <div className="text-[10px] text-gray-500 mt-0.5 font-medium">{item.qtyBag.toLocaleString()} กระสอบ</div>}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="h-px bg-gray-200 w-full" />

            {/* Individual Bills */}
            <section>
              <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                <FileText size={18} className="text-gray-500" /> รายการเอกสาร ({trip.orders.length} ใบ)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {trip.orders.map(order => {
                  const pendingReq = unlockRequests.find(r => r.SoId === order.id);
                  const isShippedOrImported = ['SHIPPED', 'IMPORTED', 'CANCELLED'].includes(order.status);
                  
                  const totalTon = (order.lines || []).filter(l => !l.isGiveaway).reduce((sum, l) => sum + (l.qtyTon || 0), 0);
                  const totalGiveaways = (order.lines || []).filter(l => l.isGiveaway).reduce((sum, l) => sum + (l.qtyTon || 0), 0);
                  const totalAmt = (order.lines || []).reduce((sum, l) => sum + ((l.qtyTon * l.netPricePerTon) || 0), 0);
                  const hasTicket = (order.lines || []).some(l => l.isControlTicketDrawn);
                  
                  return (
                    <div key={order.id} className="border border-gray-200 rounded-xl bg-white shadow-sm flex flex-col">
                      <div className="p-3 sm:p-4 relative flex flex-col flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <div className="font-bold text-sm font-mono text-[#0C447C] flex items-center gap-1.5">
                            <FileText size={16} />
                            {order.wfRef || (order as any).docuNo || (order as any).importedDocuNo || `#${order.id}`}
                            {pendingReq && <ShieldAlert size={14} className="text-red-500" />}
                          </div>
                          <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${SO_STATUS_META[order.status]?.badgeClass || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                            {soStatusLabel(order.status)}
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2 bg-gray-50/80 p-2 rounded-lg border border-gray-100">
                          <div className="flex items-baseline gap-1">
                            <span className="text-[10px] text-gray-500">สินค้า:</span>
                            <span className="text-xs font-bold text-gray-900">{totalTon.toLocaleString('th-TH', { maximumFractionDigits: 2 })}<span className="text-[9px] font-normal text-gray-500 ml-0.5">ตัน</span></span>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-[10px] text-gray-500">แถม:</span>
                            <span className="text-xs font-bold text-amber-600">{totalGiveaways.toLocaleString('th-TH')}<span className="text-[9px] font-normal text-amber-600/70 ml-0.5">ชิ้น</span></span>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-[10px] text-gray-500">มูลค่า:</span>
                            <span className="text-xs font-bold text-blue-700">฿{totalAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                          </div>
                          {hasTicket && (
                            <div className="flex items-baseline gap-1 ml-auto">
                              <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">มีเบิก AI</span>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        {order.status === 'DRAFT' && !isQuoteLocked && (
                          <div className="flex gap-2 mt-auto pt-2 border-t border-gray-100">
                            <button
                              disabled={busy}
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (await appConfirm('ยืนยันยกเลิกบิลร่าง?')) doAction(() => cancelSO(order.id!, 'ยกเลิกเอกสารร่าง'));
                              }}
                              className="flex-1 py-1.5 rounded border border-red-200 text-red-600 text-[11px] font-medium hover:bg-red-50 disabled:opacity-50"
                            >
                              ยกเลิกบิล
                            </button>
                            {onEditBill && (
                              <button
                                disabled={busy}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onEditBill(order.id!);
                                }}
                                className="flex-1 py-1.5 rounded border border-[#0C447C] text-[#0C447C] bg-blue-50 text-[11px] font-bold hover:bg-blue-100 disabled:opacity-50"
                              >
                                แก้ไขบิล
                              </button>
                            )}
                          </div>
                        )}
                        {!isShippedOrImported && pendingReq && (
                           <div className="mt-2 pt-2 border-t border-gray-100 text-center">
                              <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded border border-red-100">
                                กำลังรออนุมัติปลดล็อก...
                              </span>
                           </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            
          </div>
          </div>
        </div>
      </div>

      <RequestActionModal
        isOpen={requestModalConfig.isOpen}
        actionType={requestModalConfig.type}
        wfRef={trip.orders.map(o => o.wfRef).join(', ')}
        onClose={() => setRequestModalConfig({ isOpen: false, type: 'EDIT' })}
        onSubmit={(reason, type) => {
          doAction(async () => {
            // Apply request to ALL actionable bills in the trip
            const actionableOrders = trip.orders.filter(o => ['CONFIRMED', 'PICKING'].includes(o.status));
            await Promise.all(actionableOrders.map(o => createUnlockRequest(o.id!, reason, type)));
            alert(`ส่งคำขอ${type === 'EDIT' ? 'แก้ไข' : 'ยกเลิก'}ทั้งทริปแล้ว รออนุมัติจากหัวหน้างาน`);
            setRequestModalConfig({ isOpen: false, type: 'EDIT' });
          });
        }}
      />

      <TripSetupModal
        isOpen={isEditTripOpen}
        onClose={() => setIsEditTripOpen(false)}
        initialData={{
          custId: trip.orders[0]?.custId || '',
          custName: trip.orders[0]?.custName || '',
          truckPlate: trip.truck,
          deliveryDate: trip.orders[0]?.deliveryDate?.split('T')[0] || ''
        }}
        onConfirm={handleEditTripMetadata}
      />

      {isPrinting && (
        <PaperDocModal
          soIds={trip.orders.map(o => o.id!)}
          onClose={() => setIsPrinting(false)}
        />
      )}
    </>
  );
}
