import { useAppStore } from '../../store/app-store';

export function GlobalLoader() {
  const globalLoadingCount = useAppStore(state => state.globalLoadingCount);

  if (globalLoadingCount === 0) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/20 backdrop-blur-sm transition-opacity duration-300">
      <div className="flex flex-col items-center gap-3 bg-white p-6 rounded-2xl shadow-2xl border border-gray-100">
        <div className="relative flex h-12 w-12 items-center justify-center">
          <div className="absolute inset-0 rounded-full border-4 border-gray-100"></div>
          <div className="absolute inset-0 rounded-full border-4 border-[#0C447C] border-t-transparent animate-spin"></div>
          <div className="h-4 w-4 bg-[#0C447C] rounded-full animate-pulse"></div>
        </div>
        <div className="text-sm font-semibold text-[#0C447C] animate-pulse">
          กำลังโหลดข้อมูล...
        </div>
      </div>
    </div>
  );
}
