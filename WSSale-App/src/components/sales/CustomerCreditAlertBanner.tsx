import { AlertCircle, AlertTriangle, Clock, CreditCard, ShieldAlert } from 'lucide-react';
import type { CustomerCreditStatus } from '../../types';

export function CustomerCreditAlertBanner({
  creditStatus,
  loading = false,
}: {
  creditStatus: CustomerCreditStatus | null;
  loading?: boolean;
}) {
  if (loading && !creditStatus) {
    return (
      <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
        กำลังตรวจสอบวงเงินเครดิต และอายุหนี้ (Aging)...
      </div>
    );
  }
  if (!creditStatus) return null;

  const isOverCredit = Boolean(creditStatus.isOverCreditLimit ?? creditStatus.isCreditLimitExceeded);
  const isOverAging = Boolean(creditStatus.isOverAging ?? creditStatus.isAgingExceeded);
  const isOverPolicyMax = Boolean(creditStatus.isOverPolicyMaxAging);
  const isCashOnly = Boolean(creditStatus.isCashOnly ?? creditStatus.agingLimitDays === 0);
  const maxPolicyDays = creditStatus.maxPolicyAgingDays ?? 90;
  const isCritical = Boolean(creditStatus.blocked || creditStatus.creditHold || isOverPolicyMax);
  const hasWarnings =
    isOverCredit ||
    isOverAging ||
    Boolean(creditStatus.isConfiguredAgingOverPolicyMax) ||
    (creditStatus.warnings?.length ?? 0) > 0;

  const overdueList = creditStatus.overdueInvoices || [];
  const totalOverdueCount = overdueList.length;

  return (
    <div className="mt-2 space-y-1.5">
      {/* Compact Summary Bar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-1.5 text-[11px] rounded-lg px-2.5 py-1.5 border ${
          isCritical
            ? 'bg-red-50/70 border-red-200'
            : hasWarnings
              ? 'bg-amber-50/70 border-amber-200'
              : 'bg-gray-50 border-gray-100'
        }`}
      >
        <div className="flex items-center gap-1.5 text-gray-700 font-medium flex-wrap">
          <CreditCard size={13} className={isCritical ? 'text-red-600' : 'text-[#0C447C]'} />
          <span>
            วงเงิน:{' '}
            <strong>
              {creditStatus.creditLimit != null && creditStatus.creditLimit > 0
                ? `฿${creditStatus.creditLimit.toLocaleString()}`
                : 'ไม่จำกัด'}
            </strong>
          </span>
          <span className="text-gray-300">|</span>
          <span>
            ยอดค้าง:{' '}
            <strong className={isOverCredit ? 'text-red-600 font-bold' : 'text-gray-800'}>
              ฿{(creditStatus.totalOutstanding || 0).toLocaleString()}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-gray-700 font-medium flex-wrap">
          <Clock size={13} className={isOverAging || isOverPolicyMax ? 'text-red-600' : 'text-amber-600'} />
          {isCashOnly ? (
            <span className={`font-bold ${isOverAging ? 'text-red-700' : 'text-emerald-700'}`}>
              เงินสด (0 วัน){creditStatus.maxAgingDays > 0 ? ` · ค้างสูงสุด ${creditStatus.maxAgingDays} วัน` : ''}
            </span>
          ) : (
            <span>
              Aging:{' '}
              <strong className={isOverAging || isOverPolicyMax ? 'text-red-700 font-extrabold' : 'text-gray-800'}>
                {creditStatus.maxAgingDays}
              </strong>
              /{creditStatus.agingLimitDays} วัน
              {creditStatus.isUsingDefaultAging && (
                <span className="ml-1 text-[10px] text-blue-700 font-normal">(มาตรฐาน)</span>
              )}
            </span>
          )}
          {isOverPolicyMax && (
            <span className="rounded-full bg-red-600 text-white px-1.5 py-0.5 font-bold text-[10px]">
              เกินนโยบาย {maxPolicyDays} วัน
            </span>
          )}
          {creditStatus.creditHold && (
            <span className="rounded-full bg-red-700 text-white px-1.5 py-0.5 font-bold text-[10px] flex items-center gap-0.5">
              <ShieldAlert size={10} /> Hold
            </span>
          )}
        </div>
      </div>

      {/* Critical Red Banner: Blocked / Credit Hold / Over Policy Max */}
      {isCritical && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 p-2.5 text-xs text-red-950 shadow-xs">
          <div className="flex items-center gap-1.5 font-extrabold text-red-700">
            <AlertTriangle size={15} className="shrink-0" />
            <span>
              {creditStatus.blocked
                ? 'ไม่อนุญาตให้เปิดบิลขาย (Strict Rule / Credit Hold)'
                : `คำเตือนวิกฤติ: อายุหนี้ค้างชำระเกินเพดานนโยบาย (${creditStatus.maxAgingDays} > ${maxPolicyDays} วัน)`}
            </span>
          </div>
          {creditStatus.blockReasons && creditStatus.blockReasons.length > 0 && (
            <div className="mt-1 space-y-0.5 text-[11px] font-semibold text-red-900">
              {creditStatus.blockReasons.map((r, i) => (
                <div key={i}>• {r}</div>
              ))}
            </div>
          )}
          {creditStatus.warnings && creditStatus.warnings.length > 0 && (
            <div className="mt-1 space-y-0.5 text-[11px] text-red-900">
              {creditStatus.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}
          {totalOverdueCount > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-red-200/80 text-[10px] text-red-800 flex flex-wrap gap-x-2 gap-y-0.5">
              <span className="font-bold">บิลค้างเกินกำหนด:</span>
              {overdueList.slice(0, 3).map((inv, idx) => (
                <span key={idx} className="font-mono bg-white/80 px-1.5 py-0.2 rounded border border-red-200">
                  {inv.docuNo} ({inv.ageDays} วัน · ฿{inv.unpaidAmnt.toLocaleString()})
                </span>
              ))}
              {totalOverdueCount > 3 && (
                <span className="font-semibold">+{totalOverdueCount - 3} ใบ</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Warning Banner (Exceeded limit/aging/configured limit <= policy max, not blocked) */}
      {!isCritical && hasWarnings && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-2.5 text-xs text-amber-950">
          <div className="flex items-center gap-1.5 font-extrabold text-amber-900">
            <AlertCircle size={15} className="shrink-0 text-amber-700" />
            <span>แจ้งเตือน: เกินวงเงินเครดิต / อายุหนี้ Aging</span>
          </div>
          {creditStatus.warnings && creditStatus.warnings.length > 0 && (
            <div className="mt-1 space-y-0.5 text-[11px] text-amber-900">
              {creditStatus.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}
          {totalOverdueCount > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-amber-200/80 text-[10px] text-amber-900 flex flex-wrap gap-x-2 gap-y-0.5">
              <span className="font-bold">บิลค้างเกินกำหนด:</span>
              {overdueList.slice(0, 3).map((inv, idx) => (
                <span key={idx} className="font-mono bg-white/80 px-1.5 py-0.2 rounded border border-amber-200">
                  {inv.docuNo} ({inv.ageDays} วัน · ฿{inv.unpaidAmnt.toLocaleString()})
                </span>
              ))}
              {totalOverdueCount > 3 && (
                <span className="font-semibold">+{totalOverdueCount - 3} ใบ</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

