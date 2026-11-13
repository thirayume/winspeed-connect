import { useState } from 'react';
import { approveRebateBookingPricing, previewRebateBookingPricing, type RebateBookingPricePreview } from '../../services/api';

/** Approval binds to the server's exact prices, date and draft revision. */
export function RebateBookingApproval() {
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState<RebateBookingPricePreview | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [approved, setApproved] = useState<number[]>([]);
  const load = async () => {
    const id = Number(draft);
    if (!/^\d+$/.test(draft) || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
      setMessage('กรุณากรอกเลข ID บิลร่างที่ถูกต้อง'); return;
    }
    setBusy(true); setMessage(''); setPreview(null); setApproved([]);
    try { setPreview(await previewRebateBookingPricing(id)); }
    catch (e: unknown) { setMessage(e instanceof Error ? e.message : 'โหลดราคาที่จะอนุมัติไม่สำเร็จ'); }
    finally { setBusy(false); }
  };
  const approve = async (line: RebateBookingPricePreview['lines'][number]) => {
    if (!preview || reason.trim().length < 5) { setMessage('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร'); return; }
    setBusy(true); setMessage('');
    try {
      await approveRebateBookingPricing(preview.draftId, { lineNo: line.lineNo, expectedRevision: preview.revision,
        expectedFingerprint: line.fingerprint, reason: reason.trim() });
      setApproved(prev => [...prev, line.lineNo]);
      setMessage('บันทึกอนุมัติแล้ว หากข้อมูลบิลหรือราคาเปลี่ยน ต้องตรวจและอนุมัติใหม่');
    } catch (e: unknown) {
      setPreview(null);
      setMessage(e instanceof Error ? e.message : 'อนุมัติไม่สำเร็จ กรุณาโหลดข้อมูลใหม่');
    } finally { setBusy(false); }
  };
  return (
    <section className="rounded-lg border border-blue-200 bg-white p-4" aria-label="อนุมัติราคา Rebate ก่อนออก 103">
      <h3 className="font-bold text-[#0C447C]">ตรวจและอนุมัติราคา Rebate ก่อนออกใบจอง 103</h3>
      <p className="mt-1 text-sm text-gray-600">ระบุ ID บิลร่างเพื่อตรวจราคาประกาศ ณ วันที่ออกใบจอง การอนุมัตินี้แยกจากคำขอราคาขายเดิม</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="rebate-draft-id">ID บิลร่าง</label>
        <input id="rebate-draft-id" inputMode="numeric" value={draft} disabled={busy} placeholder="ID บิลร่าง"
          onChange={e => {setDraft(e.target.value); setPreview(null); setApproved([]); setMessage('');}}
          className="rounded border border-gray-300 px-3 py-2 text-sm" />
        <button type="button" onClick={load} disabled={busy} className="rounded bg-[#0C447C] px-4 py-2 text-sm text-white disabled:opacity-50">ตรวจราคา</button>
      </div>
      {message && <p role="status" className="mt-2 text-sm text-gray-700">{message}</p>}
      {preview && <div className="mt-3 space-y-2">
        <p className="text-sm text-gray-600">บิลร่าง #{preview.draftId} · รุ่น {preview.revision} · วันที่ใช้ราคา {preview.saleDate}</p>
        {preview.lines.map(line => <div key={line.lineNo} className="rounded border border-gray-200 p-3 text-sm">
          <p className="font-semibold">รายการ {line.lineNo} · สินค้า #{line.goodId} · {line.quantityTon} ตัน</p>
          <p>ราคากลาง {line.basePrice} · ราคาขาย {line.sellingPrice} · ราคาออกบิล {line.invoicePrice} · Rebate {line.rebatePerTon} บาท/ตัน</p>
          {line.requiresManagerApproval ? <div className="mt-2">
            <label htmlFor={`rebate-reason-${line.lineNo}`} className="block text-xs">เหตุผลการอนุมัติ</label>
            <input id={`rebate-reason-${line.lineNo}`} maxLength={500} value={reason} disabled={busy}
              onChange={e => setReason(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1" />
            <button type="button" disabled={busy || approved.includes(line.lineNo)} onClick={() => approve(line)}
              className="mt-2 rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50">
              {approved.includes(line.lineNo) ? 'อนุมัติแล้ว' : 'อนุมัติรายการนี้'}
            </button>
          </div> : <p className="mt-1 text-emerald-700">ไม่ต้องอนุมัติเกินเกณฑ์</p>}
        </div>)}
      </div>}
    </section>
  );
}
