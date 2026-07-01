import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, RefreshCw, Plus, Trash2, Power } from 'lucide-react';
import { fetchPolicies, createPolicy, updatePolicy, deletePolicy, type ApprovalPolicy } from '../../services/api';

const CASES = ['UNLOCK', 'REBATE_CLAIM', 'PRICE_CHANGE', 'CREDIT_OVERRIDE', 'GIVEAWAY_OVERRUN'];
const ROLES = ['SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ACCOUNTING', 'APPROVER', 'MANAGER', 'ADMIN'];
const CASE_LABEL: Record<string, string> = {
  UNLOCK: 'ปลดล็อก SO', REBATE_CLAIM: 'เคลมรีเบท', PRICE_CHANGE: 'เปลี่ยนราคา',
  CREDIT_OVERRIDE: 'ข้ามเครดิต', GIVEAWAY_OVERRUN: 'ของแถมเกินงบ',
};
const fmt = (n: number | null) => n == null ? '—' : `฿${Number(n).toLocaleString()}`;

export function ApprovalPolicyPage() {
  const [rows, setRows] = useState<ApprovalPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ caseType: 'REBATE_CLAIM', minAmount: '', maxAmount: '', requiredRole: 'MANAGER', note: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchPolicies()); } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setSaving(true);
    try {
      await createPolicy({
        caseType: form.caseType, requiredRole: form.requiredRole,
        minAmount: form.minAmount ? Number(form.minAmount) : null,
        maxAmount: form.maxAmount ? Number(form.maxAmount) : null,
        note: form.note || undefined,
      });
      setForm({ ...form, minAmount: '', maxAmount: '', note: '' });
      await load();
    } catch (e: unknown) { alert((e as Error).message); }
    finally { setSaving(false); }
  }
  async function toggle(p: ApprovalPolicy) { try { await updatePolicy(p.Id, { isActive: !p.IsActive }); await load(); } catch (e: unknown) { alert((e as Error).message); } }
  async function remove(p: ApprovalPolicy) { if (!confirm('ปิดใช้งานนโยบายนี้?')) return; try { await deletePolicy(p.Id); await load(); } catch (e: unknown) { alert((e as Error).message); } }

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}><ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> นโยบายการอนุมัติ</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">กำหนดอำนาจอนุมัติตาม case + วงเงิน · FR-028</p>
        </div>
        <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-0 sm:p-6 space-y-2 sm:space-y-6">
        {/* add form */}
        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><Plus size={15} /> เพิ่มนโยบาย</div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <label className="text-xs text-gray-500">Case<select value={form.caseType} onChange={e => setForm({ ...form, caseType: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm">{CASES.map(c => <option key={c} value={c}>{CASE_LABEL[c]}</option>)}</select></label>
            <label className="text-xs text-gray-500">วงเงินต่ำสุด<input value={form.minAmount} onChange={e => setForm({ ...form, minAmount: e.target.value })} placeholder="ว่าง=ไม่จำกัด" className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
            <label className="text-xs text-gray-500">วงเงินสูงสุด<input value={form.maxAmount} onChange={e => setForm({ ...form, maxAmount: e.target.value })} placeholder="ว่าง=ไม่จำกัด" className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
            <label className="text-xs text-gray-500">ผู้อนุมัติ<select value={form.requiredRole} onChange={e => setForm({ ...form, requiredRole: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm">{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className="text-xs text-gray-500">หมายเหตุ<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
            <button onClick={add} disabled={saving} className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40">เพิ่ม</button>
          </div>
        </div>

        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm min-w-full">
            <thead className="whitespace-nowrap"><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <th className="text-left px-4 py-3 whitespace-nowrap">Case</th><th className="text-left px-4 py-3 whitespace-nowrap">วงเงิน</th>
              <th className="text-left px-4 py-3 whitespace-nowrap">ผู้อนุมัติ</th><th className="text-left px-4 py-3 whitespace-nowrap">มีผล</th>
              <th className="text-left px-4 py-3 whitespace-nowrap">หมายเหตุ</th><th className="text-center px-4 py-3 whitespace-nowrap">สถานะ</th><th className="text-right px-4 py-3 whitespace-nowrap"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 whitespace-nowrap">ยังไม่มีนโยบาย</td></tr>}
              {rows.map(p => (
                <tr key={p.Id} className={p.IsActive ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap">{CASE_LABEL[p.CaseType] || p.CaseType}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmt(p.MinAmount)} – {fmt(p.MaxAmount)}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700">{p.RequiredRole}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{p.EffectiveFrom}{p.EffectiveTo ? ` – ${p.EffectiveTo}` : ''}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{p.Note}</td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">{p.IsActive ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">ใช้งาน</span> : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500">ปิด</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><div className="flex justify-end gap-1">
                    <button onClick={() => toggle(p)} title="เปิด/ปิด" className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"><Power size={15} /></button>
                    <button onClick={() => remove(p)} title="ปิดใช้งาน" className="p-1.5 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={15} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
