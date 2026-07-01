import { useEffect, useState, useCallback } from 'react';
import { ClipboardList, RefreshCw, Plus, X, Play, Square, Coins } from 'lucide-react';
import { fetchRebatePlans, createRebatePlan, updateRebatePlan, allocateRebatePlan, listUsers } from '../../services/api';
import type { RebatePlan, AdminUser } from '../../types';

const REGIONS = ['ALL', 'ใต้', 'กลาง', 'เหนือ', 'ตะวันออก'];
const THB = (n?: number | null) => n != null ? `฿${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 0 })}` : '-';
const STATUS_META: Record<string, { label: string; cls: string }> = {
  DRAFT:  { label: 'ร่าง',      cls: 'bg-gray-100 text-gray-600' },
  ACTIVE: { label: 'ใช้งาน',    cls: 'bg-green-50 text-green-700' },
  CLOSED: { label: 'ปิดแล้ว',   cls: 'bg-gray-200 text-gray-500' },
};

export function RebatePlanPage() {
  const [plans, setPlans]   = useState<RebatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<RebatePlan | null>(null);
  const [allocFor, setAllocFor] = useState<RebatePlan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPlans(await fetchRebatePlans(statusFilter || undefined)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(p: RebatePlan, status: string) {
    try { await updateRebatePlan(p.PlanId, { status }); await load(); }
    catch (e) { alert((e as Error).message); }
  }

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <ClipboardList className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> <span className="truncate">Rebate Plan — แผนส่งเสริมการขาย</span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">นิยามแผนคืนรีเบทต่อสูตร×ภาค + จัดสรรงบให้พนักงานขาย (FR-008/009)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm focus:outline-none focus:border-[#0C447C]">
            <option value="">ทุกสถานะ</option>
            <option value="DRAFT">ร่าง</option>
            <option value="ACTIVE">ใช้งาน</option>
            <option value="CLOSED">ปิดแล้ว</option>
          </select>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="px-3 py-1.5 sm:px-3 sm:py-2 rounded-lg text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 hover:bg-[#0a3866] transition-colors shadow-sm" style={{ background: '#0C447C' }}>
            <Plus size={16} /> สร้าง Plan
          </button>
          <button onClick={load} className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors shadow-sm shrink-0">
            <RefreshCw size={14} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-0 sm:p-6">
        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 flex justify-center"><RefreshCw size={26} className="animate-spin text-gray-300" /></div>
          ) : plans.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">ยังไม่มี Plan — กด “สร้าง Plan”</p>
          ) : (
            <table className="w-full text-sm min-w-full">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                <tr>
                  <th className="px-4 py-3 text-left whitespace-nowrap">เลขที่ / ชื่อ</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">สูตร</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">ภาค</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">ประเภท</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">NET</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">ช่วงเวลา</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">งบจัดสรร</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">สะสมจริง</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">สถานะ</th>
                  <th className="px-4 py-3 whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {plans.map(p => {
                  const sm = STATUS_META[p.Status];
                  return (
                    <tr key={p.PlanId} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5 whitespace-nowrap"><div className="font-mono font-bold text-[#0C447C]">{p.PlanNo}</div><div className="text-xs text-gray-500">{p.Title || '-'}</div></td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{p.GoodCodePattern || <span className="text-gray-400">ทุกสูตร</span>}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">{p.Region}</td>
                      <td className="px-4 py-2.5 text-center text-xs whitespace-nowrap">{p.ReturnType === 'PRICEDIFF' ? 'ส่วนต่าง' : 'รีเบท'}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">{THB(p.NetPrice)}</td>
                      <td className="px-4 py-2.5 text-center text-xs text-gray-400 whitespace-nowrap">{(p.ValidFrom?.substring(0,10) || '—')} → {(p.ValidTo?.substring(0,10) || '—')}</td>
                      <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">{THB(p.AllocatedAmount)}</td>
                      <td className="px-4 py-2.5 text-right text-[#0C447C] font-bold whitespace-nowrap">{THB(p.AccruedAmt)}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap"><span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${sm.cls}`}>{sm.label}</span></td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1 justify-end">
                          {p.Status === 'DRAFT' && <button onClick={() => setStatus(p, 'ACTIVE')} title="เปิดใช้งาน" className="h-7 w-7 flex items-center justify-center rounded-lg bg-green-50 text-green-700"><Play size={13} /></button>}
                          {p.Status === 'ACTIVE' && <button onClick={() => setStatus(p, 'CLOSED')} title="ปิด" className="h-7 w-7 flex items-center justify-center rounded-lg bg-gray-100 text-gray-500"><Square size={13} /></button>}
                          {p.Status !== 'CLOSED' && <button onClick={() => setAllocFor(p)} title="จัดสรรงบ" className="h-7 w-7 flex items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Coins size={13} /></button>}
                          <button onClick={() => { setEditing(p); setShowForm(true); }} className="text-xs text-gray-500 px-2 py-1 rounded-lg border border-gray-200">แก้</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showForm && <PlanForm plan={editing} onClose={() => setShowForm(false)} onDone={() => { setShowForm(false); load(); }} />}
      {allocFor && <AllocateModal plan={allocFor} onClose={() => setAllocFor(null)} onDone={() => { setAllocFor(null); load(); }} />}
    </div>
  );
}

function PlanForm({ plan, onClose, onDone }: { plan: RebatePlan | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    title: plan?.Title || '', goodCodePattern: plan?.GoodCodePattern || '', region: plan?.Region || 'ALL',
    returnType: plan?.ReturnType || 'REBATE', netPrice: plan?.NetPrice ?? '', validFrom: plan?.ValidFrom?.substring(0,10) || '',
    validTo: plan?.ValidTo?.substring(0,10) || '', allocatedAmount: plan?.AllocatedAmount ?? '', priority: plan?.Priority ?? 100, note: plan?.Note || '',
  });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: string, v: unknown) => setF(s => ({ ...s, [k]: v }));

  async function submit() {
    setBusy(true); setErr('');
    try {
      const payload = {
        title: f.title || undefined, goodCodePattern: f.goodCodePattern || undefined, region: f.region,
        returnType: f.returnType, netPrice: f.netPrice !== '' ? Number(f.netPrice) : undefined,
        validFrom: f.validFrom || undefined, validTo: f.validTo || undefined,
        allocatedAmount: f.allocatedAmount !== '' ? Number(f.allocatedAmount) : undefined,
        priority: Number(f.priority) || 100, note: f.note || undefined,
      };
      if (plan) await updateRebatePlan(plan.PlanId, payload);
      else await createRebatePlan(payload);
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold" style={{ color: '#0C447C' }}>{plan ? `แก้ไข ${plan.PlanNo}` : 'สร้าง Rebate Plan'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3 text-sm">
          <Field label="ชื่อแผน"><input value={f.title} onChange={e => set('title', e.target.value)} className="inp" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="สูตร (เว้นว่าง=ทุกสูตร)"><input value={f.goodCodePattern} onChange={e => set('goodCodePattern', e.target.value)} placeholder="เช่น 15-5-35" className="inp" /></Field>
            <Field label="ภาค"><select value={f.region} onChange={e => set('region', e.target.value)} className="inp">{REGIONS.map(r => <option key={r}>{r}</option>)}</select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ประเภทการคืน"><select value={f.returnType} onChange={e => set('returnType', e.target.value)} className="inp"><option value="REBATE">คืนรีเบท</option><option value="PRICEDIFF">คืนส่วนต่าง</option></select></Field>
            <Field label="ราคา NET (อ้างอิง)"><input type="number" value={f.netPrice} onChange={e => set('netPrice', e.target.value)} className="inp" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="เริ่ม"><input type="date" value={f.validFrom} onChange={e => set('validFrom', e.target.value)} className="inp" /></Field>
            <Field label="ถึง"><input type="date" value={f.validTo} onChange={e => set('validTo', e.target.value)} className="inp" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="งบจัดสรร (฿)"><input type="number" value={f.allocatedAmount} onChange={e => set('allocatedAmount', e.target.value)} className="inp" /></Field>
            <Field label="ลำดับความสำคัญ"><input type="number" value={f.priority} onChange={e => set('priority', e.target.value)} className="inp" /></Field>
          </div>
          <Field label="หมายเหตุ"><input value={f.note} onChange={e => set('note', e.target.value)} className="inp" /></Field>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          <button disabled={busy} onClick={submit} className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: '#0C447C' }}>
            {busy ? 'กำลังบันทึก...' : (plan ? 'บันทึก' : 'สร้าง (ร่าง)')}
          </button>
        </div>
      </div>
      <style>{`.inp{width:100%;border:1px solid #E5E7EB;border-radius:8px;padding:6px 10px;font-size:13px}`}</style>
    </div>
  );
}

