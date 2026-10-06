import React, { useState, useEffect, useCallback } from 'react';
import { X, Search, Ticket, AlertCircle, CheckCircle, RefreshCw, Shield, ArrowRight, UserCheck, Clock, Ban } from 'lucide-react';
import { apiFetch } from '../../services/api';

export interface CouponItem {
  couponId: number;
  couponNo: string;
  sourceSoId: number;
  sourceDocuNo: string;
  ownerCustId: string;
  ownerCustName: string;
  goodId: number;
  goodName: string;
  goodPrice: number;
  totalQty: number;
  nativeRemainingQty: number;
  reservedQty: number;
  availableQty: number;
  rightType: 'OWNER' | 'BENEFICIARY';
  beneficiaryReason?: string;
  beneficiaryExpiry?: string;
  sourceDocuDate?: string;
  expiryDate?: string | null;
  daysLeft?: number | null;
  isExpired?: boolean;
  isExpiringSoon?: boolean;
  warningLeadDays?: number;
  consumedQty?: number;
  hasUnmatchedCuts?: boolean;
  goodCode?: string;
}

interface CouponPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  carrierSoId: string;
  carrierDocuNo?: string;
  tripId?: number;
  customerId: string;
  customerName?: string;
  selectedGoodId?: number;
  // R12 K-F3: K bills list/draw only D coupons, I bills only C coupons
  billPrefix?: string;
  onReserved?: (result: any, coupon: CouponItem) => void;
}

