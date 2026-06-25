import { Database } from 'lucide-react';
import { getDbMode, setDbMode, DB_MODE_META, type DbMode } from '../../store/db-mode';
import { clearToken } from '../../services/api';

const ORDER: DbMode[] = ['mock', 'local', 'remote'];

/**
 * สลับแหล่งข้อมูล (ADMIN เท่านั้น) — เปลี่ยนแล้ว reload
 * ข้ามขอบ mock ↔ real = ล้าง token ให้ login ใหม่ (token คนละชุด)
 */
export function DbModeSwitch({ collapsed }: { collapsed?: boolean }) {
  const cur = getDbMode();

  function switchTo(m: DbMode) {
    if (m === cur) return;
    const crossingMock = (m === 'mock') !== (cur === 'mock');
    setDbMode(m);
    if (crossingMock) clearToken();
    window.location.reload();
  }

  if (collapsed) {
    const meta = DB_MODE_META[cur];
    return (
      <div className="flex justify-center py-1" title={`DB: ${meta.label}`}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
      </div>
    );
  }

  return (
    <div className="px-1 py-1">
      <div className="flex items-center gap-1 mb-1 text-[10px] text-muted-foreground uppercase tracking-wide">
        <Database size={11} /> แหล่งข้อมูล
      </div>
      <div className="flex gap-1">
        {ORDER.map(m => {
          const meta = DB_MODE_META[m];
          const active = cur === m;
          return (
            <button
              key={m}
              onClick={() => switchTo(m)}
              title={meta.desc}
              className={`flex-1 px-1.5 py-1 rounded-md text-[10px] font-bold border transition-all ${active ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
              style={active ? { background: meta.color } : {}}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
