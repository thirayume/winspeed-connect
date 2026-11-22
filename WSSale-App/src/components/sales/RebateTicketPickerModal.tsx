import { useEffect, useMemo, useState } from 'react';
import { X, Ticket } from 'lucide-react';
import { fetchUsableRebateTickets, type UsableRebateTicket } from '../../services/api';

// Owner, 22 Nov 2026: a Rebate ticket is used as a price-0 line of the ticket's goods inside a normal bill. The tickets
// are deducted when the 103 is issued and the deduction becomes final when the line's 116 is cut.
type Group = { goodId: string; goodCode: string; goodName: string; bags: number; tickets: UsableRebateTicket[] };
const bagsOf = (ton: string | number) => Math.floor(Math.round(Number(ton) * 10000) / 500);

export function RebateTicketPickerModal({ isOpen, onClose, customerId, customerName, usedBagsByGood, onAdd }: {
  isOpen: boolean; onClose: () => void; customerId: string; customerName?: string;
  usedBagsByGood: Record<string, number>;
  onAdd: (line: { goodId: string; goodCode: string; goodName: string; bags: number }) => void;
}) {
  const [tickets, setTickets] = useState<UsableRebateTicket[] | null>(null);
  const [error, setError] = useState('');
  const [bags, setBags] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!isOpen || !customerId) return;
    let cancelled = false;
    setTickets(null); setError(''); setBags({});
    fetchUsableRebateTickets(customerId)
      .then(r => { if (!cancelled) setTickets(r.tickets); })
      .catch(e => { if (!cancelled) setError((e as Error).message || 'อ่านตั๋ว Rebate ไม่สำเร็จ'); });
    return () => { cancelled = true; };
  }, [isOpen, customerId]);
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const t of tickets || []) {
      const key = String(t.goodId);
      const g = map.get(key) || { goodId: key, goodCode: t.goodCode, goodName: t.goodName, bags: 0, tickets: [] };
      g.bags += bagsOf(t.remainingTon); g.tickets.push(t); map.set(key, g);
    }
    return [...map.values()];
  }, [tickets]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label="ใช้ตั๋ว Rebate">
      <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 font-bold text-[#0C447C]"><Ticket size={16} /> ใช้ตั๋ว Rebate</h3>
            <p className="text-xs text-gray-500">{customerName || customerId} · เพิ่มเป็นบรรทัดสินค้าราคา 0 ในบิลนี้ ตั๋วถูกหักเมื่อออกใบสั่งจอง (103) และตัดเป็นที่สุดเมื่อทำใบตัดตั๋ว (116)</p>
          </div>
          <button type="button" aria-label="ปิด" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!error && tickets === null && <p className="text-sm text-gray-500">กำลังโหลดตั๋ว…</p>}
        {tickets && groups.length === 0 && <p className="text-sm text-gray-500">ลูกค้ารายนี้ไม่มีตั๋ว Rebate ที่ใช้ได้</p>}
        {groups.map(g => {
          const left = Math.max(0, g.bags - (usedBagsByGood[g.goodId] || 0));
          const want = Number(bags[g.goodId] || 0);
          const valid = Number.isInteger(want) && want >= 1 && want <= left;
          return (
            <div key={g.goodId} className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
              <div className="text-sm font-bold text-gray-800">{g.goodCode} · {g.goodName}</div>
              <div className="text-xs text-gray-600">
                ใช้ได้ {left} กระสอบ ({(left / 20).toFixed(2)} ตัน)
                {g.bags !== left && <span> · อยู่ในบิลนี้แล้ว {g.bags - left} กระสอบ</span>}
              </div>
              <ul className="text-[11px] text-gray-500">
                {g.tickets.map(t => <li key={t.id}>{t.ticketNo} · เหลือ {Number(t.remainingTon).toFixed(2)} ตัน · หมดอายุ {t.expiryDate}</li>)}
              </ul>
              <div className="flex items-center gap-2">
                <label className="text-xs">จำนวนกระสอบ
                  <input type="number" min={1} max={left} step={1} value={bags[g.goodId] || ''} disabled={left === 0}
                    onChange={e => setBags(b => ({ ...b, [g.goodId]: e.target.value }))}
                    className="ml-2 w-20 rounded border px-2 py-1 text-right font-mono" />
                </label>
                <button type="button" disabled={!valid}
                  onClick={() => { onAdd({ goodId: g.goodId, goodCode: g.goodCode, goodName: g.goodName, bags: want }); onClose(); }}
                  className="rounded bg-emerald-700 px-3 py-1 text-xs font-bold text-white disabled:opacity-40">เพิ่มบรรทัดตั๋ว</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