export const CouponPickerModal: React.FC<CouponPickerModalProps> = ({
  isOpen,
  onClose,
  carrierSoId,
  carrierDocuNo,
  tripId,
  customerId,
  customerName,
  selectedGoodId,
  billPrefix,
  onReserved
}) => {
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  
  // Selection & Reservation State
  const [selectedCoupon, setSelectedCoupon] = useState<CouponItem | null>(null);
  const [reserveAmount, setReserveAmount] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [retryOpKey, setRetryOpKey] = useState<string | null>(null);

  const loadCoupons = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/coupons?customerId=${encodeURIComponent(customerId)}${selectedGoodId ? `&goodId=${selectedGoodId}` : ''}${billPrefix ? `&billPrefix=${encodeURIComponent(billPrefix)}` : ''}`;
      const res = await apiFetch<{ data: CouponItem[] }>(url);
      setCoupons(res?.data || []);
    } catch (err: any) {
      setError(err.message || 'ไม่สามารถโหลดข้อมูลตั๋วปุ๋ยได้');
    } finally {
      setLoading(false);
    }
  }, [customerId, selectedGoodId, billPrefix]);

  useEffect(() => {
    if (isOpen) {
      loadCoupons();
      setSelectedCoupon(null);
      setReserveAmount('');
      setError(null);
      setSuccessMessage(null);
      setRetryOpKey(null);
    }
  }, [isOpen, loadCoupons]);

  if (!isOpen) return null;

  const filteredCoupons = coupons.filter(c => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.sourceDocuNo?.toLowerCase().includes(q) ||
      c.couponNo?.toLowerCase().includes(q) ||
      c.goodName?.toLowerCase().includes(q) ||
      c.ownerCustName?.toLowerCase().includes(q)
    );
  });

  const handleReserve = async () => {
    if (!selectedCoupon) return;
    const qty = Number(reserveAmount);
    if (isNaN(qty) || qty <= 0) {
      setError('กรุณาระบุจำนวนตันที่ต้องการจองให้ถูกต้อง');
      return;
    }
    if (qty > selectedCoupon.availableQty) {
      setError(`จำนวนที่ขอจอง (${qty} ตัน) เกินยอดพร้อมใช้ (${selectedCoupon.availableQty} ตัน)`);
      return;
    }

    setSubmitting(true);
    setError(null);

    // Reuse stable operation key on retry to avoid duplicate reservation races
    const opKey = retryOpKey || `UI_RES:${carrierSoId}:${selectedCoupon.couponId}:${qty}:${Date.now()}`;
    if (!retryOpKey) setRetryOpKey(opKey);

    try {
      const res = await apiFetch<{ id: number; couponNo: string; reservedQty: number; availableAfter: number }>('/coupons/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          couponId: selectedCoupon.couponId,
          carrierSoId: String(carrierSoId),
          carrierDocuNo: carrierDocuNo || null,
          tripId: tripId ? Number(tripId) : undefined,
          beneficiaryCustId: String(customerId),
          reservedQty: qty,
          idempotencyKey: opKey,
          billPrefix: billPrefix || undefined
        })
      });

      setSuccessMessage(`จองตั๋ว ${res.couponNo} จำนวน ${res.reservedQty} ตัน สำเร็จ (พร้อมใช้คงเหลือ: ${res.availableAfter} ตัน)`);
      if (onReserved) onReserved(res, selectedCoupon);
      await loadCoupons();
      setSelectedCoupon(null);
      setReserveAmount('');
      setRetryOpKey(null);
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการจองตั๋ว');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in" data-testid="coupon-picker-modal">
      <div className="flex h-[90vh] max-h-[820px] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/30 border border-blue-400/40 text-blue-400">
              <Ticket className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">เลือกใช้ตั๋วปุ๋ย (Coupon Reservation)</h2>
                <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-semibold text-blue-300 border border-blue-400/30">
                  ต่อบิล
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                เลขที่เอกสาร: <span className="font-semibold text-white">{carrierDocuNo || (carrierSoId && !carrierSoId.startsWith('bill-') && !carrierSoId.startsWith('TRIP-') && carrierSoId !== 'DRAFT' ? carrierSoId : 'บิลร่าง')}</span> · ลูกค้า: <span className="font-semibold text-white">{customerName || customerId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            data-testid="btn-close-coupon-modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-6 py-3">
          <div className="relative flex-1 min-w-[280px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาตามเลขที่เอกสาร (DocuNo), เลขตั๋ว, สินค้า..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              data-testid="input-coupon-search"
            />
          </div>
          <button
            onClick={loadCoupons}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรชยอด
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
            <span>{error}</span>
          </div>
        )}
        {successMessage && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle className="h-5 w-5 flex-shrink-0 text-emerald-500" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Coupon Grid / List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && coupons.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-slate-400">
              <RefreshCw className="h-8 w-8 animate-spin text-blue-500 mb-2" />
              <p className="text-sm">กำลังโหลดตั๋วปุ๋ยที่มีสิทธิ์...</p>
            </div>
          ) : filteredCoupons.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-slate-400 rounded-xl border border-dashed border-slate-300 bg-slate-50">
              <Ticket className="h-10 w-10 text-slate-300 mb-2" />
              <p className="text-sm font-medium text-slate-600">ไม่พบตั๋วปุ๋ยสำหรับลูกค้ารายนี้</p>
              <p className="text-xs text-slate-400 mt-1">ลูกค้านี้ไม่มีตั๋วคงเหลือในระบบ หรือยังไม่ได้รับสิทธิ์ใช้ตั๋วร่วมจากเจ้าของตั๋ว</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCoupons.map((c) => {
                const isSelected = selectedCoupon?.couponId === c.couponId;
                const isUsable = c.availableQty > 0;

                return (
                  <div
                    key={c.couponId}
                    onClick={() => isUsable && setSelectedCoupon(c)}
                    className={`relative flex flex-col rounded-xl border p-4 transition cursor-pointer ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50/50 shadow-md ring-2 ring-blue-500/20'
                        : isUsable
                        ? 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                        : 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                    }`}
                    data-testid={`card-coupon-${c.couponId}`}
                  >
                    {/* Top Row: DocuNo & Right Type Badge */}
                    <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-slate-500">เลขที่เอกสาร:</span>
                          <span className="font-bold text-slate-900 text-sm">{c.sourceDocuNo}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          ตั๋วเลขที่: <span className="font-medium text-slate-700">{c.couponNo}</span>
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          c.rightType === 'OWNER'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-blue-100 text-blue-800 border border-blue-200'
                        }`}
                      >
                        {c.rightType === 'OWNER' ? (
                          <>
                            <Shield className="h-3 w-3" />
                            เจ้าของตั๋ว
                          </>
                        ) : (
                          <>
                            <UserCheck className="h-3 w-3" />
                            สิทธิ์ใช้ร่วม
                          </>
                        )}
                      </span>
                    </div>

                    {/* Product Name */}
                    <div className="py-2.5">
                      <div className="text-xs text-slate-500">รายการสินค้า:</div>
                      <div className="font-semibold text-slate-800 text-sm">{c.goodName}</div>
                      {c.rightType === 'BENEFICIARY' && c.ownerCustName && (
                        <div className="text-xs text-slate-500 mt-1">
                          เจ้าของตั๋วเดิม: <span className="font-medium text-slate-700">{c.ownerCustName}</span>
                          {c.beneficiaryReason && ` (${c.beneficiaryReason})`}
                        </div>
                      )}

                      {/* D1: Ticket Expiry & Days Left */}
                      {c.expiryDate && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1.5">
                          <span className="text-[11px] text-slate-400">หมดอายุ:</span>
                          <span className="font-semibold text-slate-700 text-[11px]">{c.expiryDate}</span>
                          {c.isExpired ? (
                            <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
                              ⚠️ หมดอายุแล้ว
                            </span>
                          ) : c.isExpiringSoon ? (
                            <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              ⚠️ เหลือ {c.daysLeft} วัน
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600">
                              เหลือ {c.daysLeft} วัน
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Quantities Grid: Settled vs Reserved */}
                    <div className="mt-auto grid grid-cols-4 gap-1.5 rounded-lg bg-slate-50 p-2 text-center text-xs border border-slate-100">
                      <div>
                        <div className="text-slate-400 text-[10px]">คงเหลือเดิม</div>
                        <div className="font-bold text-slate-700 mt-0.5">{c.nativeRemainingQty.toLocaleString()} ตัน</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px]">จองค้าง</div>
                        <div className="font-bold text-amber-600 mt-0.5">{c.reservedQty.toLocaleString()} ตัน</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px]">ตัดตั๋วแล้ว</div>
                        <div className="font-bold text-blue-600 mt-0.5">{(c.consumedQty || 0).toLocaleString()} ตัน</div>
                      </div>
                      <div className="bg-emerald-50 rounded border border-emerald-200 p-0.5">
                        <div className="text-emerald-700 font-medium text-[10px]">พร้อมใช้</div>
                        <div className="font-extrabold text-emerald-700 text-xs mt-0.5">
                          {c.availableQty.toLocaleString()} ตัน
                        </div>
                      </div>
                    </div>

                    {c.hasUnmatchedCuts && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 font-medium" data-testid={`unmatched-hint-${c.couponId}`}>
                        <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                        <span>มีการตัดตั๋วที่ยังจับคู่ไม่ได้ — ให้บัญชี/ผู้จัดการตรวจที่หน้ากระทบยอด</span>
                      </div>
                    )}

                    {!isUsable && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-red-600">
                        <Ban className="h-3.5 w-3.5" />
                        <span>ยอดพร้อมใช้หมดแล้ว</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Action Panel */}
        {selectedCoupon && (
          <div className="border-t border-slate-200 bg-slate-50 p-4" data-testid="coupon-reservation-panel">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-500">ตั๋วที่เลือก:</div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">{selectedCoupon.sourceDocuNo}</span>
                  <span className="text-xs text-slate-500">({selectedCoupon.couponNo})</span>
                  <span className="text-xs text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded">
                    พร้อมใช้ {selectedCoupon.availableQty.toLocaleString()} ตัน
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-44">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={selectedCoupon.availableQty}
                    placeholder={`ระบุตัน (สูงสุด ${selectedCoupon.availableQty})`}
                    value={reserveAmount}
                    onChange={(e) => setReserveAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 font-medium text-right"
                    data-testid="input-reserve-amount"
                  />
                  <span className="absolute right-8 top-2 text-xs text-slate-400">ตัน</span>
                </div>

                <button
                  type="button"
                  onClick={() => setReserveAmount(String(selectedCoupon.availableQty))}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  ทั้งหมด
                </button>

                <button
                  type="button"
                  onClick={handleReserve}
                  disabled={submitting || !reserveAmount || Number(reserveAmount) <= 0}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50 transition"
                  data-testid="btn-confirm-reserve-coupon"
                >
                  {submitting ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <span>ยืนยันการจอง</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {Number(reserveAmount) > 0 && Number(reserveAmount) <= selectedCoupon.availableQty && (
              <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-600">
                <Clock className="h-3.5 w-3.5 text-blue-500" />
                <span>
                  ตัวอย่างผลลัพธ์: หลังการจอง ยอดพร้อมใช้จะคงเหลือ{' '}
                  <strong className="text-emerald-700">
                    {(selectedCoupon.availableQty - Number(reserveAmount)).toLocaleString()} ตัน
                  </strong>{' '}
                  (ยอด native ใน WinSpeed ยังไม่ถูกตัดจนกว่าจะส่งของจริง)
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
