import { useEffect, useRef, useState } from 'react';
import { fetchNativeCutReview, recordNativeCutHoldReview, releaseNativeEdit, resumeNativeEdit, type NativeCutReviewItem } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';

const labels: Record<string, string> = {
  NATIVE_TRANSACTION_INCOMPLETE: 'พบหลักฐานเริ่มตัดตั๋ว แต่รายการยังไม่สมบูรณ์',
  NATIVE_EDIT_INCOMPLETE: 'พบการแก้ไขใบขนที่ยังไม่สมบูรณ์ ระบบพักยอดตั๋วไว้ตรวจสอบ',
  NATIVE_EDIT_COMPLETED_REVIEW: 'บันทึกการคืนยอดจากใบขนแล้ว ยอดตั๋วยังรอตรวจสอบ',
  NATIVE_EDIT_RELEASED: 'ตรวจหลักฐานและปล่อยยอดพักแล้ว',
  NATIVE_PARTIAL_APPLIED: 'พบหลักฐานว่าบางบรรทัดตัดแล้วและบางบรรทัดยังค้าง กรุณาตรวจสอบ',
  NATIVE_EVIDENCE_INCONSISTENT: 'หลักฐานการตัดตั๋วไม่สอดคล้อง กรุณาตรวจสอบ',
  EXPIRED_SOURCE_UNCONFIRMED: 'ใบอนุญาตหมดอายุ ยังยืนยันใบขนไม่ได้',
  CLOSED_SOURCE_UNCONFIRMED: 'ใบอนุญาตปิดแล้ว ยังยืนยันต้นทางไม่ได้',
  CLOSED_WITH_NATIVE_SOURCE: 'พบใบขนหลังปิดใบอนุญาต',
  NATIVE_ATTEMPT_OR_DELETED: 'พบประวัติ แต่ยังยืนยันใบขนปัจจุบันไม่ได้',
  LINKED_SOURCE_MISSING: 'พบการจับคู่ แต่ไม่พบใบขนต้นทาง',
  NATIVE_SOURCE_REFERENCE_MISMATCH: 'ข้อมูลใบขนต้นทางไม่ตรงกับเลขอ้างอิง กรุณาตรวจสอบ',
  SOURCE_DATE_OUTSIDE_WINDOW: 'ต้นทางอยู่นอกช่วงข้อมูลหรือไม่ทราบวันที่',
  SOURCE_STATUS_UNVERIFIED: 'ยังยืนยันสถานะใบขนไม่ได้',
  NATIVE_LINES_CHANGED: 'รายการหรือจำนวนในใบขนเปลี่ยน',
  NATIVE_LINES_INCOMPLETE_OR_AMBIGUOUS: 'รายการใบขนไม่ครบหรือกำกวม',
  NATIVE_DOCUMENT_AMBIGUOUS: 'พบเอกสารต้นทางกำกวม',
  SETTLEMENT_LINK_INCOMPLETE: 'การจับคู่ยอดจองยังไม่ครบ',
  SETTLEMENT_LINK_INCONSISTENT: 'การจับคู่ยอดจองไม่ตรงต้นทาง',
  LINKED_REQUIRES_TRANSACTION_EVIDENCE: 'ต้องตรวจหลักฐานการตัดยอดใน transaction เดียวกัน',
};

