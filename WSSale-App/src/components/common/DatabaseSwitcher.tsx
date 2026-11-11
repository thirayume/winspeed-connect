import { confirmLeaveEditors } from '../../utils/unsaved-changes';
import { useEffect, useRef, useState } from 'react';
import { Database, Check, ChevronDown, Lock } from 'lucide-react';
import {
  getDatabases,
  switchDatabase,
  setToken,
  type DatabaseInfo,
  type DatabaseMeta,
  type DatabaseThemeColor,
} from '../../services/api';

const THEME_STYLES: Record<
  DatabaseThemeColor,
  {
    pill: string;
    badge: string;
    dot: string;
    icon: string;
    activeItem: string;
  }
> = {
  red: {
    pill: 'bg-rose-50/95 text-rose-900 border-rose-300 hover:bg-rose-100 ring-rose-200',
    badge: 'bg-rose-100 text-rose-800 border-rose-300',
    dot: 'bg-rose-500 ring-rose-300',
    icon: 'text-rose-700',
    activeItem: 'bg-rose-50 text-rose-900 font-bold',
  },
  yellow: {
    pill: 'bg-amber-50/95 text-amber-900 border-amber-300 hover:bg-amber-100 ring-amber-200',
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-500 ring-amber-300',
    icon: 'text-amber-700',
    activeItem: 'bg-amber-50 text-amber-900 font-bold',
  },
  green: {
    pill: 'bg-emerald-50/95 text-emerald-900 border-emerald-300 hover:bg-emerald-100 ring-emerald-200',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    dot: 'bg-emerald-500 ring-emerald-300',
    icon: 'text-emerald-700',
    activeItem: 'bg-emerald-50 text-emerald-900 font-bold',
  },
  blue: {
    pill: 'bg-sky-50/95 text-sky-900 border-sky-300 hover:bg-sky-100 ring-sky-200',
    badge: 'bg-sky-100 text-sky-800 border-sky-300',
    dot: 'bg-sky-500 ring-sky-300',
    icon: 'text-sky-700',
    activeItem: 'bg-sky-50 text-sky-900 font-bold',
  },
  slate: {
    pill: 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200 ring-slate-200',
    badge: 'bg-slate-200 text-slate-700 border-slate-300',
    dot: 'bg-slate-500 ring-slate-300',
    icon: 'text-slate-600',
    activeItem: 'bg-slate-100 text-slate-900 font-bold',
  },
};

function normalizeKey(str: string): string {
  return String(str || '').toLowerCase().replace(/[-_]/g, '').trim();
}

function resolveDbMeta(name: string, info: DatabaseInfo | null): DatabaseMeta {
  if (!name) {
    return {
      name: '',
      color: 'slate',
      label: '',
      badge: '',
      description: '',
      restrictedRoles: [],
      isRestricted: false,
      isAllowed: true,
    };
  }

  // 1. Look up in metaList from backend
  if (info?.metaList && info.metaList.length > 0) {
    const found = info.metaList.find(m => normalizeKey(m.name) === normalizeKey(name));
    if (found) return found;
  }

  // 2. Look up in custom themes
  if (info?.themes) {
    for (const [k, v] of Object.entries(info.themes)) {
      if (normalizeKey(k) === normalizeKey(name)) {
        return {
          name,
          color: v.color || 'blue',
          label: v.label || name,
          badge: v.badge || v.label || '',
          description: v.description || '',
          restrictedRoles: v.restrictedRoles || (normalizeKey(name).endsWith('2') ? ['ACCOUNTING', 'C_LEVEL', 'ADMIN'] : []),
          isRestricted: (v.restrictedRoles?.length ?? 0) > 0 || normalizeKey(name).endsWith('2'),
          isAllowed: true,
        };
      }
    }
  }

  // 3. Built-in defaults
  const norm = normalizeKey(name);
  if (norm.includes('uat')) {
    return {
      name,
      color: 'green',
      label: 'UAT_DB',
      badge: 'UAT_DB',
      description: 'ฐานข้อมูล UAT สำหรับทดสอบระบบ',
      restrictedRoles: [],
      isRestricted: false,
      isAllowed: true,
    };
  }
  if (norm.endsWith('2')) {
    return {
      name,
      color: 'yellow',
      label: 'PROD_DB_RD',
      badge: 'PROD_DB_RD',
      description: 'ฐานข้อมูล PROD_DB_RD (เฉพาะทีมบัญชีและผู้บริหาร)',
      restrictedRoles: ['ACCOUNTING', 'C_LEVEL', 'ADMIN'],
      isRestricted: true,
      isAllowed: true,
    };
  }
  if (norm.endsWith('9')) {
    return {
      name,
      color: 'red',
      label: 'PROD_DB',
      badge: 'PROD_DB',
      description: 'ฐานข้อมูล Production หลัก (ข้อมูลจริง)',
      restrictedRoles: [],
      isRestricted: false,
      isAllowed: true,
    };
  }

  return {
    name,
    color: 'blue',
    label: name,
    badge: '',
    description: '',
    restrictedRoles: [],
    isRestricted: false,
    isAllowed: true,
  };
}

