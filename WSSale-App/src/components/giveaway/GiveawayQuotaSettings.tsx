import { useCallback, useEffect, useState } from 'react';
import { Save, Plus, History } from 'lucide-react';
import { setGiveawayBudgetLine, fetchGiveawayBudgetHistory, type GiveawayBudgetHistory } from '../../services/api';
import type { GiveawayBudgetLine } from '../../types';

// R12 item 8: "ตั้งค่าโควต้าของแถม" — ADMIN/MANAGER แก้/เพิ่มงบรายปีต่อภาค × ตรา × รายการ
// ทุกการเปลี่ยนแปลงบันทึกใน wf.ChangeEvent (GIVEAWAY_BUDGET) พร้อมประวัติการยืม
export function GiveawayQuotaSettings({ region, empCode, lines, onSaved }: {
  region: string;
  empCode?: string;
  lines: GiveawayBudgetLine[];
  onSaved: () => void;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [newLine, setNewLine] = useState({ brand: 'รถเกษตร', itemName: '', budgetQty: '' });
  const [history, setHistory] = useState<GiveawayBudgetHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadHistory = useCallback(async () => {
    try { setHistory(await fetchGiveawayBudgetHistory(region)); } catch { setHistory(null); }
  }, [region]);
  useEffect(() => { setEdits({}); setMsg(null); loadHistory(); }, [region, loadHistory]);

  const keyOf = (l: GiveawayBudgetLine) => `${l.Brand}|${l.ItemName}`;

  async function save(brand: string, itemName: string, budgetQty: string) {
    const qty = Number(budgetQty);
    if (!Number.isFinite(qty) || qty < 0) { setMsg({ ok: false, text: 'จำนวนงบต้องเป็นตัวเลขไม่ติดลบ' }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await setGiveawayBudgetLine({ region, brand, itemName, budgetQty: qty, empCode, reason: reason || undefined });
      setMsg({ ok: true, text: r.warning || `บันทึกงบ ${brand} ${itemName} = ${qty.toLocaleString()} ชิ้นแล้ว` });
      onSaved(); loadHistory();
    } catch (e: unknown) {
      setMsg({ ok: false, text: (e as Error).message || 'บันทึกไม่สำเร็จ' });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4 text-xs">
      {msg && <div className={`p-2.5 rounded-lg border ${msg.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.text}</div>}
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="เหตุผลการปรับงบ (บันทึกในประวัติ)"
        className="w-full border border-gray-300 rounded-lg px-3 py-2" />

      <table className="w-full">
        <thead><tr className="text-gray-400 border-b border-gray-100">
          <th className="text-left py-2">ตรา</th><th className="text-left py-2">รายการ</th>
          <th className="text-right py-2">เบิกแล้ว</th><th className="text-right py-2">งบ (ชิ้น)</th><th className="py-2" />
        </tr></thead>
        <tbody className="divide-y divide-gray-50">
          {lines.map(l => {
            const k = keyOf(l);
            const value = edits[k] ?? String(Number(l.BudgetQty));
            const dirty = edits[k] !== undefined && Number(edits[k]) !== Number(l.BudgetQty);
            return (
              <tr key={l.Id}>
                <td className="py-1.5 text-gray-500">{l.Brand}</td>
                <td className="py-1.5 text-gray-700">{l.ItemName}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{Number(l.WithdrawnQty).toLocaleString()}</td>
                <td className="py-1.5 text-right">
                  <input type="number" min={0} value={value} onChange={e => setEdits(p => ({ ...p, [k]: e.target.value }))}
                    className="w-24 border border-gray-300 rounded px-2 py-1 text-right tabular-nums" />
                </td>
                <td className="py-1.5 text-right">
                  <button disabled={!dirty || busy} onClick={() => save(l.Brand, l.ItemName, value)}
                    className="px-2 py-1 rounded bg-[#0C447C] text-white disabled:opacity-30 inline-flex items-center gap-1"><Save size={12} /> บันทึก</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="p-3 rounded-xl border border-dashed border-gray-300 flex flex-wrap items-end gap-2">
        <div><div className="text-gray-500 mb-1">ตรา</div>
          <select value={newLine.brand} onChange={e => setNewLine(p => ({ ...p, brand: e.target.value }))} className="border border-gray-300 rounded px-2 py-1.5">
            <option value="รถเกษตร">รถเกษตร</option><option value="ปุ๋ยเทพ">ปุ๋ยเทพ</option><option value="ทั่วไป">ทั่วไป</option>
          </select></div>
        <div className="flex-1 min-w-[140px]"><div className="text-gray-500 mb-1">รายการ (ตรงกับชื่อในงบ เช่น 16-8-8, เสื้อยืดแขนยาว)</div>
          <input value={newLine.itemName} onChange={e => setNewLine(p => ({ ...p, itemName: e.target.value }))} className="w-full border border-gray-300 rounded px-2 py-1.5" /></div>
        <div><div className="text-gray-500 mb-1">งบ (ชิ้น)</div>
          <input type="number" min={0} value={newLine.budgetQty} onChange={e => setNewLine(p => ({ ...p, budgetQty: e.target.value }))} className="w-24 border border-gray-300 rounded px-2 py-1.5 text-right" /></div>
        <button disabled={busy || !newLine.itemName.trim() || newLine.budgetQty === ''}
          onClick={() => save(newLine.brand, newLine.itemName.trim(), newLine.budgetQty).then(() => setNewLine(p => ({ ...p, itemName: '', budgetQty: '' })))}
          className="px-3 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-40 inline-flex items-center gap-1"><Plus size={12} /> เพิ่มบรรทัดงบ</button>
      </div>

      <div>
        <div className="font-bold text-gray-700 flex items-center gap-1.5 mb-2"><History size={13} /> ประวัติการตั้งงบและการยืม</div>
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {(history?.changes || []).map(c => {
            const after = c.AfterJson ? JSON.parse(c.AfterJson) : {};
            const before = c.BeforeJson ? JSON.parse(c.BeforeJson) : null;
            const item = String(c.EntityId).split('|').slice(2).join(' ');
            return (
              <div key={c.Id} className="flex flex-wrap gap-x-3 text-gray-600 border-b border-gray-50 py-1">
                <span className="text-gray-400">{new Date(c.CreatedAt).toLocaleString('th-TH')}</span>
                <span className="font-semibold">{c.Action}</span>
                <span>{item}</span>
                {after.budgetQty !== undefined && <span>{before ? `${before.budgetQty} → ` : ''}{after.budgetQty} ชิ้น</span>}
                {after.qty !== undefined && <span>{after.qty} ชิ้น {after.toRegion ? `→ ${after.toRegion}` : `← ${after.fromRegion}`}</span>}
                <span className="text-gray-400">{c.UserName || c.UserId}</span>
                {c.ReasonText && <span className="italic text-gray-400">{c.ReasonText}</span>}
              </div>
            );
          })}
          {(history?.borrows || []).map(b => (
            <div key={`b-${b.Id}`} className="flex flex-wrap gap-x-3 text-gray-600 border-b border-gray-50 py-1">
              <span className="text-gray-400">{new Date(b.RequestedAt).toLocaleString('th-TH')}</span>
              <span className="font-semibold">ยืม #{b.Id} · {b.Status}</span>
              <span>{b.Brand} {b.ItemName} {Number(b.Qty)} ชิ้น</span>
              <span>{b.RequesterName} ← {b.LenderName}</span>
            </div>
          ))}
          {!history?.changes?.length && !history?.borrows?.length && <div className="text-gray-300 py-4 text-center">ยังไม่มีประวัติ</div>}
        </div>
      </div>
    </div>
  );
}
