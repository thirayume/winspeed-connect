import { useEffect, useState } from 'react';
import { Users, RefreshCw, Check, AlertTriangle, Plus, FilePenLine, X, Search, ArrowUpDown, Trash2, KeyRound, Shield } from 'lucide-react';
import { listUsers, fetchEmployees, updateUser, deleteUser, req } from '../../services/api';
import '../../store/db-mode';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import type { AdminUser, Employee } from '../../types';
import type { RoleProfile } from './RoleManagementPage';
import { BatchUsersPanel } from './BatchUsersPanel';
import { UserEditor } from './UserEditor';

import { useAuthStore } from '../../store/auth-store';

export const AdminUsersPage = ({
  initialRoleFilter = null,
  onNavigateToRoles,
  embedded = false,
}: {
  initialRoleFilter?: string | null;
  onNavigateToRoles?: () => void;
  embedded?: boolean;
} = {}) => {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [batchUsers, setBatchUsers] = useState<AdminUser[] | null>(null);
  const [users, setUsers]         = useState<AdminUser[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles]         = useState<RoleProfile[]>([]);
  const [roleFilter, setRoleFilter] = useState<string>(initialRoleFilter || 'ALL');
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingId, setSavingId]   = useState<number | null>(null);
  const [savedId, setSavedId]     = useState<number | null>(null);

  // Modal state
  const [modalUser, setModalUser] = useState<Partial<AdminUser> | null>(null);
  const [editorTab, setEditorTab] = useState<'account' | 'roles'>('account');
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

  // Sync initialRoleFilter if it changes from parent console
  useEffect(() => {
    if (initialRoleFilter) {
      setRoleFilter(initialRoleFilter);
    }
  }, [initialRoleFilter]);

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const [u, e, r] = await Promise.all([
        listUsers(),
        fetchEmployees(),
        req<{ roles: RoleProfile[] }>('/admin-management/roles').catch(() => ({ roles: [] }))
      ]);
      setUsers(u);
      setEmployees(e);
      if (r && Array.isArray(r.roles)) {
        setRoles(r.roles);
      }
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

  const needsMapping = (u: AdminUser) => (u.Roles || [u.Role]).some(r => r === 'SALES' || r === 'COUNTER_SALES') && !u.EmpId;

  // Check if an EmpID is already used by ANOTHER user
  const sessionUser = useAuthStore(s => s.user);
  const myRole = sessionUser?.role || '';
  const canBatch = Boolean(sessionUser?.capabilities?.actions.includes('roles.manage')) && !sessionUser?.isImpersonating;

  useEffect(() => { setSelected([]); }, [currentPage]);

  // Rule: Clear selection on pagination, search, inactive toggle, or role filter change
  useEffect(() => {
    setSelected([]);
    setCurrentPage(1);
  }, [includeInactive, searchQuery, roleFilter]);

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

  const getUserRoleCodes = (u: AdminUser): string[] => {
    const list: string[] = [];
    if (Array.isArray(u.RoleCodes) && u.RoleCodes.length > 0) {
      list.push(...u.RoleCodes);
    }
    if (Array.isArray(u.Roles) && u.Roles.length > 0) {
      for (const r of u.Roles) {
        if (!list.includes(r)) list.push(r);
      }
    }
    if (list.length === 0) {
      const fallback = u.RoleCode || u.Role;
      if (fallback) list.push(fallback);
    }
    return list;
  };

  const matchesRoleFilter = (u: AdminUser) => {
    if (roleFilter === 'ALL') return true;
    const userCodes = getUserRoleCodes(u);
    return userCodes.includes(roleFilter) || (Array.isArray(u.Roles) && u.Roles.includes(roleFilter)) || u.Role === roleFilter;
  };

  const filteredUsers = users.filter(u =>
    (includeInactive || u.IsActive) &&
    matchesRoleFilter(u) && (
      u.DisplayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.Username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.EmpCode && u.EmpCode.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );

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

  // Eligible users on current page (excluding oneself)
  const eligiblePageUsers = paginatedUsers.filter(u => u.Id !== sessionUser?.id);
  const isAllPageSelected = eligiblePageUsers.length > 0 && eligiblePageUsers.every(u => selected.includes(u.Id));

  // Top roles for quick filter chips
  const commonRoleCodes = ['ALL', 'C_LEVEL', 'SALES', 'COUNTER_SALES', 'WAREHOUSE', 'WEIGHBRIDGE', 'APPROVER', 'ACCOUNTING', 'MANAGER', 'ADMIN'];
  const customRoleProfiles = roles.filter(r => !commonRoleCodes.includes(r.Code));

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      {!embedded && (
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
          <div>
            <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
              <Users className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> จัดการผู้ใช้งาน (Admin Users)
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
              จัดการบัญชี บทบาทหลายรายการ และการผูกพนักงาน WINSpeed ในที่เดียว
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col gap-3.5 overflow-hidden p-3 sm:p-5">
        {/* Summary Cards: Unique UserIds */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3.5 shrink-0">
          <DataSummaryCard
            title="ผู้ใช้งานทั้งหมด"
            value={users.length.toLocaleString()}
            icon={<Users size={22} />}
            colorClass="bg-blue-100 text-blue-600"
          />
          <DataSummaryCard
            title="ใช้งานอยู่ (Active)"
            value={users.filter(u => u.IsActive).length.toLocaleString()}
            icon={<Check size={22} />}
            colorClass="bg-emerald-100 text-emerald-600"
          />
          <DataSummaryCard
            title="ผู้ใช้หลายบทบาท (Multi-Role)"
            value={users.filter(u => getUserRoleCodes(u).length > 1).length.toLocaleString()}
            icon={<Shield size={22} />}
            colorClass="bg-purple-100 text-purple-700"
          />
          <DataSummaryCard
            title="ยังไม่ผูก EMP (ฝ่ายขาย)"
            value={users.filter(needsMapping).length.toLocaleString()}
            icon={<AlertTriangle size={22} />}
            colorClass="bg-orange-100 text-orange-600"
          />
        </div>

        {/* Table Container Card */}
        <div className="flex-1 flex flex-col bg-white rounded-xl sm:rounded-2xl shadow-xs border border-gray-200 overflow-hidden relative">
          {loadError && <p role="alert" className="p-3 text-red-700 bg-red-50 text-xs border-b border-red-100">{loadError}</p>}

          {/* Toolbar: Search, Filters & Batch Trigger */}
          <div className="p-3 sm:p-4 border-b border-gray-100 flex flex-col gap-2.5 bg-gray-50/60 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="ค้นหาชื่อผู้ใช้, Username, รหัสพนักงาน..."
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-xl text-xs sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0C447C]/20 focus:border-[#0C447C]"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs sm:text-sm text-slate-700 cursor-pointer select-none">
                  <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} className="rounded accent-[#0C447C]" />
                  <span>รวมผู้ปิดใช้งาน</span>
                </label>

                {canBatch && (
                  <button
                    disabled={!selected.length}
                    className="px-3 py-1.5 border border-slate-200 bg-white text-slate-700 font-semibold rounded-xl text-xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-all"
                    onClick={() => setBatchUsers(users.filter(u => selected.includes(u.Id)))}
                  >
                    จัดการที่เลือก ({selected.length})
                  </button>
                )}

                <button
                  onClick={() => { setEditorTab('account'); setModalUser({ Role: 'SALES', IsActive: true }); }}
                  className="px-3 py-1.5 bg-[#0C447C] hover:bg-[#0a3866] text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-1"
                  title="เพิ่มผู้ใช้งานใหม่"
                >
                  <Plus size={16} />
                  <span>เพิ่มผู้ใช้</span>
                </button>

                <button onClick={load} className="p-2 text-gray-500 hover:bg-gray-200 rounded-xl transition-colors" title="รีเฟรชข้อมูล">
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Quick Role Filter Bar (State-based, Dynamic) */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs border-t border-slate-100">
              <span className="text-slate-400 font-medium text-[11px] mr-1">กรองสิทธิ์ (ANY):</span>
              {commonRoleCodes.map(code => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setRoleFilter(code)}
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                    roleFilter === code
                      ? 'bg-[#0C447C] text-white font-semibold shadow-xs'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {code === 'ALL' ? 'ทั้งหมด' : code}
                </button>
              ))}

              {customRoleProfiles.length > 0 && (
                <select
                  value={commonRoleCodes.includes(roleFilter) ? '' : roleFilter}
                  onChange={e => { if (e.target.value) setRoleFilter(e.target.value); }}
                  className="px-2 py-0.5 text-[11px] border border-slate-200 rounded-lg bg-white text-slate-700 outline-none"
                >
                  <option value="">บทบาทอื่น ๆ ({customRoleProfiles.length})</option>
                  {customRoleProfiles.map(r => (
                    <option key={r.Code} value={r.Code}>{r.Name} ({r.Code})</option>
                  ))}
                </select>
              )}

              {roleFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setRoleFilter('ALL')}
                  className="text-slate-400 hover:text-slate-600 text-xs ml-1 flex items-center gap-0.5 underline"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs sm:text-sm min-w-full">
              <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-100 shadow-xs whitespace-nowrap text-[11px] text-slate-500 uppercase tracking-wider">
                <tr>
                  {canBatch && (
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        aria-label="เลือกผู้ใช้หน้านี้ทั้งหมด"
                        checked={isAllPageSelected}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelected(eligiblePageUsers.map(u => u.Id));
                          } else {
                            setSelected([]);
                          }
                        }}
                        className="rounded accent-[#0C447C]"
                      />
                    </th>
                  )}
                  <SortableHeader title="ผู้ใช้ (Username)" sortKey="DisplayName" />
                  <SortableHeader title="บทบาท (Multiple Roles)" sortKey="Role" />
                  <SortableHeader title="พนักงาน WINSpeed (EMEmp)" sortKey="EmpCode" />
                  <SortableHeader title="สถานะระบบ" sortKey="IsActive" align="center" />
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 whitespace-nowrap">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginatedUsers.map(u => {
                  const userRoles = getUserRoleCodes(u);
                  const visibleBadges = userRoles.slice(0, 2);
                  const overflowCount = userRoles.length - 2;

                  return (
                    <tr key={u.Id} className={`hover:bg-slate-50/70 transition-colors ${needsMapping(u) ? 'bg-amber-50/30' : ''}`}>
                      {canBatch && (
                        <td className="p-3 text-center">
                          <input
                            aria-label={'เลือก ' + u.Username}
                            type="checkbox"
                            disabled={u.Id === sessionUser?.id}
                            checked={selected.includes(u.Id)}
                            onChange={e => setSelected(e.target.checked ? [...selected, u.Id] : selected.filter(id => id !== u.Id))}
                            className="rounded accent-[#0C447C]"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-bold text-gray-800">{u.DisplayName}</div>
                        <div className="text-xs text-gray-400 font-mono">@{u.Username}</div>
                      </td>

                      {/* Multi-Role Badges (+N if > 2) */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1.5 max-w-xs">
                          {visibleBadges.length === 0 ? (
                            <span className="text-xs text-gray-400 italic">—</span>
                          ) : (
                            visibleBadges.map(code => (
                              <button
                                key={code}
                                type="button"
                                onClick={() => { setEditorTab('roles'); setModalUser(u); }}
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition-all shadow-2xs ${
                                  code === 'ADMIN'
                                    ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                                    : code === 'C_LEVEL'
                                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                                    : 'bg-blue-50 text-[#0C447C] border-blue-200 hover:bg-blue-100'
                                }`}
                                title="คลิกเพื่อจัดการบทบาทของผู้ใช้"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70"></span>
                                <span>{code}</span>
                              </button>
                            ))
                          )}
                          {overflowCount > 0 && (
                            <button
                              type="button"
                              onClick={() => { setEditorTab('roles'); setModalUser(u); }}
                              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 transition-colors"
                              title={`มีอีก ${overflowCount} บทบาท (คลิกเพื่อดูทั้งหมด)`}
                            >
                              +{overflowCount}
                            </button>
                          )}
                          {!u.IsActive && <span className="text-[11px] text-red-600 font-medium ml-1">(ถูกระงับ)</span>}
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <select
                          value={u.EmpId ?? ''}
                          onChange={e => assignEmp(u, e.target.value)}
                          disabled={savingId === u.Id}
                          className="w-full max-w-xs border border-gray-200 rounded-lg px-2.5 py-1 text-xs sm:text-sm bg-white"
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
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${u.IsActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                              {u.IsActive ? 'ใช้งาน' : 'ระงับ'}
                            </span>
                            {needsMapping(u) && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-medium">
                                <AlertTriangle size={11} /> ยังไม่ map
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => { setEditorTab('account'); setModalUser(u); }}
                            className="action-edit p-1.5 rounded-lg text-amber-700 hover:bg-amber-50 transition-colors inline-flex items-center justify-center"
                            title="แก้ไขข้อมูลผู้ใช้"
                          >
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
                          <button
                            onClick={() => setDeleteTarget(u)}
                            className="action-delete p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors inline-flex items-center justify-center"
                            title="ลบผู้ใช้"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={canBatch ? 6 : 5} className="p-8 text-center text-slate-400 italic">
                      ไม่พบผู้ใช้งานที่ตรงตามเงื่อนไขค้นหา
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50 text-xs sm:text-sm text-gray-500">
            <span>
              แสดง {filteredUsers.length > 0 ? ((currentPage - 1) * itemsPerPage) + 1 : 0} ถึง {Math.min(currentPage * itemsPerPage, filteredUsers.length)} จาก {filteredUsers.length} คน · หัวตารางเลือกเฉพาะหน้าปัจจุบัน (ล้าง selection อัตโนมัติเมื่อเปลี่ยนหน้า/ตัวกรอง)
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 bg-white border border-gray-200 rounded-lg text-xs sm:text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                ก่อนหน้า
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 bg-white border border-gray-200 rounded-lg text-xs sm:text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                ถัดไป
              </button>
            </div>
          </div>
        </div>
      </div>

      {resetNotice && (
        <div role="status" className="flex items-center justify-between gap-2 rounded-lg bg-green-50 p-3 mx-4 text-xs sm:text-sm text-green-800 border border-green-200">
          <span>{resetNotice}</span>
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
            <p className="text-xs text-gray-600">ตั้งรหัสชั่วคราวสำหรับบัญชีนี้ ผู้ใช้จะต้องเปลี่ยนรหัสเมื่อเข้าสู่ระบบครั้งถัดไป</p>
            <label className="block text-xs font-semibold text-gray-700">
              รหัสผ่านชั่วคราว
              <input name="temporaryPassword" type="password" autoComplete="new-password" autoFocus required disabled={isResetting}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs font-semibold text-gray-700">
              ยืนยันรหัสผ่านชั่วคราว
              <input name="confirmPassword" type="password" autoComplete="new-password" required disabled={isResetting}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            {resetError && <p role="alert" className="text-xs text-red-700">{resetError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setResetTarget(null)} disabled={isResetting}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">ยกเลิก</button>
              <button type="submit" disabled={isResetting}
                className="rounded-lg bg-[#0C447C] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {isResetting ? 'กำลังรีเซ็ต...' : 'ยืนยันรีเซ็ต'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-full">
                <Trash2 size={20} className="text-red-600" />
              </div>
              <h2 className="font-bold text-gray-800">ยืนยันการลบผู้ใช้งาน</h2>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-600 mb-1">คุณต้องการลบผู้ใช้งานนี้หรือไม่?</p>
              <p className="font-semibold text-gray-800">{deleteTarget.DisplayName}</p>
              <p className="text-xs text-gray-400 font-mono">@{deleteTarget.Username}</p>
              {deleteTarget.EmpCode && (
                <p className="text-xs text-blue-600 mt-1">ผูกกับ {deleteTarget.EmpCode} · {deleteTarget.EmpName}</p>
              )}
              <p className="text-xs text-amber-700 mt-3 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
                ข้อมูลพนักงาน (EMEmp) จะไม่ถูกกระทบ — ลบเฉพาะบัญชีในระบบ
              </p>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-xs sm:text-sm">
                ยกเลิก
              </button>
              <button onClick={handleDeleteUser} disabled={isDeleting} className="flex-1 py-2 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 transition-colors flex items-center justify-center gap-2 text-xs sm:text-sm">
                {isDeleting && <RefreshCw size={14} className="animate-spin" />}
                ลบผู้ใช้งาน
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UserEditor with dirty guard */}
      {modalUser && (
        <UserEditor
          key={modalUser.Id || 'new'}
          user={modalUser}
          employees={employees}
          initialTab={editorTab}
          onClose={() => setModalUser(null)}
          onSaved={() => { setSelected([]); load(); }}
        />
      )}

      {/* Batch Operations */}
      {batchUsers && (
        <BatchUsersPanel
          users={batchUsers}
          onDone={() => { setSelected([]); load(); }}
          onClose={() => setBatchUsers(null)}
        />
      )}
    </div>
  );
};
