import { useState } from 'react';
import { X, Lock, Unlock, Truck, Package, FileText } from 'lucide-react';
import { cn } from '../ui/Base';
import { SOStatusBadge } from './SOStatusBadge';
import { useErpStore } from '../../store/erp-store';
import { confirmSO, cancelSO, shipSO, moveToPicking } from '../../services/api';
import type { SalesOrder } from '../../types';

export function SODetailsPanel({
  so,
  onClose,
  onUpdate,
  isInline = false,
}: {
  so: SalesOrder | null;
  onClose: () => void;
  onUpdate: () => void;
  isInline?: boolean;
}) {
  const unlockRequests = useErpStore(s => s.unlockRequests);
  const [busy, setBusy] = useState(false);

  if (!so) {
    if (isInline) {
      return (
        <div className="flex flex-col items-center justify-center h-full opacity-20 text-center">
          <Package size={64} className="mb-4" />
          <p className="font-semibold">เลือกใบสั่งขายจากรายการ</p>
        </div>
      );
    }
    return null;
  }

  const pendingReq = unlockRequests.find(r => r.SOID === String(so.id) && !r.resolved);
  const totalAmt   = (so.lines || []).filter(l => !l.isGiveaway).reduce((s, l) => s + l.qtyTon * l.pricePerTon, 0);
  const totalTon   = (so.lines || []).filter(l => !l.isGiveaway).reduce((s, l) => s + l.qtyTon, 0);
  const totalRebate = (so.lines || []).filter(l => !l.isGiveaway && (l.rebateAmount || 0) > 0).reduce((s, l) => s + (l.rebateAmount || 0), 0);

  async function doAction(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); onUpdate(); }
    catch (e: unknown) { alert((e as Error).message || 'เกิดข้อผิดพลาด'); }
    finally { setBusy(false); }
  }

  const content = (
    <div className={cn('flex flex-col h-full bg-white', !isInline && 'w-full max-w-md shadow-2xl border-l border-gray-200')}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold" style={{ color: '#0C447C' }}>{so.wfRef || `#${so.id}`}</h2>
            <SOStatusBadge status={so.status} isUnlockRequested={!!pendingReq} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{so.custName} · {so.createdAt?.slice(0, 10)}</p>
        </div>
        {!isInline && (
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Info cards */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {so.truckPlate && (
            <div className="col-span-2 flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <Truck size={15} className="text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">ทะเบียนรถ</p>
                <p className="font-mono font-bold text-gray-700">{so.truckPlate}</p>
              </div>
            </div>
          )}
          {so.controlTicketNo && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <FileText size={15} className="text-gray-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">ตั๋วคุม</p>
                <p className="font-mono text-xs font-bold text-gray-700">{so.controlTicketNo}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
            <Package size={15} className="text-gray-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">น้ำหนัก</p>
              <p className="font-bold text-gray-700">{totalTon.toFixed(3)} ตัน</p>
            </div>
          </div>
        </div>

        {/* Lock banner */}
        {pendingReq && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs">
            <Unlock className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-700">รอการอนุมัติปลดล็อก</p>
              <p className="text-red-500 mt-0.5">รอสุรชัยอนุมัติก่อนแก้ไขได้</p>
            </div>
          </div>
        )}
        {!pendingReq && so.status !== 'DRAFT' && so.status !== 'IMPORTED' && so.status !== 'CANCELLED' && (
          <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
            <Lock className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
            <p className="text-gray-500">ใบสั่งขาย locked — คลังกำลังดำเนินการ</p>
          </div>
        )}

        {/* Line items table */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">รายการสินค้า</h3>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">สินค้า</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">ตัน</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">ยอด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(so.lines || []).map((l, i) => (
                  <tr key={i} className={l.isGiveaway ? 'bg-green-50/50' : ''}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-gray-800 text-xs">{l.goodCode}</div>
                      <div className="text-[10px] text-gray-400 truncate max-w-[140px]">{l.goodName}</div>
                      {l.isGiveaway && <span className="text-[9px] text-green-600 font-bold">ของแถม</span>}
                      {(l.rebatePerTon || 0) > 0 && (
                        <div className="text-[9px] text-orange-500">รีเบท ฿{(l.rebatePerTon || 0).toFixed(0)}/ตัน</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-gray-600 tabular-nums">{l.qtyTon.toFixed(3)}</td>
                    <td className="px-3 py-2.5 text-right text-xs font-medium text-gray-800 tabular-nums">
                      {l.isGiveaway ? '–' : `฿${(l.qtyTon * l.pricePerTon).toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="space-y-1.5 pt-3 border-t border-gray-100">
          <div className="flex justify-between text-sm text-gray-500">
            <span>ยอดรวม</span>
            <span className="font-bold text-gray-800">฿{totalAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
          </div>
          {totalRebate > 0 && (
            <div className="flex justify-between text-xs text-orange-500">
              <span>รีเบทสะสม (accrual)</span>
              <span className="font-bold">฿{totalRebate.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>
            </div>
          )}
          {so.importedDocuNo && (
            <div className="flex justify-between text-xs text-emerald-600">
              <span>WINSpeed DocuNo</span>
              <span className="font-mono font-bold">{so.importedDocuNo}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="border-t border-gray-100 p-4 space-y-2.5">
        {so.status === 'DRAFT' && (
          <button
            disabled={busy}
            onClick={() => doAction(() => confirmSO(so.id!))}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60 transition-opacity"
            style={{ background: '#0C447C' }}
          >
            {busy ? 'กำลังยืนยัน...' : 'ยืนยันใบสั่งขาย'}
          </button>
        )}
        {so.status === 'CONFIRMED' && (
          <button
            disabled={busy}
            onClick={() => doAction(() => moveToPicking(so.id!))}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60"
            style={{ background: '#F59E0B' }}
          >
            เริ่มรับสินค้า (Picking)
          </button>
        )}
        {so.status === 'PICKING' && (
          <button
            disabled={busy}
            onClick={() => doAction(() => shipSO(so.id!))}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60"
            style={{ background: '#059669' }}
          >
            ส่งออก + สร้างไฟล์ WINSpeed
          </button>
        )}
        {(so.status === 'DRAFT') && (
          <button
            disabled={busy}
            onClick={() => {
              if (confirm('ยืนยันยกเลิกใบสั่งขาย?')) doAction(() => cancelSO(so.id!));
            }}
            className="w-full py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50"
          >
            ยกเลิก
          </button>
        )}
      </div>
    </div>
  );

  if (isInline) return content;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="h-full w-full max-w-md" onClick={e => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
