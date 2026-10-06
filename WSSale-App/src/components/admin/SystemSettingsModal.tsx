import { useState, useEffect } from 'react';
import {
  Settings,
  Save,
  X,
  Scale,
  AlertCircle,
  CheckCircle2,
  Calendar,
  ShieldAlert,
  Percent,
  Truck,
  History,
  Info,
  Ticket,
} from 'lucide-react';
import { fetchSystemSettings, updateSystemSettings, fetchEditReasons } from '../../services/api';

interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabKey = 'pickup' | 'ticket' | 'rebate' | 'weight' | 'settle' | 'history';

const DEFAULT_REASON_OPTIONS = [
  { code: 'POLICY_ADJUSTMENT', label: 'ปรับปรุงตามนโยบายบริษัท' },
  { code: 'BUSINESS_RULE_CHANGE', label: 'เปลี่ยนเกณฑ์เงื่อนไขการค้า' },
  { code: 'SEASONAL_UPDATE', label: 'ปรับเปลี่ยนตามฤดูกาลผลิต/จัดส่ง' },
  { code: 'SCALE_RECALIBRATION', label: 'ปรับเกณฑ์เครื่องชั่งหลังสอบเทียบ' },
  { code: 'OTHER', label: 'อื่น ๆ (ระบุรายละเอียดเพิ่มเติม)' },
];

