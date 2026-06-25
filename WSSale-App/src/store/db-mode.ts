/**
 * db-mode.ts — โหมดแหล่งข้อมูล (runtime, เก็บใน localStorage)
 *   mock   → ใช้ mock.ts (ไม่ต้องมี backend) — สำหรับ demo/Vercel
 *   local  → backend จริง + DB local (Windows Auth)
 *   remote → backend จริง + DB remote (SQL Auth) ผ่าน header X-DB-Target
 *
 * เปลี่ยนได้เฉพาะ ADMIN (UI gate) · กรณีรัน local เลือกได้ทั้ง 3
 */
export type DbMode = 'mock' | 'local' | 'remote';

const KEY = 'wssale_dbmode';

export function getDbMode(): DbMode {
  const saved = (typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null) as DbMode | null;
  if (saved === 'mock' || saved === 'local' || saved === 'remote') return saved;
  // บังคับให้ใช้ข้อมูลจริงจากฐานข้อมูลเสมอตามความต้องการของผู้ใช้
  return 'local';
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
  mock:   { label: 'MOCK',   color: '#EA580C', desc: 'ข้อมูลตัวอย่าง (ไม่ต้องมี backend)' },
  local:  { label: 'LOCAL',  color: '#475569', desc: 'DB ในเครื่อง (Windows Auth)' },
  remote: { label: 'REMOTE', color: '#059669', desc: 'DB ระยะไกล (SQL Auth)' },
};
