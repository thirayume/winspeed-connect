import { useState } from 'react';
import { approveNativeEdit, type NativeEditTarget } from '../../services/api';

export function NativeEditApprovalForm({ target }: { target: NativeEditTarget }) {
  const [operation, setOperation] = useState<'reduce' | 'cancel'>('reduce');
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState(false);
  const items = target.lines.map(line => ({
    couponId: line.couponId,
    qtyAfter: targets[line.couponId] ?? line.qtyBefore,
  }));
  const validReduction = items.every((line, index) =>
    /^\d{1,8}(?:\.\d{1,4})?$/.test(line.qtyAfter) && Number(line.qtyAfter) <= Number(target.lines[index].qtyBefore)
  ) && items.some(line => Number(line.qtyAfter) > 0) &&
     items.some((line, index) => Number(line.qtyAfter) < Number(target.lines[index].qtyBefore));

  async function approve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || approved || reason.trim().length < 10 || (operation === 'reduce' && !validReduction)) return;
    setBusy(true);
    setError(false);
    try {
      await approveNativeEdit(target.redemptionId, { operation, reason: reason.trim(), items: operation === 'reduce' ? items : undefined });
      setApproved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (approved) return <p role="status" className="mt-4 text-sm text-emerald-800">
    บันทึกแผนแล้ว กรุณาทำรายการใน WinSpeed ตามยอดที่อนุมัติภายใน 15 นาที แล้วตรวจผลในคิวใบขน
  </p>;

  return <form onSubmit={approve} className="mt-4 space-y-3 rounded-lg border border-gray-200 p-3 text-sm">
    <label className="block">รายการที่อนุมัติ
      <select value={operation} disabled={busy} className="ml-2 rounded border p-1"
        onChange={e => setOperation(e.target.value === 'cancel' ? 'cancel' : 'reduce')}>
        <option value="reduce">ลดจำนวนบางรายการ</option>
        <option value="cancel">ยกเลิกทั้งใบ</option>
      </select>
    </label>
    {operation === 'reduce' && target.lines.map(line => <label key={line.couponId} className="block">
      ตั๋ว #{line.couponId} · เดิม {line.qtyBefore} · จำนวนใหม่
      <input value={targets[line.couponId] ?? line.qtyBefore} maxLength={13} inputMode="decimal" disabled={busy}
        onChange={e => setTargets(previous => ({ ...previous, [line.couponId]: e.target.value }))}
        className="ml-2 rounded border px-2 py-1" />
    </label>)}
    <label className="block">เหตุผล
      <textarea value={reason} maxLength={500} minLength={10} disabled={busy} required
        onChange={e => setReason(e.target.value)} className="mt-1 block w-full rounded border p-2" />
    </label>
    {error && <p role="alert" className="text-red-700">บันทึกแผนไม่ได้ กรุณาตรวจใบขนและสิทธิ์ก่อนลองอีกครั้ง</p>}
    <button type="submit" disabled={busy || reason.trim().length < 10 || (operation === 'reduce' && !validReduction)}
      className="rounded-lg bg-[#0C447C] px-3 py-2 font-bold text-white disabled:opacity-50">
      {busy ? 'กำลังบันทึก…' : operation === 'cancel' ? 'อนุมัติแผนยกเลิกทั้งใบ' : 'อนุมัติแผนลดจำนวน'}
    </button>
  </form>;
}
