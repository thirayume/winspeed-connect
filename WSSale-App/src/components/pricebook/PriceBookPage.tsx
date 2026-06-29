import { useEffect, useState, useCallback } from 'react';
import { BookOpen, RefreshCw, Plus, CheckCircle2, Rocket, Archive, FileClock } from 'lucide-react';
import {
  fetchPriceBooks, fetchPriceBook, createPriceBook, priceBookAction,
  type PriceBook, type PriceBookLine, type PriceBookAuditRow,
} from '../../services/api';

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600', APPROVED: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700', ARCHIVED: 'bg-gray-100 text-gray-400',
};
type Detail = PriceBook & { lines: PriceBookLine[]; audit: PriceBookAuditRow[] };

export function PriceBookPage() {
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [sel, setSel] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', effectiveMonth: new Date().toISOString().slice(0, 7), seedFromCurrent: true });

  const load = useCallback(async () => {
    setLoading(true);
    try { setBooks(await fetchPriceBooks()); } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function open(id: number) { try { setSel(await fetchPriceBook(id)); } catch (e: unknown) { alert((e as Error).message); } }

  async function doCreate() {
    if (!form.name) { alert('ใส่ชื่อ Price Book'); return; }
    setBusy(true);
    try {
      const r = await createPriceBook(form);
      setCreating(false); setForm({ ...form, name: '' });
      await load(); await open(r.id);
    } catch (e: unknown) { alert((e as Error).message); }
    finally { setBusy(false); }
  }
  async function act(action: 'approve' | 'activate' | 'archive') {
    if (!sel) return;
    const label = { approve: 'อนุมัติ', activate: 'เปิดใช้งาน (ACTIVE)', archive: 'เก็บเข้าคลัง' }[action];
    if (!confirm(`ยืนยัน${label} Price Book "${sel.Name}"?`)) return;
    setBusy(true);
    try { await priceBookAction(sel.Id, action); await load(); await open(sel.Id); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}><BookOpen size={26} /> Price Book</h1>
          <p className="text-sm text-gray-500 mt-0.5">ร่าง → อนุมัติ → เปิดใช้งาน (มี audit) · FR-023</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCreating(!creating)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90"><Plus size={15} /> สร้างใหม่</button>
          <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50"><RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-5 gap-0">
        {/* list */}
        <div className="md:col-span-2 border-r border-gray-200 overflow-y-auto p-4 space-y-2">
          {creating && (
            <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-3 space-y-2">
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="ชื่อ Price Book เช่น ราคา ก.ค. 2569" className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" />
              <div className="flex gap-2">
                <input type="month" value={form.effectiveMonth} onChange={e => setForm({ ...form, effectiveMonth: e.target.value })} className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm" />
                <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={form.seedFromCurrent} onChange={e => setForm({ ...form, seedFromCurrent: e.target.checked })} /> ดึงราคาปัจจุบัน</label>
              </div>
              <button onClick={doCreate} disabled={busy} className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40">สร้าง (DRAFT)</button>
            </div>
          )}
          {books.map(b => (
            <button key={b.Id} onClick={() => open(b.Id)} className={`w-full text-left bg-white rounded-xl border shadow-sm p-3 hover:border-[#0C447C] transition ${sel?.Id === b.Id ? 'border-[#0C447C] ring-1 ring-[#0C447C]' : 'border-gray-100'}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-800">{b.Name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLOR[b.Status]}`}>{b.Status}</span>
              </div>
              <div className="text-xs text-gray-400 mt-1">เดือน {b.EffectiveMonth} · {b.LineCount ?? 0} รายการ</div>
            </button>
          ))}
          {!loading && books.length === 0 && <div className="text-center text-gray-400 text-sm py-8">ยังไม่มี Price Book</div>}
        </div>

        {/* detail */}
        <div className="md:col-span-3 overflow-y-auto p-4">
          {!sel ? <div className="text-center text-gray-400 text-sm py-16">เลือก Price Book เพื่อดูรายละเอียด</div> : (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-bold text-gray-800">{sel.Name}</div>
                    <div className="text-xs text-gray-400">เดือน {sel.EffectiveMonth} · {sel.lines.length} รายการ</div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${STATUS_COLOR[sel.Status]}`}>{sel.Status}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  {sel.Status === 'DRAFT' && <button onClick={() => act('approve')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:opacity-90 disabled:opacity-40"><CheckCircle2 size={15} /> อนุมัติ</button>}
                  {sel.Status === 'APPROVED' && <button onClick={() => act('activate')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-green-600 text-white hover:opacity-90 disabled:opacity-40"><Rocket size={15} /> เปิดใช้งาน</button>}
                  {sel.Status === 'ACTIVE' && <button onClick={() => act('archive')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"><Archive size={15} /> เก็บเข้าคลัง</button>}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-semibold text-gray-700">รายการราคา ({sel.lines.length})</div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0"><tr className="bg-gray-50 text-gray-500 text-xs uppercase"><th className="text-left px-4 py-2">รหัส</th><th className="text-left px-4 py-2">สินค้า</th><th className="text-right px-4 py-2">ราคา/ตัน</th></tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {sel.lines.map((l, i) => <tr key={i}><td className="px-4 py-2 text-gray-500">{l.GoodId}</td><td className="px-4 py-2 text-gray-700">{l.GoodName}</td><td className="px-4 py-2 text-right font-semibold text-gray-800">฿{Number(l.Price).toLocaleString()}</td></tr>)}
                      {sel.lines.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">ยังไม่มีรายการ</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><FileClock size={15} /> ประวัติ (Audit)</div>
                <div className="space-y-1.5">
                  {sel.audit.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-semibold text-gray-700">{a.Action}</span>
                      {a.FromStatus && <span>{a.FromStatus}→{a.ToStatus}</span>}
                      <span>· {a.ByName || '—'}</span><span>· {new Date(a.At).toLocaleString('th-TH')}</span>
                      {a.Note && <span className="text-gray-400">· {a.Note}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
