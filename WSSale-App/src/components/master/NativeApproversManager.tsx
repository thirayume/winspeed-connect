/**
 * Master Data — รายชื่อผู้อนุมัติเอกสาร WinSpeed (`wf.NativeApproverEmployee`)
 *
 * ทำไมต้องมีหน้านี้ (owner decision 30/10/2569)
 *   ใบ 116 ที่แอปสร้างไม่เขียนช่องผู้อนุมัติ (AppvEmpID) ใน WinSpeed แล้ว พนักงานผู้อนุมัติ
 *   เก็บไว้ในตาราง wf แทน และต้องเป็นพนักงานที่ "ใช้อนุมัติได้" ในรายการนี้
 *   ระบบใส่พนักงานทุกคนไว้ก่อน เจ้าของกระบวนการคัดออกเองที่หน้านี้
 *
 * สิ่งที่หน้านี้จงใจไม่ให้ทำ
 *   - ลบพนักงานออกจากตาราง — ประวัติการอนุมัติอ้างถึงอยู่ ให้ปิดใช้แทน
 *   - แก้ข้อมูลพนักงาน — ข้อมูลพนักงานมาจาก WinSpeed (dbo.EMEmp) แก้ที่ WinSpeed
 * ทุกการเปิด/ปิดเก็บผู้ทำจริง (รวม Access As) ไว้ในประวัติ
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserCheck, RefreshCw, AlertTriangle, Search } from 'lucide-react';
import { fetchNativeApprovers, updateNativeApprover, type NativeApprover } from '../../services/api';

const NAVY = '#0C447C';
type Filter = 'all' | 'enabled' | 'disabled';

export function NativeApproversManager() {
  const [rows, setRows] = useState<NativeApprover[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setRows((await fetchNativeApprovers()).data || []); }
    catch (e: any) { setErr(e?.message || 'โหลดรายชื่อไม่สำเร็จ'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (r: NativeApprover) => {
    setBusyId(r.empId); setErr(null);
    try {
      await updateNativeApprover(r.empId, { enabled: !r.enabled });
      setRows(list => list.map(x => x.empId === r.empId ? { ...x, listed: true, enabled: !r.enabled } : x));
    } catch (e: any) { setErr(e?.message || 'บันทึกไม่สำเร็จ'); }
    setBusyId(null);
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (filter === 'all' || (filter === 'enabled' ? r.enabled : !r.enabled)) &&
      (!q || r.empCode.toLowerCase().includes(q) || (r.empName || '').toLowerCase().includes(q)));
  }, [rows, search, filter]);

  const enabledCount = rows.filter(r => r.enabled).length;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold" style={{ color: NAVY }}>
          <UserCheck size={18} /> ผู้อนุมัติเอกสาร WinSpeed (ใบ 116)
        </h3>
        <span className="text-xs text-gray-500">
          พนักงานทั้งหมด {rows.length} · ใช้อนุมัติได้ {enabledCount} · ปิดไว้ {rows.length - enabledCount}
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={load} disabled={loading}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </button>
        </div>
      </div>

      <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
        ผู้อนุมัติคำขอใบ 116 ต้องผูกกับพนักงานที่<b>ใช้อนุมัติได้</b>ในรายการนี้ ระบบใส่พนักงานทุกคนไว้ก่อน ให้ปิดคนที่ไม่ใช่ผู้อนุมัติ ·
        ข้อมูลพนักงานมาจาก WinSpeed แก้ที่ WinSpeed · ปิดแล้วเปิดกลับได้ และระบบเก็บประวัติทุกครั้ง
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหารหัสหรือชื่อพนักงาน..."
            className="w-64 rounded border border-gray-300 py-1 pl-7 pr-2 text-xs" />
        </div>
        {(['all', 'enabled', 'disabled'] as Filter[]).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded border px-2 py-1 text-xs ${filter === f ? 'border-[#0C447C] bg-[#0C447C] text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {f === 'all' ? 'ทั้งหมด' : f === 'enabled' ? 'ใช้อนุมัติได้' : 'ปิดไว้'}
          </button>
        ))}
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={15} /> {err}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 text-left font-medium">รหัสพนักงาน</th>
              <th className="px-3 py-2 text-left font-medium">ชื่อ</th>
              <th className="px-3 py-2 text-center font-medium" title="EmpType ใน WinSpeed">ประเภท</th>
              <th className="px-3 py-2 text-center font-medium" title="EmpStatus ใน WinSpeed">สถานะ WinSpeed</th>
              <th className="px-3 py-2 text-center font-medium">ผู้ใช้แอปที่ผูก</th>
              <th className="px-3 py-2 text-center font-medium">เคยอนุมัติ</th>
              <th className="px-3 py-2 text-center font-medium">ใช้อนุมัติได้</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.empId} className={`border-b border-gray-100 ${r.enabled ? '' : 'bg-gray-50/60 text-gray-400'}`}>
                <td className="px-3 py-1.5 font-mono">{r.empCode}</td>
                <td className="px-3 py-1.5">{r.empName}</td>
                <td className="px-3 py-1.5 text-center">{r.empType}</td>
                <td className="px-3 py-1.5 text-center">{r.empStatus}</td>
                <td className="px-3 py-1.5 text-center">{r.appUserCount || '–'}</td>
                <td className="px-3 py-1.5 text-center">{r.approvalCount || '–'}</td>
                <td className="px-3 py-1.5 text-center">
                  <button type="button" role="switch" aria-checked={r.enabled} disabled={busyId === r.empId}
                    onClick={() => toggle(r)} title={r.enabled ? 'คลิกเพื่อนำออกจากรายชื่อผู้อนุมัติ' : 'คลิกเพื่อให้ใช้อนุมัติได้'}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${r.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${r.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">ไม่พบพนักงาน</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
