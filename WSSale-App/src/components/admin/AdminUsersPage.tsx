import { useEffect, useState } from 'react';
import { Users, RefreshCw, Check, AlertTriangle, Plus, Edit2, X, Search, UserX, ArrowUpDown } from 'lucide-react';
import { listUsers, fetchEmployees, updateUser, createUser } from '../../services/api';
import { getDbMode, DB_MODE_META } from '../../store/db-mode';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import type { AdminUser, Employee } from '../../types';

export const AdminUsersPage = () => {
  const [users, setUsers]         = useState<AdminUser[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading]     = useState(true);
  const [savingId, setSavingId]   = useState<number | null>(null);
  const [savedId, setSavedId]     = useState<number | null>(null);
  
  // Modal state
  const [modalUser, setModalUser] = useState<Partial<AdminUser> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pagination, Searching & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'Id', direction: 'asc' });

  async function load() {
    setLoading(true);
    try {
      const [u, e] = await Promise.all([listUsers(), fetchEmployees()]);
      setUsers(u);
      setEmployees(e);
    } catch (err) {
      console.error(err);
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

  const needsMapping = (u: AdminUser) => (u.Role === 'SALES' || u.Role === 'COUNTER_SALES') && !u.EmpId;

  // Check if an EmpID is already used by ANOTHER user
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

  const filteredUsers = users.filter(u => 
    u.DisplayName.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.Username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (u.EmpCode && u.EmpCode.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    let aVal: any = a[sortConfig.key as keyof AdminUser] || '';
    let bVal: any = b[sortConfig.key as keyof AdminUser] || '';
    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedUsers.length / itemsPerPage);
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
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Users size={26} /> จัดการผู้ใช้งาน (Admin Users)
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            เพิ่ม ลบ แก้ไข ผู้ใช้งานระบบ และผูกบัญชีกับพนักงาน WINSpeed
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4 overflow-hidden p-6">
        {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
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

      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4 bg-gray-50/50">
          <div className="relative flex-1 max-w-md">
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
          <div className="flex items-center gap-2">
            <button onClick={() => setModalUser({ Role: 'SALES', IsActive: true })} className="p-2 bg-[#0C447C] text-white rounded-lg hover:bg-[#0a3866] transition-colors flex items-center justify-center" title="เพิ่มผู้ใช้งาน">
              <Plus size={18} />
            </button>
            <button onClick={load} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors" title="รีเฟรชข้อมูล">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-100 shadow-sm">
              <tr>
                <SortableHeader title="ผู้ใช้" sortKey="DisplayName" />
                <SortableHeader title="บทบาท" sortKey="Role" />
                <SortableHeader title="พนักงาน WINSpeed (EMEmp)" sortKey="EmpCode" />
                <SortableHeader title="สถานะระบบ" sortKey="EmpId" align="center" />
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paginatedUsers.map(u => (
                <tr key={u.Id} className={needsMapping(u) ? 'bg-amber-50/40' : ''}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">{u.DisplayName}</div>
                    <div className="text-xs text-gray-400">@{u.Username}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.IsActive ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-600 font-medium'}`}>
                      {u.Role} {!u.IsActive && '(ถูกระงับ)'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-center">
                    {savingId === u.Id ? (
                      <RefreshCw size={15} className="animate-spin text-gray-400 inline" />
                    ) : savedId === u.Id ? (
                      <Check size={16} className="text-green-600 inline" />
                    ) : needsMapping(u) ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle size={13} /> ยังไม่ map
                      </span>
                    ) : u.EmpId ? (
                      <span className="text-xs text-green-600">{u.EmpCode}</span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => setModalUser(u)} className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center" title="แก้ไข">
                      <Edit2 size={16} />
                    </button>
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

      {/* User CRUD Modal */}
      {modalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h2 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                {modalUser.Id ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งานใหม่'}
              </h2>
              <button onClick={() => setModalUser(null)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveUser} className="p-6 flex flex-col gap-4 flex-1 overflow-y-auto">
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
                  <option value="SALES">SALES</option>
                  <option value="COUNTER_SALES">COUNTER_SALES</option>
                  <option value="APPROVER">APPROVER</option>
                  <option value="WAREHOUSE">WAREHOUSE</option>
                  <option value="ACCOUNTING">ACCOUNTING</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>

              {modalUser.Id && (
                <div className="flex items-center gap-2 mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
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

              <div className="mt-4 flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setModalUser(null)} className="flex-1 py-2 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                  ยกเลิก
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2 rounded-xl font-bold text-white bg-[#0C447C] hover:bg-blue-800 transition-colors flex items-center justify-center gap-2">
                  {isSubmitting && <RefreshCw size={16} className="animate-spin" />}
                  {modalUser.Id ? 'บันทึกการแก้ไข' : 'สร้างผู้ใช้ใหม่'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
