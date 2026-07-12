/**
 * db-mode.ts — โหมดแหล่งข้อมูล (runtime, เก็บใน localStorage)
 *   local  → backend จริง + DB local (Windows Auth)
 *   remote → backend จริง + DB remote (SQL Auth) ผ่าน header X-DB-Target
 *
 * เปลี่ยนได้เฉพาะ ADMIN (UI gate) · กรณีรัน local เลือกได้ทั้ง 2
 */
export type DbMode = 'local' | 'remote';

const KEY = 'wssale_dbmode';

export function getDbMode(): DbMode {
  const saved = (typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null) as DbMode | null;
  const isProd = import.meta.env?.PROD;

  if (saved === 'local' || saved === 'remote') {
    if (isProd && saved === 'local') return 'remote';
    return saved;
  }
  return isProd ? 'remote' : 'local';
}

export function setDbMode(m: DbMode) {
  localStorage.setItem(KEY, m);
}

/** header สำหรับบอก backend ว่าจะใช้ DB ไหน (เฉพาะ local/remote) */
export function dbTargetHeader(): Record<string, string> {
  const m = getDbMode();
  return m === 'local' || m === 'remote' ? { 'X-DB-Target': m } : {};
}

export const DB_MODE_META: Record<DbMode, { label: string; color: string; desc: string }> = {
  local:  { label: 'LOCAL',  color: '#475569', desc: 'DB ในเครื่อง (Windows Auth)' },
  remote: { label: 'REMOTE', color: '#059669', desc: 'DB ระยะไกล (SQL Auth)' },
};
