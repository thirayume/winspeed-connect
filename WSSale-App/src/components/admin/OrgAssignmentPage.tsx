/**
 * จับคู่ผู้ใช้กับตำแหน่งในผังองค์กร (`wf.AppUser.PositionCode` → `wf.OrgPosition`)
 *
 * ทำไมต้องมีหน้านี้ ไม่ใช่แค่ dropdown ในหน้า User Management
 *   งานนี้คือจับคู่ 62 คนกับ 43 ตำแหน่ง ซึ่งไม่ใช่การแก้ทีละคน แต่เป็นการไล่ให้ครบทั้งองค์กร
 *   คนที่ทำต้องเห็นสามอย่างพร้อมกัน — ใครยังไม่ได้ผูก · ตำแหน่งไหนยังว่าง · ผูกแล้วสายอนุมัติจะเป็นใคร
 *   หน้า User Management เต็มไปด้วยงาน CRUD อยู่แล้ว ยัดเข้าไปจะทำให้ทั้งสองงานอ่านยากขึ้น
 *
 * ⚠ หน้านี้เขียนเฉพาะ `wf.AppUser.PositionCode` เท่านั้น
 *   ไม่แตะ `Role` เพราะสิทธิ์จริงที่ backend ใช้ตรวจคือ `Role` ไม่ใช่ตำแหน่ง
 *   ตำแหน่งมี `DefaultRole` ไว้บอกว่า "ควรเป็นบทบาทอะไร" — หน้านี้จึงเตือนเมื่อไม่ตรง
 *   แต่ไม่แก้ให้เอง เพราะการเปลี่ยนบทบาทคือการเปลี่ยนสิทธิ์ ต้องเป็นการตัดสินใจของคน
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Network, Search, RefreshCw, AlertTriangle, Check, Users, ShieldCheck, Download,
} from 'lucide-react';
import { listUsers, listOrgPositions, updateUser, type OrgPosition } from '../../services/api';
import type { AdminUser } from '../../types';

const NAVY = '#0C447C';
const UNASSIGNED = '__none__';

const num = (v: unknown) => Number(v ?? 0).toLocaleString('th-TH');

/** สีประจำสายงาน ให้กวาดตาแล้วเห็นกลุ่มได้เร็ว */
const UNIT_STYLE: Record<string, string> = {
  'บริหาร': 'bg-purple-50 text-purple-800 border-purple-200',
  'บัญชี-การเงิน': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  'โรงงาน': 'bg-amber-50 text-amber-800 border-amber-200',
  'ขาย-การตลาด': 'bg-sky-50 text-sky-800 border-sky-200',
};
const unitClass = (u?: string | null) =>
  (u && UNIT_STYLE[u]) || 'bg-gray-100 text-gray-700 border-gray-200';

