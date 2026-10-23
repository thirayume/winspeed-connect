import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck } from 'lucide-react';
import { req } from '../../services/api';
import { useCan } from '../../utils/capabilities';

type Preview = { soid: number; docuNo: string; fingerprint: string; selfApproval: boolean };
const messages: Record<string, string> = {
  AI_ORIGIN_REQUIRED: 'ใบนี้ยังไม่มีข้อมูลตั้งต้นสำหรับการอนุมัติผ่านแอป กรุณาใช้ booking ที่สร้างใหม่',
  AI_BOOKING_CHANGED: 'ข้อมูล booking เปลี่ยนจากตอนยืนยัน กรุณาตรวจสอบเอกสารก่อน',
  AI_PREVIEW_STALE: 'ข้อมูลเปลี่ยนระหว่างตรวจสอบ กรุณาปิดแล้วเปิดรายการใหม่',
  AI_APPROVER_EMPLOYEE_REQUIRED: 'บัญชีผู้อนุมัติต้องผูกกับพนักงาน WinSpeed ก่อน',
  AI_APPROVER_INVALID: 'ไม่พบพนักงานหรือสิทธิ์ผู้อนุมัติที่ใช้งานได้',
  AI_CONTRACT_UNSUPPORTED: 'ใบนี้มีเงื่อนไขที่ยังไม่รองรับการอนุมัติ AI ผ่านแอป',
  AI_BOOKING_UNAVAILABLE: 'สถานะหรืออายุ booking ไม่พร้อมให้อนุมัติ',
  AI_ALREADY_APPROVED: 'ใบนี้อนุมัติแล้ว กรุณาโหลดรายการใหม่',
  AI_REQUEST_CONFLICT: 'รายการอนุมัตินี้ถูกดำเนินการไปแล้ว กรุณาโหลดรายการใหม่',
  AI_NOT_ENABLED: 'ยังไม่เปิดใช้การอนุมัติ AI ผ่านแอป',
  AI_COUNTER_UNSUPPORTED: 'เล่มเลขอนุมัติ AI ไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล',
};

export function NativeAiApprovalButton({ soid, onApproved }: { soid: string | number; onApproved: () => void }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [requestId, setRequestId] = useState('');
  const [error, setError] = useState('');
  if (!can('so.approve-native')) return null;
  const describe = (e: unknown) => {
    const code = (e as { data?: { code?: string } }).data?.code;
    return messages[code || ''] || 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อผู้ดูแล';
  };
  async function inspect() {
    setOpen(true); setBusy(true); setError(''); setPreview(null);
    try {
      const p = await req<Preview>(`/so/${soid}/native-ai/preview`);
      setPreview(p); setRequestId(crypto.randomUUID());
    } catch (e) { setError(describe(e)); }
    finally { setBusy(false); }
  }
  async function approve() {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try {
      await req(`/so/${soid}/native-ai`, { method: 'POST', body: JSON.stringify({ fingerprint: preview.fingerprint, requestId }) });
      setOpen(false); onApproved();
    } catch (e) { setError(describe(e)); }
    finally { setBusy(false); }
  }
  return <>
    <button onClick={inspect} disabled={busy} data-testid={`btn-native-ai-${soid}`}
      className="flex items-center justify-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
      <ShieldCheck size={14} /> อนุมัติใบสั่งจอง AI
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="อนุมัติใบสั่งจอง AI">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-[#0C447C]">อนุมัติใบสั่งจอง AI</h2>
        {busy && !preview && <p className="mt-3 text-sm">กำลังตรวจสอบเอกสาร…</p>}
        {preview && <div className="mt-3 space-y-2 text-sm text-gray-700">
          <p>เลขที่ booking: <strong>{preview.docuNo}</strong></p>
          <p>ระบบจะออกเลข AI เมื่อยืนยันอนุมัติ</p>
          {preview.selfApproval && <p>คุณกำลังอนุมัติ booking ที่คุณยืนยันเอง ระบบจะบันทึกไว้ในประวัติ</p>}
        </div>}
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">ปิด</button>
          {preview && <button onClick={approve} disabled={busy} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? 'กำลังบันทึก…' : 'ยืนยันอนุมัติ AI'}
          </button>}
        </div>
      </div>
    </div>, document.body)}
  </>;
}
