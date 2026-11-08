import { useEffect, useState } from 'react';
import { Database, Save, Palette, Lock, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';
import {
  getDatabases,
  setSystemDatabase,
  saveDatabaseThemes,
  type DatabaseInfo,
  type DatabaseThemeColor,
  type DatabaseThemeConfig,
} from '../../services/api';

const COLOR_OPTIONS: { value: DatabaseThemeColor; label: string; previewClass: string }[] = [
  { value: 'red', label: 'แดง (Red · PROD Data)', previewClass: 'bg-rose-500 text-white' },
  { value: 'yellow', label: 'เหลือง (Yellow · Restricted / RD)', previewClass: 'bg-amber-500 text-white' },
  { value: 'green', label: 'เขียว (Green · UAT Test)', previewClass: 'bg-emerald-500 text-white' },
  { value: 'blue', label: 'ฟ้า (Blue · Secondary)', previewClass: 'bg-sky-500 text-white' },
  { value: 'slate', label: 'เทา (Slate · Default)', previewClass: 'bg-slate-500 text-white' },
];

const PREVIEW_STYLES: Record<DatabaseThemeColor, { pill: string; badge: string; text: string }> = {
  red: {
    pill: 'bg-rose-50/95 text-rose-900 border-rose-300 ring-rose-200',
    badge: 'bg-rose-100 text-rose-800 border-rose-300',
    text: 'text-rose-700',
  },
  yellow: {
    pill: 'bg-amber-50/95 text-amber-900 border-amber-300 ring-amber-200',
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    text: 'text-amber-700',
  },
  green: {
    pill: 'bg-emerald-50/95 text-emerald-900 border-emerald-300 ring-emerald-200',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    text: 'text-emerald-700',
  },
  blue: {
    pill: 'bg-sky-50/95 text-sky-900 border-sky-300 ring-sky-200',
    badge: 'bg-sky-100 text-sky-800 border-sky-300',
    text: 'text-sky-700',
  },
  slate: {
    pill: 'bg-slate-100 text-slate-800 border-slate-300 ring-slate-200',
    badge: 'bg-slate-200 text-slate-700 border-slate-300',
    text: 'text-slate-600',
  },
};

/**
 * Admin control for:
 * 1. System-wide default database.
 * 2. Database color themes and environment labels (e.g. red for PROD, yellow for RD, green for UAT).
 * 3. Selector permissions and access policy explanation.
 */
export function SystemDatabaseSetting() {
  const [info, setInfo] = useState<DatabaseInfo | null>(null);
  const [choice, setChoice] = useState('');
  const [busySystem, setBusySystem] = useState(false);
  const [systemMsg, setSystemMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Editable theme state
  const [themeForm, setThemeForm] = useState<Record<string, DatabaseThemeConfig>>({});
  const [busyTheme, setBusyTheme] = useState(false);
  const [themeMsg, setThemeMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getDatabases()
      .then(d => {
        setInfo(d);
        setChoice(d.system);

        // Populate initial theme form
        const initial: Record<string, DatabaseThemeConfig> = {};
        const allNames = Array.from(
          new Set([...(d.metaList?.map(m => m.name) || []), ...(d.list || []), d.system, d.primary].filter(Boolean))
        );

        allNames.forEach(name => {
          const meta = d.metaList?.find(m => m.name.toLowerCase() === name.toLowerCase());
          const custom = d.themes?.[name] || d.themes?.[name.toLowerCase()];
          const norm = name.toLowerCase().replace(/[-_]/g, '');

          let fallbackColor: DatabaseThemeColor = 'blue';
          let fallbackLabel = name;
          let restrictedRoles: string[] | undefined = undefined;

          if (norm.includes('uat')) {
            fallbackColor = 'green';
            fallbackLabel = 'UAT_DB';
          } else if (norm.endsWith('2')) {
            fallbackColor = 'yellow';
            fallbackLabel = 'PROD_DB_RD';
            restrictedRoles = ['ACCOUNTING', 'C_LEVEL', 'ADMIN'];
          } else if (norm.endsWith('9')) {
            fallbackColor = 'red';
            fallbackLabel = 'PROD_DB';
          }

          initial[name] = {
            color: custom?.color || meta?.color || fallbackColor,
            label: custom?.label || meta?.label || fallbackLabel,
            badge: custom?.badge || meta?.badge || custom?.label || meta?.label || fallbackLabel,
            description: custom?.description || meta?.description || '',
            restrictedRoles: custom?.restrictedRoles || meta?.restrictedRoles || restrictedRoles,
          };
        });

        setThemeForm(initial);
      })
      .catch(() => {});
  }, []);

  if (!info || !info.canSetSystem) return null;

  async function saveSystemDb() {
    if (busySystem || !choice || choice === info!.system) return;
    setBusySystem(true);
    setSystemMsg(null);
    try {
      const res = await setSystemDatabase(choice);
      setInfo({ ...info!, system: res.system });
      setSystemMsg({
        ok: true,
        text: `ตั้งฐานข้อมูลของระบบเป็น ${res.system} เรียบร้อยแล้ว (มีผลกับผู้ใช้ที่ยังไม่ได้สลับฐานเอง)`,
      });
    } catch {
      setSystemMsg({ ok: false, text: 'บันทึกไม่สำเร็จ เลือกได้เฉพาะฐานข้อมูลที่ระบบอนุญาต' });
    } finally {
      setBusySystem(false);
    }
  }

  async function saveThemes() {
    if (busyTheme) return;
    setBusyTheme(true);
    setThemeMsg(null);
    try {
      await saveDatabaseThemes(themeForm);
      setThemeMsg({
        ok: true,
        text: 'บันทึกการตั้งค่าสีและป้ายกำกับฐานข้อมูลเรียบร้อยแล้ว (มีผลทันทีใน Topbar)',
      });
      // Refresh database info
      const refreshed = await getDatabases();
      setInfo(refreshed);
    } catch {
      setThemeMsg({ ok: false, text: 'บันทึกการตั้งค่าสีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
    } finally {
      setBusyTheme(false);
    }
  }

  const databaseList = Object.keys(themeForm);

  return (
    <div className="space-y-4">
      {/* Top Card: System Default Database */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
        <div className="flex items-center gap-2 mb-1 text-sm font-bold text-[#0C447C]">
          <Database size={16} /> ฐานข้อมูลเริ่มต้นของระบบ (System Database)
        </div>
        <p className="text-[11px] text-gray-600 mb-3">
          กำหนดฐานข้อมูลหลักเริ่มต้นสำหรับผู้ใช้งานทุกคน หากผู้ใช้มีสิทธิ์และสลับฐานเฉพาะ Session ตนเอง
          ระบบจะกลับมาใช้ค่านี้อัตโนมัติเมื่อออกจากระบบ
        </p>
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-gray-700">
            เลือกฐานข้อมูลระบบ
            <select
              value={choice}
              onChange={e => setChoice(e.target.value)}
              disabled={busySystem}
              className="min-w-[15rem] rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
            >
              {info.list.map(db => (
                <option key={db} value={db}>
                  {db}
                  {db.toLowerCase() === info.primary.toLowerCase() ? ' (ฐานหลัก)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={saveSystemDb}
            disabled={busySystem || choice === info.system}
            className="flex items-center gap-1.5 rounded-lg bg-[#0C447C] px-3.5 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <Save size={14} /> บันทึกฐานข้อมูลของระบบ
          </button>
          <span className="text-[11px] text-gray-500 self-center">
            ปัจจุบัน: <strong className="text-gray-900 font-bold">{info.system}</strong>
          </span>
        </div>
        {systemMsg && (
          <p
            className={`mt-2 text-[11px] font-semibold flex items-center gap-1.5 ${
              systemMsg.ok ? 'text-green-700' : 'text-red-700'
            }`}
          >
            {systemMsg.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />} {systemMsg.text}
          </p>
        )}
      </div>

      {/* Database Theme & Appearance Configuration */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-2xs">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
              <Palette size={16} className="text-[#0C447C]" /> กำหนดสีและป้ายกำกับฐานข้อมูล (Database Appearance & Themes)
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              กำหนดโทนสีและป้ายกำกับแสดงผลในแถบ Topbar เพื่อให้ผู้ใช้งานแยกแยะสภาพแวดล้อมได้ชัดเจนและปลอดภัย
            </p>
          </div>
          <button
            type="button"
            onClick={saveThemes}
            disabled={busyTheme}
            className="flex items-center gap-1.5 rounded-lg bg-[#0C447C] px-3.5 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <Save size={14} /> บันทึกการตั้งค่าสี
          </button>
        </div>

        {themeMsg && (
          <div
            className={`mb-3 p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 ${
              themeMsg.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {themeMsg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {themeMsg.text}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/70 text-gray-600 font-semibold">
                <th className="py-2.5 px-3">ชื่อฐานข้อมูล (Database)</th>
                <th className="py-2.5 px-3">สิทธิ์การเข้าถึง (Permission Policy)</th>
                <th className="py-2.5 px-3">โทนสี (Color Tone)</th>
                <th className="py-2.5 px-3">ป้ายกำกับ (Badge Tag)</th>
                <th className="py-2.5 px-3 text-right">ตัวอย่างการแสดงผลใน Topbar (Live Preview)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {databaseList.map(name => {
                const current = themeForm[name] || { color: 'blue', label: name, badge: '' };
                const isRd = name.toLowerCase().replace(/[-_]/g, '').endsWith('2');
                const isProd = name.toLowerCase().replace(/[-_]/g, '').endsWith('9') && !name.toLowerCase().includes('uat');
                const isUat = name.toLowerCase().includes('uat');
                const previewStyle = PREVIEW_STYLES[current.color] || PREVIEW_STYLES.slate;

                return (
                  <tr key={name} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-3 font-semibold text-gray-900 tabular-nums">
                      <div className="flex items-center gap-1.5">
                        <Database size={13} className="text-gray-400 shrink-0" />
                        <span>{name}</span>
                        {name.toLowerCase() === info.primary.toLowerCase() && (
                          <span className="text-[10px] text-blue-700 font-bold bg-blue-50 border border-blue-200 px-1.5 py-0.2 rounded">
                            ฐานหลัก
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      {isRd ? (
                        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                          <Lock size={12} className="text-amber-600" />
                          <span>สงวนสิทธิ์เฉพาะทีม Accounting, C_Level, ADMIN</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-gray-600">
                          ผู้มีสิทธิ์ <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-[10px]">database.switch</code> ทุกคน
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-3">
                      <select
                        value={current.color}
                        onChange={e =>
                          setThemeForm(prev => ({
                            ...prev,
                            [name]: { ...prev[name], color: e.target.value as DatabaseThemeColor },
                          }))
                        }
                        className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
                      >
                        {COLOR_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="py-3 px-3">
                      <input
                        type="text"
                        value={current.badge || ''}
                        placeholder={isProd ? 'PROD_DB' : isRd ? 'PROD_DB_RD' : isUat ? 'UAT_DB' : name}
                        onChange={e =>
                          setThemeForm(prev => ({
                            ...prev,
                            [name]: {
                              ...prev[name],
                              badge: e.target.value.toUpperCase(),
                              label: e.target.value.toUpperCase(),
                            },
                          }))
                        }
                        className="w-28 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-bold uppercase text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
                      />
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs shadow-2xs font-semibold tabular-nums select-none whitespace-nowrap cursor-default transition-all"
                        style={{ borderStyle: 'solid' }}>
                        <span className={`inline-flex items-center gap-1.5 ${previewStyle.pill} px-2.5 py-1 rounded-lg border`}>
                          <Database size={13} className={previewStyle.text} />
                          <span>{name}</span>
                          {current.badge && (
                            <span className={`rounded px-1.5 py-0.2 text-[9px] font-extrabold uppercase border ${previewStyle.badge}`}>
                              {current.badge}
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permissions Guide & Policy Card */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-xs text-amber-900">
        <div className="flex items-center gap-2 font-bold mb-1.5 text-amber-900">
          <ShieldAlert size={16} className="text-amber-700" /> นโยบายการควบคุมสิทธิ์ Database Selector (Access Control Policy)
        </div>
        <ul className="list-disc list-inside space-y-1 text-[11px] text-amber-800 leading-relaxed">
          <li>
            <strong>สิทธิ์การสลับฐานข้อมูล:</strong> ตัวเลือก Database Selector ด้านบนจะเปิดให้คลิกสลับฐานได้เฉพาะผู้ใช้งานที่ได้รับสิทธิ์{' '}
            <code className="bg-amber-100/80 px-1 py-0.2 rounded font-mono font-bold">database.switch</code> เท่านั้น
            (สามารถมอบหมายหรือเพิกถอนสิทธิ์รายบทบาทได้ที่เมนู <em>ผู้ใช้งานและสิทธิ์ &gt; บทบาท</em>)
          </li>
          <li>
            <strong>ผู้ใช้ทั่วไป (ไม่มีสิทธิ์):</strong> จะเห็นแถบชื่อฐานข้อมูลเป็นโหมดอ่านอย่างเดียว (Read-only พร้อมไอคอนล็อก)
            เพื่อทราบสถานะสภาพแวดล้อมที่ตนกำลังปฏิบัติงานอยู่โดยไม่สามารถสลับได้
          </li>
          <li>
            <strong>การล็อกความปลอดภัยระดับ API:</strong> ฐานข้อมูล{' '}
            <code className="bg-amber-100/80 px-1 py-0.2 rounded font-mono font-bold">dbwins_worldfert2</code> (PROD_DB_RD)
            ถูกจำกัดการเข้าถึงอย่างเข้มงวด อนุญาตเฉพาะทีมบัญชี (Accounting), ผู้บริหาร (C_Level) และผู้ดูแลระบบ (ADMIN)
            แม้บทบาทอื่นจะมีสิทธิ์สลับฐานทั่วไปก็จะไม่สามารถเลือกหรือสลับเข้าใช้งานฐานข้อมูลนี้ได้
          </li>
        </ul>
      </div>
    </div>
  );
}
