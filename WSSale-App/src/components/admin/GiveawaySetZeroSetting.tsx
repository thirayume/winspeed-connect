import { useEffect, useState } from 'react';
import { req } from '../../services/api';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';

type ZeroRow = { Id: number; ZeroAt: string; Note: string | null; ActorName: string | null };

const thaiDateTime = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });

/** Owner, 20 Nov 2026: Set Zero for giveaways (Sale-App only, repeatable). Budgets stay; usage counts again. */
export function GiveawaySetZeroSetting() {
  const [log, setLog] = useState<ZeroRow[] | null>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useUnsavedChanges(Boolean(note || confirm) || busy);

  const load = () => req<ZeroRow[]>('/giveaway/zero-log', { silent: true }).then(setLog).catch(() => setError('อ่านประวัติ Set Zero ไม่สำเร็จ'));
  useEffect(() => { load(); }, []);

  async function run() {
    if (confirm !== 'SET ZERO' || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const r = await req<{ message: string; before: { withdrawn: number } }>('/giveaway/set-zero', {
        method: 'POST', body: JSON.stringify({ confirm, note: note.trim() || undefined }), silent: true,
      });
      setMessage(`${r.message} (ยอดเบิกที่นับอยู่ก่อนหน้า ${Number(r.before?.withdrawn || 0).toLocaleString('th-TH')} ชิ้น)`);
      setNote(''); setConfirm(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Set Zero ไม่สำเร็จ'); } finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl border border-blue-200 bg-white p-5 space-y-4">
      <div>
        <h2 className="font-bold text-[#0C447C]">Set Zero ของแถม</h2>
        <p className="text-sm text-gray-600 mt-1">งบโควต้าคงเดิม ยอด "เบิกแล้ว" เริ่มนับใหม่ตั้งแต่ตอนที่กด ประวัติการเบิกเดิมยังอยู่และดูได้ตามปกติ
          มีผลเฉพาะ Sale-App ไม่แตะ WinSpeed ทำซ้ำได้ (เช่น วันที่ 31/12/2569)</p>
      </div>
      <label className="block text-sm">
        <span className="font-semibold text-gray-700">หมายเหตุ (ไม่บังคับ)</span>
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} disabled={busy}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="เช่น เริ่มรอบปี 2570" />
      </label>
      <label className="block text-sm">
        <span className="font-semibold text-gray-700">พิมพ์ SET ZERO เพื่อยืนยัน</span>
        <input value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} aria-label="ยืนยัน Set Zero"
          className="mt-1 w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 font-mono" />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-green-700">{message}</p>}
      <button type="button" onClick={run} disabled={confirm !== 'SET ZERO' || busy}
        className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-red-800">Set Zero ของแถม</button>
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-2">ประวัติ Set Zero</h3>
        {log && log.length === 0 && <p className="text-sm text-gray-500">ยังไม่เคย Set Zero (นับการเบิกทั้งหมด)</p>}
        {log && log.length > 0 && (
          <ul className="text-sm divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {log.map(z => (
              <li key={z.Id} className="px-3 py-2 flex flex-wrap gap-x-4">
                <span className="font-semibold">{thaiDateTime(z.ZeroAt)}</span>
                <span className="text-gray-600">{z.ActorName || '-'}</span>
                {z.Note && <span className="text-gray-500">{z.Note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
