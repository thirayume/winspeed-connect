/**
 * RebateClaimForm.tsx — ใบขอเคลียร์รายการส่งเสริมการขาย (R6-06)
 *
 * แทนแบบฟอร์มกระดาษ RBD68-019 ทั้งใบ ซึ่งมี **สองตาราง** ไม่ใช่ตารางเดียว
 *
 *   คืนรีเบท     เทียบ ราคาขาย กับ ราคาสุทธิที่โปรโมชั่นกำหนด
 *   คืนส่วนต่าง  เทียบ ราคาขาย กับ ราคาขายใน Pricelist ของเดือนนั้น
 *
 * รูปคำนวณเดียวกัน ต่างที่ "ราคาที่ใช้เทียบ" จึงใช้ตารางฐานข้อมูลเดียวแยกด้วย LineType
 * แต่หัวคอลัมน์บนหน้าจอต้องต่างกัน ไม่งั้นผู้ใช้อ่านผิดว่าเทียบกับอะไร
 *
 * คอลัมน์แรกของทั้งสองตารางคือ "เลขที่ INV" — ใบกำกับผูกรายบรรทัด
 */
import { useEffect, useMemo, useState } from 'react';
import { Scissors, X, Plus, Trash2, Printer, Check, Ban, Loader2 } from 'lucide-react';
import {
  createRebateClaim, fetchRebateClaimDetail, approveRebateClaim, rejectRebateClaim,
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { RebatePool, RebateClaim } from '../../types';

const NAVY = '#0C447C';
const baht = (n: unknown) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ton = (n: unknown) => Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 3 });

type Kind = 'REBATE' | 'DIFF';

/** หัวคอลัมน์ที่ต่างกันระหว่างสองตาราง — ชื่อเดียวกันทั้งคู่จะทำให้อ่านผิดว่าเทียบกับอะไร */
const TABLE: Record<Kind, { title: string; compare: string; rate: string; amount: string; hint: string }> = {
  REBATE: {
    title: 'คืนรีเบท', compare: 'ราคาสุทธิ', rate: 'คืนรีเบท', amount: 'รวมเป็นเงิน',
    hint: 'เทียบกับราคาสุทธิที่โปรโมชั่นกำหนด',
  },
  DIFF: {
    title: 'คืนส่วนต่าง', compare: 'ราคาขาย (Pricelist)', rate: 'ส่วนต่าง', amount: 'จำนวนเงินที่ได้',
    hint: 'เทียบกับราคาขายใน Pricelist ของเดือนนั้น',
  },
};

type Line = { invoiceNo: string; goodCode: string; qtyTon: string; pricePerTon: string; netPricePerTon: string };
const emptyLine = (): Line => ({ invoiceNo: '', goodCode: '', qtyTon: '', pricePerTon: '', netPricePerTon: '' });

const calc = (l: Line) => {
  const qty = Number(l.qtyTon) || 0;
  const price = Number(l.pricePerTon) || 0;
  const compare = Number(l.netPricePerTon) || 0;
  const perTon = price - compare;
  return { qty, price, compare, perTon, amount: Math.round(qty * perTon * 100) / 100 };
};
const sum = (rows: Line[]) => rows.reduce((s, l) => s + calc(l).amount, 0);

