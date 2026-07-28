/**
 * RebatePlanApproval.tsx — สายอนุมัติของแบบขออนุมัติรายการส่งเสริมการขาย
 *
 * เอกสารนี้เป็นต้นทางที่กำหนด "ราคาสุทธิ" ให้ใบขอเคลียร์ทุกใบใช้อ้างอิง
 * ฟอร์มกระดาษ (เช่น เลขที่ 14/2568) มีลายเซ็น 4 ตำแหน่ง
 *
 * ⚠ ชั้นที่ 3 คือ "ผู้จัดการฝ่ายขาย" ไม่ใช่ "ผู้จัดการฝ่ายตลาด" อย่างใบขอเคลียร์
 *   ถ้าใช้ป้ายเดียวกันทั้งสองเอกสาร ผู้อนุมัติจะเข้าใจผิดว่าตนต้องเซ็นใบไหน
 */
import { useEffect, useState } from 'react';
import { X, Check, Ban, Send, Printer, Loader2 } from 'lucide-react';
import {
  fetchRebatePlanApprovals, submitRebatePlan, approveRebatePlan, rejectRebatePlan,
} from '../../services/api';
import type { RebatePlan } from '../../types';

const NAVY = '#0C447C';

const TIER_LABEL: Record<number, string> = {
  1: 'ผู้แทนขาย (ผู้ยื่น)',
  2: 'ผู้จัดการภาค',
  3: 'ผู้จัดการฝ่ายขาย',
  4: 'กรรมการบริหาร',
};

export const PLAN_STATUS: Record<string, string> = {
  DRAFT: 'ร่าง',
  TIER2_PENDING: 'รอผู้จัดการภาค',
  TIER3_PENDING: 'รอผู้จัดการฝ่ายขาย',
  TIER4_PENDING: 'รอกรรมการบริหาร',
  APPROVED: 'อนุมัติแล้ว',
  ACTIVE: 'ใช้งาน',
  REJECTED: 'ไม่อนุมัติ',
  CLOSED: 'ปิดแล้ว',
  INACTIVE: 'ยกเลิก',
};

