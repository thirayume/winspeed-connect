import { useState } from 'react';
import { X, Lock, Unlock, Truck, Package, FileText, CalendarClock, CheckCircle2, Clock3 } from 'lucide-react';
import { cn } from '../ui/Base';
import { SOStatusBadge } from './SOStatusBadge';
import { useErpStore } from '../../store/erp-store';
import { approveGiveawayLine, confirmSO, cancelSO, shipSO, moveToPicking, createUnlockRequest } from '../../services/api';
import { appConfirm } from '../ui/AppAlert';
import { RequestActionModal, type RequestActionType } from '../papertrail/RequestActionModal';
import { useAuthStore } from '../../store/auth-store';
import { canViewRebateAmounts } from '../../utils/permissions';
import type { SalesOrder } from '../../types';

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('th-TH', {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SODetailsPanel({
  so,
  onClose,
  onUpdate,
  onEdit,
  isInline = false,
}: {
  so: SalesOrder | null;
  onClose?: () => void;
  onUpdate: () => void;
  onEdit?: () => void;
  isInline?: boolean;
}) {
  const unlockRequests = useErpStore(s => s.unlockRequests);
  const currentUser = useAuthStore(s => s.user);
  const canSeeRebate = canViewRebateAmounts(currentUser);
  const canApproveGiveaway = currentUser?.role === 'MANAGER' || currentUser?.role === 'ADMIN';
  const [busy, setBusy] = useState(false);
  const [requestModalConfig, setRequestModalConfig] = useState<{ isOpen: boolean, type: RequestActionType }>({ isOpen: false, type: 'EDIT' });

  if (!so) {
    if (isInline) {
      return (
        <div className="flex flex-col items-center justify-center h-full opacity-20 text-center">
          <Package size={64} className="mb-4" />
          <p className="font-semibold">เลือกบิลจากรายการ</p>
        </div>
      );
    }
    return null;
  }

  const pendingReq = unlockRequests.find(r => r.SoId === so.id);
  const totalAmt   = (so.lines || []).filter(l => !l.isGiveaway).reduce((s, l) => s + l.qtyTon * l.pricePerTon, 0);
  const totalTon   = (so.lines || []).filter(l => !l.isGiveaway).reduce((s, l) => s + l.qtyTon, 0);
  const totalRebate = canSeeRebate
    ? (so.lines || []).filter(l => !l.isGiveaway && (l.rebateAmount || 0) > 0).reduce((s, l) => s + (l.rebateAmount || 0), 0)
    : 0;

  async function doAction(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); onUpdate(); }
    catch (e: unknown) { alert((e as Error).message || 'เกิดข้อผิดพลาด'); }
    finally { setBusy(false); }
  }

  async function approveLine(lineNum: number) {
    const note = window.prompt('หมายเหตุการอนุมัติของแถม (ไม่บังคับ):') || undefined;
    await doAction(() => approveGiveawayLine(so.id!, lineNum, note));
  }

  const content = (
    <div className={cn('flex flex-col h-full bg-white', !isInline && 'w-full max-w-md shadow-2xl border-l border-gray-200')}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold" style={{ color: '#0C447C' }}>
              <span className="text-sm px-1.5 py-0.5 rounded bg-blue-100 text-[#0C447C] mr-2">{so.soPrefix}</span>
              {so.docuNo || (so as any).importedDocuNo || so.wfRef || `#${so.id}`}
            </h2>
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

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-5">
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
          {so.requestedAt && (
            <div className="col-span-2 flex items-center gap-2 p-3 rounded-xl bg-blue-50 border border-blue-100">
              <CalendarClock size={15} className="text-blue-500 shrink-0" />
              <div>
                <p className="text-xs text-blue-500">วันที่แจ้ง/เวลานัด</p>
                <p className="font-bold text-blue-900">{new Date(so.requestedAt).toLocaleString('th-TH')}</p>
              </div>
            </div>
          )}
          {(so.isOwnTruck || so.noTruckRequired || so.pSling) && (
            <div className="col-span-2 flex flex-wrap gap-1.5">
              {so.isOwnTruck && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-700 bg-gray-100 rounded-full px-2 py-1"><CheckCircle2 size={11} /> ขึ้นรถตัวเอง</span>}
              {so.noTruckRequired && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-700 bg-gray-100 rounded-full px-2 py-1"><CheckCircle2 size={11} /> ไม่ต้องระบุรถ</span>}
              {so.pSling && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-700 bg-gray-100 rounded-full px-2 py-1"><CheckCircle2 size={11} /> P-Sling</span>}
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
            <p className="text-gray-500">บิล locked — คลังกำลังดำเนินการ</p>
          </div>
        )}

        {so.statusTimeline && so.statusTimeline.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
              <Clock3 size={13} /> เวลาสถานะ
            </h3>
            <div className="rounded-xl border border-gray-100 overflow-hidden bg-white">
              {so.statusTimeline.map((item, idx) => {
                const reached = !!item.at;
                const isCurrent = item.status === so.status;
                return (
                  <div key={`${item.status}-${idx}`} className={`flex items-start gap-3 px-3 py-2.5 border-b border-gray-50 last:border-b-0 ${isCurrent ? 'bg-blue-50/60' : ''}`}>
                    <div className={`mt-0.5 h-2.5 w-2.5 rounded-full shrink-0 ${reached ? 'bg-[#0C447C]' : 'bg-gray-200'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-bold ${reached ? 'text-gray-800' : 'text-gray-400'}`}>{item.label}</span>
                        <span className={`text-[10px] font-mono whitespace-nowrap ${reached ? 'text-gray-600' : 'text-gray-300'}`}>{formatDateTime(item.at)}</span>
                      </div>
                      {item.source === 'weigh_ticket' && (
                        <div className="text-[9px] text-emerald-600 font-bold mt-0.5">เวลาออกจากข้อมูลชั่ง</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Line items table */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">รายการสินค้า</h3>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm min-w-full">
              <thead className="bg-gray-50 border-b border-gray-100 whitespace-nowrap">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">สินค้า</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">ตัน</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">ยอด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(so.lines || []).map((l, i) => {
                  const lineNum = (l as any).lineNum || l.lineNo || i + 1;
                  const giveawayStatus = l.giveawayApprovalStatus || (l.isGiveaway ? 'PENDING' : null);
                  const giveawayApproved = giveawayStatus === 'APPROVED';
                  return (
                    <tr key={i} className={l.isGiveaway ? 'bg-green-50/50' : ''}>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="font-medium text-gray-800 text-xs">{l.goodCode}</div>
                        <div className="text-[10px] text-gray-400 truncate max-w-[140px]">{l.goodName}</div>
                        {l.isGiveaway && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-[9px] text-green-600 font-bold">ของแถม</span>
                            <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${
                              giveawayApproved
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-amber-200 bg-amber-50 text-amber-700'
                            }`}>
                              {giveawayApproved ? 'อนุมัติแล้ว' : 'รออนุมัติ'}
                            </span>
                            {canApproveGiveaway && !giveawayApproved && (
                              <button
                                type="button"
                                onClick={() => approveLine(lineNum)}
                                disabled={busy}
                                className="rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                              >
                                อนุมัติ
                              </button>
                            )}
                          </div>
                        )}
                        {l.isGiveaway && giveawayApproved && (l.giveawayApprovedByName || l.giveawayApprovedAt) && (
                          <div className="mt-0.5 text-[9px] text-gray-400">
                            {l.giveawayApprovedByName || 'Manager'} {l.giveawayApprovedAt ? formatDateTime(l.giveawayApprovedAt) : ''}
                          </div>
                        )}
                        {canSeeRebate && (l.rebatePerTon || 0) > 0 && (
                          <div className="text-[9px] text-orange-500">รีเบท ฿{(l.rebatePerTon || 0).toFixed(0)}/ตัน</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-gray-600 tabular-nums whitespace-nowrap">{l.qtyTon.toFixed(3)}</td>
                      <td className="px-3 py-2.5 text-right text-xs font-medium text-gray-800 tabular-nums whitespace-nowrap">
                        {l.isGiveaway ? '–' : `฿${(l.qtyTon * l.pricePerTon).toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
                      </td>
                    </tr>
                  );
                })}
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
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => doAction(() => confirmSO(so.id!))}
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60 transition-opacity"
              style={{ background: '#0C447C' }}
            >
              {busy ? 'กำลังยืนยัน...' : 'ยืนยันบิล'}
            </button>
            {onEdit && (
              <button
                disabled={busy}
                onClick={onEdit}
                className="flex-1 py-2.5 rounded-xl border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 text-sm font-bold disabled:opacity-60 transition-colors"
              >
                แก้ไขข้อมูล
              </button>
            )}
          </div>
        )}
        {so.status === 'CONFIRMED' && !pendingReq && (
          <button
            disabled={busy}
            onClick={() => doAction(() => moveToPicking(so.id!))}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60"
            style={{ background: '#F59E0B' }}
          >
            เริ่มรับสินค้า (Picking)
          </button>
        )}
        
        {['CONFIRMED', 'PICKING'].includes(so.status) && !pendingReq && (
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => setRequestModalConfig({ isOpen: true, type: 'EDIT' })}
              className="flex-1 py-2 rounded-xl border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 text-sm font-medium transition-colors"
            >
              ขอแก้ไข
            </button>
            <button
              disabled={busy}
              onClick={() => setRequestModalConfig({ isOpen: true, type: 'CANCEL' })}
              className="flex-1 py-2 rounded-xl border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 text-sm font-medium transition-colors"
            >
              ขอยกเลิก
            </button>
          </div>
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
            onClick={async () => {
              if (await appConfirm('ยืนยันยกเลิกบิล?')) doAction(() => cancelSO(so.id!, 'ยกเลิกเอกสารร่าง'));
            }}
            className="w-full py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50"
          >
            ยกเลิกเอกสารร่าง
          </button>
        )}
      </div>

      <RequestActionModal
        isOpen={requestModalConfig.isOpen}
        actionType={requestModalConfig.type}
        wfRef={so.wfRef || ''}
        onClose={() => setRequestModalConfig({ isOpen: false, type: 'EDIT' })}
        onSubmit={(reason, type) => {
          doAction(async () => {
            await createUnlockRequest(so.id!, reason, type);
            alert(`ส่งคำขอ${type === 'EDIT' ? 'แก้ไข' : 'ยกเลิก'}แล้ว รออนุมัติจากหัวหน้างาน`);
            setRequestModalConfig({ isOpen: false, type: 'EDIT' });
          });
        }}
      />
    </div>
  );

  if (isInline) return content;

  return (
    <div className="fixed inset-0 z-[70] bg-black/20 flex justify-end" onClick={onClose}>
      <div className="h-full w-full max-w-md" onClick={e => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
