import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  XCircle,
  Clock,
  Coins,
  AlertTriangle,
  RefreshCw,
  Bell,
  Lock,
  ArrowRightLeft,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  calculateRebatePoolOrder,
  fetchRebatePoolLedger,
  createRebatePoolLedger,
  approveRebatePoolLedger,
  rejectRebatePoolLedger,
  fetchRebatePoolCustomerQueue,
  fetchRebatePoolAlerts,
  fetchOct31StandingPrices,
  snapshotOct31StandingPrices,
  fetchRebateConversions,
  executeManualRebateConversion,
  fetchCustomers,
  fetchGoods,
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import { useCan } from '../../utils/capabilities';
import { bangkokDate, formatThaiDate } from '../../utils/date';
import { SearchableSelect, type SearchableSelectOption } from '../ui/SearchableSelect';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { appAlert, appConfirm, appPrompt } from '../ui/AppAlert';
import { RebateEvidenceQueue } from './RebateEvidenceQueue';
import type {
  EMCust,
  EMGood,
  Oct31StandingPriceItem,
  RebateCalculationResult,
  RebateConversionAlertItem,
  RebateConversionRecord,
  RebateCustomerQueue,
  RebatePoolLedgerEntry,
  RebatePricingMode,
} from '../../types';

const fmtMoney = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtTons = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const PRICING_MODE_META: Record<RebatePricingMode, { label: string; badge: string }> = {
  CASH_DISCOUNT: { label: 'ส่วนลดเงินสด (ไม่สะสม)', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
  STANDARD_LIST: { label: 'ขายเท่าราคากลาง (ไม่สะสม)', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REBATE_WITHIN_LIMIT: { label: 'ลดไม่เกิน 200 บ./ตัน', badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  REBATE_OVER_LIMIT: { label: 'ลดเกิน 200 ถึง 300 บ./ตัน (รอผู้จัดการอนุมัติ)', badge: 'bg-amber-50 text-amber-800 border-amber-200' },
  MARKUP_STANDARD: { label: 'ขายสูงกว่าราคากลาง (ส่วนเพิ่มเข้า Rebate)', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  MARKUP_EXTRA_PROFIT: { label: 'ขายสูงกว่าราคากลาง (ส่วนเกินเป็นกำไรบริษัท)', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  CASE_A_CASH_DISCOUNT: {
    label: 'Case A: ส่วนลดเงินสด (ไม่สะสม)',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  CASE_B_TIER1_AUTO: {
    label: 'Case B: ลด ≤ 200 บ./ตัน (อนุมัติอัตโนมัติ)',
    badge: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  CASE_B_TIER2_APPROVAL: {
    label: 'Case B: ลดเกิน 200 ถึง 300 บ./ตัน (รออนุมัติ ผจก.)',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  CASE_C_AT_BASE: {
    label: 'Case C: ขายเท่าราคากลาง',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  CASE_C_MARKUP_REWARD: {
    label: 'Case C+: ขายเกินราคากลาง (โบนัสเพิ่ม)',
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
};

const APPROVAL_META: Record<string, { label: string; cls: string }> = {
  NOT_REQUIRED: { label: 'อนุมัติอัตโนมัติ', cls: 'bg-gray-100 text-gray-600' },
  PENDING_MANAGER_APPROVAL: { label: 'รออนุมัติส่วนลดเกิน 200 ถึง 300 บ./ตัน', cls: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'ผู้จัดการอนุมัติแล้ว', cls: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'ไม่อนุมัติ', cls: 'bg-red-100 text-red-700' },
};

const LEDGER_STATUS_META: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'สะสมใช้งานได้', cls: 'bg-blue-50 text-blue-700' },
  READY_FOR_CONVERSION: { label: 'ครบรอบสะสม', cls: 'bg-purple-100 text-purple-800' },
  PARTIALLY_CONVERTED: { label: 'แปลงบางส่วน', cls: 'bg-indigo-50 text-indigo-700' },
  CONVERTED: { label: 'แปลงหมดแล้ว', cls: 'bg-gray-100 text-gray-500' },
  CANCELLED: { label: 'ยกเลิก', cls: 'bg-red-50 text-red-600' },
};

type SubTab = 'ledger' | 'calculator' | 'conversion';

export function RebatePoolPanel() {
  const user = useAuthStore(s => s.user);
  const can = useCan();

  // The server-provided capability list already includes all assigned roles
  // and Access As restrictions. Role-name fallbacks must not re-enable a
  // permission that an administrator explicitly removed.
  const canApproveOverLimit = can('rebate.approve-over-limit');
  const canConvert = can('rebate.convert');

  const canManageSnapshot =
    canConvert || canApproveOverLimit;

  const [subTab, setSubTab] = useState<SubTab>('ledger');
  const [customers, setCustomers] = useState<EMCust[]>([]);
  const [goods, setGoods] = useState<EMGood[]>([]);

  // Shared overview data
  const [ledger, setLedger] = useState<RebatePoolLedgerEntry[]>([]);
  const [alerts, setAlerts] = useState<RebateConversionAlertItem[]>([]);
  const [standingYear, setStandingYear] = useState<number>(new Date().getFullYear());
  const [oct31Items, setOct31Items] = useState<Oct31StandingPriceItem[]>([]);
  const [conversions, setConversions] = useState<RebateConversionRecord[]>([]);
  const [expandedConvId, setExpandedConvId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [ledgerUnavailable, setLedgerUnavailable] = useState(false);
  const [alertsUnavailable, setAlertsUnavailable] = useState(false);

  // Ledger filters
  const [filterCustId, setFilterCustId] = useState('');
  const [filterApproval, setFilterApproval] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Calculator / record state
  const [calcCustId, setCalcCustId] = useState('');
  const [calcGoodId, setCalcGoodId] = useState('');
  const [basePriceStr, setBasePriceStr] = useState('15000');
  const [sellingPriceStr, setSellingPriceStr] = useState('15000');
  const [qtyTonsStr, setQtyTonsStr] = useState('10');
  const [isCashDiscount, setIsCashDiscount] = useState(false);
  const [earnedDate, setEarnedDate] = useState(() => bangkokDate());
  const [calcDocNo, setCalcDocNo] = useState('');
  const [calcResult, setCalcResult] = useState<RebateCalculationResult | null>(null);
  const [calcErr, setCalcErr] = useState('');
  const [calcBusy, setCalcBusy] = useState(false);

  // Customer FIFO Queue & Manual Conversion state
  const [queueCustId, setQueueCustId] = useState('');
  const [queueAsOfDate, setQueueAsOfDate] = useState(() => bangkokDate());
  const [customerQueue, setCustomerQueue] = useState<RebateCustomerQueue | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [convGoodId, setConvGoodId] = useState('');
  const [convMode, setConvMode] = useState<'BAHT' | 'TONS' | 'ALL'>('BAHT');
  const [convBahtStr, setConvBahtStr] = useState('');
  const [convTonsStr, setConvTonsStr] = useState('');
  const [convMaturedOnly, setConvMaturedOnly] = useState(true);
  const [convNote, setConvNote] = useState('');
  const [convExpiryDate, setConvExpiryDate] = useState('');
  const [convBusy, setConvBusy] = useState(false);

  // Oct 31 Snapshot Modal state
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [snapEntries, setSnapEntries] = useState<
    { goodId: string; price: string; note: string }[]
  >([{ goodId: '', price: '', note: '' }]);
  const [snapBusy, setSnapBusy] = useState(false);

  useEffect(() => {
    fetchCustomers({ limit: 500 })
      .then(c => setCustomers(Array.isArray(c) ? c : []))
      .catch(() => setCustomers([]));
    fetchGoods({ forSale: true })
      .then(g => setGoods(Array.isArray(g) ? g : []))
      .catch(() => setGoods([]));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [lRows, aRows, oRes, cRows] = await Promise.all([
        fetchRebatePoolLedger({
          custId: filterCustId || undefined,
          approvalStatus: filterApproval || undefined,
          status: filterStatus || undefined,
          limit: 200,
        }).catch(() => null),
        fetchRebatePoolAlerts(standingYear).catch(() => null),
        fetchOct31StandingPrices(standingYear).catch(() => ({ standingYear, items: [] })),
        fetchRebateConversions(undefined, 100).catch(() => []),
      ]);
      setLedger(Array.isArray(lRows) ? lRows : []);
      setAlerts(Array.isArray(aRows) ? aRows : []);
      setLedgerUnavailable(lRows === null);
      setAlertsUnavailable(aRows === null);
      setOct31Items(Array.isArray(oRes?.items) ? oRes.items : []);
      setConversions(Array.isArray(cRows) ? cRows : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filterCustId, filterApproval, filterStatus, standingYear]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const loadCustomerQueue = useCallback(async (cid: string, asOf: string) => {
    if (!cid) {
      setCustomerQueue(null);
      return;
    }
    setQueueLoading(true);
    try {
      const res = await fetchRebatePoolCustomerQueue(cid, asOf || undefined);
      setCustomerQueue(res);
    } catch (e: unknown) {
      await appAlert((e as Error).message || 'โหลดคิว FIFO ไม่สำเร็จ', 'error');
      setCustomerQueue(null);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (queueCustId) {
      loadCustomerQueue(queueCustId, queueAsOfDate);
    }
  }, [queueCustId, queueAsOfDate, loadCustomerQueue]);

  const customerById = useMemo(() => {
    const m = new Map<string, EMCust>();
    for (const c of customers) m.set(String(c.CustID), c);
    return m;
  }, [customers]);

  const goodById = useMemo(() => {
    const m = new Map<string, EMGood>();
    for (const g of goods) m.set(String(g.GoodID), g);
    return m;
  }, [goods]);

  const customerOptions: SearchableSelectOption[] = useMemo(
    () =>
      customers.map(c => ({
        value: String(c.CustID),
        label: c.CustCode ? `[${c.CustCode}] ${c.CustName}` : c.CustName,
        sublabel: c.regionName || c.areaName || undefined,
        keywords: `${c.CustCode || ''} ${c.CustName} ${c.CustID}`,
      })),
    [customers]
  );

  const goodOptions: SearchableSelectOption[] = useMemo(
    () =>
      goods.map(g => ({
        value: String(g.GoodID),
        label: g.GoodCode ? `[${g.GoodCode}] ${g.GoodName}` : g.GoodName,
        sublabel: g.GoodGroupName || undefined,
        keywords: `${g.GoodCode || ''} ${g.GoodName} ${g.GoodID}`,
      })),
    [goods]
  );

  const oct31MapByGoodId = useMemo(() => {
    const m = new Map<number, Oct31StandingPriceItem>();
    for (const item of oct31Items) m.set(Number(item.goodId), item);
    return m;
  }, [oct31Items]);

  // KPI metrics
  const kpi = useMemo(() => {
    let pendingApproval = 0;
    let totalRemaining = 0;
    let totalMaturedInLedger = 0;
    for (const r of ledger) {
      if (r.approvalStatus === 'PENDING_MANAGER_APPROVAL') pendingApproval += 1;
      if (r.status !== 'CANCELLED' && r.approvalStatus !== 'REJECTED') {
        totalRemaining += Number(r.remainingAmount || 0);
      }
      if (r.status === 'READY_FOR_CONVERSION') {
        totalMaturedInLedger += Number(r.remainingAmount || 0);
      }
    }
    const alertTotal = alerts.reduce((s, a) => s + Number(a.MaturedBalance || 0), 0);
    return {
      pendingApproval,
      totalRemaining,
      totalMaturedInLedger,
      alertCount: alerts.length,
      alertTotal,
    };
  }, [ledger, alerts]);

  async function handleApproveLedger(row: RebatePoolLedgerEntry) {
    const note = await appPrompt(
      `อนุมัติรายการส่วนลด ${Math.abs(row.sellingPrice - row.basePrice).toLocaleString()} บ./ตัน ของ "${row.custName || `ลูกค้า #${row.custId}`}"?\nระบุหมายเหตุ (ไม่บังคับ):`,
      'อนุมัติตามนโยบายผู้จัดการ'
    );
    if (note === null) return;
    try {
      await approveRebatePoolLedger(row.id, note.trim() || undefined);
      await loadAll();
    } catch (e: unknown) {
      await appAlert((e as Error).message || 'อนุมัติไม่สำเร็จ', 'error');
    }
  }

  async function handleRejectLedger(row: RebatePoolLedgerEntry) {
    const note = await appPrompt(
      `ระบุเหตุผลที่ปฏิเสธรายการ "${row.custName || `ลูกค้า #${row.custId}`}" (บังคับ):`
    );
    if (note === null) return;
    if (!note.trim()) {
      await appAlert('กรุณาระบุเหตุผลในการปฏิเสธ', 'warning');
      return;
    }
    try {
      await rejectRebatePoolLedger(row.id, note.trim());
      await loadAll();
    } catch (e: unknown) {
      await appAlert((e as Error).message || 'ปฏิเสธไม่สำเร็จ', 'error');
    }
  }

  async function runPreview() {
    const basePrice = Number(basePriceStr);
    const sellingPrice = Number(sellingPriceStr);
    const qtyTons = Number(qtyTonsStr);
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      setCalcErr('ราคากลางต้องมากกว่า 0');
      setCalcResult(null);
      return null;
    }
    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
      setCalcErr('ราคาเสนอขายต้องไม่ติดลบ');
      setCalcResult(null);
      return null;
    }
    if (!Number.isFinite(qtyTons) || qtyTons <= 0) {
      setCalcErr('ปริมาณ (ตัน) ต้องมากกว่า 0');
      setCalcResult(null);
      return null;
    }
    setCalcBusy(true);
    setCalcErr('');
    try {
      const res = await calculateRebatePoolOrder({
        basePrice,
        sellingPrice,
        qtyTons,
        isCashDiscount,
      });
      setCalcResult(res);
      return res;
    } catch (e: unknown) {
      setCalcErr((e as Error).message || 'คำนวณไม่สำเร็จ');
      setCalcResult(null);
      return null;
    } finally {
      setCalcBusy(false);
    }
  }

  async function handleCreateLedger() {
    if (!calcCustId) {
      await appAlert('กรุณาเลือกลูกค้าก่อนบันทึกลง Ledger', 'warning');
      return;
    }
    const custIdNum = Number(calcCustId);
    if (!Number.isInteger(custIdNum) || custIdNum <= 0) {
      await appAlert('รหัสลูกค้าต้องเป็นตัวเลขที่ถูกต้อง', 'warning');
      return;
    }
    const preview = await runPreview();
    if (!preview) return;

    const ok = await appConfirm(
      `ยืนยันบันทึกลง Rebate Ledger?\nราคาออกบิล: ${fmtMoney(preview.invoiceUnitPrice)} บ./ตัน\nสะสม Rebate รวม: ${fmtMoney(preview.totalRebateEarned)} บาท${
        preview.requiresManagerApproval ? '\n(รายการนี้มีสถานะรออนุมัติจากผู้จัดการ)' : ''
      }`
    );
    if (!ok) return;

    const cust = customerById.get(calcCustId);
    const good = calcGoodId ? goodById.get(calcGoodId) : undefined;
    setCalcBusy(true);
    try {
      await createRebatePoolLedger({
        custId: custIdNum,
        custCode: cust?.CustCode || String(custIdNum),
        custName: cust?.CustName || undefined,
        goodId: good ? Number(good.GoodID) : undefined,
        goodCode: good?.GoodCode || undefined,
        goodName: good?.GoodName || undefined,
        qtyTons: Number(qtyTonsStr),
        basePrice: Number(basePriceStr),
        sellingPrice: Number(sellingPriceStr),
        isCashDiscount,
        earnedDate: earnedDate || undefined,
        docNo: calcDocNo.trim() || undefined,
      });
      await appAlert('บันทึกลง Rebate Pool Ledger เรียบร้อยแล้ว', 'info');
      setCalcDocNo('');
      setSubTab('ledger');
      await loadAll();
    } catch (e: unknown) {
      await appAlert((e as Error).message || 'บันทึกรายการไม่สำเร็จ', 'error');
    } finally {
      setCalcBusy(false);
    }
  }

  async function handleManualConvert() {
    if (!canConvert) {
      await appAlert('บัญชีผู้ใช้ของคุณไม่มีสิทธิ์แปลงตั๋วปุ๋ย', 'error');
      return;
    }
    if (!queueCustId) {
      await appAlert('กรุณาเลือกลูกค้า', 'warning');
      return;
    }
    if (!convGoodId) {
      await appAlert('กรุณาเลือกสินค้าปุ๋ยที่จะแปลง', 'warning');
      return;
    }
    if (!convNote.trim()) {
      await appAlert('กรุณาระบุหมายเหตุการแปลงตั๋ว (จำเป็นสำหรับการตรวจสอบ)', 'warning');
      return;
    }
    if (convExpiryDate && convExpiryDate < bangkokDate()) {
      await appAlert('วันหมดอายุต้องไม่ก่อนวันแปลง', 'warning');
      return;
    }
    const goodIdNum = Number(convGoodId);
    const standingItem = oct31MapByGoodId.get(goodIdNum);
    if (!standingItem || standingItem.basePrice <= 0) {
      await appAlert(
        `ไม่พบราคายืน ณ 31 ต.ค. ${standingYear + 543} สำหรับสินค้านี้ กรุณาบันทึก/Snapshot ราคา 31 ต.ค. ก่อน`,
        'warning'
      );
      return;
    }
    const payload: Omit<Parameters<typeof executeManualRebateConversion>[0], 'requestId'> = {
      custId: Number(queueCustId),
      goodId: goodIdNum,
      standingYear,
      maturedOnly: convMaturedOnly,
      executionMode: 'MANUAL',
      note: convNote.trim(),
      ...(convExpiryDate ? { expiryDate: convExpiryDate } : {}),
    };
    if (convMode === 'ALL') {
      payload.convertAllEligible = true;
    } else if (convMode === 'BAHT') {
      const amt = Number(convBahtStr);
      if (!Number.isFinite(amt) || amt <= 0) {
        await appAlert('ระบุจำนวนเงินที่ต้องการแปลงให้ถูกต้อง', 'warning');
        return;
      }
      payload.requestedAmountBaht = amt;
    } else {
      const tons = Number(convTonsStr);
      if (!Number.isFinite(tons) || tons <= 0) {
        await appAlert('ระบุจำนวนตันปุ๋ยที่ต้องการแปลงให้ถูกต้อง', 'warning');
        return;
      }
      payload.requestedTons = tons;
    }

    const ok = await appConfirm(
      `ยืนยันการแปลงตั๋วปุ๋ยแบบ FIFO (Manual)\nสินค้า: ${standingItem.goodName || goodIdNum}\nราคายืน 31 ต.ค.: ${fmtMoney(standingItem.basePrice)} บ./ตัน\nวันหมดอายุ: ${convExpiryDate || 'ตามค่าเริ่มต้นของระบบ'}\n\nหมายเหตุ: ระบบจะตัดยอดจากรายการสะสมเก่าที่สุดก่อนเสมอ`
    );
    if (!ok) return;

    setConvBusy(true);
    try {
      // Persist only a hash and random request ID, scoped to both identities.
      // If the response is lost, the same form can be retried after a reload
      // without deducting again. Do not send if session storage is unavailable.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
      const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const attemptKey = `wf-rebate-conversion:${user?.actorId || user?.id}:${user?.id}:${fingerprint}`;
      let requestId = sessionStorage.getItem(attemptKey);
      if (!requestId) {
        requestId = crypto.randomUUID();
        sessionStorage.setItem(attemptKey, requestId);
      }
      const res = await executeManualRebateConversion({ ...payload, requestId });
      sessionStorage.removeItem(attemptKey);
      await appAlert(
        `แปลงตั๋วปุ๋ยสำเร็จ (${res.conversion.conversionNo})\nจำนวน ${fmtTons(res.conversion.convertedTons)} ตัน · ตัดยอด ${fmtMoney(res.conversion.convertedValueBaht)} บาท\nหมดอายุ ${res.ticket.expiryDate}`,
        'info'
      );
      setConvNote('');
      setConvBahtStr('');
      setConvTonsStr('');
      setConvExpiryDate('');
      await Promise.all([loadAll(), loadCustomerQueue(queueCustId, queueAsOfDate)]);
    } catch (e: unknown) {
      await appAlert((e as Error).message || 'แปลงตั๋วปุ๋ยไม่สำเร็จ', 'error');
    } finally {
      setConvBusy(false);
    }
  }

  async function handleSaveSnapshot(autoFromPricelist: boolean) {
    setSnapBusy(true);
    try {
      if (autoFromPricelist) {
        const res = await snapshotOct31StandingPrices({ standingYear });
        await appAlert(`Snapshot ราคา 31 ต.ค. ${standingYear + 543} จาก Pricelist สำเร็จ ${res.count} รายการ`, 'info');
      } else {
        const entries = snapEntries
          .filter(r => r.goodId && Number(r.price) > 0)
          .map(r => {
            const g = goodById.get(r.goodId);
            return {
              goodId: Number(r.goodId),
              goodCode: g?.GoodCode || undefined,
              goodName: g?.GoodName || undefined,
              basePrice: Number(r.price),
              note: r.note.trim() || undefined,
            };
          });
        if (entries.length === 0) {
          await appAlert('กรุณาระบุสินค้าและราคาอย่างน้อย 1 รายการ', 'warning');
          setSnapBusy(false);
          return;
        }
        const res = await snapshotOct31StandingPrices({ standingYear, entries });
        await appAlert(`บันทึกราคา 31 ต.ค. ${standingYear + 543} สำเร็จ ${res.count} รายการ`, 'info');
      }
      setShowSnapshotModal(false);
      await loadAll();
    } catch (e: unknown) {
      await appAlert((e as Error).message || 'บันทึก Snapshot ไม่สำเร็จ', 'error');
    } finally {
      setSnapBusy(false);
    }
  }

  const selectedOct31Price = convGoodId ? oct31MapByGoodId.get(Number(convGoodId)) : undefined;
  const estConversionPreview = useMemo(() => {
    if (!selectedOct31Price || selectedOct31Price.basePrice <= 0) return null;
    const price = selectedOct31Price.basePrice;
    if (convMode === 'ALL' && customerQueue) {
      const baht = convMaturedOnly
        ? customerQueue.maturedBalance
        : customerQueue.totalFifoEligibleBalance;
      return { baht, tons: baht / price };
    }
    if (convMode === 'BAHT') {
      const baht = Number(convBahtStr) || 0;
      return baht > 0 ? { baht, tons: baht / price } : null;
    }
    const tons = Number(convTonsStr) || 0;
    return tons > 0 ? { baht: tons * price, tons } : null;
  }, [selectedOct31Price, convMode, convBahtStr, convTonsStr, convMaturedOnly, customerQueue]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
      {can('rebate.evidence.verify') && <RebateEvidenceQueue />}
      {(ledgerUnavailable || alertsUnavailable) && <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        ข้อมูลยอดหรือการแจ้งเตือนบางส่วนยังไม่พร้อมแสดง กรุณาอย่าใช้ตัวเลขในส่วนที่ไม่พร้อมเป็นยอดคงเหลือ
      </p>}
      {/* KPI + Alert Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="text-xs text-gray-400 flex items-center gap-1.5">
            <Coins size={14} className="text-[#0C447C]" /> ยอดจาก Ledger เดิม (ไม่ใช่ยอดคงเหลือที่ใช้เคลม)
          </div>
          <div className="text-xl font-black text-[#0C447C] tabular-nums mt-1">
            {ledgerUnavailable ? 'ไม่พร้อมแสดง' : `฿${fmtMoney(kpi.totalRemaining)}`}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">{ledgerUnavailable ? 'โหลดข้อมูลไม่สำเร็จ' : `${ledger.length} รายการในตาราง`}</div>
        </div>

        <div className="bg-white rounded-xl border border-amber-200 p-4 shadow-sm">
          <div className="text-xs text-amber-700 flex items-center gap-1.5 font-semibold">
            <Clock size={14} /> รออนุมัติส่วนลดเกิน 200 ถึง 300 บ./ตัน
          </div>
          <div className="text-xl font-black text-amber-700 tabular-nums mt-1">
            {ledgerUnavailable ? 'ไม่พร้อมแสดง' : `${kpi.pendingApproval} รายการ`}
          </div>
          <div className="text-[11px] text-amber-600 mt-0.5">
            {canApproveOverLimit ? 'คุณมีสิทธิ์อนุมัติ / ปฏิเสธ' : 'รอ MANAGER / C_LEVEL / ADMIN'}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-purple-200 p-4 shadow-sm">
          <div className="text-xs text-purple-700 flex items-center gap-1.5 font-semibold">
            <Bell size={14} /> ยอดครบกำหนด 1 พ.ย. (ปี {standingYear + 543})
          </div>
          <div className="text-xl font-black text-purple-700 tabular-nums mt-1">
            {alertsUnavailable ? 'ไม่พร้อมแสดง' : `${kpi.alertCount} ลูกค้า · ฿${fmtMoney(kpi.alertTotal)}`}
          </div>
          <div className="text-[11px] text-purple-600 mt-0.5">
            พร้อมแปลงตั๋วปุ๋ยแบบ Manual (FIFO)
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col justify-between">
          <div className="text-xs text-gray-500 font-semibold">เกณฑ์นโยบายปัจจุบัน</div>
          <div className="text-[11px] text-gray-600 space-y-0.5 mt-1">
            <div>· สะสมอัตโนมัติ: ส่วนลด ≤ 200 บ./ตัน</div>
            <div>· ขออนุมัติ ผจก.: ส่วนลดเกิน 200 ถึง 300 บ./ตัน</div>
            <div>· รอบตัด FIFO: 1 พ.ย. ใช้ราคา 31 ต.ค.</div>
          </div>
        </div>
      </div>

      {/* Sub-navigation bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-2 flex flex-wrap items-center justify-between gap-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab('ledger')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              subTab === 'ledger' ? 'bg-[#0C447C] text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Clock size={14} /> Ledger &amp; อนุมัติ (-200..-300)
            {kpi.pendingApproval > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-400 text-amber-950 font-black">
                {kpi.pendingApproval}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('calculator')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              subTab === 'calculator' ? 'bg-[#0C447C] text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Calculator size={14} /> คำนวณราคา &amp; บันทึกสะสม
          </button>
          <button
            type="button"
            onClick={() => setSubTab('conversion')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              subTab === 'conversion' ? 'bg-[#0C447C] text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <ArrowRightLeft size={14} /> คิว FIFO · ราคา 31 ต.ค. · แปลงตั๋วปุ๋ย
          </button>
        </div>
        <button
          type="button"
          onClick={loadAll}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> รีเฟรช
        </button>
      </div>

      {/* TAB 1: LEDGER & APPROVALS */}
      {subTab === 'ledger' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-4">
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            Ledger เดิมเป็นข้อมูลแยก ไม่ใช่ยอดที่ใช้เคลมหรือแปลงตั๋ว ให้ดูยอดจริงที่คิว FIFO; การอนุมัติรายการชุดเดิมอยู่ระหว่างเชื่อมระบบ
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">กรองตามลูกค้า</label>
              <SearchableSelect
                options={customerOptions}
                value={filterCustId}
                onChange={setFilterCustId}
                placeholder="-- ลูกค้าทั้งหมด --"
                searchPlaceholder="ค้นหารหัสหรือชื่อร้านค้า..."
                allowClear
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">สถานะการอนุมัติส่วนลดเกิน 200 ถึง 300 บ./ตัน</label>
              <select
                value={filterApproval}
                onChange={e => setFilterApproval(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">-- ทั้งหมด --</option>
                <option value="PENDING_MANAGER_APPROVAL">รออนุมัติผู้จัดการ (PENDING)</option>
                <option value="APPROVED">ผู้จัดการอนุมัติแล้ว (APPROVED)</option>
                <option value="REJECTED">ไม่อนุมัติ (REJECTED)</option>
                <option value="NOT_REQUIRED">อนุมัติอัตโนมัติ (NOT_REQUIRED)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">สถานะยอด FIFO</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">-- ทั้งหมด --</option>
                <option value="ACTIVE">สะสมใช้งานได้ (ACTIVE)</option>
                <option value="READY_FOR_CONVERSION">ครบรอบสะสม</option>
                <option value="PARTIALLY_CONVERTED">แปลงบางส่วน</option>
                <option value="CONVERTED">แปลงหมดแล้ว</option>
                <option value="CANCELLED">ยกเลิก</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100 whitespace-nowrap">
                  <th className="text-left py-2 px-2">วันที่ / เอกสาร</th>
                  <th className="text-left py-2 px-2">ลูกค้า</th>
                  <th className="text-left py-2 px-2">สินค้า · ปริมาณ</th>
                  <th className="text-right py-2 px-2">กลาง / ขาย / บิล</th>
                  <th className="text-left py-2 px-2">โหมดราคา</th>
                  <th className="text-right py-2 px-2">สะสม / คงเหลือ FIFO</th>
                  <th className="text-center py-2 px-2">ครบกำหนด</th>
                  <th className="text-center py-2 px-2">สถานะอนุมัติ &amp; FIFO</th>
                  <th className="text-right py-2 px-2">ดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ledger.map(row => {
                  const modeMeta = PRICING_MODE_META[row.pricingMode];
                  const appMeta = APPROVAL_META[row.approvalStatus] || {
                    label: row.approvalStatus,
                    cls: 'bg-gray-100 text-gray-600',
                  };
                  const stMeta = LEDGER_STATUS_META[row.status] || {
                    label: row.status,
                    cls: 'bg-gray-100 text-gray-600',
                  };
                  const isPending = row.approvalStatus === 'PENDING_MANAGER_APPROVAL';
                  return (
                    <tr key={row.id} className={isPending ? 'bg-amber-50/40' : ''}>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <div className="font-semibold text-gray-800">{formatThaiDate(row.earnedDate)}</div>
                        <div className="text-[11px] font-mono text-gray-400">{row.docNo || `#${row.id}`}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="font-semibold text-gray-800">
                          {row.custCode ? `[${row.custCode}] ` : ''}{row.custName || `ลูกค้า #${row.custId}`}
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="text-gray-700">{row.goodName || (row.goodId ? `#${row.goodId}` : '-')}</div>
                        <div className="text-[11px] text-gray-400 tabular-nums">{fmtTons(row.qtyTons)} ตัน</div>
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">
                        <div className="text-gray-500">กลาง {fmtMoney(row.basePrice)} · ขาย {fmtMoney(row.sellingPrice)}</div>
                        <div className="font-bold text-[#0C447C]">ออกบิล {fmtMoney(row.invoiceUnitPrice)}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ${modeMeta?.badge || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                          {modeMeta?.label || row.pricingMode}
                        </span>
                        {row.companyExtraProfitPerTon > 0 && (
                          <div className="text-[10px] text-indigo-700 mt-0.5">
                            +กำไรส่วนเกิน ฿{fmtMoney(row.companyExtraProfitPerTon)}/ตัน
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">
                        <div className="text-gray-500">สะสม ฿{fmtMoney(row.totalRebateEarned)}</div>
                        <div className="font-black text-green-700">คงเหลือ ฿{fmtMoney(row.remainingAmount)}</div>
                      </td>
                      <td className="py-2.5 px-2 text-center whitespace-nowrap text-gray-600">
                        {formatThaiDate(row.cycleExpiryDate)}
                      </td>
                      <td className="py-2.5 px-2 text-center space-y-1">
                        <div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${appMeta.cls}`}>
                            {appMeta.label}
                          </span>
                        </div>
                        <div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${stMeta.cls}`}>
                            {stMeta.label}
                          </span>
                        </div>
                        {row.approvalNote && (
                          <div className="text-[10px] text-gray-400 max-w-[160px] truncate mx-auto" title={row.approvalNote}>
                            {row.approvalNote}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {isPending && canApproveOverLimit && (
                            <>
                              <button
                                type="button"
                                disabled
                                onClick={() => handleApproveLedger(row)}
                                className="px-2 py-1 rounded bg-green-600 text-white text-[11px] font-bold hover:bg-green-700 flex items-center gap-1"
                              >
                                <CheckCircle2 size={12} /> อนุมัติ
                              </button>
                              <button
                                type="button"
                                disabled
                                onClick={() => handleRejectLedger(row)}
                                className="px-2 py-1 rounded bg-red-600 text-white text-[11px] font-bold hover:bg-red-700 flex items-center gap-1"
                              >
                                <XCircle size={12} /> ปฏิเสธ
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setQueueCustId(String(row.custId));
                              setSubTab('conversion');
                            }}
                            className="px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 text-[11px] font-semibold"
                          >
                            คิว FIFO
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {ledger.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-gray-400">
                      ไม่พบรายการ Rebate Ledger ตามเงื่อนไขที่เลือก
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: CALCULATOR PREVIEW & RECORD */}
      {subTab === 'calculator' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-black text-[#0C447C] flex items-center gap-2">
              <Calculator size={16} /> กรอกข้อมูลคำนวณราคาออกบิล &amp; สะสม Rebate
            </h2>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                ลูกค้า (จำเป็นเมื่อบันทึกลง Ledger)
              </label>
              <SearchableSelect
                options={customerOptions}
                value={calcCustId}
                onChange={setCalcCustId}
                placeholder="-- ค้นหาลูกค้า --"
                searchPlaceholder="พิมพ์รหัสหรือชื่อร้านค้า..."
                allowClear
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">สินค้าปุ๋ย (ไม่บังคับ)</label>
              <SearchableSelect
                options={goodOptions}
                value={calcGoodId}
                onChange={val => {
                  setCalcGoodId(val);
                  const g = goodById.get(val);
                  const p = Number(g?.SetPrice || g?.GoodPrice || g?.GoodPrice1 || 0);
                  if (p > 0) {
                    setBasePriceStr(String(p));
                    setSellingPriceStr(String(p));
                  }
                }}
                placeholder="-- ค้นหาสินค้าปุ๋ย --"
                searchPlaceholder="พิมพ์รหัส หรือสูตรปุ๋ย..."
                allowClear
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">ราคากลาง (บ./ตัน) *</label>
                <input
                  type="number"
                  min={0}
                  value={basePriceStr}
                  onChange={e => setBasePriceStr(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">ราคาเสนอขาย (บ./ตัน) *</label>
                <input
                  type="number"
                  min={0}
                  value={sellingPriceStr}
                  onChange={e => setSellingPriceStr(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">จำนวน (ตัน) *</label>
                <input
                  type="number"
                  min={0.01}
                  step="0.5"
                  value={qtyTonsStr}
                  onChange={e => setQtyTonsStr(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums"
                />
              </div>
            </div>

            <label className="flex items-start gap-2.5 p-3 rounded-lg bg-sky-50/70 border border-sky-200 cursor-pointer">
              <input
                type="checkbox"
                checked={isCashDiscount}
                onChange={e => setIsCashDiscount(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-[#0C447C]"
              />
              <div className="text-xs">
                <div className="font-bold text-sky-900">ใช้เป็นส่วนลดเงินสดหน้าบิล (Case A)</div>
                <div className="text-sky-700">ลดราคาออกบิลทันทีตามราคาเสนอขาย แต่ไม่สะสมเข้า Rebate Pool</div>
              </div>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">วันที่มีรายการสะสม</label>
                <ThaiDatePicker value={earnedDate} onChange={setEarnedDate} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">เลขที่เอกสารอ้างอิง (ถ้ามี)</label>
                <input
                  type="text"
                  value={calcDocNo}
                  onChange={e => setCalcDocNo(e.target.value)}
                  placeholder="เช่น I69-XXXXX"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={calcBusy}
                onClick={runPreview}
                className="px-4 py-2 rounded-lg border border-[#0C447C] text-[#0C447C] text-xs font-bold hover:bg-blue-50 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Calculator size={14} /> ทดลองคำนวณ
              </button>
              <button
                type="button"
                disabled
                onClick={handleCreateLedger}
                className="px-4 py-2 rounded-lg bg-[#0C447C] text-white text-xs font-bold hover:bg-[#09345f] disabled:opacity-50 flex items-center gap-1.5"
              >
                <Plus size={14} /> การบันทึก Ledger เดิมยังไม่พร้อม
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex flex-col justify-between">
            <div>
              <h2 className="text-sm font-black text-[#0C447C] mb-3">ผลการคำนวณตามนโยบาย Rebate Pool</h2>
              {calcErr && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2 mb-3">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>{calcErr}</span>
                </div>
              )}
              {calcResult ? (
                <div className="space-y-3 text-xs">
                  <div>
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full border font-bold ${
                        PRICING_MODE_META[calcResult.pricingMode]?.badge || 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {PRICING_MODE_META[calcResult.pricingMode]?.label || calcResult.pricingMode}
                    </span>
                  </div>

                  {calcResult.requiresManagerApproval && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-start gap-2">
                      <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold">ต้องขออนุมัติผู้จัดการ (ส่วนลดเกิน 200 ถึง 300 บ./ตัน)</div>
                        <div>
                          ส่วนเกินจากเกณฑ์ 200 บ./ตัน = {fmtMoney(calcResult.excessApprovalAmount)} บ./ตัน
                          (รวม {fmtMoney(calcResult.totalExcessApprovalAmount)} บาท)
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                      <div className="text-gray-500">ราคาออกบิล (Invoice Price)</div>
                      <div className="text-lg font-black text-[#0C447C] tabular-nums mt-0.5">
                        ฿{fmtMoney(calcResult.invoiceUnitPrice)} <span className="text-xs font-normal">/ ตัน</span>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                      <div className="text-gray-600">สะสม Rebate / ตัน</div>
                      <div className="text-lg font-black text-emerald-700 tabular-nums mt-0.5">
                        ฿{fmtMoney(calcResult.rebatePerTon)} <span className="text-xs font-normal">/ ตัน</span>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                      <div className="text-gray-600">ยอดสะสม Rebate รวม</div>
                      <div className="text-lg font-black text-emerald-800 tabular-nums mt-0.5">
                        ฿{fmtMoney(calcResult.totalRebateEarned)}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200">
                      <div className="text-gray-600">กำไรส่วนเกินบริษัท (+&gt;200)</div>
                      <div className="text-lg font-black text-indigo-800 tabular-nums mt-0.5">
                        ฿{fmtMoney(calcResult.totalCompanyExtraProfit)}
                        <span className="text-[11px] font-normal ml-1">
                          ({fmtMoney(calcResult.companyExtraProfitPerTon)}/ตัน)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-gray-400 text-xs">
                  กด &quot;ทดลองคำนวณ&quot; เพื่อดูราคาออกบิล ยอดสะสม Rebate และเงื่อนไขการอนุมัติ
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-500 space-y-1">
              <div>• Case A (ส่วนลดเงินสด): ออกบิลตามราคาเสนอขาย · สะสม = 0</div>
              <div>• Case B (ลดไม่เกิน 200 บ./ตัน): ออกบิลที่ราคากลาง · สะสมเท่ากับส่วนต่างระหว่างราคากลางกับราคาขาย</div>
              <div>• Case B2 (ลดเกิน 200 ถึง 300 บ./ตัน): ออกบิลที่ราคากลาง · สะสมเท่ากับส่วนต่าง · รอผู้จัดการอนุมัติ</div>
              <div>• Case C (ขายตั้งแต่ราคากลาง): ออกบิลตามราคาขาย · สะสมส่วนเพิ่มไม่เกิน 200 บ./ตัน ส่วนที่เกินเป็นกำไรบริษัท</div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: FIFO QUEUE + NOV 1 ALERTS + OCT 31 STANDING PRICES + MANUAL CONVERSION */}
      {subTab === 'conversion' && (
        <div className="space-y-4">
          {/* Nov 1 Conversion Alerts */}
          <div className="bg-white rounded-xl border border-purple-200 p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-purple-700" />
                <h2 className="text-sm font-black text-purple-900">
                  ยอดลูกค้าครบกำหนด 1 พฤศจิกายน (ปี {standingYear + 543})
                </h2>
              </div>
              <span className="text-xs text-purple-700">คำนวณจากยอด WinSpeed ที่เหลือ ณ วันที่ 1 พ.ย.</span>
            </div>
            {alerts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {alerts.map(a => (
                  <button
                    key={a.Id}
                    type="button"
                    onClick={() => setQueueCustId(String(a.CustId))}
                    className={`text-left p-3 rounded-lg border transition-all ${
                      String(a.CustId) === queueCustId
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-gray-200 hover:border-purple-400'
                    }`}
                  >
                    <div className="text-xs font-bold text-gray-800 truncate">
                      {a.CustCode ? `[${a.CustCode}] ` : ''}{a.CustName || `ลูกค้า #${a.CustId}`}
                    </div>
                    <div className="flex items-center justify-between text-[11px] mt-1">
                      <span className="text-purple-700 font-black tabular-nums">
                        ฿{fmtMoney(a.MaturedBalance)}
                      </span>
                      <span className="text-gray-400">{a.LedgerCount} รายการ</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">ไม่พบยอดครบกำหนดรอบ 1 พ.ย. สำหรับปีนี้</p>
            )}
          </div>

          {/* Customer Queue + Manual Conversion Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7 bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    เลือกลูกค้าเพื่อดูคิว FIFO
                  </label>
                  <SearchableSelect
                    options={customerOptions}
                    value={queueCustId}
                    onChange={setQueueCustId}
                    placeholder="-- ค้นหาลูกค้า --"
                    searchPlaceholder="พิมพ์รหัสหรือชื่อลูกค้า..."
                    allowClear
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">ณ วันที่ (As Of)</label>
                  <ThaiDatePicker value={queueAsOfDate} onChange={setQueueAsOfDate} />
                </div>
              </div>

              {queueLoading ? (
                <div className="py-8 text-center text-xs text-gray-400">กำลังโหลดคิว FIFO...</div>
              ) : customerQueue ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-purple-50 border border-purple-200">
                      <div className="text-[11px] text-purple-700">ครบรอบ ณ วันที่เลือก</div>
                      <div className="font-black text-purple-900 tabular-nums mt-0.5">
                        ฿{fmtMoney(customerQueue.maturedBalance)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200">
                      <div className="text-[11px] text-blue-700">สะสมยังไม่ครบกำหนด</div>
                      <div className="font-black text-blue-900 tabular-nums mt-0.5">
                        ฿{fmtMoney(customerQueue.activeUnmaturedBalance)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                      <div className="text-[11px] text-emerald-700">รวมตัด FIFO ได้</div>
                      <div className="font-black text-emerald-900 tabular-nums mt-0.5">
                        ฿{fmtMoney(customerQueue.totalFifoEligibleBalance)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                      <div className="text-[11px] text-amber-700">ล็อตที่ยังไม่มีแผน</div>
                      <div className="font-black text-amber-900 tabular-nums mt-0.5">
                        {customerQueue.withoutPlanCount} รายการ (ยังไม่รวมในยอด)
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-gray-500">ยอดยกมา ฿{fmtMoney(customerQueue.openingEligibleBalance)} รวมอยู่ในยอด FIFO แล้ว · แสดงรายละเอียดไม่เกิน {customerQueue.detailLimit} รายการตามลำดับ FIFO</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-100 whitespace-nowrap">
                          <th className="text-left py-2">ลำดับ FIFO</th>
                          <th className="text-left py-2">วันที่สะสม</th>
                          <th className="text-left py-2">เอกสาร</th>
                          <th className="text-left py-2">ครบกำหนด</th>
                          <th className="text-right py-2">คงเหลือ (บาท)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {customerQueue.eligibleLedgers.map((l, idx) => (
                          <tr key={l.id}>
                            <td className="py-2 font-mono text-[11px] text-[#0C447C] font-bold">#{idx + 1}</td>
                            <td className="py-2">{formatThaiDate(l.earnedDate)}</td>
                            <td className="py-2 text-gray-500">{l.docNo || `#${l.id}`}</td>
                            <td className="py-2">{formatThaiDate(l.cycleExpiryDate)}</td>
                            <td className="py-2 text-right font-bold tabular-nums text-emerald-700">
                              ฿{fmtMoney(l.remainingAmount)}
                            </td>
                          </tr>
                        ))}
                        {customerQueue.eligibleLedgers.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-gray-400">
                              ไม่มีรายละเอียดล็อตในช่วงวันเริ่มข้อมูล (อาจมียอดยกมาในยอดรวม)
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="py-10 text-center text-xs text-gray-400">
                  เลือกลูกค้าเพื่อแสดงคิว FIFO (เข้าก่อน-ออกก่อน)
                </div>
              )}
            </div>

            {/* Manual Conversion Execution Panel */}
            <div className="lg:col-span-5 bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-[#0C447C] flex items-center gap-1.5">
                  <ArrowRightLeft size={15} /> แปลงยอดเป็นตั๋วปุ๋ย (Manual เท่านั้น)
                </h3>
                {!canConvert && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-semibold">
                    <Lock size={10} /> เฉพาะผู้มีสิทธิ์
                  </span>
                )}
              </div>

              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                นโยบาย: ระบบไม่อนุญาต Auto-Convert ต้องดำเนินการแบบ Manual ด้วยราคายืน ณ วันที่ 31 ต.ค. และตัด FIFO จากยอดสะสมเก่าสุดก่อนเสมอ
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">สินค้าปุ๋ยที่รับ *</label>
                  <SearchableSelect
                    options={goodOptions}
                    value={convGoodId}
                    onChange={setConvGoodId}
                    placeholder="-- เลือกสินค้าปุ๋ย --"
                    searchPlaceholder="ค้นหารหัสหรือสูตรปุ๋ย..."
                    disabled={!canConvert}
                    allowClear
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">ปีราคา 31 ต.ค.</label>
                  <input
                    type="number"
                    value={standingYear}
                    onChange={e => setStandingYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>

              {convGoodId && (
                <div
                  className={`p-2.5 rounded-lg border text-xs ${
                    selectedOct31Price
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  {selectedOct31Price ? (
                    <>
                      ราคายืน 31 ต.ค. {standingYear + 543}:{' '}
                      <strong className="tabular-nums">฿{fmtMoney(selectedOct31Price.basePrice)} / ตัน</strong>
                    </>
                  ) : (
                    <>ไม่พบราคายืน 31 ต.ค. {standingYear + 543} ของสินค้านี้ (กรุณา Snapshot ก่อน)</>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">รูปแบบการระบุจำนวน</label>
                <div className="grid grid-cols-3 gap-1.5 text-xs">
                  {(
                    [
                      ['BAHT', 'ตามจำนวนเงิน'],
                      ['TONS', 'ตามจำนวนตัน'],
                      ['ALL', 'แปลงทั้งหมด'],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      disabled={!canConvert}
                      onClick={() => setConvMode(m)}
                      className={`py-1.5 px-2 rounded-lg border font-semibold ${
                        convMode === m
                          ? 'bg-[#0C447C] text-white border-[#0C447C]'
                          : 'bg-white text-gray-600 border-gray-200'
                      } disabled:opacity-50`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {convMode === 'BAHT' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">จำนวนเงินที่แปลง (บาท) *</label>
                  <input
                    type="number"
                    min={0}
                    disabled={!canConvert}
                    value={convBahtStr}
                    onChange={e => setConvBahtStr(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums disabled:bg-gray-50"
                  />
                </div>
              )}
              {convMode === 'TONS' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">จำนวนปุ๋ย (ตัน) *</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    disabled={!canConvert}
                    value={convTonsStr}
                    onChange={e => setConvTonsStr(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums disabled:bg-gray-50"
                  />
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={convMaturedOnly}
                  disabled={!canConvert}
                  onChange={e => setConvMaturedOnly(e.target.checked)}
                />
                ตัดเฉพาะยอดที่ครบระยะเวลาสะสม (Matured Only)
              </label>

              {estConversionPreview && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs flex justify-between">
                  <span>ประมาณการตัด FIFO:</span>
                  <span className="font-bold text-[#0C447C] tabular-nums">
                    {fmtTons(estConversionPreview.tons)} ตัน (฿{fmtMoney(estConversionPreview.baht)})
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">วันหมดอายุตั๋ว</label>
                <input type="date" min={bangkokDate()} value={convExpiryDate} disabled={!canConvert}
                  onChange={e => setConvExpiryDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" />
                <p className="text-[11px] text-gray-500 mt-1">เว้นว่างเพื่อใช้ค่าเริ่มต้นของระบบ (เริ่มต้น 90 วันนับจากวันแปลง)</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">หมายเหตุการออกตั๋วปุ๋ย *</label>
                <input
                  type="text"
                  disabled={!canConvert}
                  value={convNote}
                  onChange={e => setConvNote(e.target.value)}
                  placeholder="ระบุเลขอ้างอิงหรือรายละเอียดการอนุมัติ Manual"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
                />
              </div>

              <button
                type="button"
                disabled={!canConvert || convBusy || !queueCustId}
                onClick={handleManualConvert}
                className="w-full py-2.5 rounded-xl bg-[#0C447C] text-white text-xs font-bold hover:bg-[#09345f] disabled:opacity-50"
              >
                {convBusy
                  ? 'กำลังแปลงตั๋ว...'
                  : canConvert
                  ? 'ยืนยันแปลงเป็นตั๋วปุ๋ย (FIFO Manual)'
                  : 'จำกัดสิทธิ์เฉพาะ ACCOUNTING / REBATE_CONVERTER / ADMIN'}
              </button>
            </div>
          </div>

          {/* Oct 31 Standing Prices Table */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-black text-[#0C447C]">
                ราคายืน ณ วันที่ 31 ตุลาคม (ปี {standingYear + 543} · {oct31Items.length} รายการ)
              </h3>
              {canManageSnapshot && (
                <button
                  type="button"
                  onClick={() => setShowSnapshotModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-[#0C447C] text-white text-xs font-bold hover:bg-[#09345f] flex items-center gap-1.5"
                >
                  <Plus size={14} /> บันทึก / Snapshot ราคา 31 ต.ค.
                </button>
              )}
            </div>
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-gray-400 border-b border-gray-100 whitespace-nowrap">
                    <th className="text-left py-2">รหัส / ชื่อสินค้า</th>
                    <th className="text-right py-2">ราคายืน 31 ต.ค. (บ./ตัน)</th>
                    <th className="text-center py-2">แหล่งที่มา</th>
                    <th className="text-left py-2">ผู้บันทึก</th>
                    <th className="text-left py-2">วันที่บันทึก</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {oct31Items.map(item => (
                    <tr key={item.id}>
                      <td className="py-2 font-medium text-gray-800">
                        {item.goodCode ? `[${item.goodCode}] ` : ''}{item.goodName || `#${item.goodId}`}
                      </td>
                      <td className="py-2 text-right font-black tabular-nums text-[#0C447C]">
                        ฿{fmtMoney(item.basePrice)}
                      </td>
                      <td className="py-2 text-center">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
                          {item.sourceType}
                        </span>
                      </td>
                      <td className="py-2 text-gray-600">{item.capturedByUserId ? `#${item.capturedByUserId}` : '-'}</td>
                      <td className="py-2 text-gray-500">{formatThaiDate(item.capturedAt, true)}</td>
                    </tr>
                  ))}
                  {oct31Items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-gray-400">
                        ยังไม่มีราคายืน 31 ต.ค. สำหรับปี {standingYear + 543}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Conversion History */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
            <h3 className="text-sm font-black text-[#0C447C]">
              ประวัติการแปลงตั๋วปุ๋ย FIFO ({conversions.length} รายการ)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100 whitespace-nowrap">
                    <th className="text-left py-2">เลขที่แปลงตั๋ว</th>
                    <th className="text-left py-2">ลูกค้า</th>
                    <th className="text-left py-2">สินค้า · ราคายืน</th>
                    <th className="text-right py-2">จำนวนตัน</th>
                    <th className="text-right py-2">ตัดยอดเงิน (บาท)</th>
                    <th className="text-left py-2">ผู้ดำเนินการ</th>
                    <th className="text-right py-2">รายละเอียด FIFO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {conversions.map(c => (
                      <Fragment key={c.id}>
                        <tr>
                          <td className="py-2.5 font-mono text-[11px] font-bold text-[#0C447C]">
                            {c.conversionNo}
                            <div className="text-[10px] font-sans font-normal text-gray-400">
                              {formatThaiDate(c.convertedAt, true)}
                            </div>
                          </td>
                          <td className="py-2.5 font-semibold text-gray-800">
                            {c.custCode ? `[${c.custCode}] ` : ''}{c.custName || `ลูกค้า #${c.custId}`}
                          </td>
                          <td className="py-2.5">
                            <div>{c.goodCode ? `[${c.goodCode}] ` : ''}{c.goodName || `#${c.goodId}`}</div>
                            <div className="text-[11px] text-gray-400 tabular-nums">
                              ราคา 31 ต.ค. ({c.standingYear + 543}): ฿{fmtMoney(c.standingPricePerTon)}/ตัน
                            </div>
                          </td>
                          <td className="py-2.5 text-right font-bold tabular-nums text-emerald-700">
                            {fmtTons(c.convertedTons)} ตัน
                          </td>
                          <td className="py-2.5 text-right font-bold tabular-nums text-[#0C447C]">
                            ฿{fmtMoney(c.convertedValueBaht)}
                          </td>
                          <td className="py-2.5 text-gray-600">
                            <div>{c.convertedByUserId ? `#${c.convertedByUserId}` : '-'}</div>
                            {c.note && <div className="text-[10px] text-gray-400">{c.note}</div>}
                          </td>
                          <td className="py-2.5 text-right">
                            <button type="button" onClick={() => setExpandedConvId(expandedConvId === c.id ? null : c.id)}
                              className="px-2 py-1 rounded border border-gray-200 text-[11px] text-gray-600 hover:bg-gray-50">
                              {expandedConvId === c.id ? 'ซ่อน' : 'ดู'} รายการที่แสดงได้ ({c.allocations.length})
                            </button>
                          </td>
                        </tr>
                        {expandedConvId === c.id && <tr className="bg-slate-50/80"><td colSpan={7} className="p-3">
                          <p className="text-gray-500 mb-2">แสดงเฉพาะรายการหลังวันเริ่มข้อมูล ยอดรวมยังรวมรายการยกมา</p>
                          {c.allocations.map((a, i) => <div key={`${a.ledgerId}-${i}`} className="text-gray-700 py-1">
                            #{i + 1} · {a.ledgerId ? `Ledger #${a.ledgerId}` : 'ล็อต WinSpeed'} {a.docNo || ''} · {formatThaiDate(a.earnedDate)} · ตัด ฿{fmtMoney(a.deductedAmount)}{a.remainingAfter != null ? ` · เหลือ ฿${fmtMoney(a.remainingAfter)}` : ''}
                          </div>)}
                        </td></tr>}
                      </Fragment>
                  ))}
                  {conversions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-gray-400">
                        ยังไม่มีประวัติการแปลงตั๋วปุ๋ย
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Oct 31 Snapshot Modal */}
      {showSnapshotModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !snapBusy && setShowSnapshotModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-black text-[#0C447C]">
                  บันทึก / Snapshot ราคายืน ณ วันที่ 31 ตุลาคม {standingYear + 543}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  เลือกคัดลอกราคาปัจจุบันจาก Pricelist หรือกำหนดรายสินค้าเอง
                </p>
              </div>
              <button
                type="button"
                disabled={snapBusy}
                onClick={() => setShowSnapshotModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle size={18} />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-blue-900">
                <div className="font-bold">Snapshot อัตโนมัติจาก Pricelist</div>
                <div className="text-blue-700">ดึงราคากลางที่มีผลปัจจุบันของสินค้าปุ๋ยทุกตัวเข้าตารางราคา 31 ต.ค.</div>
              </div>
              <button
                type="button"
                disabled={snapBusy}
                onClick={() => handleSaveSnapshot(true)}
                className="px-3 py-2 rounded-lg bg-[#0C447C] text-white text-xs font-bold hover:bg-[#09345f] disabled:opacity-50"
              >
                Snapshot จาก Pricelist ทันที
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700">หรือระบุราคารายสินค้า</span>
                <button
                  type="button"
                  onClick={() => setSnapEntries(prev => [...prev, { goodId: '', price: '', note: '' }])}
                  className="text-xs text-[#0C447C] font-bold hover:underline flex items-center gap-1"
                >
                  <Plus size={13} /> เพิ่มแถว
                </button>
              </div>
              {snapEntries.map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-6">
                    <SearchableSelect
                      options={goodOptions}
                      value={row.goodId}
                      onChange={val =>
                        setSnapEntries(prev =>
                          prev.map((item, i) => (i === idx ? { ...item, goodId: val } : item))
                        )
                      }
                      placeholder="-- เลือกสินค้า --"
                      searchPlaceholder="ค้นหาสินค้า..."
                      allowClear
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      type="number"
                      min={0}
                      placeholder="ราคา/ตัน"
                      value={row.price}
                      onChange={e =>
                        setSnapEntries(prev =>
                          prev.map((item, i) => (i === idx ? { ...item, price: e.target.value } : item))
                        )
                      }
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs tabular-nums"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="text"
                      placeholder="หมายเหตุ"
                      value={row.note}
                      onChange={e =>
                        setSnapEntries(prev =>
                          prev.map((item, i) => (i === idx ? { ...item, note: e.target.value } : item))
                        )
                      }
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-xs"
                    />
                  </div>
                  <div className="col-span-1 text-right">
                    {snapEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setSnapEntries(prev => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                disabled={snapBusy}
                onClick={() => setShowSnapshotModal(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={snapBusy}
                onClick={() => handleSaveSnapshot(false)}
                className="px-4 py-2 rounded-lg bg-[#0C447C] text-white text-xs font-bold hover:bg-[#09345f] disabled:opacity-50"
              >
                {snapBusy ? 'กำลังบันทึก...' : 'บันทึกราคาที่กรอก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
