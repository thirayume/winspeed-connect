import { useEffect, useState } from 'react';
import { X, AlertTriangle, RefreshCw, CheckCircle2, Sparkles, Clock } from 'lucide-react';
import {
  fetchQuotationExtendPreview,
  extendQuotationValidity,
  type QuotationExtendPreview,
  type QuotationExtendPreviewLine,
} from '../../services/api';
import type { Quotation } from '../../types';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { formatThaiShortDate, getLocalDateStr, MAE_PUI_GOOD_GROUP_ID } from '../../utils/quotation-policy';

interface Props {
  quote: Quotation;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function ExtendMaePuiQuoteModal({ quote, onClose, onDone }: Props) {
  const [preview, setPreview] = useState<QuotationExtendPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [validUntil, setValidUntil] = useState('');
  const [editedPrices, setEditedPrices] = useState<Record<string, string>>({});
  const [priceReviewed, setPriceReviewed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    fetchQuotationExtendPreview(quote.Id)
      .then(res => {
        if (cancelled) return;
        setPreview(res);
        const maxDays = res.maxValidDays ?? res.maePuiMaxValidDays ?? 3;
        setValidUntil(res.maxValidUntil || getLocalDateStr(maxDays, res.today));
        const initPrices: Record<string, string> = {};
        for (const l of res.lines || []) {
          const key = lineKey(l);
          initPrices[key] = String(l.PricePerTon ?? 0);
        }
        setEditedPrices(initPrices);
      })
      .catch(e => {
        if (!cancelled) setErr(e?.message || 'โหลดข้อมูลสำหรับทบทวนราคาไม่สำเร็จ');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [quote.Id]);

  const lineKey = (l: QuotationExtendPreviewLine) => `${l.LineNum ?? ''}:${l.GoodId}`;
  const isLineMaePui = (l: QuotationExtendPreviewLine) =>
    Boolean(l.IsMaePui) || Number(l.GoodGroupID) === MAE_PUI_GOOD_GROUP_ID || String(l.GoodGroupName || '').includes('แม่ปุ๋ย');

  const lines = preview?.lines || [];
  const maxDays = preview?.maxValidDays ?? preview?.maePuiMaxValidDays ?? (quote.MaePuiMaxValidDays || 3);
  const todayStr = preview?.today || getLocalDateStr(0);
  const maxValidUntil = preview?.maxValidUntil || getLocalDateStr(maxDays, todayStr);

  const hasAnyAnnounced = lines.some(l => !l.IsGiveaway && l.CurrentAnnouncedPrice != null);

  function applyAllAnnouncedPrices() {
    setEditedPrices(prev => {
      const next = { ...prev };
      for (const l of lines) {
        if (l.IsGiveaway || l.CurrentAnnouncedPrice == null) continue;
        next[lineKey(l)] = String(l.CurrentAnnouncedPrice);
      }
      return next;
    });
  }

  const oldTotal = lines.reduce(
    (s, l) => s + (l.IsGiveaway ? 0 : Number(l.QtyTon || 0) * Number(l.PricePerTon || 0)),
    0
  );
  const newTotal = lines.reduce((s, l) => {
    if (l.IsGiveaway) return s;
    const p = Number(editedPrices[lineKey(l)] ?? l.PricePerTon ?? 0);
    return s + Number(l.QtyTon || 0) * (Number.isFinite(p) ? p : 0);
  }, 0);

  async function handleSubmit() {
    if (!preview) return;
    if (!validUntil || validUntil < todayStr) {
      setErr('วันหมดอายุใหม่ต้องไม่ก่อนวันนี้');
      return;
    }
    if (preview.hasMaePui && validUntil > maxValidUntil) {
      setErr(`ใบเสนอราคากลุ่ม "แม่ปุ๋ย" ขอขยายเวลาได้สูงสุดครั้งละ ${maxDays} วันเท่านั้น (ไม่เกินวันที่ ${formatThaiShortDate(maxValidUntil)})`);
      return;
    }
    if (preview.requiresPriceReview && !priceReviewed) {
      setErr('กรุณายืนยันว่าได้ทบทวนราคาก่อนขอขยายเวลา');
      return;
    }

    const payloadLines: Array<{ lineNum?: number; id?: number; goodId: string; pricePerTon: number }> = [];
    for (const l of lines) {
      if (l.IsGiveaway) continue;
      const rawPrice = editedPrices[lineKey(l)] ?? String(l.PricePerTon ?? 0);
      const parsedPrice = Number(rawPrice);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        setErr(`กรุณาระบุราคาที่ถูกต้องสำหรับสินค้า ${l.GoodName || l.GoodId}`);
        return;
      }
      payloadLines.push({
        lineNum: l.LineNum,
        id: l.Id,
        goodId: String(l.GoodId),
        pricePerTon: parsedPrice,
      });
    }

    setSaving(true);
    setErr('');
    try {
      const res = await extendQuotationValidity(quote.Id, {
        validUntil,
        priceReviewed: true,
        lines: payloadLines,
      });
      const updatedMsg = res.updatedPriceCount
        ? `ขยายอายุ ${quote.QuoteNo} ถึง ${formatThaiShortDate(res.validUntil)} และทบทวน/ปรับราคา ${res.updatedPriceCount} รายการเรียบร้อย`
        : `ทบทวนราคาและขยายอายุ ${quote.QuoteNo} ถึง ${formatThaiShortDate(res.validUntil)} เรียบร้อย`;
      onDone(updatedMsg);
    } catch (e: any) {
      setErr(e?.message || 'ขอขยายเวลาไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  const quickDayOptions = Array.from({ length: Math.min(maxDays, 7) }, (_, i) => i + 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4 backdrop-blur-[1px]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-amber-50/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-amber-100 text-amber-800 shrink-0">
              <Clock size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm sm:text-base text-gray-900 truncate">
                ขอขยายอายุ & ทบทวนราคา — {quote.QuoteNo}
              </h3>
              <p className="text-xs text-gray-600 truncate">
                ลูกค้า: {quote.CustName} · วันหมดอายุเดิม: {formatThaiShortDate(preview?.currentValidUntil || quote.ValidUntil)}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="text-gray-400 hover:text-gray-600 rounded-full p-1.5 hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-sm text-gray-500">
              <RefreshCw size={16} className="animate-spin" /> กำลังโหลดข้อมูลราคาปัจจุบัน...
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
                <AlertTriangle size={16} className="text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-amber-950">
                    เงื่อนไขใบเสนอราคามีสินค้ากลุ่ม &quot;แม่ปุ๋ย&quot;
                  </div>
                  <p className="leading-relaxed">
                    ขอขยายเวลาได้สูงสุดครั้งละ <span className="font-bold underline">{maxDays} วัน</span> (ไม่เกินวันที่{' '}
                    <span className="font-bold">{formatThaiShortDate(maxValidUntil)}</span>) และ{' '}
                    <span className="font-bold">ต้องทบทวนราคาสินค้าทุกรายการเทียบกับราคาปัจจุบันเสมอ</span>
                  </p>
                </div>
              </div>

              {/* Extend date controls */}
              <div className="rounded-xl border border-gray-200 p-4 space-y-3 bg-gray-50/50">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label className="text-xs font-bold text-gray-700">กำหนดวันยืนราคาใหม่ (สูงสุด +{maxDays} วัน)</label>
                  <div className="flex flex-wrap gap-1.5">
                    {quickDayOptions.map(d => {
                      const target = getLocalDateStr(d, todayStr);
                      const active = validUntil === target;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setValidUntil(target)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                            active
                              ? 'bg-[#0C447C] text-white border-[#0C447C]'
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50'
                          }`}
                        >
                          +{d} วัน
                        </button>
                      );
                    })}
                    {maxDays > 7 && (
                      <button
                        type="button"
                        onClick={() => setValidUntil(maxValidUntil)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                          validUntil === maxValidUntil
                            ? 'bg-[#0C447C] text-white border-[#0C447C]'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50'
                        }`}
                      >
                        +{maxDays} วัน (สูงสุด)
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <ThaiDatePicker
                    value={validUntil}
                    min={todayStr}
                    max={preview?.hasMaePui ? maxValidUntil : undefined}
                    onChange={setValidUntil}
                  />
                  <div className="text-xs text-gray-600">
                    ยืนราคาถึงวันที่: <span className="font-bold text-[#0C447C]">{formatThaiShortDate(validUntil)}</span>
                  </div>
                </div>
              </div>

              {/* Price Review Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wide flex items-center gap-1.5">
                    <Sparkles size={14} className="text-amber-600" />
                    รายการสินค้าที่ต้องทบทวนราคา ({lines.filter(l => !l.IsGiveaway).length} รายการ)
                  </h4>
                  {hasAnyAnnounced && (
                    <button
                      type="button"
                      onClick={applyAllAnnouncedPrices}
                      className="text-xs font-bold text-[#0C447C] bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      ใช้ราคากลางปัจจุบันทุกรายการ
                    </button>
                  )}
                </div>

                <div className="border border-gray-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-3 py-2 font-bold">สินค้า</th>
                        <th className="text-right px-3 py-2 font-bold">จำนวน (ตัน)</th>
                        <th className="text-right px-3 py-2 font-bold">ราคาเดิม</th>
                        <th className="text-right px-3 py-2 font-bold">ราคากลางวันนี้</th>
                        <th className="text-right px-3 py-2 font-bold w-36">ราคาเสนอใหม่ (฿/ตัน)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lines.map(l => {
                        const key = lineKey(l);
                        const newPrice = Number(editedPrices[key] ?? l.PricePerTon ?? 0);
                        const announced = l.CurrentAnnouncedPrice;
                        const diffVsAnnounced =
                          announced != null && !l.IsGiveaway ? Number((newPrice - announced).toFixed(2)) : null;

                        return (
                          <tr key={key} className="hover:bg-gray-50/70">
                            <td className="px-3 py-2.5">
                              <div className="font-bold text-gray-900">{l.GoodName}</div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px] text-gray-500">
                                <span className="font-mono">{l.GoodCode}</span>
                                {isLineMaePui(l) && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold border border-amber-200">
                                    แม่ปุ๋ย
                                  </span>
                                )}
                                {l.IsGiveaway && (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">
                                    ของแถม
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-700">
                              {Number(l.QtyTon || 0).toLocaleString('th-TH', { maximumFractionDigits: 3 })}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-gray-500">
                              {l.IsGiveaway ? '-' : `฿${Number(l.PricePerTon || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono">
                              {l.IsGiveaway ? (
                                '-'
                              ) : announced != null ? (
                                <div className="space-y-0.5">
                                  <div className="font-bold text-[#0C447C]">
                                    ฿{announced.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                                  </div>
                                  {diffVsAnnounced !== null && diffVsAnnounced !== 0 && (
                                    <div className={`text-[10px] font-bold ${diffVsAnnounced < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                      {diffVsAnnounced > 0 ? `+${diffVsAnnounced.toLocaleString()}` : diffVsAnnounced.toLocaleString()} จากราคากลาง
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-400">ไม่มีราคาประกาศ</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {l.IsGiveaway ? (
                                <span className="text-gray-400">0</span>
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={editedPrices[key] ?? ''}
                                  onChange={e => setEditedPrices(prev => ({ ...prev, [key]: e.target.value }))}
                                  className="w-full text-right px-2.5 py-1.5 rounded-lg border border-gray-300 font-mono font-bold text-gray-900 focus:border-[#0C447C] focus:ring-1 focus:ring-[#0C447C] outline-none"
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Totals summary */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-xs">
                  <div className="text-gray-600">
                    ยอดรวมเดิม:{' '}
                    <span className="font-bold text-gray-800">
                      ฿{oldTotal.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="text-gray-800">
                    ยอดรวมหลังทบทวน:{' '}
                    <span className="font-bold text-sm text-[#0C447C]">
                      ฿{newTotal.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                    </span>
                    {Math.abs(newTotal - oldTotal) > 0.01 && (
                      <span className={`ml-2 font-bold ${newTotal >= oldTotal ? 'text-emerald-700' : 'text-rose-600'}`}>
                        ({newTotal > oldTotal ? '+' : ''}{(newTotal - oldTotal).toLocaleString('th-TH', { maximumFractionDigits: 2 })})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Mandatory confirmation checkbox */}
              <label className="flex items-start gap-2.5 p-3.5 rounded-xl border border-blue-200 bg-blue-50/50 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={priceReviewed}
                  onChange={e => setPriceReviewed(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
                />
                <span className="text-xs font-bold text-gray-800 leading-relaxed">
                  ข้าพเจ้าได้ทบทวนราคาสินค้ากลุ่ม &quot;แม่ปุ๋ย&quot; เทียบกับราคาปัจจุบันเรียบร้อยแล้ว และยืนยันขอขยายอายุใบเสนอราคาเป็น{' '}
                  <span className="text-[#0C447C] underline">{formatThaiShortDate(validUntil)}</span>
                </span>
              </label>

              {err && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{err}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={loading || saving || (preview?.requiresPriceReview && !priceReviewed)}
            onClick={handleSubmit}
            className="px-4 py-2 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 transition-opacity disabled:opacity-50"
            style={{ background: '#0C447C' }}
          >
            <CheckCircle2 size={15} />
            {saving ? 'กำลังบันทึก...' : 'ยืนยันทบทวนราคาและขยายเวลา'}
          </button>
        </div>
      </div>
    </div>
  );
}