/**
 * Shows the session's active database with environment-aware colors and, for a permitted
 * role, a dropdown to switch to another allowed database for this session only.
 * - dbwins_worldfert9: PROD_DB (Red tone)
 * - dbwins_worldfert2: PROD_DB_RD (Yellow tone - restricted to Accounting, C_Level, ADMIN)
 * - dbwins_worldfert9_uat: UAT_DB (Green tone)
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
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!info || !info.active) return null;

  const activeMeta = resolveDbMeta(info.active, info);
  const theme = THEME_STYLES[activeMeta.color] || THEME_STYLES.slate;
  const switched = info.active.toLowerCase() !== info.system.toLowerCase();
  const canOpen = info.canSwitch && ((info.list?.length || 0) > 1 || (info.metaList?.length || 0) > 1);

  async function choose(database: string) {
    if (busy) return;
    if (database.toLowerCase() === info!.active.toLowerCase()) { setOpen(false); return; }
    if (!(await confirmLeaveEditors())) return;
    setBusy(true);
    try {
      const res = await switchDatabase(database);
      setToken(res.accessToken);
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }

  const pill = (
    <span className="flex items-center gap-2 whitespace-nowrap min-w-0">
      <Database className={`h-3.5 w-3.5 shrink-0 ${theme.icon}`} />
      {activeMeta.badge && (
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider border shadow-2xs ${theme.badge}`}>
          {activeMeta.badge}
        </span>
      )}
      <span className="font-semibold tabular-nums tracking-tight">{info.active}</span>
      {canOpen ? (
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          } opacity-75`}
        />
      ) : (
        <Lock className="h-3 w-3 shrink-0 opacity-40 ml-0.5" />
      )}
    </span>
  );

  const base = `flex items-center rounded-lg px-2.5 sm:px-3 py-1.5 text-xs border shadow-2xs transition-all duration-150 ${theme.pill}`;

  if (!canOpen) {
    return (
      <div
        className={base}
        title={
          info.canSwitch
            ? `ฐานข้อมูลปัจจุบัน: ${info.active}`
            : `ฐานข้อมูลที่กำลังใช้งาน: ${info.active} (${activeMeta.label || 'ฐานข้อมูลปัจจุบัน'}) — สิทธิ์ของคุณไม่สามารถสลับฐานข้อมูลได้`
        }
      >
        {pill}
      </div>
    );
  }

  const candidateItems =
    info.metaList && info.metaList.length > 0
      ? info.metaList
      : info.list.map(name => resolveDbMeta(name, info));

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(o => !o)}
        className={`${base} ${busy ? 'opacity-60 cursor-wait' : 'hover:brightness-95 cursor-pointer'}`}
        title={
          switched
            ? `ฐานข้อมูลชั่วคราว (ระบบตั้งไว้: ${info.system}) คลิกเพื่อสลับ`
            : `เลือกฐานข้อมูลสำหรับ session นี้ (${activeMeta.label})`
        }
      >
        {pill}
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-80 sm:w-88 rounded-xl border border-border bg-white shadow-xl z-50 overflow-hidden divide-y divide-border">
          <div className="bg-gray-50/80 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
            <span>ฐานข้อมูลสำหรับ Session นี้</span>
            {switched && <span className="text-amber-700 font-semibold">สลับฐานอยู่</span>}
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {candidateItems.map(item => {
              const active = item.name.toLowerCase() === info.active.toLowerCase();
              const isSystem = item.name.toLowerCase() === info.system.toLowerCase();
              const itemTheme = THEME_STYLES[item.color] || THEME_STYLES.slate;
              const isLocked = item.isAllowed === false;

              return (
                <button
                  key={item.name}
                  type="button"
                  disabled={busy || isLocked}
                  onClick={() => !isLocked && choose(item.name)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                    isLocked
                      ? 'opacity-40 cursor-not-allowed bg-gray-50'
                      : active
                      ? itemTheme.activeItem
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  title={
                    isLocked
                      ? `สงวนสิทธิ์เฉพาะทีมที่ได้รับอนุญาต (${(item.restrictedRoles || []).join(', ')})`
                      : item.description || undefined
                  }
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${itemTheme.dot}`} />
                    {item.badge && (
                      <span className={`rounded px-1.5 py-0.2 text-[9px] font-bold border uppercase ${itemTheme.badge}`}>
                        {item.badge}
                      </span>
                    )}
                    <span className="font-semibold tabular-nums truncate">{item.name}</span>
                    {isSystem && (
                      <span className="text-[10px] text-muted-foreground font-normal">(ค่าระบบ)</span>
                    )}
                    {isLocked && <Lock className="h-3 w-3 text-gray-400 shrink-0 ml-0.5" />}
                  </span>
                  {active && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                </button>
              );
            })}
          </div>

          {switched && (
            <button
              type="button"
              disabled={busy}
              onClick={() => choose(info.system)}
              className="w-full px-3 py-2.5 text-left text-xs font-semibold text-[#0C447C] hover:bg-blue-50/70 transition-colors flex items-center justify-between"
            >
              <span>กลับไปใช้ฐานข้อมูลของระบบ ({info.system})</span>
              <span className="text-[10px] text-muted-foreground">รีเซ็ต</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
