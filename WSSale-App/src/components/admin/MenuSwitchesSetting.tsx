import { useEffect, useState } from 'react';
import { req } from '../../services/api';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { AdminReportCatalogModal } from './AdminReportCatalogModal';

/** Owner, 20 Nov 2026: ADMIN switches any menu (and, through the report catalog, any report) on or off. */
const MENU_LABELS: Record<string, string> = {
  sales: 'ขาย', voucher: 'ชุดตั๋วคุม — รายชื่อตามสังกัด', 'edit-requests': 'คำขอแก้ไขและอนุมัติ', quotation: 'เสนอราคา',
  store: 'คลัง', stock: 'สต๊อกปฏิบัติการ', papertrail: 'Paper Trail', 'control-ticket': 'ชุดตั๋วคุม — รายการและเตือนอายุ',
  'scale-reports': 'สถานะการชั่งรถ', aging: 'บิลค้างส่ง', rebate: 'รีเบท (App)', 'rebate-plan': 'Rebate Plan',
  giveaway: 'ของแถม', accounting: 'บัญชี', recon: 'กระทบยอด', incidents: 'เหตุการณ์ผิดกฎ', reports: 'รายงาน',
  master: 'ข้อมูลหลัก', policy: 'นโยบายอนุมัติ', ops: 'สถานะระบบ', org: 'ผังองค์กร', beneficiaries: 'จัดการสิทธิ์ตั๋วร่วม',
};

type Switches = { disabled: string[]; switchable?: string[]; alwaysOn?: string[] };

export function MenuSwitchesSetting() {
  const [data, setData] = useState<Switches | null>(null);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reportsOpen, setReportsOpen] = useState(false);
  const dirty = Boolean(data) && [...disabled].sort().join() !== [...(data?.disabled || [])].sort().join();
  useUnsavedChanges(dirty || busy);

  useEffect(() => {
    let live = true;
    req<Switches>('/menu-switches', { silent: true })
      .then(r => { if (live) { setData(r); setDisabled(r.disabled); } })
      .catch(() => { if (live) setError('อ่านการเปิด/ปิดเมนูไม่สำเร็จ'); });
    return () => { live = false; };
  }, []);

  async function save() {
    if (!dirty || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const r = await req<Switches & { message: string }>('/menu-switches', { method: 'PUT', body: JSON.stringify({ disabled }), silent: true });
      setData(d => ({ ...(d || {}), disabled: r.disabled })); setDisabled(r.disabled); setMessage(r.message || 'บันทึกแล้ว');
    } catch (e) { setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ'); } finally { setBusy(false); }
  }

  const menus = data?.switchable || [];
  return (
    <section className="rounded-2xl border border-blue-200 bg-white p-5 space-y-4">
      <div>
        <h2 className="font-bold text-[#0C447C]">เปิด/ปิดเมนูและรายงาน</h2>
        <p className="text-sm text-gray-600 mt-1">เมนูที่ปิดจะหายไปจากผู้ใช้ทุกคน ยกเว้น ADMIN ที่ยังเห็นเพื่อเปิดกลับ ข้อมูลและสิทธิ์เดิมไม่เปลี่ยน
          เมนู Dashboard, App Settings และผู้ใช้งานและสิทธิ์ ปิดไม่ได้</p>
      </div>
      {!data && !error && <p className="text-sm text-gray-500">กำลังโหลด...</p>}
      {menus.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" aria-label="รายการเมนู">
          {menus.map(key => {
            const on = !disabled.includes(key);
            return (
              <li key={key}>
                <label className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer ${on ? 'border-gray-200' : 'border-amber-300 bg-amber-50'}`}>
                  <span>{MENU_LABELS[key] || key}<span className="block text-xs text-gray-500">{on ? 'เปิดอยู่' : 'ปิดอยู่'}</span></span>
                  <input type="checkbox" aria-label={`เปิดเมนู ${MENU_LABELS[key] || key}`} checked={on} disabled={busy}
                    onChange={e => { setMessage(''); setDisabled(d => e.target.checked ? d.filter(k => k !== key) : [...d, key]); }}
                    className="h-4 w-4 accent-[#0C447C]" />
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-green-700">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={!dirty || busy}
          className="rounded-lg bg-[#0C447C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-blue-800">บันทึกการเปิด/ปิดเมนู</button>
        <button type="button" onClick={() => setReportsOpen(true)}
          className="rounded-lg border border-[#0C447C] px-4 py-2 text-sm font-semibold text-[#0C447C] hover:bg-blue-50">เปิด/ปิดรายงานแต่ละรายการ</button>
      </div>
      <AdminReportCatalogModal isOpen={reportsOpen} onClose={() => setReportsOpen(false)} onCatalogUpdated={() => {}} />
    </section>
  );
}