export function OrgAssignmentPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [positions, setPositions] = useState<OrgPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [u, p] = await Promise.all([listUsers(), listOrgPositions()]);
      setUsers(u); setPositions(p);
    } catch (e: any) {
      setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const units = useMemo(
    () => Array.from(new Set(positions.map(p => p.OrgUnit))),
    [positions]);

  /** ตำแหน่งจัดกลุ่มตามสายงาน แล้วเรียงตามระดับ — ให้ dropdown อ่านเหมือนผังจริง */
  const grouped = useMemo(() => {
    const m = new Map<string, OrgPosition[]>();
    for (const p of positions) {
      if (!p.IsActive) continue;
      if (!m.has(p.OrgUnit)) m.set(p.OrgUnit, []);
      m.get(p.OrgUnit)!.push(p);
    }
    for (const list of m.values()) list.sort((a, b) => a.Tier - b.Tier || a.PositionName.localeCompare(b.PositionName, 'th'));
    return m;
  }, [positions]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users
      .filter(u => (onlyActive ? u.IsActive : true))
      .filter(u => (onlyUnassigned ? !u.PositionCode : true))
      .filter(u => (unitFilter ? u.OrgUnit === unitFilter : true))
      .filter(u => !needle || [u.DisplayName, u.Username, u.EmpCode, u.PositionName]
        .some(v => String(v ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => Number(!!a.PositionCode) - Number(!!b.PositionCode)
        || String(a.DisplayName).localeCompare(String(b.DisplayName), 'th'));
  }, [users, q, unitFilter, onlyUnassigned, onlyActive]);

  const active = users.filter(u => u.IsActive);
  const assigned = active.filter(u => u.PositionCode).length;
  const emptyPositions = positions.filter(p => p.IsActive && p.AssignedCount === 0).length;
  /** บทบาทจริงไม่ตรงกับที่ตำแหน่งกำหนด — ไม่ใช่ error แต่ต้องให้คนตัดสิน */
  const mismatched = active.filter(
    u => u.PositionCode && u.PositionDefaultRole && u.PositionDefaultRole !== u.Role);

  async function assign(user: AdminUser, code: string) {
    const next = code === UNASSIGNED ? null : code;
    if ((user.PositionCode ?? null) === next) return;
    setSavingId(user.Id); setErr(null);
    try {
      await updateUser(user.Id, { positionCode: next });
      // อ่านกลับจากเซิร์ฟเวอร์ เพราะชื่อผู้อนุมัติมาจาก view ที่คำนวณฝั่งฐาน
      // ถ้าเดาเองในหน้าจอ จะเพี้ยนทันทีที่ผังเปลี่ยน
      const fresh = await listUsers();
      setUsers(fresh);
      setPositions(await listOrgPositions());
      setSavedId(user.Id);
      setTimeout(() => setSavedId(v => (v === user.Id ? null : v)), 1800);
    } catch (e: any) {
      setErr(`บันทึกตำแหน่งของ ${user.DisplayName} ไม่สำเร็จ: ${e?.message || ''}`);
    }
    setSavingId(null);
  }

  function exportCsv() {
    const head = ['ผู้ใช้', 'ชื่อที่แสดง', 'บทบาท', 'รหัสพนักงาน', 'รหัสตำแหน่ง', 'ตำแหน่ง', 'สายงาน', 'ผู้อนุมัติ'];
    const rows = shown.map(u => [
      u.Username, u.DisplayName, u.Role, u.EmpCode ?? '',
      u.PositionCode ?? '', u.PositionName ?? '', u.OrgUnit ?? '', u.ApproverName ?? '',
    ]);
    const csv = [head, ...rows]
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    // BOM นำหน้าเพื่อให้ Excel อ่านภาษาไทยถูก
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `ผังตำแหน่ง-ผู้ใช้-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto flex items-center gap-2 text-lg font-bold" style={{ color: NAVY }}>
            <Network size={20} /> ผูกผู้ใช้กับตำแหน่ง
            <span className="text-xs font-normal text-gray-500">ผังองค์กร 2568 · wf.OrgPosition</span>
          </h1>

          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ชื่อ / username / รหัสพนักงาน"
              className="h-10 w-64 rounded-xl border border-gray-200 pl-8 pr-3 text-sm" />
          </div>

          <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)}
            className="h-10 rounded-xl border border-gray-200 px-3 text-sm">
            <option value="">ทุกสายงาน</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>

          <button onClick={() => setOnlyUnassigned(v => !v)}
            className={`h-10 rounded-xl border px-3 text-sm font-semibold ${onlyUnassigned
              ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 bg-white text-gray-600'}`}>
            เฉพาะที่ยังไม่ผูก
          </button>
          <button onClick={() => setOnlyActive(v => !v)}
            className={`h-10 rounded-xl border px-3 text-sm font-semibold ${onlyActive
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600'}`}>
            เฉพาะที่ใช้งานอยู่
          </button>

          <button onClick={exportCsv} disabled={!shown.length}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold disabled:opacity-40"
            style={{ color: NAVY }}>
            <Download size={15} /> CSV
          </button>
          <button onClick={load} className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white"
            aria-label="โหลดใหม่">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* ความคืบหน้า — งานนี้วัดผลด้วย "ครบทุกคนหรือยัง" ไม่ใช่ "แก้ไปกี่คน" */}
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="text-2xl font-bold tabular-nums" style={{ color: NAVY }}>
              {num(assigned)}<span className="text-base font-normal text-gray-400"> / {num(active.length)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs font-medium text-gray-600"><Users size={12} /> ผูกตำแหน่งแล้ว</div>
          </div>
          <div className={`rounded-xl border px-4 py-3 ${active.length - assigned > 0
            ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-800'}`}>
            <div className="text-2xl font-bold tabular-nums">{num(active.length - assigned)}</div>
            <div className="text-xs font-medium">ยังไม่ผูก</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="text-2xl font-bold tabular-nums text-gray-800">{num(emptyPositions)}</div>
            <div className="text-xs font-medium text-gray-600">ตำแหน่งที่ยังไม่มีคน</div>
          </div>
          <div className={`rounded-xl border px-4 py-3 ${mismatched.length
            ? 'border-red-200 bg-red-50 text-red-900' : 'border-gray-200 bg-white text-gray-800'}`}>
            <div className="text-2xl font-bold tabular-nums">{num(mismatched.length)}</div>
            <div className="text-xs font-medium">บทบาทไม่ตรงกับตำแหน่ง</div>
          </div>
        </div>

        {mismatched.length > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <b>มี {num(mismatched.length)} คนที่บทบาทไม่ตรงกับตำแหน่ง</b> — สิทธิ์จริงที่ระบบใช้ตรวจคือ <b>บทบาท</b> ไม่ใช่ตำแหน่ง
              <div className="mt-0.5 text-red-800">
                หน้านี้ไม่แก้บทบาทให้เอง เพราะการเปลี่ยนบทบาทคือการเปลี่ยนสิทธิ์เข้าถึง
                ถ้าต้องการแก้ ให้ไปที่ <b>User Management</b> แล้วเปลี่ยนบทบาทเอง
              </div>
            </div>
          </div>
        )}

        {err && <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">ผู้ใช้</th>
                  <th className="px-3 py-2.5 text-left font-semibold">บทบาท</th>
                  <th className="px-3 py-2.5 text-left font-semibold">รหัสพนักงาน</th>
                  <th className="px-3 py-2.5 text-left font-semibold" style={{ minWidth: 300 }}>ตำแหน่งในผังองค์กร</th>
                  <th className="px-3 py-2.5 text-left font-semibold">สายงาน</th>
                  <th className="px-3 py-2.5 text-left font-semibold">ผู้อนุมัติ</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(u => {
                  const mismatch = u.PositionCode && u.PositionDefaultRole && u.PositionDefaultRole !== u.Role;
                  return (
                    <tr key={u.Id} className={`border-t border-gray-100 ${u.IsActive ? '' : 'opacity-50'} hover:bg-gray-50`}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">{u.DisplayName}</div>
                        <div className="text-xs text-gray-400">{u.Username}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${
                          mismatch ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
                          {u.Role}
                        </span>
                        {mismatch && (
                          <div className="mt-0.5 text-xs text-red-600">ตำแหน่งกำหนด {u.PositionDefaultRole}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{u.EmpCode || <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <select
                            value={u.PositionCode || UNASSIGNED}
                            disabled={savingId === u.Id}
                            onChange={e => assign(u, e.target.value)}
                            className={`h-9 w-full rounded-lg border px-2 text-sm disabled:opacity-50 ${
                              u.PositionCode ? 'border-gray-200' : 'border-amber-300 bg-amber-50'}`}>
                            <option value={UNASSIGNED}>— ยังไม่ผูกตำแหน่ง —</option>
                            {Array.from(grouped.entries()).map(([unit, list]) => (
                              <optgroup key={unit} label={unit}>
                                {list.map(p => (
                                  <option key={p.PositionCode} value={p.PositionCode}>
                                    {' '.repeat((p.Tier - 1) * 2)}{p.PositionName}
                                    {p.AssignedCount > 0 ? ` (${p.AssignedCount})` : ''}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          {savingId === u.Id && <RefreshCw size={15} className="shrink-0 animate-spin text-gray-400" />}
                          {savedId === u.Id && <Check size={16} className="shrink-0 text-emerald-600" />}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {u.OrgUnit
                          ? <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${unitClass(u.OrgUnit)}`}>{u.OrgUnit}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {u.ApproverName
                          ? <span className="inline-flex items-center gap-1"><ShieldCheck size={13} className="text-gray-400" />{u.ApproverName}</span>
                          : u.PositionCode
                            ? <span className="text-xs text-gray-400">สูงสุดของสาย</span>
                            : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && !loading && (
                  <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-400">ไม่พบผู้ใช้ตามเงื่อนไขที่เลือก</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-2 text-xs text-gray-500">
          แสดง {num(shown.length)} คน จากทั้งหมด {num(users.length)} · เลือกตำแหน่งแล้วบันทึกทันที ไม่ต้องกดยืนยัน
          · ผู้อนุมัติคำนวณจากสายบังคับบัญชา (<code>wf.v_NearestApprover</code>) ไม่ได้ตั้งเอง
        </p>
      </div>
    </div>
  );
}
