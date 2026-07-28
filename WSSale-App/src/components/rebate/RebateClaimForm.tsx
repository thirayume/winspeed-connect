/**
 * RebateClaimForm.tsx — ใบขอเคลียร์รายการส่งเสริมการขาย (R6-06)
 *
 * แทนแบบฟอร์มกระดาษ RBD68-049 ทั้งใบ ประกอบด้วย
 *   ClaimDialog       ยื่นใบขอเคลียร์แบบหลายบรรทัด (สูงสุด 6 ตามที่ backend รองรับ)
 *   ClaimDetailDialog ดูรายละเอียด สายอนุมัติ 4 ชั้น อนุมัติ/ตีกลับ และพิมพ์
 *
 * ผู้ใช้กรอกเฉพาะ ยอดขน · ราคาขาย · ราคาสุทธิ
 * คอลัมน์ "คืนรีเบท" และ "รวมเป็นเงิน" คำนวณให้เห็นทันที และฐานข้อมูลบังคับซ้ำอีกชั้น
 * จึงไม่มีทางกรอกยอดที่ไม่ตรงกับสูตร
 */
import { useEffect, useMemo, useState } from 'react';
import { Scissors, X, Plus, Trash2, Printer, Check, Ban, Loader2 } from 'lucide-react';
import {
  createRebateClaim, fetchRebateClaimDetail, approveRebateClaim, rejectRebateClaim,
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { RebatePool, RebateClaim } from '../../types';

const NAVY = '#0C447C';
const baht = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Line = { goodCode: string; goodName: string; qtyTon: string; pricePerTon: string; netPricePerTon: string };
const emptyLine = (): Line => ({ goodCode: '', goodName: '', qtyTon: '', pricePerTon: '', netPricePerTon: '' });

const calc = (l: Line) => {
  const qty = Number(l.qtyTon) || 0;
  const price = Number(l.pricePerTon) || 0;
  const net = Number(l.netPricePerTon) || 0;
  const perTon = price - net;
  return { qty, price, net, perTon, amount: Math.round(qty * perTon * 100) / 100 };
};

// ─────────────────────────────────────────────────────────────
// ยื่นใบขอเคลียร์
// ─────────────────────────────────────────────────────────────
export function ClaimDialog({ pool, onClose, onDone }:
  { pool: RebatePool; onClose: () => void; onDone: () => void }) {

  const available = Number(pool.AccruedAmt) - Number(pool.ClaimedAmt);
  const [custId, setCustId] = useState('');
  const [note, setNote] = useState('');
  const [invoices, setInvoices] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const total = useMemo(() => lines.reduce((s, l) => s + calc(l).amount, 0), [lines]);
  const overBudget = total > available;

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function submit() {
    const usable = lines.filter(l => calc(l).qty > 0 && calc(l).perTon !== 0);
    if (!usable.length) { setErr('ต้องมีรายการอย่างน้อย 1 บรรทัดที่มียอดขนและส่วนต่างราคา'); return; }
    if (overBudget) { setErr(`ยอดรวม ฿${baht(total)} เกินยอดที่ใช้ได้ ฿${baht(available)}`); return; }
    setBusy(true); setErr('');
    try {
      await createRebateClaim({
        poolId: pool.Id,
        custId: custId.trim() || undefined,
        note: note.trim() || undefined,
        lines: usable.map(l => ({
          goodCode: l.goodCode.trim() || 'GENERAL',
          goodName: l.goodName.trim() || undefined,
          qtyTon: calc(l).qty,
          pricePerTon: calc(l).price,
          netPricePerTon: calc(l).net,
        })),
        invoices: invoices.split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
      });
      onDone();
    } catch (e: unknown) { setErr((e as Error).message || 'บันทึกไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: NAVY }}>
              <Scissors size={18} /> แบบขออนุมัติเคลียร์รายการส่งเสริมการขาย
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {pool.SalesName} · งวด {pool.PeriodMonth}/{pool.PeriodYear} · ใช้ได้ ฿{baht(available)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-gray-500">รหัสลูกค้า</span>
              <input value={custId} onChange={e => setCustId(e.target.value)}
                placeholder="เช่น 0592004"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <span className="text-[11px] text-gray-400">ใช้อนุมานภาคเพื่อส่งอนุมัติชั้นที่ 2</span>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-500">เลขที่ใบกำกับที่ตัดเคลียร์ร่วม</span>
              <input value={invoices} onChange={e => setInvoices(e.target.value)}
                placeholder="I68-01781, I68-02952"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <span className="text-[11px] text-gray-400">คั่นด้วยจุลภาคหรือเว้นวรรค</span>
            </label>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-gray-50 text-gray-600">
                  <tr className="text-left">
                    <th className="px-2 py-2 w-10">ที่</th>
                    <th className="px-2 py-2">รายการสูตรปุ๋ย</th>
                    <th className="px-2 py-2 w-28 text-right">ยอดขน (ตัน)</th>
                    <th className="px-2 py-2 w-32 text-right">ราคาขาย</th>
                    <th className="px-2 py-2 w-32 text-right">ราคาสุทธิ</th>
                    <th className="px-2 py-2 w-28 text-right bg-blue-50/60">คืนรีเบท</th>
                    <th className="px-2 py-2 w-32 text-right bg-blue-50/60">รวมเป็นเงิน</th>
                    <th className="px-2 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const c = calc(l);
                    return (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <input value={l.goodCode} onChange={e => setLine(i, { goodCode: e.target.value })}
                            placeholder="18-4-5"
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" />
                        </td>
                        {(['qtyTon', 'pricePerTon', 'netPricePerTon'] as const).map(field => (
                          <td key={field} className="px-2 py-1.5">
                            <input type="number" inputMode="decimal" value={l[field]}
                              onChange={e => setLine(i, { [field]: e.target.value } as Partial<Line>)}
                              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-right" />
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right bg-blue-50/60 tabular-nums text-gray-700">
                          {c.perTon ? baht(c.perTon) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right bg-blue-50/60 tabular-nums font-semibold" style={{ color: NAVY }}>
                          {c.amount ? baht(c.amount) : '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          {lines.length > 1 && (
                            <button onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
                              className="text-gray-300 hover:text-red-500" aria-label="ลบบรรทัด">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                    <td colSpan={2} className="px-2 py-2">รวม</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {lines.reduce((s, l) => s + calc(l).qty, 0).toLocaleString('th-TH')} ตัน
                    </td>
                    <td colSpan={3}></td>
                    <td className="px-2 py-2 text-right tabular-nums text-base" style={{ color: overBudget ? '#B91C1C' : NAVY }}>
                      ฿{baht(total)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {lines.length < 6 && (
            <button onClick={() => setLines(prev => [...prev, emptyLine()])}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
              style={{ color: NAVY }}>
              <Plus size={15} /> เพิ่มรายการ ({lines.length}/6)
            </button>
          )}

          <label className="block">
            <span className="text-xs font-semibold text-gray-500">หมายเหตุ</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </label>

          {overBudget && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              ยอดรวมเกินยอดรีเบทค้างรับที่ใช้ได้ (฿{baht(available)})
            </p>
          )}
          {err && <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400">ยื่นแล้วจะเข้าสู่การอนุมัติชั้นที่ 2 (ผู้จัดการภาค)</p>
          <button disabled={busy || overBudget} onClick={submit}
            className="px-5 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50"
            style={{ background: NAVY }}>
            {busy ? 'กำลังบันทึก…' : 'ยื่นใบขอเคลียร์'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// รายละเอียด + สายอนุมัติ 4 ชั้น + พิมพ์
// ─────────────────────────────────────────────────────────────
const TIER_LABEL: Record<number, string> = {
  1: 'ผู้แทนขาย (ผู้ยื่น)',
  2: 'ผู้จัดการภาค',
  3: 'ผู้จัดการฝ่ายตลาด',
  4: 'กรรมการบริหาร',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'ร่าง', PENDING: 'รอดำเนินการ',
  TIER2_PENDING: 'รอผู้จัดการภาค', TIER3_PENDING: 'รอผู้จัดการฝ่ายตลาด', TIER4_PENDING: 'รอกรรมการบริหาร',
  APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CN_ISSUED: 'ออกใบลดหนี้แล้ว',
};

export function ClaimDetailDialog({ claimId, onClose, onChanged }:
  { claimId: number; onClose: () => void; onChanged: () => void }) {

  const role = useAuthStore(s => s.user?.role);
  const [data, setData] = useState<{ claim: RebateClaim; lines: any[]; approvals: any[]; invoices: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [docuNo, setDocuNo] = useState('');
  const [reason, setReason] = useState('');

  const load = async () => {
    try { setData(await fetchRebateClaimDetail(claimId)); }
    catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [claimId]);

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <Loader2 className="animate-spin text-white" size={28} />
      </div>
    );
  }

  const { claim, lines, approvals, invoices } = data;
  const tier = Number((claim as any).CurrentTier || 0);
  const open = !['APPROVED', 'REJECTED', 'CN_ISSUED'].includes(String(claim.Status));
  const canAct = open && ['MANAGER', 'MARKETING', 'APPROVER', 'ACCOUNTING', 'ADMIN', 'C_LEVEL', 'SALES'].includes(String(role));

  async function act(kind: 'approve' | 'reject') {
    if (kind === 'reject' && !reason.trim()) { setErr('การตีกลับต้องระบุเหตุผล'); return; }
    setBusy(true); setErr('');
    try {
      if (kind === 'approve') await approveRebateClaim(claimId, docuNo.trim() || undefined);
      else await rejectRebateClaim(claimId, reason.trim());
      await load(); onChanged();
    } catch (e: unknown) { setErr((e as Error).message || 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  const totalQty = lines.reduce((s, l) => s + Number(l.QtyTon || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4 print:static print:bg-white print:p-0"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col print:max-h-none print:shadow-none print:rounded-none"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 print:hidden">
          <h2 className="text-lg font-bold" style={{ color: NAVY }}>ใบขอเคลียร์รีเบท #{claim.Id}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
              <Printer size={15} /> พิมพ์
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 print:overflow-visible">
          {/* หัวเอกสาร — จัดให้เหมือนแบบฟอร์มกระดาษเพื่อให้ผู้อนุมัติคุ้นเคย */}
          <div className="text-center print:block hidden">
            <h1 className="text-xl font-bold">แบบขออนุมัติเคลียร์รายการส่งเสริมการขาย</h1>
            <p className="text-sm text-gray-600">เลขที่ใบขอเคลียร์ RBD-{String(claim.Id).padStart(5, '0')}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[
              ['ลูกค้า', (claim as any).CustId || '—'],
              ['ภาค', (claim as any).RegionCode || '—'],
              ['สถานะ', STATUS_LABEL[String(claim.Status)] || claim.Status],
              ['เลขใบลดหนี้', (claim as any).CnDocuNo || '—'],
            ].map(([k, v]) => (
              <div key={k as string} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <div className="text-[11px] text-gray-500">{k}</div>
                <div className="font-semibold text-gray-800">{v as string}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-xl">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-gray-50 text-gray-600 text-left">
                <tr>
                  <th className="px-3 py-2 w-10">ที่</th>
                  <th className="px-3 py-2">รายการสูตรปุ๋ย</th>
                  <th className="px-3 py-2 text-right">ยอดขน (ตัน)</th>
                  <th className="px-3 py-2 text-right">ราคาขาย</th>
                  <th className="px-3 py-2 text-right">ราคาสุทธิ</th>
                  <th className="px-3 py-2 text-right">คืนรีเบท</th>
                  <th className="px-3 py-2 text-right">รวมเป็นเงิน</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l: any) => (
                  <tr key={l.LineId} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-400">{l.LineNo}</td>
                    <td className="px-3 py-2">{l.GoodCode}{l.GoodName ? ` · ${l.GoodName}` : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(l.QtyTon).toLocaleString('th-TH')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{baht(l.PricePerTon)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{baht(l.NetPricePerTon)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{baht(l.RebatePerTon)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{baht(l.LineAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td colSpan={2} className="px-3 py-2">รวม</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalQty.toLocaleString('th-TH')}</td>
                  <td colSpan={3}></td>
                  <td className="px-3 py-2 text-right tabular-nums text-base" style={{ color: NAVY }}>
                    ฿{baht(claim.ClaimAmt)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {invoices?.length > 0 && (
            <p className="text-sm text-gray-600">
              <span className="font-semibold">ตัดเคลียร์ร่วมกับใบกำกับ: </span>
              {invoices.map((v: any) => v.DocuNo).join(', ')}
            </p>
          )}

          {/* สายอนุมัติ 4 ชั้น — ต้องเห็นครบทุกชั้นเพื่อใช้เป็นหลักฐาน */}
          <div>
            <h3 className="text-sm font-bold mb-2" style={{ color: NAVY }}>ลำดับการอนุมัติ</h3>
            <div className="space-y-2">
              {[1, 2, 3, 4].map(t => {
                const a = approvals.find((x: any) => Number(x.Tier) === t);
                const isCurrent = open && tier === t;
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
                        {a?.Decision === 'APPROVED' ? 'อนุมัติ' : a?.Decision === 'REJECTED' ? 'ไม่อนุมัติ' : isCurrent ? 'รออนุมัติ' : '—'}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {a?.DecidedByName || ''}{a?.DecidedAt ? ` · ${new Date(a.DecidedAt).toLocaleDateString('th-TH')}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ช่องลงนามบนกระดาษ — แสดงเฉพาะตอนพิมพ์ */}
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

        {canAct && (
          <div className="px-5 py-3 border-t border-gray-200 space-y-2 print:hidden">
            {tier === 4 && (
              <input value={docuNo} onChange={e => setDocuNo(e.target.value)}
                placeholder="เลขที่ใบลดหนี้ (CN) — กรอกได้เมื่ออนุมัติชั้นสุดท้าย"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={reason} onChange={e => setReason(e.target.value)}
                placeholder="เหตุผล (บังคับกรอกเมื่อตีกลับ)"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <button disabled={busy} onClick={() => act('reject')}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-red-200 text-red-700 text-sm font-bold disabled:opacity-50">
                <Ban size={15} /> ตีกลับ
              </button>
              <button disabled={busy} onClick={() => act('approve')}
                className="inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                style={{ background: '#059669' }}>
                <Check size={15} /> อนุมัติชั้นที่ {tier}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