function parseStrictInt(val: string, fallback: number): number {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseStrictFloat(val: string, fallback: number): number {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

export function SystemSettingsModal({ isOpen, onClose }: SystemSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('pickup');

  // Policy Settings States
  const [pickupDueDefaultDays, setPickupDueDefaultDays] = useState<string>('7');
  const [pickupDueOptions, setPickupDueOptions] = useState<string>('7,15,30,45');
  const [pickupStrictMode, setPickupStrictMode] = useState<boolean>(false);
  const [pickupLeadTimeDays, setPickupLeadTimeDays] = useState<string>('1');

  const [ticketAlertDays, setTicketAlertDays] = useState<string>('7');
  const [ticketBlockExpired, setTicketBlockExpired] = useState<boolean>(false);

  const [customerRatio, setCustomerRatio] = useState<string>('100');
  const [companyRatio, setCompanyRatio] = useState<string>('0');

  const [tripCapacityTon, setTripCapacityTon] = useState<string>('50');
  const [tripTolerancePct, setTripTolerancePct] = useState<string>('5');
  const [standardBagKg, setStandardBagKg] = useState<string>('50.0');
  const [minPct, setMinPct] = useState<string>('2.0');
  const [maxPct, setMaxPct] = useState<string>('5.0');

  const [settleWindowDays, setSettleWindowDays] = useState<string>('3');
  const [goLiveCutoff, setGoLiveCutoff] = useState<string>('2000-01-01');
  const [borrowMaxPct, setBorrowMaxPct] = useState<string>('100');

  // Concurrency & Original Settings Tracking
  const [loadedRevision, setLoadedRevision] = useState<number | undefined>(undefined);
  const [originalSettings, setOriginalSettings] = useState<Record<string, any>>({});

  // Reason & History States
  const [reasonOptions, setReasonOptions] = useState<{ code: string; label: string }[]>(DEFAULT_REASON_OPTIONS);
  const [reasonCode, setReasonCode] = useState<string>('');
  const [reasonText, setReasonText] = useState<string>('');
  const [effectiveFrom, setEffectiveFrom] = useState<string>('');
  const [policyVersions, setPolicyVersions] = useState<any[]>([]);
  const [policySnapshots, setPolicySnapshots] = useState<any[]>([]);

  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setErrorMsg('');
      setSuccessMsg('');
      setReasonCode('');
      setReasonText('');
      setEffectiveFrom('');

      // Fetch dynamic active reasons from Master
      fetchEditReasons('POLICY')
        .then(res => {
          if (res?.data && res.data.length > 0) {
            setReasonOptions(res.data.map(r => ({ code: r.reasonCode, label: r.reasonText || r.reasonCode })));
          }
        })
        .catch(() => {});

      fetchSystemSettings()
        .then(res => {
          if (res.raw || res.settings) {
            const raw = res.raw || {};
            const set = res.settings || {};
            const combined = { ...raw, ...set };
            setOriginalSettings(combined);

            setPickupDueDefaultDays(String(raw.PICKUP_DUE_DEFAULT_DAYS ?? set.PICKUP_DUE_DEFAULT_DAYS ?? '7'));
            setPickupDueOptions(String(raw.PICKUP_DUE_OPTIONS ?? set.PICKUP_DUE_OPTIONS ?? '7,15,30,45'));
            setPickupStrictMode(String(raw.PICKUP_STRICT_MODE ?? set.PICKUP_STRICT_MODE) === 'true');
            setPickupLeadTimeDays(String(raw.PICKUP_LEAD_TIME_DAYS ?? set.PICKUP_LEAD_TIME_DAYS ?? '1'));

            setTicketAlertDays(String(raw.CONTROL_TICKET_ALERT_DAYS ?? set.CONTROL_TICKET_ALERT_DAYS ?? '7'));
            setTicketBlockExpired(String(raw.CONTROL_TICKET_BLOCK_EXPIRED ?? set.CONTROL_TICKET_BLOCK_EXPIRED) === 'true');

            setCustomerRatio(String(raw.CUSTOMER_RATIO ?? set.CUSTOMER_RATIO ?? '100'));
            setCompanyRatio(String(raw.COMPANY_RATIO ?? set.COMPANY_RATIO ?? '0'));

            setTripCapacityTon(String(raw.TRIP_CAPACITY_TON ?? set.TRIP_CAPACITY_TON ?? '50'));
            setTripTolerancePct(String(raw.TRIP_OVERLOAD_TOLERANCE_PCT ?? set.TRIP_OVERLOAD_TOLERANCE_PCT ?? '5'));
            setStandardBagKg(String(raw.STANDARD_BAG_WEIGHT_KG ?? set.standardBagKg ?? '50.0'));
            setMinPct(String(raw.WEIGHT_TOLERANCE_MIN_PCT ?? set.minPct ?? '2.0'));
            setMaxPct(String(raw.WEIGHT_TOLERANCE_MAX_PCT ?? set.maxPct ?? '5.0'));

            setSettleWindowDays(String(raw.COUPON_SETTLEMENT_WINDOW_DAYS ?? set.COUPON_SETTLEMENT_WINDOW_DAYS ?? '3'));
            setGoLiveCutoff(String(raw.COUPON_GOLIVE_CUTOFF_DATE ?? set.COUPON_GOLIVE_CUTOFF_DATE ?? '2000-01-01'));
            setBorrowMaxPct(String(raw.GIVEAWAY_BORROW_MAX_PCT ?? set.GIVEAWAY_BORROW_MAX_PCT ?? '100'));
          }
          if (res.currentRevision !== undefined) {
            setLoadedRevision(res.currentRevision);
          }
          if (res.snapshots) {
            setPolicySnapshots(res.snapshots);
          }
          if (res.versions) {
            setPolicyVersions(res.versions);
          }
        })
        .catch(err => setErrorMsg(err.message || 'โหลดการตั้งค่าระบบไม่สำเร็จ'))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSave() {
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      // 1. Validate Reason Code & Detail
      if (!reasonCode) {
        throw new Error('กรุณาเลือกรหัสเหตุผลในการปรับปรุงนโยบาย');
      }
      if (reasonCode === 'OTHER' && (!reasonText.trim() || reasonText.trim().length < 5)) {
        throw new Error('กรณีเลือกเหตุผล "อื่น ๆ" ต้องระบุรายละเอียดเพิ่มเติมอย่างน้อย 5 ตัวอักษร');
      }

      // 2. Validation for Rebate
      const cRatio = parseStrictFloat(customerRatio, 100);
      const wRatio = parseStrictFloat(companyRatio, 0);
      if (cRatio < 0 || wRatio < 0 || Math.abs(cRatio + wRatio - 100) > 0.001) {
        throw new Error('สัดส่วนรีเบทลูกค้า และ บริษัท รวมกันต้องเท่ากับ 100%');
      }

      // 3. Validation for Weights
      const minP = parseStrictFloat(minPct, 2.0);
      const maxP = parseStrictFloat(maxPct, 5.0);
      const bag = parseStrictFloat(standardBagKg, 50.0);
      if (minP < 0 || maxP < minP) {
        throw new Error('กรุณาระบุช่วง Error Tolerance % ที่ถูกต้อง (Min ต้องไม่ติดลบ และ Max ต้องมากกว่า Min)');
      }
      if (bag <= 0) {
        throw new Error('กรุณาระบุน้ำหนักกระสอบปุ๋ยมาตรฐานที่ถูกต้อง (> 0 กก.)');
      }

      // 4. Validation for Pickup Due & Lead Time
      const dueDays = parseStrictInt(pickupDueDefaultDays, 7);
      if (dueDays < 1) {
        throw new Error('จำนวนวันกำหนดรับสินค้าค่าเริ่มต้นต้องไม่น้อยกว่า 1 วัน');
      }
      const leadTime = parseStrictInt(pickupLeadTimeDays, 0);
      if (leadTime < 0) {
        throw new Error('Lead Time การนัดหมายรถต้องไม่ติดลบ');
      }
      const alertDays = parseStrictInt(ticketAlertDays, 0);
      if (alertDays < 0) {
        throw new Error('วันแจ้งเตือนตั๋วคุมหมดอายุต้องไม่ติดลบ');
      }
      const windowDays = parseStrictInt(settleWindowDays, 3);
      if (windowDays < 0 || windowDays > 60) {
        throw new Error('ช่วงวันย้อนหลังของการตัดตั๋วต้องอยู่ระหว่าง 0 ถึง 60 วัน');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(goLiveCutoff.trim())) {
        throw new Error('วันเริ่มใช้งานระบบต้องเป็นวันที่รูปแบบ YYYY-MM-DD');
      }
      const borrowPct = parseStrictInt(borrowMaxPct, 100);
      if (borrowPct < 0 || borrowPct > 100) {
        throw new Error('เพดานการยืมของแถมต้องอยู่ระหว่าง 0 ถึง 100%');
      }
      const overloadPct = parseStrictFloat(tripTolerancePct, 0);
      if (overloadPct < 0) {
        throw new Error('Overload Tolerance % ต้องไม่ติดลบ');
      }

      // Candidate updates preserving explicit 0 values
      const candidateUpdates: Record<string, any> = {
        PICKUP_DUE_DEFAULT_DAYS: dueDays,
        PICKUP_DUE_OPTIONS: pickupDueOptions.trim(),
        PICKUP_STRICT_MODE: pickupStrictMode ? 'true' : 'false',
        PICKUP_LEAD_TIME_DAYS: leadTime,
        CONTROL_TICKET_ALERT_DAYS: alertDays,
        CONTROL_TICKET_BLOCK_EXPIRED: ticketBlockExpired ? 'true' : 'false',
        CUSTOMER_RATIO: cRatio,
        COMPANY_RATIO: wRatio,
        TRIP_CAPACITY_TON: parseStrictFloat(tripCapacityTon, 50),
        TRIP_OVERLOAD_TOLERANCE_PCT: overloadPct,
        STANDARD_BAG_WEIGHT_KG: bag,
        WEIGHT_TOLERANCE_MIN_PCT: minP,
        WEIGHT_TOLERANCE_MAX_PCT: maxP,
        COUPON_SETTLEMENT_WINDOW_DAYS: windowDays,
        COUPON_GOLIVE_CUTOFF_DATE: goLiveCutoff.trim(),
        GIVEAWAY_BORROW_MAX_PCT: borrowPct,
      };

      // Only submit dirty (modified) keys
      const dirtyUpdates: Record<string, any> = {};
      for (const [k, v] of Object.entries(candidateUpdates)) {
        const orig = originalSettings[k];
        if (orig === undefined || String(orig) !== String(v)) {
          dirtyUpdates[k] = v;
        }
      }

      if (Object.keys(dirtyUpdates).length === 0) {
        throw new Error('ไม่มีการเปลี่ยนแปลงการตั้งค่าที่ต้องบันทึก');
      }

      const selectedReason = reasonOptions.find(r => r.code === reasonCode);
      const fullReasonText = reasonText.trim()
        ? `${selectedReason?.label || reasonCode}: ${reasonText.trim()}`
        : selectedReason?.label || reasonCode;

      const res = await updateSystemSettings({
        updates: dirtyUpdates,
        expectedRevision: loadedRevision,
        reasonCode,
        reasonText: fullReasonText,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
      });

      if (res.currentRevision !== undefined) {
        setLoadedRevision(res.currentRevision);
      }
      if (res.snapshots) {
        setPolicySnapshots(res.snapshots);
      }
      if (res.versions) {
        setPolicyVersions(res.versions);
      }
      setOriginalSettings(prev => ({ ...prev, ...dirtyUpdates }));

      setSuccessMsg(`บันทึกการตั้งค่านโยบายสำเร็จ (${res.updatedCount || Object.keys(dirtyUpdates).length} รายการที่เปลี่ยนแปลง)`);
      setTimeout(() => {
        setSuccessMsg('');
        onClose();
      }, 1400);
    } catch (e: any) {
      setErrorMsg(e.message || 'บันทึกการตั้งค่าไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-[#0C447C] text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-white/10 rounded-lg">
              <Settings size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base flex items-center gap-2">
                ตั้งค่านโยบายระบบ (System Policy Management)
                {loadedRevision !== undefined && (
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-white/20 rounded-full font-normal">
                    Revision #{loadedRevision}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-blue-200">
                ควบคุมพารามิเตอร์หลักตามสิทธิ์ ADMIN พร้อมระบบ Versioning & Change Audit
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition">
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 bg-gray-50/80 px-4 text-xs font-semibold overflow-x-auto gap-1">
          <button
            onClick={() => setActiveTab('pickup')}
            className={`py-3 px-3 flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${
              activeTab === 'pickup'
                ? 'border-[#0C447C] text-[#0C447C] font-bold bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Calendar size={15} /> กำหนดรับสินค้า
          </button>

          <button
            onClick={() => setActiveTab('ticket')}
            className={`py-3 px-3 flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${
              activeTab === 'ticket'
                ? 'border-[#0C447C] text-[#0C447C] font-bold bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <ShieldAlert size={15} /> ตั๋วคุม & หมดอายุ
          </button>

          <button
            onClick={() => setActiveTab('rebate')}
            className={`py-3 px-3 flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${
              activeTab === 'rebate'
                ? 'border-[#0C447C] text-[#0C447C] font-bold bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Percent size={15} /> สัดส่วนรีเบท
          </button>

          <button
            onClick={() => setActiveTab('weight')}
            className={`py-3 px-3 flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${
              activeTab === 'weight'
                ? 'border-[#0C447C] text-[#0C447C] font-bold bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Truck size={15} /> เที่ยวรถ & เครื่องชั่ง
          </button>

          <button
            onClick={() => setActiveTab('settle')}
            className={`py-3 px-3 flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${
              activeTab === 'settle'
                ? 'border-[#0C447C] text-[#0C447C] font-bold bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Ticket size={15} /> ตัดตั๋ว & ของแถม
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 px-3 flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${
              activeTab === 'history'
                ? 'border-[#0C447C] text-[#0C447C] font-bold bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <History size={15} /> ประวัติ Version
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">⏳ กำลังโหลดนโยบายระบบ...</div>
          ) : (
            <>
              {successMsg && (
                <div className="bg-green-50 border border-green-200 text-green-800 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 size={16} /> {successMsg}
                </div>
              )}

              {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertCircle size={16} /> {errorMsg}
                </div>
              )}

              {/* TAB 1: กำหนดรับสินค้า */}
              {activeTab === 'pickup' && (
                <div className="space-y-4 text-xs">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-900 flex items-start gap-2">
                    <Info size={16} className="text-[#0C447C] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-[#0C447C] mb-0.5">นโยบายกำหนดวันรับสินค้า (Pickup Due Policy)</div>
                      กำหนดวันรับสินค้าค่าเริ่มต้นนับจาก SO Confirmation พร้อม Lead time ขั้นต่ำสำหรับการนัดหมายรถ
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        จำนวนวันกำหนดรับสินค้าค่าเริ่มต้น (วัน)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={pickupDueDefaultDays}
                        onChange={e => setPickupDueDefaultDays(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                      />
                      <p className="text-[11px] text-gray-500 mt-1">ค่าเริ่มต้นคือ 7 วันหลังยืนยันใบสั่งขาย</p>
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        Lead Time การนัดหมายรถล่วงหน้า (วัน)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="60"
                        value={pickupLeadTimeDays}
                        onChange={e => setPickupLeadTimeDays(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                      />
                      <p className="text-[11px] text-gray-500 mt-1">ค่าเริ่มต้น 1 วันสำหรับการจัดคิวโรงงาน</p>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-gray-700 mb-1">
                      ตัวเลือกกำหนดรับสินค้าในหน้าสร้าง SO (วัน, คั่นด้วยจุลภาค)
                    </label>
                    <input
                      type="text"
                      value={pickupDueOptions}
                      onChange={e => setPickupDueOptions(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-gray-300 font-mono text-gray-800 focus:border-[#0C447C] outline-none"
                      placeholder="7,15,30,45"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">ตัวเลือกปุ่มด่วนสำหรับฝ่ายขาย เช่น 7, 15, 30, 45 วัน</p>
                  </div>

                  <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="font-bold text-gray-800">โหมดเข้มงวดวันกำหนดรับ (Pickup Strict Mode)</div>
                      <div className="text-[11px] text-gray-500">
                        {pickupStrictMode
                          ? 'เปิดใช้งาน: บล็อกไม่ให้ออกตั๋ว/โหลดสินค้าหากเกินกำหนดรับ'
                          : 'ปิดใช้งาน (ค่าเริ่มต้น): อนุญาตให้ดำเนินการต่อพร้อมแจ้งเตือนผู้ใช้งาน'}
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pickupStrictMode}
                        onChange={e => setPickupStrictMode(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0C447C]"></div>
                    </label>
                  </div>
                </div>
              )}

              {/* TAB 2: ตั๋วคุม */}
              {activeTab === 'ticket' && (
                <div className="space-y-4 text-xs">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900 flex items-start gap-2">
                    <ShieldAlert size={16} className="text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-amber-800 mb-0.5">นโยบายอายุและการแจ้งเตือนตั๋วคุม (Control Ticket Policy)</div>
                      กำหนดเงื่อนไขการแจ้งเตือนล่วงหน้า และการควบคุมตั๋วคุมที่หมดอายุการใช้งาน
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-gray-700 mb-1">
                      แจ้งเตือนล่วงหน้าก่อนตั๋วคุมหมดอายุ (วัน)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="90"
                      value={ticketAlertDays}
                      onChange={e => setTicketAlertDays(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">แสดงสถานะเตือนสีส้มเมื่อเหลืออายุตั๋วไม่เกินจำนวนวันที่กำหนด (ค่าเริ่มต้น 7 วัน)</p>
                  </div>

                  <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="font-bold text-gray-800">บล็อกการใช้ตั๋วคุมหมดอายุ (Block Expired Tickets)</div>
                      <div className="text-[11px] text-gray-500">
                        {ticketBlockExpired
                          ? 'เปิดใช้งาน: ห้ามผูกตั๋วคุมที่หมดอายุกับใบสั่งขายเด็ดขาด'
                          : 'ปิดใช้งาน (ค่าเริ่มต้น): อนุญาตพร้อมบันทึกประวัติการเบิกเกินอายุ'}
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ticketBlockExpired}
                        onChange={e => setTicketBlockExpired(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0C447C]"></div>
                    </label>
                  </div>
                </div>
              )}

              {/* TAB 3: สัดส่วนรีเบท */}
              {activeTab === 'rebate' && (
                <div className="space-y-4 text-xs">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-900 flex items-start gap-2">
                    <Percent size={16} className="text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-emerald-800 mb-0.5">นโยบายสัดส่วนเงินรีเบท (Rebate Split Ratio Policy)</div>
                      ค่าเริ่มต้นตามนโยบายบริษัทคือ ลูกค้า 100% / เวิลด์เฟิร์ต 0% (รวมกันต้องได้ 100% เสมอ)
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        สัดส่วนเงินคืนลูกค้า (Customer Ratio %)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max="100"
                          value={customerRatio}
                          onChange={e => {
                            const val = e.target.value;
                            setCustomerRatio(val);
                            const n = parseFloat(val);
                            if (!isNaN(n) && n >= 0 && n <= 100) {
                              setCompanyRatio(String(100 - n));
                            }
                          }}
                          className="w-full p-2.5 pr-8 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                        />
                        <span className="absolute right-3 top-2.5 font-bold text-gray-400">%</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">ค่าเริ่มต้น 100%</p>
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        สัดส่วนคงไว้ให้บริษัท (WorldFert Ratio %)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max="100"
                          value={companyRatio}
                          onChange={e => {
                            const val = e.target.value;
                            setCompanyRatio(val);
                            const n = parseFloat(val);
                            if (!isNaN(n) && n >= 0 && n <= 100) {
                              setCustomerRatio(String(100 - n));
                            }
                          }}
                          className="w-full p-2.5 pr-8 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                        />
                        <span className="absolute right-3 top-2.5 font-bold text-gray-400">%</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">ค่าเริ่มต้น 0%</p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: เที่ยวรถ & เครื่องชั่ง */}
              {activeTab === 'weight' && (
                <div className="space-y-4 text-xs">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-900 flex items-start gap-2">
                    <Scale size={16} className="text-[#0C447C] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-[#0C447C] mb-0.5">เที่ยวรถขนส่ง & สอบเทียบเครื่องชั่ง</div>
                      กำหนดพิกัดความจุต่อเที่ยว เกณฑ์น้ำหนักเกิน และช่วง Tolerance ส่วนต่างน้ำหนักเครื่องชั่ง
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        พิกัดบรรทุกมาตรฐานต่อเที่ยว (ตัน)
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={tripCapacityTon}
                        onChange={e => setTripCapacityTon(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                      />
                      <p className="text-[11px] text-gray-500 mt-1">พิกัดบรรทุกเฉลี่ยรถพ่วง (ค่าเริ่มต้น 50 ตัน)</p>
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        Overload Tolerance สูงสุด (%)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.5"
                          value={tripTolerancePct}
                          onChange={e => setTripTolerancePct(e.target.value)}
                          className="w-full p-2.5 pr-8 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                        />
                        <span className="absolute right-3 top-2.5 font-bold text-gray-400">%</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">ส่วนต่างเกินพิกัดที่อนุญาต (ค่าเริ่มต้น 5%)</p>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <label className="block font-bold text-gray-700 mb-1">
                      น้ำหนักกระสอบปุ๋ยมาตรฐาน (กก./กระสอบ)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={standardBagKg}
                      onChange={e => setStandardBagKg(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">ปกติปุ๋ย 1 ตัน = 20 กระสอบ (กระสอบละ 50.0 กก.)</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        Min Scale Tolerance (%)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.1"
                          value={minPct}
                          onChange={e => setMinPct(e.target.value)}
                          className="w-full p-2.5 pr-8 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                        />
                        <span className="absolute right-3 top-2.5 font-bold text-gray-400">%</span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">เกณฑ์ส่วนต่างขั้นต่ำ (ค่าเริ่มต้น +2.0%)</p>
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        Max Scale Tolerance (%)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.1"
                          value={maxPct}
                          onChange={e => setMaxPct(e.target.value)}
                          className="w-full p-2.5 pr-8 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                        />
                        <span className="absolute right-3 top-2.5 font-bold text-gray-400">%</span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">เกณฑ์ส่วนต่างสูงสุด (ค่าเริ่มต้น +5.0%)</p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: ตัดตั๋ว & ของแถม */}
              {activeTab === 'settle' && (
                <div className="space-y-4 text-xs">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-900 flex items-start gap-2">
                    <Info size={16} className="text-[#0C447C] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-[#0C447C] mb-0.5">การจับคู่ใบตัดตั๋ว และการยืมของแถม</div>
                      ใบตัดตั๋วที่เก่ากว่าช่วงนี้จะไม่แสดงในรายการรอจับคู่ และตัดแบบแมนนวลไม่ได้
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">ช่วงวันย้อนหลังก่อนวันสร้างรายการจอง (วัน)</label>
                      <input
                        type="number"
                        min="0"
                        max="60"
                        value={settleWindowDays}
                        onChange={e => setSettleWindowDays(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                      />
                      <p className="text-[11px] text-gray-500 mt-1">ค่าเริ่มต้น 3 วัน</p>
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">วันเริ่มใช้งานระบบ (Go-Live)</label>
                      <input
                        type="date"
                        value={goLiveCutoff}
                        onChange={e => setGoLiveCutoff(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                      />
                      <p className="text-[11px] text-gray-500 mt-1">ใบตัดตั๋วก่อนวันนี้จะไม่ถูกแสดงหรือจับคู่</p>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-gray-700 mb-1">ยืมของแถมได้สูงสุด (% ของโควต้าคงเหลือของผู้ให้ยืม)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={borrowMaxPct}
                      onChange={e => setBorrowMaxPct(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-gray-300 font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">ค่าเริ่มต้น 100% ตรวจทั้งตอนขอยืมและตอนอนุมัติ</p>
                  </div>
                </div>
              )}

              {/* TAB 5: ประวัติ Version */}
              {activeTab === 'history' && (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-gray-800 flex items-center gap-1.5">
                      <History size={16} className="text-[#0C447C]" /> ประวัตินโยบายล่าสุด (Policy Versions)
                    </h4>
                    <span className="text-[11px] text-gray-500">บันทึกอัตโนมัติลง wf.PolicyVersion & wf.PolicySnapshot</span>
                  </div>

                  {policySnapshots.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[11px] font-bold text-[#0C447C] mb-1.5 flex items-center gap-1">
                        Coherent Policy Snapshots (Revision #{loadedRevision || 1})
                      </div>
                      <div className="border border-blue-100 bg-blue-50/40 rounded-xl overflow-hidden mb-3">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-blue-100/60 text-blue-900 font-bold border-b border-blue-200">
                            <tr>
                              <th className="p-2">Policy Name</th>
                              <th className="p-2 text-center">Revision</th>
                              <th className="p-2">Effective From</th>
                              <th className="p-2">Updated By</th>
                              <th className="p-2">Reason</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-blue-100/50">
                            {policySnapshots.map((s, idx) => (
                              <tr key={idx} className="hover:bg-blue-50/80">
                                <td className="p-2 font-bold text-gray-800">{s.PolicyName}</td>
                                <td className="p-2 text-center font-bold text-[#0C447C]">Rev #{s.RevisionNumber}</td>
                                <td className="p-2 text-gray-600 font-mono text-[10px]">{s.EffectiveFrom ? new Date(s.EffectiveFrom).toLocaleString('th-TH') : '-'}</td>
                                <td className="p-2 text-gray-600">{s.CreatedBy}</td>
                                <td className="p-2 text-gray-500 truncate max-w-[140px]">{s.ReasonText || s.ReasonCode || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                        <tr>
                          <th className="p-2.5">นโยบาย</th>
                          <th className="p-2.5">Key</th>
                          <th className="p-2.5">เวอร์ชัน</th>
                          <th className="p-2.5">ค่าปัจจุบัน</th>
                          <th className="p-2.5">ผู้แก้ไข</th>
                          <th className="p-2.5">เหตุผล</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {policyVersions.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-4 text-center text-gray-400">
                              ยังไม่มีประวัติการเปลี่ยนแปลง
                            </td>
                          </tr>
                        ) : (
                          policyVersions.map((v, idx) => (
                            <tr key={idx} className="hover:bg-gray-50/50">
                              <td className="p-2.5 font-bold text-gray-800">{v.PolicyName}</td>
                              <td className="p-2.5 font-mono text-gray-600">{v.SettingKey}</td>
                              <td className="p-2.5 text-center font-bold text-[#0C447C]">v{v.VersionNumber}</td>
                              <td className="p-2.5 font-mono text-gray-900 font-semibold">{v.NewValue}</td>
                              <td className="p-2.5 text-gray-600">{v.ChangedBy}</td>
                              <td className="p-2.5 text-gray-500 truncate max-w-[120px]">{v.ReasonText || v.ReasonCode || '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Mandatory Reason & Scheduling Section (Always visible when making changes) */}
              <div className="pt-3 border-t border-gray-200 bg-amber-50/50 -mx-6 -mb-4 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-amber-900">
                  <div className="flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-amber-700" /> ระบุเหตุผลและการบังคับใช้นโยบาย (Audit & Schedule)
                  </div>
                  {reasonCode === 'OTHER' && (
                    <span className="text-[10px] text-red-600 font-normal">
                      * ต้องระบุรายละเอียดอย่างน้อย 5 ตัวอักษร
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <select
                    value={reasonCode}
                    onChange={e => setReasonCode(e.target.value)}
                    className="p-2 rounded-lg border border-amber-200 bg-white font-medium text-gray-800 outline-none focus:border-[#0C447C]"
                  >
                    <option value="">-- กรุณาเลือกเหตุผล (จำเป็น) --</option>
                    {reasonOptions.map(r => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={reasonText}
                    onChange={e => setReasonText(e.target.value)}
                    placeholder={reasonCode === 'OTHER' ? 'ระบุรายละเอียดเพิ่มเติม (จำเป็น อย่างน้อย 5 ตัวอักษร)' : 'บันทึกรายละเอียดเพิ่มเติม (ถ้ามี)'}
                    className={`p-2 rounded-lg border bg-white text-gray-800 outline-none ${
                      reasonCode === 'OTHER' && (!reasonText.trim() || reasonText.trim().length < 5)
                        ? 'border-red-400 focus:border-red-500'
                        : 'border-amber-200 focus:border-[#0C447C]'
                    }`}
                  />

                  <div className="flex items-center gap-1.5 bg-white px-2 py-1.5 rounded-lg border border-amber-200">
                    <Calendar size={14} className="text-gray-500 shrink-0" />
                    <span className="text-[11px] text-gray-500 shrink-0">มีผล:</span>
                    <input
                      type="datetime-local"
                      value={effectiveFrom}
                      onChange={e => setEffectiveFrom(e.target.value)}
                      title="เว้นว่างเพื่อให้มีผลทันที หรือระบุวันและเวลาที่มีผลล่วงหน้า"
                      className="w-full text-xs bg-transparent text-gray-800 outline-none"
                    />
                  </div>
                </div>
                <div className="text-[10px] text-gray-500">
                  * กำหนดวันมีผล: หากเว้นว่าง นโยบายจะมีผลทันที (Immediate Effective) หรือระบุวันเวลาล่วงหน้าเพื่อจัดตารางล่วงหน้า (Scheduled Effective)
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-xs bg-white hover:bg-gray-100 transition"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex-1 py-2.5 rounded-xl text-white font-semibold text-xs bg-[#0C447C] hover:bg-[#093560] flex items-center justify-center gap-1.5 disabled:opacity-50 transition shadow-sm"
          >
            <Save size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกนโยบาย'}
          </button>
        </div>
      </div>
    </div>
  );
}
