import { useEffect, useState } from 'react';
import { Database, Save } from 'lucide-react';
import { getDatabases, setSystemDatabase, type DatabaseInfo } from '../../services/api';

/**
 * Admin control for the system-wide default database (owner 2026-10-25). It changes which
 * database everyone uses by default; a user's own session switch (topbar) still overrides it.
 * Renders only for a role that may set the system default.
 */
export function SystemDatabaseSetting() {
  const [info, setInfo] = useState<DatabaseInfo | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getDatabases().then(d => { setInfo(d); setChoice(d.system); }).catch(() => {});
  }, []);

  if (!info || !info.canSetSystem) return null;

  async function save() {
    if (busy || !choice || choice === info!.system) return;
    setBusy(true); setMsg(null);
    try {
      const res = await setSystemDatabase(choice);
      setInfo({ ...info!, system: res.system });
      setMsg({ ok: true, text: `ตั้งฐานข้อมูลของระบบเป็น ${res.system} แล้ว (มีผลกับผู้ใช้ที่ยังไม่สลับฐานเอง)` });
    } catch {
      setMsg({ ok: false, text: 'บันทึกไม่สำเร็จ เลือกได้เฉพาะฐานข้อมูลที่ระบบอนุญาต' });
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
      <div className="flex items-center gap-2 mb-1 text-sm font-bold text-[#0C447C]">
        <Database size={16} /> ฐานข้อมูลของระบบ (System Database)
      </div>
      <p className="text-[11px] text-gray-600 mb-3">
        ฐานข้อมูลเริ่มต้นสำหรับผู้ใช้ทุกคน ผู้ใช้ที่มีสิทธิ์ยังสลับฐานเฉพาะ session ของตนได้ที่แถบบน
        และจะกลับมาใช้ค่านี้เมื่อออกจากระบบ
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-gray-700">
          เลือกฐานข้อมูล
          <select value={choice} onChange={e => setChoice(e.target.value)} disabled={busy}
            className="min-w-[14rem] rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-800">
            {info.list.map(db => (
              <option key={db} value={db}>{db}{db.toLowerCase() === info.primary.toLowerCase() ? ' (ฐานหลัก)' : ''}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={save} disabled={busy || choice === info.system}
          className="flex items-center gap-1.5 rounded-lg bg-[#0C447C] px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40">
          <Save size={14} /> บันทึกฐานข้อมูลของระบบ
        </button>
        <span className="text-[11px] text-gray-500">ปัจจุบัน: <strong className="text-gray-800">{info.system}</strong></span>
      </div>
      {msg && <p className={`mt-2 text-[11px] font-semibold ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}
    </div>
  );
}
