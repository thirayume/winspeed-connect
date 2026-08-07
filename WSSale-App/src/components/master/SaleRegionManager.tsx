import { useCallback, useEffect, useState } from 'react';
// ตั้งชื่อไอคอนเป็น MapIcon เพราะ Map ของ lucide จะบัง Map ของ JavaScript
// ทำให้ new Map() ในไฟล์นี้เรียกคอมโพเนนต์ React เป็น constructor แล้วพัง
import { Map as MapIcon, RefreshCw, Plus, Trash2, AlertTriangle, Users } from 'lucide-react';
import {
  fetchRegionCoverage, setUserRegion, removeUserRegion, listUsers,
  fetchRebateDocCodes, setRebateDocCode,
  type RegionCoverage, type RebateDocCodeRow, type RebateDocCodeEvidence,
} from '../../services/api';
// AdminUser ประกาศไว้ที่ types ไม่ใช่ที่ api.ts — api.ts เพียง import มาใช้ต่อ
import type { AdminUser } from '../../types';

/**
 * จัดการผู้อนุมัติรายภาค — ผู้อนุมัติชั้นที่ 2 ของใบขอเคลียร์รีเบท
 *
 * มีหน้าจอนี้เพราะที่ผ่านมาการผูกภาคทำได้จากฐานข้อมูลเท่านั้น และเคยผูกผิดจริง
 * (ผู้ดูแลภาคหนึ่งถูกผูกกับภาคใต้ ทั้งที่ยอดขายอยู่ภาคอีสาน) โดยไม่มีทางแก้จากระบบเลย
 *
 * ภาคที่ยังว่างไม่ได้ทำให้ใบค้าง แต่ทำให้ชั้นที่ 2 ตกไปเป็น "ผู้จัดการคนใดก็ได้"
 * ตามเงื่อนไขใน backend/routes/rebate.js จึงต้องเห็นชัดว่าภาคไหนยังว่าง
 */
