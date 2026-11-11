import { useCan } from '../../utils/capabilities';
import { useState, useEffect, useRef } from 'react';
import { X, Truck, Package, Clock, FileText, CheckCircle2, ShieldAlert, Printer, Edit, AlertTriangle, Plus, Send, Users, Check, Undo2 } from 'lucide-react';
import type { SalesOrder, EMGood } from '../../types';
import { useErpStore } from '../../store/erp-store';
import { useTripStore } from '../../store/trip-store';
import { useAppStore } from '../../store/app-store';
import {
  cancelSO, confirmSO, moveToPicking, createUnlockRequest, createQuotationFromSoTrip,
  confirmTrip, submitTripPlan, createTrip, updateTrip, fetchTrip, fetchTruckPlates, updateLoadPlan, acknowledgeLoadPlan,
  fetchLoadingPlan, fetchSystemSettings, fetchGoods,
  requestTripMultiCustApproval, cancelTripMultiCustApproval, approveTripApproval, rejectTripApproval,
  type MultiCustTripApprovalSummary,
} from '../../services/api';
import { isMaePuiGood, parseMaePuiMaxValidDays } from '../../utils/quotation-policy';
import { useAuthStore } from '../../store/auth-store';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { appAlert, appConfirm } from '../ui/AppAlert';
import { RequestActionModal, type RequestActionType } from '../papertrail/RequestActionModal';
import { SOCancelDeleteModal } from '../common/SOCancelDeleteModal';
import { TripSetupModal, type TripSetupData } from './TripSetupModal';
import { PaperDocModal } from '../papertrail/PaperDocModal';
import { SOBookingDocModal } from './SOBookingDocModal';
import { displayStatus, SO_STATUS_META, soStatusLabel } from '../../constants/soStatus';
import { QuickShipModal } from './QuickShipModal';
import { bangkokDate, formatThaiDate } from '../../utils/date';
import { giveawayPieces } from '../../utils/giveaway';
import { LoadSequencer, type SequencedLine } from './LoadSequencer';

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
  trip: { tripId?: number; tripCode?: string; dateDisplay: string; cust: string; custCount?: number; truck: string; orders: SalesOrder[]; totalAmt: number; totalTon: number } | null;
  onUpdate?: () => void;
  onEditBill?: (soId: string | number) => void;
  onAddBill?: () => void;
}) {
  const unlockRequests = useErpStore(s => s.unlockRequests);
  const navigate = useAppStore(s => s.navigate);
  const can = useCan();
  const currentUser = useAuthStore(s => s.user);
  const isWarehouseOrElevated = currentUser && ['WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'].includes(currentUser.role);

  const [busy, setBusy] = useState(false);
  const [requestModalConfig, setRequestModalConfig] = useState<{ isOpen: boolean, type: RequestActionType }>({ isOpen: false, type: 'EDIT' });
  const [quoteDays, setQuoteDays] = useState<number>(15);
  const [maePuiMaxDays, setMaePuiMaxDays] = useState<number>(3);
  const [minCustThreshold, setMinCustThreshold] = useState<number>(2);
  const [multiCustApproval, setMultiCustApproval] = useState<MultiCustTripApprovalSummary | null>(null);
  const [showMultiCustForm, setShowMultiCustForm] = useState(false);
  const [multiCustReason, setMultiCustReason] = useState('');
  const [multiCustApproveMode, setMultiCustApproveMode] = useState<null | 'approve' | 'reject'>(null);
  const [multiCustDecisionNote, setMultiCustDecisionNote] = useState('');
  const [goodsList, setGoodsList] = useState<EMGood[]>([]);
  const [selectedSoIds, setSelectedSoIds] = useState<Set<string | number>>(new Set());
  const [tripPickupDueDate, setTripPickupDueDate] = useState<string>('');
  const [tripRevision, setTripRevision] = useState<number>(1);
  const [tripLoaded, setTripLoaded] = useState(false);
  const [serverPlate, setServerPlate] = useState('');
  const [tripRemark, setTripRemark] = useState('');
  const [tripPreSling, setTripPreSling] = useState(false);
  const [loadPlanStatus, setLoadPlanStatus] = useState<string>('DRAFT');
  const [loadPlanRevision, setLoadPlanRevision] = useState<number>(1);
  const [warehouseAckAt, setWarehouseAckAt] = useState<string | null>(null);
  const [loadPlanLines, setLoadPlanLines] = useState<any[]>([]);
  const [capacityInfo, setCapacityInfo] = useState<any>(null);
  const idempotencyKeyRef = useRef<string>('');

  const loadTripPlan = (tripId: number) => {
    fetchLoadingPlan(tripId).then(planRes => {
      if (planRes.trip) {
        setLoadPlanStatus(planRes.trip.loadPlanStatus || 'DRAFT');
        setLoadPlanRevision(Number(planRes.trip.loadPlanRevision || 1));
        setWarehouseAckAt(planRes.trip.warehouseAckAt || null);
      }
      if (planRes.capacityInfo) setCapacityInfo(planRes.capacityInfo);
      if (planRes.plan) setLoadPlanLines(planRes.plan);
    }).catch(err => {
      console.warn('fetchLoadingPlan failed', err);
    });
  };

  useEffect(() => {
    let disposed = false;
    setTripLoaded(false);
    setMultiCustApproval(null);
    setShowMultiCustForm(false);
    setMultiCustApproveMode(null);
    if (trip?.orders) {
      fetchSystemSettings()
        .then(res => {
          if (disposed) return;
          setMaePuiMaxDays(parseMaePuiMaxValidDays(res.raw, res.settings));
          const rawMin = res.raw?.TRIP_MULTI_CUST_APPROVAL_MIN_CUSTOMERS ?? res.settings?.TRIP_MULTI_CUST_APPROVAL_MIN_CUSTOMERS;
          const parsedMin = parseInt(String(rawMin ?? '2'), 10);
          if (Number.isInteger(parsedMin) && parsedMin >= 2) setMinCustThreshold(parsedMin);
        })
        .catch(() => {});
      fetchGoods({ forSale: true })
        .then(res => { if (!disposed) setGoodsList(Array.isArray(res) ? res : []); })
        .catch(() => {});
      const draftIds = trip.orders
        .filter(o => o.status === 'DRAFT' && o.id && String(o.id) !== 'undefined')
        .map(o => o.id!);
      setSelectedSoIds(new Set(draftIds));

      const rawDeliveryDate = trip.orders.find(o => o.deliveryDate)?.deliveryDate;
      const initialDue = (trip as any)?.pickupDueDate?.split('T')[0] || (rawDeliveryDate ? rawDeliveryDate.split('T')[0] : '');
      setTripPickupDueDate(initialDue);

      const tripId = (trip as any)?.tripId || (trip.orders[0] as any)?.tripId;
      if (tripId && Number(tripId) > 0) {
        if (!idempotencyKeyRef.current.startsWith(`trip-confirm-${tripId}-`)) {
          idempotencyKeyRef.current = `trip-confirm-${tripId}-${Date.now()}`;
        }
        fetchTrip(tripId).then(res => {
          if (disposed) return;
          setTripRemark(res.tripRemark ?? '');
          setTripPreSling(!!res.preSlingRequired);
          setServerPlate(res.transRegistration || '');
          setTripRevision(Number(res.documentRevision));
          if (res.pickupDueDate) setTripPickupDueDate(res.pickupDueDate.split('T')[0]);
          setMultiCustApproval(res.multiCustApproval || null);
          if (res.multiCustApproval?.minCustomers) {
            setMinCustThreshold(res.multiCustApproval.minCustomers);
          }
          const store = useTripStore.getState();
          if (Number(store.activeTrip?.tripId) === Number(tripId)) store.updateTrip({
            truckPlate: res.transRegistration || undefined, remark: res.tripRemark || '',
            pSling: !!res.preSlingRequired,
            ...(res.pickupDueDate ? {deliveryDate:res.pickupDueDate.split('T')[0]} : {})
          });
          setTripLoaded(true);
        }).catch(err => console.warn('fetchTrip failed; editing disabled', err));

        loadTripPlan(Number(tripId));
      } else {
        setServerPlate(trip.truck || '');
        setTripLoaded(true);
        if (!idempotencyKeyRef.current.startsWith('trip-confirm-new-')) {
          idempotencyKeyRef.current = `trip-confirm-new-${Date.now()}`;
        }
      }
    }
    return () => { disposed = true; };
  }, [trip]);

  const handleWarehouseAck = async () => {
    const effectiveTripId = (trip as any)?.tripId || (trip?.orders[0] as any)?.tripId;
    if (!effectiveTripId) return;

    setBusy(true);
    try {
      const ackRes = await acknowledgeLoadPlan(effectiveTripId, {
        expectedPlanRevision: loadPlanRevision,
        note: 'คลังรับทราบแผนจัดของผ่านหน้าจอสรุปเที่ยวรถ'
      });
      setLoadPlanStatus('WAREHOUSE_ACK');
      setWarehouseAckAt(ackRes.warehouseAckAt || new Date().toISOString());
      await appAlert(ackRes.message || 'ฝ่ายคลังรับทราบแผนจัดของเรียบร้อยแล้ว', 'success');
      if (onUpdate) onUpdate();
      loadTripPlan(Number(effectiveTripId));
    } catch (e: any) {
      await appAlert('การรับทราบแผนล้มเหลว: ' + (e.message || 'ข้อผิดพลาด'), 'error');
    } finally {
      setBusy(false);
    }
  };
  
  const [isEditTripOpen, setIsEditTripOpen] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [selectedBookingSoId, setSelectedBookingSoId] = useState<string | number | null>(null);
  const [shipModalConfig, setShipModalConfig] = useState<{ isOpen: boolean; soIds: (string | number)[] }>({ isOpen: false, soIds: [] });
  const [cancelModalConfig, setCancelModalConfig] = useState<{ isOpen: boolean; order: SalesOrder | null }>({ isOpen: false, order: null });
  const [isSequencerOpen, setIsSequencerOpen] = useState(false);
  const [truckPickerOrder, setTruckPickerOrder] = useState<SalesOrder | null>(null);
  const [customerTrucks, setCustomerTrucks] = useState<string[]>([]);
  const [loadingTrucks, setLoadingTrucks] = useState(false);
  const [newTruckPlateInput, setNewTruckPlateInput] = useState('');
  const [savingTruck, setSavingTruck] = useState(false);

  // Guard Hooks Rule (#310): keep all derived hook inputs and useEffect strictly above early return
  const hasMaePuiInTrip = Boolean(trip?.orders?.some(o =>
    (o.lines || []).some(l => {
      if (l.isGiveaway) return false;
      const g = goodsList.find(item => String(item.GoodID) === String(l.goodId) || (l.goodCode && item.GoodCode === l.goodCode));
      return isMaePuiGood(g) || isMaePuiGood(l as any);
    })
  ));

  useEffect(() => {
    if (hasMaePuiInTrip && quoteDays > maePuiMaxDays) {
      setQuoteDays(maePuiMaxDays);
    }
  }, [hasMaePuiInTrip, quoteDays, maePuiMaxDays]);

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
      existing.qtyTon += line.isGiveaway ? giveawayPieces(line) : line.qtyTon;
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
    catch (e: unknown) { await appAlert((e as Error).message || 'เกิดข้อผิดพลาด', 'error'); }
    finally { setBusy(false); }
  }

  const handleBulkAction = async (actionFn: (id: string | number) => Promise<any>, confirmMsg: string) => {
    if (!await appConfirm(confirmMsg)) return;
    setBusy(true);
    try {
      await Promise.all(trip.orders.filter(o => o.id && String(o.id) !== 'undefined').map(so => actionFn(so.id!)));
      if (onUpdate) onUpdate();
    } catch (e: any) {
      await appAlert('ทำรายการล้มเหลว: ' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const allDraftOrders = trip.orders.filter(o => o.status === 'DRAFT');
  const activeOrdersForCheck = allDraftOrders.length === trip.orders.length
    ? (selectedSoIds.size > 0 ? allDraftOrders.filter(o => o.id != null && selectedSoIds.has(o.id)) : allDraftOrders)
    : trip.orders.filter(o => !['CANCELLED', 'DELETED'].includes(String(o.status || '').toUpperCase()));
  const selectedCustKeys = Array.from(
    new Set(
      activeOrdersForCheck
        .map(o => String(o.custId || (o.custName ? `NAME:${o.custName}` : '')).trim())
        .filter(Boolean)
    )
  ).sort();
  const effectiveMinCust = multiCustApproval?.minCustomers || minCustThreshold || 2;
  const isDraftOrRelock = trip.orders.some(o => o.status === 'DRAFT');
  const selectionRequiresMultiCust = isDraftOrRelock && selectedCustKeys.length >= effectiveMinCust;
  const serverCustSorted = [...(multiCustApproval?.customerIds || [])].map(String).sort();
  const selectionMatchesServer =
    !!multiCustApproval &&
    selectedCustKeys.length > 0 &&
    JSON.stringify(selectedCustKeys) === JSON.stringify(serverCustSorted);
  const effectiveMultiCustStatus = selectionRequiresMultiCust
    ? (selectionMatchesServer ? multiCustApproval!.approvalStatus : 'REQUIRED')
    : 'NOT_REQUIRED';
  const isMultiCustApprovedForSelection =
    !selectionRequiresMultiCust || effectiveMultiCustStatus === 'APPROVED';

  const ensureTripIdAndReload = async (): Promise<number | null> => {
    let tid = (trip as any)?.tripId || (trip.orders[0] as any)?.tripId;
    if (!tid || Number(tid) <= 0) {
      const created = await createTrip({
        transRegistration: serverPlate,
        deliveryDate: tripPickupDueDate || undefined,
        orderIds: trip.orders.map(o => o.id!).filter(Boolean),
      });
      tid = created.tripId;
    }
    return tid ? Number(tid) : null;
  };

  const handleRequestMultiCustApproval = async () => {
    setBusy(true);
    try {
      const effectiveTripId = await ensureTripIdAndReload();
      if (!effectiveTripId) throw new Error('ไม่พบรหัส Trip สำหรับส่งขออนุมัติ');
      const subsetIds = allDraftOrders.length === trip.orders.length && selectedSoIds.size > 0 && selectedSoIds.size < allDraftOrders.length
        ? Array.from(selectedSoIds)
        : undefined;
      const res = await requestTripMultiCustApproval(effectiveTripId, {
        reason: multiCustReason.trim() || undefined,
        orderIds: subsetIds,
      });
      setShowMultiCustForm(false);
      setMultiCustReason('');
      const refreshed = await fetchTrip(effectiveTripId);
      setMultiCustApproval(refreshed.multiCustApproval || null);
      if (onUpdate) onUpdate();
      appAlert(res.message || 'ส่งคำขออนุมัติทริปหลายลูกค้าเรียบร้อยแล้ว', 'success');
    } catch (e: any) {
      appAlert('ส่งคำขออนุมัติไม่สำเร็จ: ' + (e.message || 'เกิดข้อผิดพลาด'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelMultiCustApproval = async () => {
    const latestId = multiCustApproval?.latestApproval?.id;
    const effectiveTripId = (trip as any)?.tripId || (trip.orders[0] as any)?.tripId;
    if (!latestId || !effectiveTripId) return;
    if (!await appConfirm('ต้องการถอนคำขออนุมัติทริปหลายลูกค้านี้ใช่หรือไม่?')) return;
    setBusy(true);
    try {
      const res = await cancelTripMultiCustApproval(effectiveTripId, latestId);
      const refreshed = await fetchTrip(effectiveTripId);
      setMultiCustApproval(refreshed.multiCustApproval || null);
      if (onUpdate) onUpdate();
      appAlert(res.message || 'ถอนคำขออนุมัติเรียบร้อย', 'success');
    } catch (e: any) {
      appAlert('ถอนคำขอไม่สำเร็จ: ' + (e.message || 'เกิดข้อผิดพลาด'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDecideMultiCustApproval = async (decision: 'approve' | 'reject') => {
    const latestId = multiCustApproval?.latestApproval?.id;
    const effectiveTripId = (trip as any)?.tripId || (trip.orders[0] as any)?.tripId;
    if (!latestId || !effectiveTripId) return;
    if (decision === 'reject' && multiCustDecisionNote.trim().length < 5) {
      appAlert('ปฏิเสธคำขอต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร', 'warning');
      return;
    }
    setBusy(true);
    try {
      const res = decision === 'approve'
        ? await approveTripApproval(latestId, multiCustDecisionNote.trim() || undefined)
        : await rejectTripApproval(latestId, multiCustDecisionNote.trim());
      setMultiCustApproveMode(null);
      setMultiCustDecisionNote('');
      const refreshed = await fetchTrip(effectiveTripId);
      setMultiCustApproval(refreshed.multiCustApproval || null);
      if (onUpdate) onUpdate();
      appAlert(res.message || (decision === 'approve' ? 'อนุมัติทริปหลายลูกค้าเรียบร้อย' : 'ปฏิเสธคำขอเรียบร้อย'), 'success');
    } catch (e: any) {
      appAlert('ดำเนินการไม่สำเร็จ: ' + (e.message || 'เกิดข้อผิดพลาด'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmTripOrders = async () => {
    if (!tripLoaded) return;
    const draftOrders = trip.orders.filter(o => o.status === 'DRAFT');
    const selectedOrders = draftOrders.filter(o => selectedSoIds.has(o.id!));
    if (selectedOrders.length === 0) {
      appAlert('กรุณาเลือกบิลที่ต้องการยืนยันอย่างน้อย 1 บิล', 'warning');
      return;
    }

    if (selectionRequiresMultiCust && !isMultiCustApprovedForSelection) {
      appAlert(`ทริปนี้มีลูกค้า ${selectedCustKeys.length} ราย (ตั้งแต่ ${effectiveMinCust} รายขึ้นไป) ต้องส่งขออนุมัติจากผู้มีอำนาจอนุมัติก่อนยืนยันการสั่งซื้อ`, 'warning');
      return;
    }

    // Check if any selected order has pending price approval
    const pendingPriceOrder = selectedOrders.find(o =>
      (o as any).requiresPriceApproval && ((o as any).priceApprovalStatus === 'PENDING' || (o as any).priceApprovalStatus === 'NONE' || !(o as any).priceApprovalStatus)
    );
    if (pendingPriceOrder) {
      appAlert(`ไม่สามารถยืนยันได้: บิล ${pendingPriceOrder.wfRef || '#' + pendingPriceOrder.id} มีรายการราคาต่ำกว่าประกาศที่ยังรอการอนุมัติ`, 'warning');
      return;
    }

    const rejectedPriceOrder = selectedOrders.find(o => (o as any).priceApprovalStatus === 'REJECTED');
    if (rejectedPriceOrder) {
      appAlert(`ไม่สามารถยืนยันได้: บิล ${rejectedPriceOrder.wfRef || '#' + rejectedPriceOrder.id} ถูกปฏิเสธราคาขาย`, 'error');
      return;
    }

    // F-06 UI: Control ticket trips confirm as a trip unit, no truck plate or pickup due date required
    const isControlTicketTrip = serverPlate === 'ตั๋วคุม' || selectedOrders.every(o => o.truckPlate === 'ตั๋วคุม' || (o as any).noTruckRequired);

    if (!isControlTicketTrip) {
      const isNoPlate = !serverPlate || serverPlate === 'ไม่ระบุทะเบียนรถ' || serverPlate === 'ยังไม่ระบุรถ';
      if (isNoPlate) {
        appAlert('การยืนยันเที่ยวรถจำเป็นต้องระบุทะเบียนรถ กรุณากด "แก้ไขข้อมูล" เพื่อใส่ทะเบียนรถก่อนยืนยัน', 'warning');
        return;
      }

      // P1 Finding 4: วันนัดรับรถห้ามเดาและต้องระบุชัดเจน (แยกจากวันรับของแต่ละ SO)
      if (!tripPickupDueDate) {
        appAlert('การยืนยันเที่ยวรถจำเป็นต้องระบุวันนัดรับสินค้า (Pickup Due Date) ให้ชัดเจน', 'warning');
        return;
      }
    }

    let effectiveTripId = (trip as any)?.tripId || (trip.orders[0] as any)?.tripId;
    if (!effectiveTripId || Number(effectiveTripId) <= 0) {
      try {
        const newTrip = await createTrip({
          transRegistration: serverPlate,
          deliveryDate: tripPickupDueDate,
          orderIds: trip.orders.map(o => o.id!).filter(Boolean)
        });
        effectiveTripId = newTrip.tripId;
        idempotencyKeyRef.current = `trip-confirm-${effectiveTripId}-${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
      } catch (err: any) {
        appAlert('ไม่สามารถสร้างเที่ยวรถอัตโนมัติ: ' + err.message, 'error');
        return;
      }
    }

    const isPartial = !hasRelockableBill && selectedOrders.length < draftOrders.length;
    const confirmMsg = isPartial
      ? `ยืนยัน ${selectedOrders.length} บิลที่เลือก?\nบิลที่ไม่ได้เลือกอีก ${draftOrders.length - selectedOrders.length} บิล จะถูกย้ายไปเที่ยวตกค้าง (-R) โดยอัตโนมัติ`
      : `ยืนยันออร์เดอร์ทั้งหมด ${selectedOrders.length} บิลในเที่ยวนี้ใช่หรือไม่?`;

    // SO-07: Require explicit sequence confirmation if loadInOrder is true
    const isLoadInOrder = selectedOrders.some(o => (o.lines || []).some(l => l.loadSequence && Number(l.loadSequence) > 0));
    if (isLoadInOrder) {
      setIsSequencerOpen(true);
      return; // handleProceedConfirmTrip will be called from LoadSequencer
    }

    if (!await appConfirm(confirmMsg)) return;
    await proceedConfirmTrip(effectiveTripId, selectedOrders);
  };

  const proceedConfirmTrip = async (effectiveTripId: number, selectedOrders: SalesOrder[], sequencedLines?: SequencedLine[]) => {
    setBusy(true);
    try {
      // SO-07: Send transactional load plan command (no updateSO loop!)
      if (sequencedLines && sequencedLines.length > 0) {
        const savedPlan = await updateLoadPlan(effectiveTripId, {
          expectedPlanRevision: loadPlanRevision,
          lines: sequencedLines.map(sl => ({
            memberKind: sl.memberKind,
            memberId: sl.memberId,
            lineNum: sl.lineNum,
            loadSequence: sl.newSequence,
            masterQty: sl.masterQty,
            childQty: sl.childQty,
          })),
          reason: 'จัดลำดับขึ้นของโดยพนักงานขาย',
        });
        setLoadPlanRevision(savedPlan.loadPlanRevision);
        setLoadPlanStatus(savedPlan.loadPlanStatus);
      }

      const isControlTicketTrip = serverPlate === 'ตั๋วคุม' || selectedOrders.every(o => o.truckPlate === 'ตั๋วคุม' || o.soPrefix === 'AI');
      const isNoTruckTrip = !isControlTicketTrip && selectedOrders.every(o => (o as any).noTruckRequired);
      const targetPlate = isControlTicketTrip ? 'ตั๋วคุม' : (isNoTruckTrip ? null : serverPlate);
      const targetPickup = (isControlTicketTrip || isNoTruckTrip)
        ? (tripPickupDueDate || bangkokDate())
        : tripPickupDueDate;

      const res = await confirmTrip(effectiveTripId, {
        confirmedOrderIds: selectedOrders.map(o => o.id!),
        transRegistration: targetPlate,
        pickupDueDate: targetPickup,
        expectedRevision: tripRevision || 1,
        idempotencyKey: idempotencyKeyRef.current,
      });

      if (res.warning) {
        await appAlert(`${res.message || 'ยืนยันเที่ยวรถสำเร็จ'}\n\nข้อควรระวัง: ${res.warning}`, 'warning');
      } else {
        await appAlert(res.message || 'ยืนยันเที่ยวรถสำเร็จ', 'success');
      }
      useTripStore.getState().clearTrip();
      if (onUpdate) onUpdate();
      onClose();
    } catch (e: any) {
      appAlert('ยืนยันล้มเหลว: ' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateQuotation = async () => {
    const soIds = trip.orders.map(o => o.id).filter((id): id is string | number => !!id && String(id) !== 'undefined');
    if (!soIds.length) return void appAlert('ไม่พบ SO สำหรับสร้างใบเสนอราคา', 'warning');
    if (isQuoteLocked) return void appAlert(`ทริปนี้ผูกกับใบเสนอราคา ${linkedQuoteOrder?.linkedQuoteNo || ''} ที่ยังรอการยืนยันอยู่`, 'warning');
    if (!allDraft) return void appAlert('สร้างใบเสนอราคาได้เฉพาะบิลร่างทั้งหมดในทริปเท่านั้น', 'warning');
    const ok = await appConfirm(`สร้างใบเสนอราคาจากทริปนี้ ${soIds.length} บิล?\nระบบจะรวมสินค้าเป็นใบเดียว และไม่รวมรายการของแถม`);
    if (!ok) return;
    await doAction(async () => {
      const sourceRefs = trip.orders
        .map(o => o.wfRef || (o as any).importedDocuNo || String(o.id || ''))
        .filter(ref => ref && ref !== 'undefined');
      const result = await createQuotationFromSoTrip({ soIds, sourceRefs, validDays: effectiveQuoteDays });
      await appAlert(`สร้างใบเสนอราคา ${result.quoteNo} สำเร็จ\nSO ในทริปจะยังเป็นร่างจนกว่าใบเสนอราคาจะถูกยืนยัน`, 'success');
    });
  };

  const handleEditTripMetadata = (data: TripSetupData) => {
    if (data.expectedRevision) setTripRevision(data.expectedRevision);
    setTripPickupDueDate(data.deliveryDate);
    setServerPlate(data.truckPlate || '');
    setTripRemark(data.remark || '');
    setTripPreSling(!!data.pSling);
    const store = useTripStore.getState();
    if (Number(store.activeTrip?.tripId) === Number(data.tripId)) store.updateTrip(data);
    setIsEditTripOpen(false);
    if (onUpdate) onUpdate();
  };

  const openTruckPickerForOrder = (order: SalesOrder) => {
    if (!order.custId) return;
    setTruckPickerOrder(order);
    setNewTruckPlateInput('');
    setLoadingTrucks(true);
    fetchTruckPlates(String(order.custId))
      .then(plates => setCustomerTrucks(plates || []))
      .catch(() => setCustomerTrucks([]))
      .finally(() => setLoadingTrucks(false));
  };

  const applyTripTruckPlate = async (plateRaw: string) => {
    if (!trip || savingTruck) return;
    const trimmed = plateRaw.trim();
    if (!trimmed) return;
    const cleanPlate = ['ยังไม่ระบุรถ', 'ตั๋วคุม', 'ไม่ระบุทะเบียนรถ'].includes(trimmed) ? '' : trimmed;
    const effectiveTripId = (trip as any)?.tripId || (trip.orders[0] as any)?.tripId;
    const deliveryDate = tripPickupDueDate || trip.orders.find(o => o.deliveryDate)?.deliveryDate?.split('T')[0] || bangkokDate();
    const loadInOrder = trip.orders.some(o => (o.lines || []).some((l: any) => l.loadSequence && Number(l.loadSequence) > 0));

    setSavingTruck(true);
    try {
      let nextRevision = tripRevision;
      let resolvedTripId = effectiveTripId ? Number(effectiveTripId) : undefined;
      if (resolvedTripId) {
        const res = await updateTrip(resolvedTripId, {
          transRegistration: cleanPlate || null,
          deliveryDate,
          pSling: tripPreSling,
          loadInOrder,
          remark: tripRemark,
          expectedRevision: tripRevision,
        });
        if (res.documentRevision) nextRevision = res.documentRevision;
      } else {
        const orderIds = trip.orders.map(o => o.id!).filter(Boolean);
        const created = await createTrip({
          transRegistration: cleanPlate || null,
          deliveryDate,
          truckCapacityTon: 30,
          pSling: tripPreSling,
          remark: tripRemark,
          ...(orderIds.length ? { orderIds } : {}),
        });
        resolvedTripId = created.tripId;
        const freshTrip = await fetchTrip(created.tripId).catch(() => null);
        if (freshTrip?.documentRevision) nextRevision = freshTrip.documentRevision;
      }

      setTripRevision(nextRevision);
      setServerPlate(cleanPlate);
      setTripPickupDueDate(deliveryDate);
      const store = useTripStore.getState();
      if (resolvedTripId && (!store.activeTrip?.tripId || Number(store.activeTrip.tripId) === resolvedTripId)) {
        store.updateTrip({
          tripId: resolvedTripId,
          truckPlate: cleanPlate || undefined,
          deliveryDate,
        });
      }
      if (resolvedTripId) loadTripPlan(resolvedTripId);
      setTruckPickerOrder(null);
      setNewTruckPlateInput('');
      if (onUpdate) onUpdate();
    } catch (err: any) {
      await appAlert('บันทึกรถขนส่งไม่สำเร็จ: ' + (err?.message || 'ข้อผิดพลาด'), 'error');
    } finally {
      setSavingTruck(false);
    }
  };

  const allDraft = trip.orders.every(o => o.status === 'DRAFT');
  const effectiveQuoteDays = hasMaePuiInTrip ? Math.min(quoteDays, maePuiMaxDays) : quoteDays;
  // a bill unlocked for an edit reads DRAFT while the rest of its confirmed trip stays as it was
  const hasRelockableBill = !allDraft && trip.orders.some(o => o.status === 'DRAFT');
  const allConfirmed = trip.orders.every(o => o.status === 'CONFIRMED');
  const allPicking = trip.orders.length > 0 && trip.orders.every(o => ['PICKING', 'LOADED'].includes(o.status));
  const canSubmitPlan = (!loadPlanStatus || loadPlanStatus === 'DRAFT') &&
    trip.orders.length > 0 &&
    trip.orders.every(o => ['CONFIRMED', 'PICKING', 'LOADED'].includes(o.status));
  const hasAnyUnlockRequest = trip.orders.some(o => unlockRequests.some(r => r.SoId === o.id));
  
  // Checking if there are any non-draft bills that are NOT shipped/imported
  const hasActionableBills = trip.orders.some(o => ['CONFIRMED', 'PICKING'].includes(o.status));

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4 animate-in fade-in duration-200" onClick={onClose} data-testid="trip-summary-modal">
        <div className="bg-[#F1EFE8] w-full h-[90vh] sm:w-[96vw] sm:h-[96vh] sm:rounded-2xl flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95" onClick={e => e.stopPropagation()}>
          
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-blue-800 bg-[#0C447C] text-white shrink-0">
            <div>
              <h2 className="text-base sm:text-xl font-bold flex items-center gap-2">
                <Truck size={20} className="sm:w-6 sm:h-6" />
                เที่ยวรถ {trip.tripCode ? `[${trip.tripCode}]` : ''} · {serverPlate || 'ยังไม่ระบุรถ'}
              </h2>
              <p className="text-xs sm:text-sm text-blue-200 mt-0.5 sm:mt-1">
                ลูกค้า {Array.from(new Set(trip.orders.map(o => String(o.custId || '')).filter(Boolean))).length} ราย · รวมบิล {trip.orders.length} ใบ (สินค้ารวม {trip.orders.reduce((s, o) => s + (o.lines || []).reduce((ls, l) => ls + (l.isGiveaway ? 0 : l.qtyTon), 0), 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ตัน)
              </p>
            </div>
            <button onClick={onClose} data-testid="btn-close-trip-summary" className="text-white/80 hover:text-white rounded-full p-2 hover:bg-white/10 transition-colors">
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
                      <div className="font-bold text-lg text-gray-900">{serverPlate || 'ยังไม่ระบุรถ'}</div>
                      <div className="text-xs text-gray-500 font-medium mt-0.5">
                        ลูกค้า {Array.from(new Set(trip.orders.map(o => String(o.custId || '')).filter(Boolean))).length} ราย · บิล {trip.orders.length} ใบ
                      </div>
                    </div>
                  </div>
                  {/* Edit Trip Metadata */}
                  <button
                    disabled={busy || isQuoteLocked || !tripLoaded}
                    onClick={() => setIsEditTripOpen(true)}
                    title={isQuoteLocked ? 'ต้องยืนยันหรือยกเลิกใบเสนอราคาก่อน' : undefined}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:hover:bg-white"
                  >
                    <Edit size={12} /> แก้ไขข้อมูลเที่ยวรถ
                  </button>
                </div>

                <div className="flex flex-col gap-1.5 mt-1">
                  <div className="text-xs text-gray-500 flex items-center gap-1.5 bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-200">
                    <Clock size={12} className="text-gray-400" /> วันที่เอกสารเที่ยวรถ: <span className="font-semibold text-gray-700">{trip.dateDisplay || '—'}</span>
                  </div>
                </div>

                {allDraft && (
                  <div className="flex flex-col gap-1.5 bg-blue-50/70 p-3 rounded-xl border border-blue-100 mt-2">
                    <label className="text-xs font-bold text-[#0C447C] flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Clock size={13} className="text-[#0C447C]" /> วันนัดรับสินค้าของเที่ยว (Trip Pickup)
                      </span>
                      <span className="text-[10px] text-blue-600 font-normal">แยกจากกำหนดรับของในบิล</span>
                    </label>
                    <ThaiDatePicker
                      value={tripPickupDueDate}
                      onChange={setTripPickupDueDate}
                      disabled={busy}
                      className="w-full text-xs font-bold border border-blue-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-[#0C447C] bg-white text-gray-800"
                    />
                  </div>
                )}

                {/* Summary Totals: All vs Selected */}
                <div className="mt-1 p-3 bg-gray-50/80 rounded-xl border border-gray-200 space-y-2">
                  <div className="text-xs font-bold text-gray-700 flex items-center justify-between">
                    <span>รวมทั้งเที่ยว ({trip.orders.length} บิล):</span>
                    <span className="text-[#0C447C]">฿{trip.orders.reduce((s, o) => s + (o.lines || []).reduce((ls, l) => ls + (l.qtyTon * l.pricePerTon), 0), 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 flex justify-between">
                    <span>น้ำหนักสินค้ารวม:</span>
                    <span className="font-semibold text-gray-700">{trip.orders.reduce((s, o) => s + (o.lines || []).reduce((ls, l) => ls + (l.isGiveaway ? 0 : l.qtyTon), 0), 0).toFixed(2)} ตัน</span>
                  </div>
                  {trip.orders.reduce((s, o) => s + (o.lines || []).reduce((ls, l) => ls + (l.isGiveaway ? l.qtyTon : 0), 0), 0) > 0 && (
                    <div className="text-[11px] text-pink-600 flex justify-between">
                      <span>น้ำหนักของแถม:</span>
                      <span className="font-semibold">{trip.orders.reduce((s, o) => s + (o.lines || []).reduce((ls, l) => ls + (l.isGiveaway ? l.qtyTon : 0), 0), 0).toFixed(2)} ตัน</span>
                    </div>
                  )}

                  {allDraft && selectedSoIds.size < trip.orders.length && (
                    <div className="pt-2 border-t border-gray-200 mt-2">
                      <div className="text-xs font-bold text-emerald-700 flex items-center justify-between">
                        <span>ที่เลือกยืนยัน ({selectedSoIds.size} บิล):</span>
                        <span>฿{trip.orders.filter(o => o.id != null && selectedSoIds.has(o.id)).reduce((s, o) => s + (o.lines || []).reduce((ls, l) => ls + (l.qtyTon * l.pricePerTon), 0), 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="text-[11px] text-emerald-600 flex justify-between">
                        <span>น้ำหนักสินค้าที่เลือก:</span>
                        <span className="font-semibold">{trip.orders.filter(o => o.id != null && selectedSoIds.has(o.id)).reduce((s, o) => s + (o.lines || []).reduce((ls, l) => ls + (l.isGiveaway ? 0 : l.qtyTon), 0), 0).toFixed(2)} ตัน</span>
                      </div>
                    </div>
                  )}
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
                      {selectionRequiresMultiCust && !isQuoteLocked && (() => {
                        const latestApp = selectionMatchesServer ? multiCustApproval?.latestApproval : null;
                        const canDecideMultiCust =
                          ['APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL'].includes(String(currentUser?.role || '')) &&
                          (['ADMIN', 'C_LEVEL'].includes(String(currentUser?.role || '')) || Number(latestApp?.requestedBy) !== Number(currentUser?.id));
                        const isRequester = !!latestApp && Number(latestApp.requestedBy) === Number(currentUser?.id);
                        const boxStyle =
                          effectiveMultiCustStatus === 'APPROVED'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : effectiveMultiCustStatus === 'REJECTED'
                              ? 'bg-red-50 border-red-200 text-red-900'
                              : 'bg-amber-50 border-amber-200 text-amber-950';

                        return (
                          <div className={`rounded-xl border p-3 text-xs space-y-2 ${boxStyle}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2">
                                <Users size={15} className="shrink-0 mt-0.5" />
                                <div>
                                  <div className="font-bold">
                                    ทริปมีลูกค้า {selectedCustKeys.length} ราย (ตั้งแต่ {effectiveMinCust} รายขึ้นไป)
                                  </div>
                                  <div className="text-[11px] opacity-85 mt-0.5">
                                    {effectiveMultiCustStatus === 'APPROVED'
                                      ? 'ได้รับการอนุมัติจากผู้มีอำนาจแล้ว สามารถยืนยันการสั่งซื้อได้'
                                      : effectiveMultiCustStatus === 'PENDING'
                                        ? 'ส่งคำขอแล้ว กำลังรอผู้มีอำนาจอนุมัติพิจารณาก่อนยืนยัน'
                                        : effectiveMultiCustStatus === 'REJECTED'
                                          ? `ถูกปฏิเสธ${latestApp?.approvalNote ? `: ${latestApp.approvalNote}` : ''}`
                                          : multiCustApproval?.isStale && !selectionMatchesServer
                                            ? 'รายชื่อลูกค้าในทริปเปลี่ยน ต้องส่งขออนุมัติใหม่ก่อนยืนยัน'
                                            : 'ต้องส่งขออนุมัติทริปหลายลูกค้าจากผู้มีอำนาจก่อนยืนยันการสั่งซื้อทุกครั้ง'}
                                  </div>
                                </div>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                effectiveMultiCustStatus === 'APPROVED'
                                  ? 'bg-emerald-600 text-white'
                                  : effectiveMultiCustStatus === 'PENDING'
                                    ? 'bg-amber-500 text-white'
                                    : effectiveMultiCustStatus === 'REJECTED'
                                      ? 'bg-red-600 text-white'
                                      : 'bg-gray-700 text-white'
                              }`}>
                                {effectiveMultiCustStatus === 'APPROVED' ? 'อนุมัติแล้ว'
                                  : effectiveMultiCustStatus === 'PENDING' ? 'รออนุมัติ'
                                  : effectiveMultiCustStatus === 'REJECTED' ? 'ปฏิเสธ'
                                  : 'ต้องขออนุมัติ'}
                              </span>
                            </div>

                            {latestApp?.reasonText && (
                              <div className="text-[11px] bg-white/70 rounded px-2 py-1 border border-black/5">
                                เหตุผลผู้ขอ: <span className="font-semibold">{latestApp.reasonText}</span>
                              </div>
                            )}
                            {latestApp?.approvedByName && (
                              <div className="text-[11px] opacity-80">
                                {effectiveMultiCustStatus === 'APPROVED' ? 'อนุมัติโดย' : 'ปฏิเสธโดย'}: <strong>{latestApp.approvedByName}</strong>
                                {latestApp.approvalNote ? ` (${latestApp.approvalNote})` : ''}
                              </div>
                            )}

                            {(effectiveMultiCustStatus === 'REQUIRED' || effectiveMultiCustStatus === 'REJECTED' || effectiveMultiCustStatus === 'SUPERSEDED') && (
                              <div className="space-y-2 pt-1">
                                {!showMultiCustForm ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setShowMultiCustForm(true)}
                                    data-testid="btn-open-multi-cust-request"
                                    className="w-full py-2 px-3 rounded-lg bg-[#0C447C] text-white font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-blue-900 disabled:opacity-50"
                                  >
                                    <Send size={13} /> ส่งขออนุมัติทริปหลายลูกค้า ({selectedCustKeys.length} ราย)
                                  </button>
                                ) : (
                                  <div className="space-y-2 bg-white p-2.5 rounded-lg border border-amber-200">
                                    <textarea
                                      rows={2}
                                      value={multiCustReason}
                                      onChange={e => setMultiCustReason(e.target.value)}
                                      placeholder="ระบุเหตุผลประกอบการรวมทริปหลายลูกค้า (ถ้ามี)..."
                                      className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-800 focus:border-[#0C447C] outline-none"
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={handleRequestMultiCustApproval}
                                        data-testid="btn-submit-multi-cust-request"
                                        className="flex-1 py-1.5 rounded-lg bg-[#0C447C] text-white font-bold text-xs flex items-center justify-center gap-1 hover:bg-blue-900 disabled:opacity-50"
                                      >
                                        <Send size={12} /> ยืนยันส่งขออนุมัติ
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => { setShowMultiCustForm(false); setMultiCustReason(''); }}
                                        className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-600 text-xs font-semibold hover:bg-gray-50"
                                      >
                                        ยกเลิก
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {effectiveMultiCustStatus === 'PENDING' && (
                              <div className="space-y-2 pt-1">
                                <div className="flex flex-wrap gap-2">
                                  {canDecideMultiCust && multiCustApproveMode === null && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => setMultiCustApproveMode('approve')}
                                        className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-1 hover:bg-emerald-700 disabled:opacity-50"
                                      >
                                        <Check size={13} /> อนุมัติ
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => setMultiCustApproveMode('reject')}
                                        className="flex-1 py-1.5 px-2.5 rounded-lg border border-red-300 bg-red-50 text-red-700 font-bold text-xs flex items-center justify-center gap-1 hover:bg-red-100 disabled:opacity-50"
                                      >
                                        <X size={13} /> ปฏิเสธ
                                      </button>
                                    </>
                                  )}
                                  {isRequester && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={handleCancelMultiCustApproval}
                                      className="py-1.5 px-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-semibold text-xs flex items-center gap-1 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      <Undo2 size={12} /> ถอนคำขอ
                                    </button>
                                  )}
                                </div>

                                {multiCustApproveMode && (
                                  <div className="space-y-1.5 bg-white p-2 rounded-lg border border-gray-200">
                                    <input
                                      type="text"
                                      value={multiCustDecisionNote}
                                      onChange={e => setMultiCustDecisionNote(e.target.value)}
                                      placeholder={multiCustApproveMode === 'reject' ? 'เหตุผลที่ปฏิเสธ (อย่างน้อย 5 ตัวอักษร)...' : 'หมายเหตุการอนุมัติ (ถ้ามี)...'}
                                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-800 outline-none focus:border-[#0C447C]"
                                    />
                                    <div className="flex gap-1.5">
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => handleDecideMultiCustApproval(multiCustApproveMode)}
                                        className={`flex-1 py-1.5 rounded text-xs font-bold text-white disabled:opacity-50 ${
                                          multiCustApproveMode === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                                        }`}
                                      >
                                        {multiCustApproveMode === 'approve' ? 'ยืนยันอนุมัติ' : 'ยืนยันปฏิเสธ'}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => { setMultiCustApproveMode(null); setMultiCustDecisionNote(''); }}
                                        className="px-2.5 py-1.5 rounded border border-gray-300 text-xs text-gray-600 bg-white hover:bg-gray-50"
                                      >
                                        ยกเลิก
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {(allDraft || hasRelockableBill) && !isQuoteLocked && (
                        <button
                          disabled={busy || selectedSoIds.size === 0 || !can('so.confirm') || !isMultiCustApprovedForSelection}
                          onClick={handleConfirmTripOrders}
                          title={!isMultiCustApprovedForSelection ? `ต้องได้รับการอนุมัติทริปหลายลูกค้า (>= ${effectiveMinCust} ราย) ก่อนยืนยัน` : undefined}
                          className="w-full bg-green-600 text-white py-2.5 sm:py-3 rounded-xl font-bold text-sm sm:text-base flex items-center justify-center gap-2 hover:bg-green-700 shadow-sm disabled:opacity-50 transition-colors"
                        >
                          <CheckCircle2 size={18} /> ยืนยัน {selectedSoIds.size} บิลที่เลือก {selectedSoIds.size < trip.orders.filter(o => o.status === 'DRAFT').length ? '(แยกบิลตกค้าง -R)' : 'ทั้งเที่ยว'}
                        </button>
                      )}
                      {allDraft && !isQuoteLocked && can('quotation.create') && (
                        <div className="rounded-xl border border-blue-100 bg-blue-50 p-2.5 space-y-2">
                          <div className="flex items-center gap-2">
                            <FileText size={15} className="text-[#0C447C]" />
                            <select
                              value={effectiveQuoteDays}
                              onChange={e => setQuoteDays(Number(e.target.value))}
                              className="flex-1 rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs font-bold text-[#0C447C] outline-none"
                              disabled={busy}
                            >
                              {(hasMaePuiInTrip
                                ? Array.from({ length: Math.min(maePuiMaxDays, 7) }, (_, i) => i + 1).concat(maePuiMaxDays > 7 ? [maePuiMaxDays] : [])
                                : [7, 15, 20, 30, 45]
                              ).map(days => (
                                <option key={days} value={days}>
                                  ยืนราคา +{days} วัน{hasMaePuiInTrip && days === maePuiMaxDays ? ' (สูงสุดกลุ่มแม่ปุ๋ย)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                          {hasMaePuiInTrip && (
                            <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                              มีสินค้ากลุ่มแม่ปุ๋ย: ยืนราคาได้สูงสุด {maePuiMaxDays} วัน
                            </p>
                          )}
                          <button
                            disabled={busy}
                            onClick={handleCreateQuotation}
                            className="w-full bg-white text-[#0C447C] border border-blue-200 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                          >
                            <FileText size={16} /> สร้างใบเสนอราคาจากทริป
                          </button>
                        </div>
                      )}
                      {/* picking is the warehouse's job: the server allows WAREHOUSE / ADMIN / C_LEVEL (sales and counter saw the button and got 403) */}
                      {allConfirmed && ['WAREHOUSE', 'ADMIN', 'C_LEVEL'].includes(String(currentUser?.role || '')) && (
                        <button
                          disabled={busy}
                          onClick={() => handleBulkAction(moveToPicking, `เริ่มรับสินค้า (Picking) ทั้งทริปใช่หรือไม่?`)}
                          className="w-full py-2.5 sm:py-3 rounded-xl text-white text-sm sm:text-base font-bold shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                          style={{ background: '#F59E0B' }}
                        >
                          <Package size={18} /> เริ่มรับสินค้า (Picking) ทั้งทริป
                        </button>
                      )}
                      {/* shipping: the server allows WAREHOUSE / WEIGHBRIDGE / MANAGER / ADMIN / C_LEVEL (sales saw the button) */}
                      {allPicking && ['WAREHOUSE', 'WEIGHBRIDGE', 'MANAGER', 'ADMIN', 'C_LEVEL'].includes(String(currentUser?.role || '')) && (
                        <button
                          data-testid="btn-trip-ship"
                          disabled={busy}
                          onClick={() => setShipModalConfig({ isOpen: true, soIds: trip.orders.filter(o => o.id && String(o.id) !== 'undefined').map(o => o.id!) })}
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

                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      disabled={busy}
                      onClick={() => setIsPrinting(true)}
                      className="py-2.5 rounded-xl border border-gray-300 bg-white text-[#0C447C] hover:bg-blue-50 text-xs sm:text-sm font-bold shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Printer size={15} /> พิมพ์ใบจ่ายของ (4 สี)
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setSelectedBookingSoId(trip.orders[0]?.id || null)}
                      className="py-2.5 rounded-xl border border-blue-600 bg-blue-50 text-[#0C447C] hover:bg-blue-100 text-xs sm:text-sm font-bold shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <FileText size={15} /> พิมพ์ใบสั่งจอง (A4)
                    </button>
                  </div>
                  
                  {onAddBill && !isQuoteLocked && can('so.create') && (
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
            
            {/* Load Plan & Warehouse Acknowledgement Section (SO-07) */}
            <section className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <Truck size={20} className="text-[#0C447C]" />
                  <h3 className="font-bold text-gray-800 text-base sm:text-lg">
                    แผนการจัดของขึ้นรถ & การรับทราบของฝ่ายคลัง
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 font-mono">Revision {loadPlanRevision}</span>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${
                    loadPlanStatus === 'WAREHOUSE_ACK'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : loadPlanStatus === 'SALE_CONFIRMED'
                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                        : loadPlanStatus === 'LOADING'
                          ? 'bg-blue-50 text-blue-700 border-blue-300'
                          : 'bg-gray-100 text-gray-600 border-gray-200'
                  }`}>
                    {loadPlanStatus === 'WAREHOUSE_ACK'
                      ? '✓ คลังรับทราบแผนแล้ว'
                      : loadPlanStatus === 'SALE_CONFIRMED'
                        ? '⏳ รอคลังรับทราบแผน'
                        : loadPlanStatus === 'LOADING'
                          ? '🚚 กำลังโหลดสินค้า'
                          : loadPlanStatus === 'COMPLETED'
                            ? '✓ โหลดเสร็จสิ้น'
                            : 'แบบร่าง'}
                  </span>
                  {canSubmitPlan && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        let effectiveTripId = (trip as any)?.tripId || (trip.orders[0] as any)?.tripId;
                        if (!effectiveTripId) return;
                        setBusy(true);
                        try {
                          const res = await submitTripPlan(effectiveTripId);
                          setLoadPlanStatus(res.loadPlanStatus);
                          setLoadPlanRevision(res.loadPlanRevision);
                          await appAlert(res.message || 'ส่งแผนการโหลดให้ฝ่ายคลังสำเร็จ', 'success');
                          if (onUpdate) onUpdate();
                        } catch (err: any) {
                          await appAlert('ส่งแผนการโหลดล้มเหลว: ' + err.message, 'error');
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#0C447C] text-white hover:bg-[#082E54] flex items-center gap-1 shadow-sm"
                    >
                      <Send size={13} /> ส่งแผนโหลดให้คลัง
                    </button>
                  )}
                </div>
              </div>

              {/* Re-acknowledgement alert banner */}
              {loadPlanStatus === 'SALE_CONFIRMED' && (
                <div data-testid="load-plan-reack-alert" className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-amber-900 text-xs">
                  <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">แผนจัดของถูกแก้ไขโดยฝ่ายขาย — ต้องให้ฝ่ายคลังรับทราบใหม่ (Revision {loadPlanRevision})</span>
                    <p className="text-amber-700 mt-0.5">ฝ่ายคลังต้องตรวจสอบลำดับการขึ้นของและการแบ่งสัดส่วนแม่-ลูกก่อนเริ่มรับสินค้า</p>
                  </div>
                </div>
              )}

              {/* Capacity info banner */}
              {capacityInfo && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-blue-50/60 rounded-xl border border-blue-100 text-xs text-[#0C447C]">
                  <div>
                    <span className="font-bold">พิกัดรถ: </span>
                    <span>{capacityInfo.truckTypeName || 'รถพ่วงบรรทุก'}</span>
                    {capacityInfo.maxWeightMain != null && (
                      <span className="ml-1 text-gray-600">
                        (ตัวแม่ {capacityInfo.maxWeightMain} ตัน + ตัวลูก {capacityInfo.maxWeightTrailer} ตัน = พิกัดบรรทุก {capacityInfo.ratedCapacityTon} ตัน)
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] bg-blue-100 text-[#0C447C] px-2 py-0.5 rounded font-bold">
                    {({ VERIFIED: 'ตรงกับข้อมูลรถ', UNVERIFIED: 'ยังไม่ยืนยันประเภทรถ' } as Record<string, string>)[capacityInfo.status] || capacityInfo.status}
                  </span>
                </div>
              )}

              {/* Load plan table */}
              {loadPlanLines.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border border-gray-100 rounded-xl overflow-hidden">
                    <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                      <tr>
                        <th className="p-2 text-center w-12">ลำดับ</th>
                        <th className="p-2">เอกสาร</th>
                        <th className="p-2">สินค้า</th>
                        <th className="p-2 text-right">ตัวแม่ (ตัน)</th>
                        <th className="p-2 text-right">ตัวลูก (ตัน)</th>
                        <th className="p-2 text-right">รวม (ตัน)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loadPlanLines.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/50">
                          <td className="p-2 text-center font-mono font-bold text-gray-700">{row.step || row.loadSequence || idx + 1}</td>
                          <td className="p-2 font-mono text-[#0C447C] font-semibold">{row.docuNo || `#${row.memberId}`}</td>
                          <td className="p-2 text-gray-800 font-medium">{row.goodName}</td>
                          <td className="p-2 text-right font-mono text-gray-700">{row.split?.masterQty != null ? Number(row.split.masterQty).toFixed(2) : '-'}</td>
                          <td className="p-2 text-right font-mono text-gray-700">{row.split?.childQty != null ? Number(row.split.childQty).toFixed(2) : '-'}</td>
                          <td className="p-2 text-right font-mono font-bold text-[#0C447C]">{row.isGiveaway ? `${row.qtyPiece} ชิ้น` : Number(row.qtyTon || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Action buttons for Warehouse */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="text-xs text-gray-500">
                  {warehouseAckAt && (
                    <span>คลังรับทราบล่าสุดเมื่อ: {formatThaiDate(warehouseAckAt, true)}</span>
                  )}
                </div>
                {isWarehouseOrElevated && loadPlanStatus === 'SALE_CONFIRMED' && (
                  <button
                    type="button"
                    data-testid="btn-warehouse-ack-loadplan"
                    disabled={busy}
                    onClick={handleWarehouseAck}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 size={16} />
                    คลังรับทราบแผนจัดของ (Revision {loadPlanRevision})
                  </button>
                )}
              </div>
            </section>

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
                  const totalGiveaways = (order.lines || []).filter(l => l.isGiveaway).reduce((sum, l) => sum + giveawayPieces(l), 0);
                  const totalGrossAmt = (order.lines || []).reduce((sum, l) => sum + ((l.qtyTon * (l.pricePerTon != null ? l.pricePerTon : l.netPricePerTon)) || 0), 0);
                  const totalNetAmt = (order.lines || []).reduce((sum, l) => sum + ((l.qtyTon * l.netPricePerTon) || 0), 0);
                  const hasTicket = (order.lines || []).some(l => l.isControlTicketDrawn);
                  
                  const rebateDiscount = 0;
                  const totalNetPayable = totalGrossAmt;
                  
                  return (
                    <div key={order.id} className={`border rounded-xl shadow-sm flex flex-col ${order.truckPlate === 'ตั๋วคุม' ? 'border-purple-200 bg-purple-50' : 'border-gray-200 bg-white'}`}>
                      <div className="p-3 sm:p-4 relative flex flex-col flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <div className={`font-bold text-sm font-mono flex items-center gap-1.5 ${order.truckPlate === 'ตั๋วคุม' ? 'text-purple-800' : 'text-[#0C447C]'}`}>
                            {order.status === 'DRAFT' && !isQuoteLocked && (
                              <input
                                type="checkbox"
                                checked={selectedSoIds.has(order.id!)}
                                onChange={() => {
                                  setSelectedSoIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(order.id!)) next.delete(order.id!);
                                    else next.add(order.id!);
                                    return next;
                                  });
                                }}
                                className="w-4 h-4 rounded text-[#0C447C] focus:ring-[#0C447C] cursor-pointer mr-1"
                              />
                            )}
                            <FileText size={16} />
                            {order.wfRef || (order as any).docuNo || (order as any).importedDocuNo || `#${order.id}`}
                            {order.truckPlate === 'ตั๋วคุม' && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold">ตั๋วคุม</span>}
                            {pendingReq && <ShieldAlert size={14} className="text-red-500" />}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1.5">
                              {order.custId && order.truckPlate !== 'ตั๋วคุม' && order.status !== 'CANCELLED' && (
                                <button
                                  type="button"
                                  data-testid={`btn-bill-truck-picker-${order.id}`}
                                  disabled={busy || savingTruck || isQuoteLocked || !tripLoaded || !allDraft}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openTruckPickerForOrder(order);
                                  }}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 hover:bg-blue-200 text-[#0C447C] font-bold text-[11px] border border-blue-200 transition-colors shrink-0 shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={
                                    isQuoteLocked
                                      ? 'ต้องยืนยันหรือยกเลิกใบเสนอราคาก่อน'
                                      : !allDraft
                                        ? 'เปลี่ยนรถได้เฉพาะเที่ยวรถสถานะร่าง'
                                        : 'เลือกรถที่ลูกค้ารายนี้เคยใช้ขนส่ง (หรือระบุคันใหม่)'
                                  }
                                >
                                  <Truck size={13} className="text-[#0C447C]" />
                                  <span>เลือกรถ</span>
                                </button>
                              )}
                              <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${SO_STATUS_META[order.status]?.badgeClass || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                {soStatusLabel(displayStatus(order))}
                              </div>
                            </div>
                            {(order as any).requiresPriceApproval && (
                              <div>
                                {(order as any).priceApprovalStatus === 'APPROVED' ? (
                                  <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-300 px-1.5 py-0.5 rounded-full font-bold">✓ อนุมัติราคาแล้ว</span>
                                ) : (order as any).priceApprovalStatus === 'REJECTED' ? (
                                  <span className="text-[9px] bg-red-50 text-red-700 border border-red-300 px-1.5 py-0.5 rounded-full font-bold">✗ ปฏิเสธราคา</span>
                                ) : (
                                  <span className="text-[9px] bg-amber-50 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded-full font-bold">⏳ รออนุมัติราคา</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1 mb-2 text-xs">
                          <div className="text-gray-600 font-medium truncate" title={order.custName}>
                            ลูกค้า: <span className="font-semibold text-gray-800">{order.custId ? `[${order.custId}] ` : ''}{order.custName || '-'}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 text-[11px] text-gray-500">
                            <div>
                              เครดิต: <span className="font-semibold text-gray-700">{(order as any).creditDays != null ? `${(order as any).creditDays} วัน` : '-'}</span>
                            </div>
                            {order.deliveryDate && (
                              <div>
                                กำหนดรับ: <span className="font-semibold text-gray-700">{formatThaiDate(order.deliveryDate)}</span>
                              </div>
                            )}
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
                            <span className="text-xs font-bold text-blue-700">฿{totalGrossAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
                            {totalNetAmt > 0 && totalNetAmt !== totalGrossAmt && (
                              <span className="text-[10px] text-gray-500 font-normal ml-0.5">
                                (สุทธิ ฿{totalNetAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })})
                              </span>
                            )}
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
                              disabled={busy || !can('so.cancel')}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCancelModalConfig({ isOpen: true, order });
                              }}
                              className="flex-1 py-1.5 rounded border border-red-200 text-red-600 text-[11px] font-medium hover:bg-red-50 disabled:opacity-50"
                            >
                              ยกเลิกบิล
                            </button>
                            {onEditBill && can('so.edit') && (
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

      <SOCancelDeleteModal
        isOpen={cancelModalConfig.isOpen}
        mode="CANCEL"
        targetTitle={cancelModalConfig.order?.wfRef || (cancelModalConfig.order?.id ? `บิล #${cancelModalConfig.order.id}` : 'บิล')}
        onClose={() => setCancelModalConfig({ isOpen: false, order: null })}
        onConfirm={async (reasonCode, reasonText) => {
          if (!cancelModalConfig.order?.id) return;
          await doAction(() => cancelSO(cancelModalConfig.order!.id!, { reasonCode, reasonText }));
        }}
      />

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
            await appAlert(`ส่งคำขอ${type === 'EDIT' ? 'แก้ไข' : 'ยกเลิก'}ทั้งทริปแล้ว รออนุมัติจากหัวหน้างาน`, 'success');
            setRequestModalConfig({ isOpen: false, type: 'EDIT' });
          });
        }}
      />

      <TripSetupModal
        isOpen={isEditTripOpen}
        onClose={() => setIsEditTripOpen(false)}
        initialData={{
          tripId: trip.tripId || trip.orders[0]?.tripId,
          orderIds: (trip.tripId || trip.orders[0]?.tripId) ? undefined : trip.orders.map(o => o.id!).filter(Boolean),
          expectedRevision: tripRevision,
          truckPlate: serverPlate,
          deliveryDate: tripPickupDueDate,
          pSling: tripPreSling,
          loadInOrder: trip.orders.some(o => (o.lines || []).some((l: any) => l.loadSequence && Number(l.loadSequence) > 0)),
          remark: tripRemark
        }}
        onConfirm={handleEditTripMetadata}
      />

      {isPrinting && (
        <PaperDocModal
          soIds={trip.orders.map(o => o.id!)}
          onClose={() => setIsPrinting(false)}
        />
      )}

      {isSequencerOpen && (
        <LoadSequencer
          isOpen={isSequencerOpen}
          onClose={() => setIsSequencerOpen(false)}
          tripOrders={trip.orders.filter(o => o.status === 'DRAFT' && selectedSoIds.has(o.id!))}
          onConfirm={async (sequencedLines) => {
             setIsSequencerOpen(false);
             const draftOrders = trip.orders.filter(o => o.status === 'DRAFT');
             const selectedOrders = draftOrders.filter(o => selectedSoIds.has(o.id!));
             const effectiveTripId = (trip as any)?.tripId || (trip.orders[0] as any)?.tripId;
             
             await proceedConfirmTrip(effectiveTripId, selectedOrders, sequencedLines);
          }}
        />
      )}

      {selectedBookingSoId && (
        <SOBookingDocModal
          soId={selectedBookingSoId}
          soIds={trip.orders.map(o => o.id!)}
          onClose={() => setSelectedBookingSoId(null)}
        />
      )}

      <QuickShipModal
        isOpen={shipModalConfig.isOpen}
        onClose={() => setShipModalConfig({ isOpen: false, soIds: [] })}
        soIds={shipModalConfig.soIds}
        onSuccess={() => {
          setShipModalConfig({ isOpen: false, soIds: [] });
          if (onUpdate) onUpdate();
        }}
      />

      {truckPickerOrder && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => { if (!savingTruck) setTruckPickerOrder(null); }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col animate-in fade-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-blue-50">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-[#0C447C]" />
                <h3 className="font-bold text-[#0C447C] text-sm">
                  เลือกรถขนส่งสำหรับลูกค้า [{truckPickerOrder.custId}]
                </h3>
              </div>
              <button
                type="button"
                disabled={savingTruck}
                onClick={() => setTruckPickerOrder(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {truckPickerOrder.custName && (
                <div className="text-xs text-gray-500">
                  ลูกค้า: <span className="font-semibold text-gray-800">{truckPickerOrder.custName}</span>
                  {serverPlate && (
                    <span className="ml-2 text-[#0C447C] font-semibold">· รถปัจจุบัน: {serverPlate}</span>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  ระบุทะเบียนรถคันใหม่
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="เช่น 70-1234 กทม."
                    value={newTruckPlateInput}
                    disabled={savingTruck}
                    onChange={e => setNewTruckPlateInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newTruckPlateInput.trim()) {
                        applyTripTruckPlate(newTruckPlateInput.trim());
                      }
                    }}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-bold focus:border-[#0C447C] outline-none"
                  />
                  <button
                    type="button"
                    disabled={savingTruck || !newTruckPlateInput.trim()}
                    onClick={() => applyTripTruckPlate(newTruckPlateInput.trim())}
                    className="px-3 py-1.5 bg-[#0C447C] text-white text-xs font-bold rounded-lg hover:bg-blue-900 disabled:opacity-40 cursor-pointer"
                  >
                    {savingTruck ? 'กำลังบันทึก...' : 'ใช้คันนี้'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  ประวัติรถที่ลูกค้ารายนี้เคยใช้ ({customerTrucks.length} คัน)
                </label>
                {loadingTrucks ? (
                  <div className="py-6 text-center text-xs text-gray-400">กำลังโหลดรายการรถ...</div>
                ) : customerTrucks.length === 0 ? (
                  <div className="py-6 text-center text-xs text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    ไม่พบประวัติรถที่เคยใช้ สามารถพิมพ์ระบุทะเบียนใหม่ด้านบนได้
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {customerTrucks.map(plate => {
                      const isCurrent = plate === serverPlate;
                      return (
                        <button
                          key={plate}
                          type="button"
                          disabled={savingTruck}
                          onClick={() => applyTripTruckPlate(plate)}
                          className={`w-full text-left px-3 py-2 rounded-xl border flex items-center justify-between transition-colors group cursor-pointer disabled:opacity-40 ${
                            isCurrent
                              ? 'border-[#0C447C] bg-blue-50'
                              : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Truck size={14} className={isCurrent ? 'text-[#0C447C]' : 'text-gray-400 group-hover:text-[#0C447C]'} />
                            <span className={`font-bold text-xs ${isCurrent ? 'text-[#0C447C]' : 'text-gray-800 group-hover:text-[#0C447C]'}`}>
                              {plate}
                            </span>
                            {isCurrent && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-[#0C447C] font-semibold">กำลังใช้อยู่</span>
                            )}
                          </div>
                          <span className="text-[11px] text-blue-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                            เลือกคันนี้ →
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                type="button"
                disabled={savingTruck}
                onClick={() => setTruckPickerOrder(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
