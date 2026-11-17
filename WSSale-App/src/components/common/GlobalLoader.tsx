import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { cancelPendingReads } from '../../services/api';

/**
 * Small corner notice while requests run. It never covers the page. When loading is slow and only reads are
 * waiting, it offers "หยุดรอ": the pending reads stop, each screen drops its own spinner, and the user carries on
 * (owner, 17 Nov 2026: a 30 s read left screens feeling locked although they were not). A save in flight is never
 * cancelled from here; the notice then says to wait for its result.
 */
export function GlobalLoader() {
  const busy = useAppStore(state => state.globalLoadingCount > 0);
  const writing = useAppStore(state => state.globalWritingCount > 0);
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) { setVisible(false); setSlow(false); return; }
    const show = window.setTimeout(() => setVisible(true), 350);
    const warn = window.setTimeout(() => setSlow(true), 6000);
    return () => { clearTimeout(show); clearTimeout(warn); };
  }, [busy]);
  if (!busy || !visible) return null;

  const message = writing
    ? (slow ? 'กำลังบันทึก ระบบตอบช้า — ข้อมูลที่กรอกยังอยู่ กรุณารอผลก่อนกดบันทึกซ้ำ' : 'กำลังบันทึก…')
    : (slow ? 'โหลดข้อมูลช้า — กดหยุดรอเพื่อทำงานต่อ ข้อมูลที่กรอกยังอยู่' : 'กำลังโหลดข้อมูล…');

  return (
    <div
      data-testid="global-loader"
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-20 right-3 z-[9999] max-w-[calc(100vw-1.5rem)] md:bottom-4"
    >
      <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl shadow-md border border-blue-100">
        <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <div className="absolute inset-0 rounded-full border-4 border-gray-100"></div>
          <div className="absolute inset-0 rounded-full border-4 border-[#0C447C] border-t-transparent animate-spin"></div>
        </div>
        <div className="text-xs text-[#0C447C]">{message}</div>
        {slow && !writing && (
          <button
            type="button"
            data-testid="global-loader-cancel"
            onClick={() => cancelPendingReads()}
            className="pointer-events-auto ml-1 shrink-0 rounded-lg border border-[#0C447C] px-2 py-0.5 text-xs font-bold text-[#0C447C] hover:bg-blue-50"
          >
            หยุดรอ
          </button>
        )}
      </div>
    </div>
  );
}