function AllocateModal({ plan, onClose, onDone }: { plan: RebatePlan; onClose: () => void; onDone: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [salesUserId, setSalesUserId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  useEffect(() => { listUsers().then(u => setUsers(u.filter(x => x.Role === 'SALES' || x.Role === 'ADMIN'))).catch(console.error); }, []);

  async function submit() {
    if (!salesUserId || !amount) { setErr('เลือกพนักงานและกรอกจำนวน'); return; }
    setBusy(true); setErr('');
    try { await allocateRebatePlan(plan.PlanId, { salesUserId: Number(salesUserId), amount: Number(amount) }); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: '#0C447C' }}><Coins size={18} /> จัดสรรงบ — {plan.PlanNo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3 text-sm">
          <div><label className="text-xs font-semibold text-gray-500 block mb-1">พนักงานขาย</label>
            <select value={salesUserId} onChange={e => setSalesUserId(e.target.value ? Number(e.target.value) : '')} className="w-full border border-gray-200 rounded-lg px-3 py-2">
              <option value="">— เลือก —</option>
              {users.map(u => <option key={u.Id} value={u.Id}>{u.DisplayName}</option>)}
            </select></div>
          <div><label className="text-xs font-semibold text-gray-500 block mb-1">จำนวนเงิน (฿) → Pool เดือนนี้</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2" /></div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          <button disabled={busy} onClick={submit} className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: '#0C447C' }}>
            {busy ? 'กำลังบันทึก...' : 'จัดสรร'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs font-semibold text-gray-500 block mb-1">{label}</label>{children}</div>;
}