export function SaleRegionManager() {
  const [rows, setRows] = useState<RegionCoverage[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [pickUser, setPickUser] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [coverage, all] = await Promise.all([fetchRegionCoverage(), listUsers().catch(() => [])]);
      setRows(coverage);
      setUsers((all as AdminUser[]).filter(u => u.IsActive));
    } catch (e: unknown) { alert((e as Error).message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function assign(regionCode: string) {
    if (!pickUser) return;
    setBusy(true);
    try {
      await setUserRegion({ userId: Number(pickUser), regionCode, isPrimary: true });
      setAddFor(null); setPickUser('');
      await load();
    } catch (e: unknown) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(userId: number, regionCode: string, name: string) {
    if (!confirm(`ถอด ${name} ออกจากภาคนี้?\n\nใบขอเคลียร์ของภาคนี้จะกลับไปให้ผู้จัดการคนใดก็ได้อนุมัติชั้นที่ 2`)) return;
    setBusy(true);
    try { await removeUserRegion(userId, regionCode); await load(); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  // แต่ละภาคมีได้หลายคน ข้อมูลที่ได้มาเป็นรายแถว จึงรวมเป็นรายภาคก่อนแสดง
  const byRegion = new Map<string, { name: string; customers: number; people: RegionCoverage[] }>();
  for (const r of rows) {
    const g = byRegion.get(r.RegionCode)
      || { name: r.RegionName, customers: r.Customers, people: [] };
    if (r.UserId) g.people.push(r);
    byRegion.set(r.RegionCode, g);
  }
  const regions = [...byRegion.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const empty = regions.filter(([, g]) => g.people.length === 0);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 bg-gray-50/50">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 text-[#0C447C]"><MapIcon size={18} /> ผู้อนุมัติรายภาค</h2>
          <p className="text-xs text-gray-500 mt-0.5">ผู้อนุมัติชั้นที่ 2 ของใบขอเคลียร์รีเบท · แบ่งตามภาคของลูกค้า</p>
        </div>
        <button onClick={load} className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      {empty.length > 0 && (
        <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900 flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
          <div>
            <span className="font-bold">ยังไม่มีผู้อนุมัติ {empty.length} ภาค</span> — {empty.map(([c, g]) => `${c} ${g.name}`).join(' · ')}
            <div className="mt-1 text-amber-800">
              ใบของภาคเหล่านี้จะให้ผู้จัดการคนใดก็ได้อนุมัติชั้นที่ 2 หลักฐานจึงไม่ได้ระบุผู้รับผิดชอบพื้นที่จริง
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {regions.map(([code, g]) => (
          <div key={code} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-bold text-gray-800">
                  <span className="text-gray-400 font-mono text-sm mr-2">{code}</span>{g.name}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                  <Users size={12} /> ลูกค้า {g.customers.toLocaleString()} ราย
                </div>
              </div>
              {addFor === code ? (
                <div className="flex items-center gap-2">
                  <select value={pickUser} onChange={e => setPickUser(e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white max-w-56">
                    <option value="">-- เลือกผู้ใช้ --</option>
                    {users.map(u => (
                      <option key={u.Id} value={u.Id}>{u.DisplayName || u.Username} ({u.Role})</option>
                    ))}
                  </select>
                  <button onClick={() => assign(code)} disabled={busy || !pickUser}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0C447C] text-white disabled:opacity-40">บันทึก</button>
                  <button onClick={() => { setAddFor(null); setPickUser(''); }}
                    className="px-2 py-1.5 text-xs text-gray-500">ยกเลิก</button>
                </div>
              ) : (
                <button onClick={() => { setAddFor(code); setPickUser(''); }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">
                  <Plus size={14} /> เพิ่มผู้อนุมัติ
                </button>
              )}
            </div>

            <div className="mt-3 space-y-1.5">
              {g.people.length === 0 ? (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ยังไม่มีผู้อนุมัติภาคนี้
                </div>
              ) : g.people.map(p => (
                <div key={p.UserId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="text-sm">
                    <span className="font-semibold text-gray-800">{p.DisplayName || p.Username}</span>
                    <span className="text-[11px] text-gray-400 ml-2">{p.Username} · {p.Role}</span>
                    {p.IsPrimary && <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">หลัก</span>}
                    {!p.IsActive && <span className="ml-2 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">ปิดใช้งาน</span>}
                  </div>
                  <button onClick={() => remove(p.UserId!, code, p.DisplayName || p.Username || '')}
                    disabled={busy} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!loading && regions.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-12">ยังไม่มีข้อมูลภาค</div>
        )}

        <RebateDocCodeSection />
      </div>
    </div>
  );
}

/**
 * รหัสผู้ขอใช้รีเบทบนเลขที่เอกสาร RB
 *
 * เอกสารคืนรีเบทใน WINSpeed คือ RB<รหัสผู้ขอ><ปี พ.ศ.>-<ลำดับ> เช่น RBD68-049
 * ตรวจจากฐานจริง 16,195 ใบ พบว่า **EmpID ว่างทุกใบ** — WINSpeed ไม่ได้บันทึกว่าใครขอ
 * อักษรในเลขที่เอกสารจึงเป็นร่องรอยเดียวที่บอกได้ ต้องผูกกับบัญชีผู้ใช้ให้ชัด
 *
 * ตารางหลักฐานด้านล่างคือความสัมพันธ์ในอดีต (นับจากพนักงานขายประจำของลูกค้า)
 * ระบบไม่ตั้งรหัสให้อัตโนมัติ เพราะบางอักษรในอดีตคาบเกี่ยวหลายคน การเดาแล้วผิด
 * จะทำให้เลขที่เอกสารชี้ไปผิดคนอย่างถาวร
 */
function RebateDocCodeSection() {
  const [assigned, setAssigned] = useState<RebateDocCodeRow[]>([]);
  const [evidence, setEvidence] = useState<RebateDocCodeEvidence[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await fetchRebateDocCodes();
      setAssigned(d.assigned);
      setEvidence(d.evidence);
      setDraft(Object.fromEntries(d.assigned.map(u => [u.UserId, u.RebateDocCode || ''])));
    } catch (e: unknown) { setMsg((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(userId: number) {
    setBusy(true); setMsg('');
    try {
      await setRebateDocCode(userId, (draft[userId] || '').trim().toUpperCase() || null);
      await load();
      setMsg('บันทึกแล้ว');
    } catch (e: unknown) { setMsg((e as Error).message); }
    setBusy(false);
  }

  const hintFor = (code: string | null) => {
    if (!code) return '';
    const top = evidence.filter(e => e.SeriesCode === code[0]).sort((a, b) => b.DocCount - a.DocCount)[0];
    return top ? `เดิม ${top.EmpName} ออก ${top.DocCount.toLocaleString()} ใบ` : '';
  };

  return (
    <section className="mt-8 border-t border-gray-200 pt-6">
      <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
        <Users size={15} /> รหัสผู้ขอใช้รีเบท (บนเลขที่เอกสาร RB)
      </h2>
      <p className="text-xs text-gray-500 mt-1">
        เลขที่ใบคืนรีเบทใน WINSpeed คือ <code>RB&lt;รหัส&gt;&lt;ปี พ.ศ.&gt;-&lt;ลำดับ&gt;</code> เช่น <code>RBD68-049</code> ·
        WINSpeed ไม่ได้บันทึกว่าใครเป็นผู้ขอ อักษรนี้จึงเป็นร่องรอยเดียว · ตัวอักษร A-Z 1-2 ตัว ห้ามซ้ำกัน ·
        คนที่มีเอกสารเดิมอยู่แล้วให้คงอักษรเดิมไว้ · คนใหม่ใช้ตัวแรกของชื่อ + ตัวแรกของนามสกุล
      </p>
      {msg && <p className="text-xs mt-2 text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{msg}</p>}

      <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
              <tr className="text-left">
                <th className="px-3 py-2">ผู้ใช้</th>
                <th className="px-3 py-2">บทบาท</th>
                <th className="px-3 py-2 w-32">รหัส</th>
                <th className="px-3 py-2">หลักฐานจากเอกสารเดิม</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {assigned.map(u => (
                <tr key={u.UserId} className="hover:bg-gray-50/70">
                  <td className="px-3 py-2">
                    <span className="font-medium text-gray-700">{u.DisplayName || u.Username}</span>
                    <span className="text-[11px] text-gray-400 ml-2">{u.Username}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{u.Role}</td>
                  <td className="px-3 py-2">
                    <input value={draft[u.UserId] ?? ''} maxLength={2}
                      onChange={e => setDraft({ ...draft, [u.UserId]: e.target.value.toUpperCase() })}
                      placeholder="—"
                      className="w-16 border border-gray-200 rounded px-2 py-1 text-sm uppercase tracking-widest text-center" />
                  </td>
                  <td className="px-3 py-2 text-[11px] text-gray-400">
                    {u.RebateDocCode
                      ? hintFor(draft[u.UserId] || u.RebateDocCode)
                      : u.suggested && (
                        <button onClick={() => setDraft({ ...draft, [u.UserId]: u.suggested! })}
                          className="text-blue-600 hover:underline">
                          เสนอ {u.suggested} (จากชื่อ)
                        </button>
                      )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(draft[u.UserId] ?? '') !== (u.RebateDocCode ?? '') && (
                      <button onClick={() => save(u.UserId)} disabled={busy}
                        className="px-2.5 py-1 text-xs rounded-lg text-white font-bold disabled:opacity-40"
                        style={{ background: '#0C447C' }}>
                        บันทึก
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!assigned.length && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-300">ไม่มีผู้ใช้ที่ต้องตั้งรหัส</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
