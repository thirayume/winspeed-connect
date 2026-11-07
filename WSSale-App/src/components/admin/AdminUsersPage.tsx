import { useEffect, useState } from 'react';
import { Users, RefreshCw, Check, AlertTriangle, Plus, FilePenLine, X, Search, UserX, ArrowUpDown, Trash2, KeyRound } from 'lucide-react';
import { listUsers, fetchEmployees, updateUser, createUser, deleteUser } from '../../services/api';
import '../../store/db-mode';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import type { AdminUser, Employee } from '../../types';
import { BatchUsersPanel } from './BatchUsersPanel';

import { useAuthStore } from '../../store/auth-store';

// Same roles and ranks as backend/services/role-capabilities.js
const ASSIGNABLE_ROLES = ['SALES', 'COUNTER_SALES', 'APPROVER', 'WAREHOUSE', 'WEIGHBRIDGE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'];
const ROLE_RANK: Record<string, number> = {
  SALES: 1, WEIGHBRIDGE: 1, COUNTER_SALES: 2, WAREHOUSE: 2, APPROVER: 3, ACCOUNTING: 4, MANAGER: 5, C_LEVEL: 6, ADMIN: 7,
};

export const AdminUsersPage = () => {
  const [includeInactive,setIncludeInactive]=useState(false);
  const [selected,setSelected]=useState<number[]>([]);
  const [batchUsers,setBatchUsers]=useState<AdminUser[]|null>(null);
  const [users, setUsers]         = useState<AdminUser[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingId, setSavingId]   = useState<number | null>(null);
  const [savedId, setSavedId]     = useState<number | null>(null);
  
  // Modal state
  const [modalUser, setModalUser] = useState<Partial<AdminUser> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetNotice, setResetNotice] = useState('');

  // Pagination, Searching & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'Id', direction: 'asc' });

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const [u, e] = await Promise.all([listUsers(), fetchEmployees()]);
      setUsers(u);
      setEmployees(e);
    } catch (err) {
      setLoadError((err as Error).message || 'โหลดผู้ใช้ไม่สำเร็จ');
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function assignEmp(user: AdminUser, empId: string) {
    setSavingId(user.Id);
    try {
      await updateUser(user.Id, { empId: empId || null });
      setUsers(prev => prev.map(u => u.Id === user.Id
        ? { ...u, EmpId: empId || null, EmpCode: employees.find(e => e.EmpID === empId)?.EmpCode ?? null, EmpName: employees.find(e => e.EmpID === empId)?.EmpName ?? null }
        : u));
      setSavedId(user.Id);
      setTimeout(() => setSavedId(null), 1500);
    } catch (e: unknown) {
      alert((e as Error).message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteUser(deleteTarget.Id);
      setUsers(prev => prev.filter(u => u.Id !== deleteTarget.Id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      alert((e as Error).message || 'ลบไม่สำเร็จ');
    } finally {
      setIsDeleting(false);
    }
  }

  const needsMapping = (u: AdminUser) => (u.Role === 'SALES' || u.Role === 'COUNTER_SALES') && !u.EmpId;

  // Check if an EmpID is already used by ANOTHER user
  const sessionUser = useAuthStore(s => s.user);
  const myRole = sessionUser?.role || '';
  const canBatch = Boolean(sessionUser?.capabilities?.actions.includes('roles.manage')) && !sessionUser?.isImpersonating;
  useEffect(()=>{setSelected([]);setCurrentPage(1);},[includeInactive,searchQuery]);

  async function handleResetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!resetTarget || isResetting) return;
    const data = new FormData(e.currentTarget);
    const password = String(data.get('temporaryPassword') ?? '');
    if (Array.from(password).length < 8 || new TextEncoder().encode(password).length > 72) {
      setResetError('กรอกรหัสผ่านอย่างน้อย 8 ตัวอักษร และไม่เกิน 72 ไบต์');
      return;
    }
    if (password !== data.get('confirmPassword')) {
      setResetError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }

    setResetError('');
    setIsResetting(true);
    try {
      await updateUser(resetTarget.Id, { password });
      setResetNotice('รีเซ็ตรหัสผ่านให้ ' + resetTarget.Username + ' แล้ว ผู้ใช้ต้องเปลี่ยนรหัสเมื่อเข้าสู่ระบบครั้งถัดไป');
      setResetTarget(null);
    } catch (err: unknown) {
      setResetError((err as Error).message || 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
    } finally {
      setIsResetting(false);
    }
  }

  const isEmpIdTaken = (empId: string, currentUserId?: number) => {
    return users.some(u => u.EmpId === empId && u.Id !== currentUserId);
  };

  const handleSaveUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    
    setIsSubmitting(true);
    try {
      if (modalUser?.Id) {
        // Edit
        await updateUser(modalUser.Id, {
          displayName: fd.get('displayName') as string,
          role: fd.get('role') as string,
          isActive: fd.get('isActive') === 'on',
          lineUserId: (fd.get('lineUserId') as string) || null,
          address: (fd.get('address') as string) || null,
          phone: (fd.get('phone') as string) || null,
          email: (fd.get('email') as string) || null,
          idCardNo: (fd.get('idCardNo') as string) || null,
          taxId: (fd.get('taxId') as string) || null,
          ...(fd.get('password') ? { password: fd.get('password') as string } : {})
        });
      } else {
        // Create
        await createUser({
          username: fd.get('username') as string,
          password: fd.get('password') as string,
          displayName: fd.get('displayName') as string,
          role: fd.get('role') as string,
          empId: undefined // Can map later or add it to modal
        });
      }
      setModalUser(null);
      await load();
    } catch (err: unknown) {
      alert((err as Error).message || 'บันทึกไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredUsers = users.filter(u => (includeInactive || u.IsActive) && (
    u.DisplayName.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.Username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (u.EmpCode && u.EmpCode.toLowerCase().includes(searchQuery.toLowerCase()))
  ));

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    let aVal: any = a[sortConfig.key as keyof AdminUser] || '';
    let bVal: any = b[sortConfig.key as keyof AdminUser] || '';
    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / itemsPerPage));
  const paginatedUsers = sortedUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const SortableHeader = ({ title, sortKey, align = 'left' }: { title: string, sortKey: string, align?: 'left'|'center'|'right' }) => (
    <th className={`px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors text-${align} text-xs font-semibold text-gray-500`} onClick={() => requestSort(sortKey)}>
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        {title}
        <ArrowUpDown size={12} className={`text-gray-400 ${sortConfig.key === sortKey ? 'text-[#0C447C] font-bold' : ''}`} />
      </div>
    </th>
  );

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <Users className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> จัดการผู้ใช้งาน (Admin Users)
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
            เพิ่ม ลบ แก้ไข ผู้ใช้งานระบบ และผูกบัญชีกับพนักงาน WINSpeed
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4 overflow-hidden p-3 sm:p-6">
        {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 shrink-0">
        <DataSummaryCard
          title="ผู้ใช้งานทั้งหมด"
          value={users.length.toLocaleString()}
          icon={<Users size={24} />}
          colorClass="bg-blue-100 text-blue-600"
        />
        <DataSummaryCard
          title="ใช้งานอยู่"
          value={users.filter(u => u.IsActive).length.toLocaleString()}
          icon={<Check size={24} />}
          colorClass="bg-emerald-100 text-emerald-600"
        />
        <DataSummaryCard
          title="ยังไม่ Map (ฝ่ายขาย)"
          value={users.filter(needsMapping).length.toLocaleString()}
          icon={<AlertTriangle size={24} />}
          colorClass="bg-orange-100 text-orange-600"
        />
      </div>

      <div className="flex-1 flex flex-col bg-white rounded-none sm:rounded-2xl shadow-sm sm:shadow-sm shadow-none border-y sm:border border-gray-100 overflow-hidden relative">
        {loadError && <p role="alert" className="p-3 text-red-700">{loadError}</p>}
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4 bg-gray-50/50">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="ค้นหาชื่อผู้ใช้, Username, รหัสพนักงาน..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C] focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeInactive} onChange={e=>setIncludeInactive(e.target.checked)}/>แสดง Active + Inactive</label>
            {canBatch&&<button disabled={!selected.length} className="border rounded-lg p-2 disabled:opacity-40" onClick={()=>setBatchUsers(users.filter(u=>selected.includes(u.Id)))}>จัดการที่เลือก ({selected.length})</button>}
            <button onClick={() => setModalUser({ Role: 'SALES', IsActive: true })} className="action-add p-2 rounded-lg transition-colors flex items-center justify-center" title="เพิ่มผู้ใช้งาน">
              <Plus size={18} />
            </button>
            <button onClick={load} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors" title="รีเฟรชข้อมูล">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm min-w-full">
            <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-100 shadow-sm whitespace-nowrap">
              <tr>
                {canBatch&&<th className="p-3"><input type="checkbox" aria-label="เลือกผู้ใช้หน้านี้ทั้งหมด" checked={paginatedUsers.some(u=>u.Id!==sessionUser?.id)&&paginatedUsers.filter(u=>u.Id!==sessionUser?.id).every(u=>selected.includes(u.Id))} onChange={e=>setSelected(e.target.checked?[...new Set([...selected,...paginatedUsers.filter(u=>u.Id!==sessionUser?.id).map(u=>u.Id)])]:selected.filter(id=>!paginatedUsers.some(u=>u.Id===id)))}/></th>}
                <SortableHeader title="ผู้ใช้" sortKey="DisplayName" />
                <SortableHeader title="บทบาท" sortKey="Role" />
                <SortableHeader title="พนักงาน WINSpeed (EMEmp)" sortKey="EmpCode" />
                <SortableHeader title="สถานะระบบ" sortKey="IsActive" align="center" />
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 whitespace-nowrap">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paginatedUsers.map(u => (
                <tr key={u.Id} className={needsMapping(u) ? 'bg-amber-50/40' : ''}>
                  {canBatch&&<td className="p-3"><input aria-label={'เลือก '+u.Username} type="checkbox" disabled={u.Id===sessionUser?.id} checked={selected.includes(u.Id)} onChange={e=>setSelected(e.target.checked?[...selected,u.Id]:selected.filter(id=>id!==u.Id))}/></td>}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="font-medium text-gray-800">{u.DisplayName}</div>
                    <div className="text-xs text-gray-400">@{u.Username}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.IsActive ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-600 font-medium'}`}>
                      {canBatch ? <button className="text-blue-700 underline" title="จัดการ Role ของผู้ใช้" onClick={()=>setBatchUsers([u])}>{(u.RoleCodes||[u.RoleCode||u.Role]).join(' + ')}</button> : (u.RoleCodes||[u.RoleCode||u.Role]).join(' + ')} {!u.IsActive && '(ถูกระงับ)'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <select
                      value={u.EmpId ?? ''}
                      onChange={e => assignEmp(u, e.target.value)}
                      disabled={savingId === u.Id}
                      className="w-full max-w-xs border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white"
                    >
                      <option value="">— ไม่ผูก —</option>
                      {employees.map(emp => {
                        const taken = isEmpIdTaken(emp.EmpID, u.Id);
                        return (
                          <option key={emp.EmpID} value={emp.EmpID} disabled={taken}>
                            {emp.EmpCode} · {emp.EmpName}{emp.IsActive ? '' : ' (ลาออก)'} {taken ? '(ผูกแล้ว)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    {savingId === u.Id ? (
                      <RefreshCw size={15} className="animate-spin text-gray-400 inline" />
                    ) : savedId === u.Id ? (
                      <Check size={16} className="text-green-600 inline" />
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.IsActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {u.IsActive ? 'ใช้งาน' : 'ระงับ'}
                        </span>
                        {needsMapping(u) && (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                            <AlertTriangle size={11} /> ยังไม่ map
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setModalUser(u)} className="action-edit p-1.5 rounded-lg transition-colors inline-flex items-center justify-center" title="แก้ไข">
                        <FilePenLine size={16} />
                      </button>
                      {myRole === 'ADMIN' && !sessionUser?.isImpersonating && sessionUser?.id !== u.Id && (
                        <button
                          type="button"
                          onClick={() => { setResetError(''); setResetNotice(''); setResetTarget(u); }}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-[#0C447C] hover:bg-blue-50"
                          aria-label={'รีเซ็ตรหัสผ่าน ' + u.Username}
                        >
                          <KeyRound size={15} /> รีเซ็ตรหัสผ่าน
                        </button>
                      )}
                      <button onClick={() => setDeleteTarget(u)} className="action-delete p-1.5 rounded-lg transition-colors inline-flex items-center justify-center" title="ลบผู้ใช้">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
          <span className="text-sm text-gray-500">
            แสดง {filteredUsers.length > 0 ? ((currentPage - 1) * itemsPerPage) + 1 : 0} ถึง {Math.min(currentPage * itemsPerPage, filteredUsers.length)} จาก {filteredUsers.length}
          </span>
            <div className="flex gap-1">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 bg-white border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                ก่อนหน้า
              </button>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 bg-white border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                ถัดไป
              </button>
            </div>
          </div>
        </div>
      </div>

      {resetNotice && (
        <div role="status" className="flex items-center justify-between gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {resetNotice}
          <button type="button" aria-label="ปิดข้อความ" onClick={() => setResetNotice('')}><X size={16} /></button>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handleResetPassword}
            onKeyDown={e => { if (e.key === 'Escape' && !isResetting) setResetTarget(null); }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
            className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 id="reset-password-title" className="text-lg font-bold text-gray-800">รีเซ็ตรหัสผ่าน</h2>
            <p className="text-sm text-gray-700">{resetTarget.DisplayName} ({resetTarget.Username})</p>
            <p className="text-sm text-gray-600">ตั้งรหัสชั่วคราวสำหรับบัญชีนี้ ผู้ใช้จะต้องเปลี่ยนรหัสเมื่อเข้าสู่ระบบครั้งถัดไป</p>
            <label className="block text-sm font-medium text-gray-700">
              รหัสผ่านชั่วคราว
              <input name="temporaryPassword" type="password" autoComplete="new-password" autoFocus required disabled={isResetting}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              ยืนยันรหัสผ่านชั่วคราว
              <input name="confirmPassword" type="password" autoComplete="new-password" required disabled={isResetting}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" />
            </label>
            {resetError && <p role="alert" className="text-sm text-red-700">{resetError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResetTarget(null)} disabled={isResetting}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">ยกเลิก</button>
              <button type="submit" disabled={isResetting}
                className="rounded-lg bg-[#0C447C] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                {isResetting ? 'กำลังรีเซ็ต...' : 'ยืนยันรีเซ็ต'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-full">
                <Trash2 size={20} className="text-red-600" />
              </div>
              <h2 className="font-bold text-gray-800">ยืนยันการลบผู้ใช้งาน</h2>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-600 mb-1">คุณต้องการลบผู้ใช้งานนี้หรือไม่?</p>
              <p className="font-semibold text-gray-800">{deleteTarget.DisplayName}</p>
              <p className="text-xs text-gray-400">@{deleteTarget.Username}</p>
              {deleteTarget.EmpCode && (
                <p className="text-xs text-blue-600 mt-1">ผูกกับ {deleteTarget.EmpCode} · {deleteTarget.EmpName}</p>
              )}
              <p className="text-xs text-amber-600 mt-3 bg-amber-50 px-3 py-2 rounded-lg">ข้อมูลพนักงาน (EMEmp) จะไม่ถูกกระทบ — ลบเฉพาะบัญชีในระบบ</p>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                ยกเลิก
              </button>
              <button onClick={handleDeleteUser} disabled={isDeleting} className="flex-1 py-2 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 transition-colors flex items-center justify-center gap-2">
                {isDeleting && <RefreshCw size={14} className="animate-spin" />}
                ลบผู้ใช้งาน
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User CRUD Modal */}
      {modalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 shrink-0">
              <h2 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                {modalUser.Id ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งานใหม่'}
              </h2>
              <button type="button" onClick={() => setModalUser(null)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveUser} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Left Column: Account Settings */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-[#0C447C] border-b border-gray-100 pb-2">ข้อมูลบัญชีผู้ใช้</h3>
                    
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Username (ใช้ Login)</label>
                      <input
                        name="username"
                        defaultValue={modalUser.Username}
                        disabled={!!modalUser.Id}
                        required
                        autoComplete="off"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 focus:ring-2 focus:ring-[#0C447C]/20 outline-none"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Password {modalUser.Id && '(เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน)'}</label>
                      <input
                        name="password"
                        type="password"
                        required={!modalUser.Id}
                        autoComplete="new-password"
                        placeholder={modalUser.Id ? "••••••••" : ""}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0C447C]/20 outline-none"
                      />
                      {modalUser.Id ? (
                        <p className="mt-1 text-[11px] text-amber-700">
                          ตั้งรหัสให้ผู้ใช้คนอื่นแล้ว ระบบจะบังคับให้เจ้าของบัญชีตั้งรหัสใหม่เองก่อนบันทึกข้อมูลได้อีก
                          — เพราะผู้ดูแลรู้รหัสนี้ ชื่อผู้ทำรายการในหลักฐานจึงยังไม่ยืนยันตัวเจ้าของบัญชี
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">ชื่อที่แสดง (Display Name)</label>
                      <input
                        name="displayName"
                        defaultValue={modalUser.DisplayName}
                        required
                        autoComplete="off"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0C447C]/20 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">บทบาท (Role)</label>
                      <select
                        name="role"
                        defaultValue={modalUser.Role || 'SALES'}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0C447C]/20 outline-none bg-white"
                      >
                        {/* R12 item 2: every role used in code; the server refuses ranks the caller may not assign */}
                        {ASSIGNABLE_ROLES
                          .filter(r => myRole === 'ADMIN' || (ROLE_RANK[r] ?? 0) < (ROLE_RANK[myRole] ?? 0) || r === modalUser.Role)
                          .map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>

                    {modalUser.Id && (
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">LINE User ID</label>
                        <input
                          name="lineUserId"
                          defaultValue={modalUser.LineUserId || ''}
                          autoComplete="off"
                          placeholder="เช่น Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#0C447C]/20 outline-none"
                        />
                        {modalUser.LineDisplayName && (
                          <div className="mt-1 text-[11px] text-gray-500">
                            LINE: {modalUser.LineDisplayName}
                          </div>
                        )}
                      </div>
                    )}

                    {modalUser.Id && (
                      <div className="flex items-center gap-2 mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <input
                          type="checkbox"
                          id="isActive"
                          name="isActive"
                          defaultChecked={modalUser.IsActive}
                          className="h-4 w-4 text-blue-600 rounded border-gray-300"
                        />
                        <label htmlFor="isActive" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
                          เปิดใช้งาน (Active)
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Profile Data */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-[#0C447C] border-b border-gray-100 pb-2">ข้อมูลส่วนตัว (Profile)</h3>
                    {modalUser.Id ? (
                      <>
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1">ที่อยู่</label>
                          <textarea name="address" defaultValue={modalUser.Address || ''} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0C447C]/20 outline-none custom-scrollbar" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">เบอร์โทร</label>
                            <input name="phone" defaultValue={modalUser.Phone || ''} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0C447C]/20 outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">อีเมล</label>
                            <input name="email" type="email" defaultValue={modalUser.Email || ''} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0C447C]/20 outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">เลขบัตรประชาชน</label>
                            <input name="idCardNo" defaultValue={modalUser.IdCardNo || ''} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0C447C]/20 outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">เลขผู้เสียภาษี</label>
                            <input name="taxId" defaultValue={modalUser.TaxId || ''} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0C447C]/20 outline-none" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-gray-500 italic bg-gray-50 p-6 mt-4 rounded-xl border border-dashed border-gray-300 text-center flex flex-col items-center justify-center h-40">
                        <UserX className="h-8 w-8 text-gray-300 mb-2" />
                        <p>กรุณาสร้างบัญชีผู้ใช้ให้เสร็จสิ้นก่อน</p>
                        <p>จึงจะสามารถเพิ่มข้อมูลโปรไฟล์ได้</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3 shrink-0">
                <button type="button" onClick={() => setModalUser(null)} className="px-6 py-2 rounded-xl font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition-colors shadow-sm">
                  ยกเลิก
                </button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2 rounded-xl font-bold text-white bg-[#0C447C] hover:bg-blue-800 transition-colors flex items-center justify-center gap-2 shadow-sm">
                  {isSubmitting && <RefreshCw size={16} className="animate-spin" />}
                  {modalUser.Id ? 'บันทึกการแก้ไข' : 'สร้างผู้ใช้ใหม่'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* System Settings Modal */}
      {batchUsers&&<BatchUsersPanel users={batchUsers} onDone={()=>{setSelected([]);load();}} onClose={()=>setBatchUsers(null)}/>}
    </div>
  );
};
