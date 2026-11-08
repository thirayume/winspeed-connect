import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/app-store';

export function GlobalLoader() {
  const busy = useAppStore(state => state.globalLoadingCount > 0);
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) { setVisible(false); setSlow(false); return; }
    const show = window.setTimeout(() => setVisible(true), 350);
    const warn = window.setTimeout(() => setSlow(true), 10000);
    return () => { clearTimeout(show); clearTimeout(warn); };
  }, [busy]);
  if (!busy || !visible) return null;

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
        <div className="text-xs text-[#0C447C]">
          {slow ? 'ระบบตอบช้า ข้อมูลที่กำลังกรอกยังอยู่ กรุณารอผลก่อนทำรายการซ้ำ' : 'กำลังอัปเดตข้อมูล… คุณทำงานต่อได้'}
        </div>
      </div>
    </div>
  );
}
