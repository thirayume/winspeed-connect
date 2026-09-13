/** Production follows server DB_MODE; development can explicitly select a configured target. */
export type DbMode = 'server' | 'local' | 'remote' | 'remote_b';
const KEY = 'wssale_dbmode';
export function getDbMode(): DbMode {
  if (import.meta.env?.PROD) return 'server';
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  if (saved === 'server' || saved === 'local' || saved === 'remote' || saved === 'remote_b') return saved;
  return 'server';
}
export function setDbMode(m: DbMode) { localStorage.setItem(KEY, m); }
export function dbTargetHeader(): Record<string, string> {
  const m = getDbMode();
  return m === 'server' ? {} : { 'X-DB-Target': m };
}
export const DB_MODE_META: Record<DbMode, { label: string; color: string; desc: string }> = {
  server: { label: 'SERVER', color: '#059669', desc: 'ฐานข้อมูลที่เซิร์ฟเวอร์กำหนด' },
  local: { label: 'LOCAL', color: '#475569', desc: 'ฐานข้อมูลในเครื่อง Windows' },
  remote: { label: 'DOCKER', color: '#059669', desc: 'SQL Server ตาม REMOTE_DB_*' },
  remote_b: { label: 'HOSTINGER', color: '#0369a1', desc: 'Hostinger ตาม REMOTE_B_DB_*' },
};