export function NativeCutReviewQueue({ canReview }: { canReview: boolean }) {
  const token = useAuthStore(s => s.token);
  const [items, setItems] = useState<NativeCutReviewItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [reviewAction, setReviewAction] = useState<'hold' | 'release' | 'resume'>('hold');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    setItems([]); setCursor(null); setLoaded(false); setBusy(false); setError(''); setReviewId(null); setNote(''); setNotice('');
    return () => { generation.current++; };
  }, [token, canReview]);

  async function load(next?: string, successNotice?: string) {
    const current = ++generation.current;
    setBusy(true); setError('');
    if (!next) { setItems([]); setCursor(null); setLoaded(false); setReviewId(null); setNote(''); setNotice(''); }
    try {
      const result = await fetchNativeCutReview(next);
      if (generation.current !== current) return;
      setItems(previous => next ? [...previous, ...result.items] : result.items);
      setCursor(result.nextCursor); setLoaded(true);
      if (successNotice) setNotice(successNotice);
    } catch {
      if (generation.current === current) setError('ยังไม่สามารถโหลดคิวได้ กรุณาตรวจสิทธิ์และความพร้อมของระบบ หรือลองใหม่');
    } finally { if (generation.current === current) setBusy(false); }
  }

  async function hold(item: NativeCutReviewItem) {
    if ((reviewAction === 'release' && !item.releaseId) || (reviewAction === 'resume' && !item.resumeId)) return;
    const current = ++generation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      if (reviewAction === 'release' && item.releaseId) await releaseNativeEdit(item.releaseId, note.trim());
      else if (reviewAction === 'resume' && item.resumeId) await resumeNativeEdit(item.resumeId, note.trim());
      else await recordNativeCutHoldReview(item.authorizationId, item.code, note.trim());
      if (generation.current !== current) return;
      setReviewId(null); setNote('');
      if (reviewAction === 'release') {
        setItems(previous => previous.map(row => row.authorizationId === item.authorizationId
          ? { ...row, code: 'NATIVE_EDIT_RELEASED', releaseId: undefined } : row));
        setNotice('ตรวจและปล่อยยอดพักแล้ว ยอดจองที่เหลือยังผูกกับใบเดิม');
      } else if (reviewAction === 'resume') {
        await load(undefined, 'กู้ใบขนตามแผนสำเร็จแล้ว กรุณาตรวจยอดและหลักฐานก่อนปล่อยยอดพัก');
      } else setNotice('บันทึกผลตรวจแล้ว ยอดจองยังคงพักไว้');
    } catch {
      if (generation.current === current) setError('บันทึกผลตรวจไม่ได้ กรุณาโหลดคิวใหม่ ตรวจสิทธิ์และสถานะรายการ แล้วลองอีกครั้ง');
    } finally { if (generation.current === current) setBusy(false); }
  }

  if (!canReview) return null;
  return <section className="bg-white rounded-2xl border border-amber-200 p-4 sm:p-5" aria-labelledby="native-review-title">
    <h3 id="native-review-title" className="text-sm font-bold text-gray-800">คิวตรวจใบขนและยอดจอง</h3>
    <p className="text-xs text-gray-600 mt-1">ตรวจรายการที่มีใบอนุญาตเท่านั้น การดูคิวไม่ปล่อยยอดจองและไม่ยืนยันว่าตัดตั๋วสำเร็จ</p>
    <button type="button" disabled={busy} onClick={() => void load()}
      className="mt-3 px-4 py-2 rounded-lg bg-[#0C447C] text-white text-sm font-bold disabled:opacity-50">
      {busy ? 'กำลังตรวจ...' : 'โหลดคิวตรวจ'}
    </button>
    {error && <p role="alert" className="text-sm text-red-700 mt-3">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-700 mt-3">{notice}</p>}
    {loaded && items.length === 0 && <p role="status" className="text-sm text-gray-600 mt-3">
      ไม่พบรายการที่ต้องตรวจในส่วนที่โหลด{cursor ? ' สามารถโหลดส่วนถัดไปได้' : ''}
    </p>}
    {items.length > 0 && <ul className="mt-3 space-y-2">{items.map(item =>
      <li key={item.authorizationId} className="rounded-lg border border-amber-200 p-3 text-sm">
        <span className="font-semibold">รายการตรวจ #{item.authorizationId}</span>
        <span className="ml-2">{labels[item.code] || 'หลักฐานยังไม่ครบ กรุณาตรวจสอบ'}</span>
        {item.docuNo && <span className="ml-2">ใบขน {item.docuNo}</span>}
        {item.sourceHidden && <span className="ml-2 text-gray-500">รายละเอียดต้นทางไม่แสดง</span>}
        {item.recovery && <p className="mt-1 text-gray-700">
          คืนยอด {item.recovery.restoredQty} · ยอดจับคู่สุทธิ {item.recovery.settledAfter}
          {' · คืนจากใบขนก่อนวันเริ่มข้อมูล '}{item.recovery.openingSourceRestored}
        </p>}
        {item.code !== 'NATIVE_EDIT_RELEASED' && <div className="mt-2">
          {reviewId !== item.authorizationId ? <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy}
              onClick={() => { setReviewId(item.authorizationId); setReviewAction('hold'); setNote(''); setNotice(''); }}
              className="text-blue-700 underline disabled:opacity-50">บันทึกว่าพักตรวจต่อ</button>
            {item.releaseId && <button type="button" disabled={busy}
              onClick={() => { setReviewId(item.authorizationId); setReviewAction('release'); setNote(''); setNotice(''); }}
              className="text-blue-700 underline disabled:opacity-50">ตรวจและปล่อยยอดพัก</button>}
            {item.resumeId && <button type="button" disabled={busy}
              onClick={() => { setReviewId(item.authorizationId); setReviewAction('resume'); setNote(''); setNotice(''); }}
              className="text-blue-700 underline disabled:opacity-50">กู้ใบขนตามแผน</button>}
          </div> : <>
            <label className="block text-gray-700" htmlFor={`native-review-note-${item.authorizationId}`}>
              {reviewAction === 'release' ? 'เหตุผลที่ยืนยันปล่อยยอดพัก'
                : reviewAction === 'resume' ? 'เหตุผลที่ยืนยันกู้ใบขน' : 'เหตุผลที่พักตรวจต่อ'}
            </label>
            <input id={`native-review-note-${item.authorizationId}`} value={note} maxLength={300} disabled={busy}
              onChange={e => setNote(e.target.value)} className="mt-1 w-full rounded border border-gray-300 p-2" />
            <p className="text-xs text-gray-500 mt-1">
              {reviewAction === 'release' ? 'หลังยืนยัน ระบบจะใช้ยอดจับคู่สุทธิ ยอดจองคงเหลือยังผูกกับใบเดิม'
                : reviewAction === 'resume' ? 'ระบบจะกู้ใบขนตามจำนวนที่อนุมัติและเก็บยอดพักไว้รอตรวจ'
                : 'บันทึกผลตรวจเท่านั้น ยอดจองและตั๋วจะไม่เปลี่ยน'}
            </p>
            <button type="button" disabled={busy || note.trim().length < (reviewAction === 'hold' ? 5 : 10)} onClick={() => void hold(item)}
              className="mt-2 mr-2 rounded bg-[#0C447C] px-3 py-1 text-white disabled:opacity-50">
              {reviewAction === 'release' ? 'ยืนยันปล่อยยอดพัก' : reviewAction === 'resume' ? 'ยืนยันกู้ใบขน' : 'บันทึกผลตรวจ'}
            </button>
            <button type="button" disabled={busy} onClick={() => { setReviewId(null); setNote(''); }} className="text-gray-600 underline">ยกเลิก</button>
          </>}
        </div>}
      </li>)}</ul>}
    {cursor && <button type="button" disabled={busy} onClick={() => void load(cursor)}
      className="mt-3 px-4 py-2 rounded-lg border border-gray-300 text-sm disabled:opacity-50">โหลดรายการถัดไป</button>}
  </section>;
}