export function PlanApprovalDialog({ plan, onClose, onChanged }:
  { plan: RebatePlan; onClose: () => void; onChanged: () => void }) {

  const planId = Number((plan as any).PlanId ?? (plan as any).Id);
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState('');

  const load = async () => {
    try { setRows(await fetchRebatePlanApprovals(planId)); }
    catch (e) { setErr((e as Error).message); setRows([]); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [planId]);

  const status = String((plan as any).Status || 'DRAFT');
  const tier = Number((plan as any).CurrentTier || 0);
  const canSubmit = ['DRAFT', 'REJECTED'].includes(status);
  const inFlight = [2, 3, 4].includes(tier) && status.endsWith('_PENDING');

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr('');
    try { await fn(); await load(); onChanged(); }
    catch (e: unknown) { setErr((e as Error).message || 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4 print:static print:bg-white print:p-0"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col print:max-h-none print:shadow-none"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 print:hidden">
          <div>
            <h2 className="text-lg font-bold" style={{ color: NAVY }}>
              แบบขออนุมัติรายการส่งเสริมการขาย
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {(plan as any).PlanNo} · {(plan as any).Title || '—'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
              <Printer size={15} /> พิมพ์
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 print:overflow-visible">
          <div className="text-center print:block hidden">
            <h1 className="text-xl font-bold">แบบขออนุมัติรายการส่งเสริมการขาย</h1>
            <p className="text-sm text-gray-600">เลขที่ {(plan as any).PlanNo}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[
              ['ภาค', (plan as any).Region || 'ทุกภาค'],
              ['สูตรปุ๋ย', (plan as any).GoodCodePattern || 'ทุกสูตร'],
              ['ราคาสุทธิ', (plan as any).NetPrice != null ? `฿${Number((plan as any).NetPrice).toLocaleString('th-TH')}` : '—'],
              ['สถานะ', PLAN_STATUS[status] || status],
            ].map(([k, v]) => (
              <div key={k as string} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <div className="text-[11px] text-gray-500">{k}</div>
                <div className="font-semibold text-gray-800">{v as string}</div>
              </div>
            ))}
          </div>

          <p className="text-sm text-gray-600">
            <span className="font-semibold">ระยะเวลา: </span>
            {(plan as any).ValidFrom ? new Date((plan as any).ValidFrom).toLocaleDateString('th-TH') : '—'}
            {' – '}
            {(plan as any).ValidTo ? new Date((plan as any).ValidTo).toLocaleDateString('th-TH') : '—'}
          </p>

          <div>
            <h3 className="text-sm font-bold mb-2" style={{ color: NAVY }}>ลำดับการอนุมัติ</h3>
            {rows === null ? (
              <div className="py-6 text-center text-gray-400"><Loader2 className="animate-spin inline" size={18} /></div>
            ) : (
              <div className="space-y-2">
                {[1, 2, 3, 4].map(t => {
                  const a = rows.find(x => Number(x.Tier) === t);
                  const isCurrent = inFlight && tier === t;
                  return (
                    <div key={t}
                      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 border text-sm
                        ${a?.Decision === 'APPROVED' ? 'bg-emerald-50 border-emerald-100'
                          : a?.Decision === 'REJECTED' ? 'bg-red-50 border-red-100'
                          : isCurrent ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100'}`}>
                      <div>
                        <div className="font-semibold text-gray-800">ชั้นที่ {t} · {TIER_LABEL[t]}</div>
                        {a?.Reason && <div className="text-[11px] text-gray-500 mt-0.5">{a.Reason}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold">
                          {a?.Decision === 'APPROVED' ? 'อนุมัติ'
                            : a?.Decision === 'REJECTED' ? 'ไม่อนุมัติ'
                            : isCurrent ? 'รออนุมัติ' : '—'}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {a?.DecidedByName || ''}
                          {a?.DecidedAt ? ` · ${new Date(a.DecidedAt).toLocaleDateString('th-TH')}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {status === 'REJECTED' && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              ยื่นใหม่ได้ — ระบบจะล้างลายเซ็นของฉบับก่อนแก้ทิ้งทั้งหมด เพื่อไม่ให้เอกสารที่แก้แล้วถือลายเซ็นเดิม
            </p>
          )}

          <div className="hidden print:grid grid-cols-4 gap-4 pt-10 text-center text-xs">
            {[1, 2, 3, 4].map(t => (
              <div key={t}>
                <div className="border-t border-gray-400 pt-1 mt-10">{TIER_LABEL[t]}</div>
                <div className="text-gray-500">วันที่ ......../......../........</div>
              </div>
            ))}
          </div>

          {err && <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 print:hidden">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 print:hidden">
          {canSubmit ? (
            <button disabled={busy} onClick={() => run(() => submitRebatePlan(planId))}
              className="w-full inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50"
              style={{ background: NAVY }}>
              <Send size={15} /> {status === 'REJECTED' ? 'ยื่นขออนุมัติใหม่' : 'ยื่นขออนุมัติ'}
            </button>
          ) : inFlight ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={reason} onChange={e => setReason(e.target.value)}
                placeholder="เหตุผล (บังคับกรอกเมื่อตีกลับ)"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <button disabled={busy || !reason.trim()} onClick={() => run(() => rejectRebatePlan(planId, reason.trim()))}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-red-200 text-red-700 text-sm font-bold disabled:opacity-50">
                <Ban size={15} /> ตีกลับ
              </button>
              <button disabled={busy} onClick={() => run(() => approveRebatePlan(planId))}
                className="inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                style={{ background: '#059669' }}>
                <Check size={15} /> อนุมัติชั้นที่ {tier}
              </button>
            </div>
          ) : (
            <p className="text-center text-sm text-gray-400">เอกสารนี้ไม่อยู่ระหว่างการอนุมัติ</p>
          )}
        </div>
      </div>
    </div>
  );
}
