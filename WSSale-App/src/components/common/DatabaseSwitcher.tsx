import { useEffect, useRef, useState } from 'react';
import { Database, Check, ChevronDown } from 'lucide-react';
import { getDatabases, switchDatabase, setToken, type DatabaseInfo } from '../../services/api';

/**
 * Shows the session's active database (replaces the old "SERVER" label) and, for a permitted
 * role, a dropdown to switch to another allowed database for this session only. Switching
 * reissues the token and reloads so every view reads from the chosen database; signing out or a
 * timeout drops the choice and returns to the system default (owner 2026-10-25).
 */
export function DatabaseSwitcher() {
  const [info, setInfo] = useState<DatabaseInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getDatabases().then(d => { if (live) setInfo(d); }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!info || !info.active) return null;

  const switched = info.active.toLowerCase() !== info.system.toLowerCase();
  const canOpen = info.canSwitch && info.list.length > 1;

  async function choose(database: string) {
    if (busy) return;
    if (database.toLowerCase() === info!.active.toLowerCase()) { setOpen(false); return; }
    setBusy(true);
    try {
      const res = await switchDatabase(database);
      setToken(res.accessToken);
      window.location.reload();
    } catch { setBusy(false); }
  }

  const pill = (
    <span className="flex items-center gap-1.5 min-w-0">
      <Database className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate max-w-[9rem] font-semibold tabular-nums">{info.active}</span>
      {canOpen && <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />}
    </span>
  );

  const base = `flex items-center rounded-lg px-2.5 py-1.5 text-xs border transition-colors ${
    switched
      ? 'bg-amber-50 text-amber-800 border-amber-300'
      : 'bg-green-50 text-green-800 border-green-200'
  }`;

  if (!canOpen) {
    return <div className={base} title={switched ? `ฐานข้อมูลชั่วคราว (ระบบตั้งไว้: ${info.system})` : 'ฐานข้อมูลที่ใช้งาน'}>{pill}</div>;
  }

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" disabled={busy} onClick={() => setOpen(o => !o)}
        className={`${base} ${busy ? 'opacity-60' : 'hover:brightness-95'}`}
        title={switched ? `ฐานข้อมูลชั่วคราว (ระบบตั้งไว้: ${info.system})` : 'เลือกฐานข้อมูลสำหรับ session นี้'}>
        {pill}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 rounded-xl border border-border bg-white shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground border-b border-border">
            ฐานข้อมูลสำหรับ session นี้
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {info.list.map(db => {
              const active = db.toLowerCase() === info.active.toLowerCase();
              const isSystem = db.toLowerCase() === info.system.toLowerCase();
              return (
                <button key={db} type="button" disabled={busy} onClick={() => choose(db)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50 ${active ? 'font-bold text-green-700' : 'text-gray-700'}`}>
                  <span className="truncate">{db}{isSystem && <span className="ml-1 text-[10px] text-muted-foreground">(ค่าระบบ)</span>}</span>
                  {active && <Check className="h-4 w-4 shrink-0 text-green-600" />}
                </button>
              );
            })}
          </div>
          {switched && (
            <button type="button" disabled={busy} onClick={() => choose(info.system)}
              className="w-full border-t border-border px-3 py-2 text-left text-xs font-semibold text-[#0C447C] hover:bg-blue-50">
              กลับไปใช้ฐานข้อมูลของระบบ ({info.system})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