// ─────────────────────────────────────────────────────────────
// ยื่นใบขอเคลียร์
// ─────────────────────────────────────────────────────────────
export function ClaimDialog({ pool, onClose, onDone }:
  { pool: RebatePool; onClose: () => void; onDone: () => void }) {

  const available = Number(pool.AccruedAmt) - Number(pool.ClaimedAmt);
  const [custId, setCustId] = useState('');
  const [note, setNote] = useState('');
  const [rebate, setRebate] = useState<Line[]>([emptyLine()]);
  const [diff, setDiff] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const totals = useMemo(() => ({ rebate: sum(rebate), diff: sum(diff) }), [rebate, diff]);
  const grand = totals.rebate + totals.diff;
  const overBudget = grand > available;

  async function submit() {
    const pack = (rows: Line[], lineType: Kind) => rows
      .filter(l => calc(l).qty > 0 && calc(l).perTon !== 0)
      .map(l => ({
        lineType,
        invoiceNo: l.invoiceNo.trim() || undefined,
        goodCode: l.goodCode.trim() || 'GENERAL',
        qtyTon: calc(l).qty,
        pricePerTon: calc(l).price,
        netPricePerTon: calc(l).compare,
      }));
    const lines = [...pack(rebate, 'REBATE'), ...pack(diff, 'DIFF')];
    if (!lines.length) { setErr('ต้องมีรายการอย่างน้อย 1 บรรทัดที่มียอดขนและส่วนต่างราคา'); return; }
    if (overBudget) { setErr(`ยอดรวม ฿${baht(grand)} เกินยอดที่ใช้ได้ ฿${baht(available)}`); return; }

    setBusy(true); setErr('');
    try {
      await createRebateClaim({ poolId: pool.Id, custId: custId.trim() || undefined, note: note.trim() || undefined, lines });
      onDone();
    } catch (e: unknown) { setErr((e as Error).message || 'บันทึกไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
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

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <label className="block max-w-xs">
            <span className="text-xs font-semibold text-gray-500">รหัสลูกค้า</span>
            <input value={custId} onChange={e => setCustId(e.target.value)} placeholder="เช่น 0592004"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <span className="text-[11px] text-gray-400">ใช้อนุมานภาคเพื่อส่งอนุมัติชั้นที่ 2</span>
          </label>

          <LineTable kind="REBATE" rows={rebate} setRows={setRebate} total={totals.rebate} />
          <LineTable kind="DIFF" rows={diff} setRows={setDiff} total={totals.diff} />

          <div className="flex items-center justify-end gap-4 border-t-2 border-gray-200 pt-3">
            <span className="text-sm text-gray-500">ยอดรวมทั้งใบ</span>
            <span className="text-xl font-black tabular-nums" style={{ color: overBudget ? '#B91C1C' : NAVY }}>
              ฿{baht(grand)}
            </span>
          </div>

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
            className="px-5 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: NAVY }}>
            {busy ? 'กำลังบันทึก…' : 'ยื่นใบขอเคลียร์'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LineTable({ kind, rows, setRows, total }:
  { kind: Kind; rows: Line[]; setRows: (r: Line[]) => void; total: number }) {

  const t = TABLE[kind];
  const setLine = (i: number, patch: Partial<Line>) => setRows(rows.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-1.5">
        <h3 className="text-sm font-bold" style={{ color: NAVY }}>{t.title}</h3>
        <span className="text-[11px] text-gray-400">{t.hint}</span>
      </div>

      {rows.length === 0 ? (
        <button onClick={() => setRows([emptyLine()])}
          className="w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 hover:bg-gray-50">
          + เพิ่มรายการ{t.title}
        </button>
      ) : (
        <>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead className="bg-gray-50 text-gray-600">
                  <tr className="text-left">
                    <th className="px-2 py-2 w-9">ที่</th>
                    <th className="px-2 py-2 w-36">เลขที่ INV</th>
                    <th className="px-2 py-2">รายการสูตรปุ๋ย</th>
                    <th className="px-2 py-2 w-24 text-right">ยอดขน (ตัน)</th>
                    <th className="px-2 py-2 w-28 text-right">ราคาขาย</th>
                    <th className="px-2 py-2 w-32 text-right">{t.compare}</th>
                    <th className="px-2 py-2 w-24 text-right bg-blue-50/60">{t.rate}</th>
                    <th className="px-2 py-2 w-32 text-right bg-blue-50/60">{t.amount}</th>
                    <th className="px-2 py-2 w-9"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l, i) => {
                    const c = calc(l);
                    return (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <input value={l.invoiceNo} onChange={e => setLine(i, { invoiceNo: e.target.value })}
                            placeholder="I68-01781" className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={l.goodCode} onChange={e => setLine(i, { goodCode: e.target.value })}
                            placeholder="18-4-5" className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" />
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
                          <button onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                            className="text-gray-300 hover:text-red-500" aria-label="ลบบรรทัด"><Trash2 size={15} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                    <td colSpan={3} className="px-2 py-2">รวม{t.title}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {ton(rows.reduce((s, l) => s + calc(l).qty, 0))}
                    </td>
                    <td colSpan={3}></td>
                    <td className="px-2 py-2 text-right tabular-nums" style={{ color: NAVY }}>฿{baht(total)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          {rows.length < 6 && (
            <button onClick={() => setRows([...rows, emptyLine()])}
              className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
              style={{ color: NAVY }}>
              <Plus size={15} /> เพิ่มรายการ ({rows.length}/6)
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// รายละเอียด + สายอนุมัติ 4 ชั้น + พิมพ์
// ─────────────────────────────────────────────────────────────
const TIER_LABEL: Record<number, string> = {
  1: 'ผู้แทนขาย (ผู้ยื่น)', 2: 'ผู้จัดการภาค', 3: 'ผู้จัดการฝ่ายตลาด', 4: 'กรรมการบริหาร',
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'ร่าง', PENDING: 'รอดำเนินการ',
  TIER2_PENDING: 'รอผู้จัดการภาค', TIER3_PENDING: 'รอผู้จัดการฝ่ายตลาด', TIER4_PENDING: 'รอกรรมการบริหาร',
  APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CN_ISSUED: 'ออกใบลดหนี้แล้ว',
};

export function ClaimDetailDialog({ claimId, onClose, onChanged }:
  { claimId: number; onClose: () => void; onChanged: () => void }) {

  const role = useAuthStore(s => s.user?.role);
  const [data, setData] = useState<any>(null);
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
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <Loader2 className="animate-spin text-white" size={28} /></div>;
  }

  const { claim, lines, approvals, invoices, totals } = data;
  const tier = Number(claim.CurrentTier || 0);
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

  const section = (kind: Kind) => {
    const rows = (lines || []).filter((l: any) => (l.LineType || 'REBATE') === kind);
    if (!rows.length) return null;
    const t = TABLE[kind];
    const amt = kind === 'REBATE' ? totals?.RebateAmt : totals?.DiffAmt;
    const tons = kind === 'REBATE' ? totals?.RebateTon : totals?.DiffTon;
    return (
      <div key={kind}>
        <h3 className="text-sm font-bold mb-1.5" style={{ color: NAVY }}>{t.title}</h3>
        <div className="overflow-x-auto border border-gray-200 rounded-xl">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-3 py-2 w-9">ที่</th>
                <th className="px-3 py-2">เลขที่ INV</th>
                <th className="px-3 py-2">รายการสูตรปุ๋ย</th>
                <th className="px-3 py-2 text-right">ยอดขน (ตัน)</th>
                <th className="px-3 py-2 text-right">ราคาขาย</th>
                <th className="px-3 py-2 text-right">{t.compare}</th>
                <th className="px-3 py-2 text-right">{t.rate}</th>
                <th className="px-3 py-2 text-right">{t.amount}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l: any, i: number) => (
                <tr key={l.LineId} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2">{l.InvoiceNo || '—'}</td>
                  <td className="px-3 py-2">{l.GoodCode}{l.GoodName ? ` · ${l.GoodName}` : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{ton(l.QtyTon)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{baht(l.PricePerTon)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{baht(l.NetPricePerTon)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{baht(l.RebatePerTon)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{baht(l.LineAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                <td colSpan={3} className="px-3 py-2">รวม{t.title}</td>
                <td className="px-3 py-2 text-right tabular-nums">{ton(tons)}</td>
                <td colSpan={3}></td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: NAVY }}>฿{baht(amt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4 print:static print:bg-white print:p-0"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col print:max-h-none print:shadow-none print:rounded-none"
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
          <div className="text-center print:block hidden">
            <h1 className="text-xl font-bold">แบบขออนุมัติเคลียร์รายการส่งเสริมการขาย</h1>
            <p className="text-sm text-gray-600">เลขที่ RBD-{String(claim.Id).padStart(5, '0')}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[
              ['ลูกค้า', claim.CustName || claim.CustId || '—'],
              ['ภาค', claim.RegionCode || '—'],
              ['สถานะ', STATUS_LABEL[String(claim.Status)] || claim.Status],
              ['เลขใบลดหนี้', claim.CnDocuNo || '—'],
            ].map(([k, v]) => (
              <div key={k as string} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <div className="text-[11px] text-gray-500">{k}</div>
                <div className="font-semibold text-gray-800">{v as string}</div>
              </div>
            ))}
          </div>

          {section('REBATE')}
          {section('DIFF')}

          <div className="flex items-center justify-end gap-4 border-t-2 border-gray-200 pt-3">
            <span className="text-sm text-gray-500">ยอดรวมทั้งใบ</span>
            <span className="text-xl font-black tabular-nums" style={{ color: NAVY }}>฿{baht(claim.ClaimAmt)}</span>
          </div>

          {invoices?.length > 0 && (
            <p className="text-sm text-gray-600">
              <span className="font-semibold">ใบกำกับที่ตัดเคลียร์ร่วมทั้งใบ: </span>
              {invoices.map((v: any) => v.DocuNo).join(', ')}
            </p>
          )}

          <div>
            <h3 className="text-sm font-bold mb-2" style={{ color: NAVY }}>ลำดับการอนุมัติ</h3>
            <div className="space-y-2">
              {[1, 2, 3, 4].map(t => {
                const a = (approvals || []).find((x: any) => Number(x.Tier) === t);
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
