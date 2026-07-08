import { useEffect, useState, useMemo } from 'react';
import { Search, Edit2, Save, X, RefreshCw, Truck, Trash2, Users, ArrowUpDown, Phone, Filter, UserPlus, CheckCircle2 } from 'lucide-react';
import { fetchCustomers, fetchCustomerFilters, updateCustomer, getToken, fetchCustomerRequests, createCustomerRequest, reviewCustomerRequest } from '../../services/api';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import { DeleteConfirmModal } from '../ui/DeleteConfirmModal';
import type { CustomerRequest, EMCust } from '../../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';


export const CustomersManager = ({ onViewTrucks }: { onViewTrucks?: (custName: string) => void }) => {
  const [customers, setCustomers] = useState<EMCust[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOptions, setFilterOptions] = useState<import('../../types').CustomerFilterOptions | null>(null);
  const [filters, setFilters] = useState({ salesperson: '', area: '', group: '', employee: '' });
  const [customerRequests, setCustomerRequests] = useState<CustomerRequest[]>([]);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [requestSaving, setRequestSaving] = useState(false);
  const [requestForm, setRequestForm] = useState({
    CustName: '',
    ContactName: '',
    Tel: '',
    Mobile: '',
    TaxId: '',
    Address: '',
    Note: '',
  });
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<EMCust>>({});
  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30;
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'CustID', direction: 'asc' });

  async function loadCustomers(nextFilters = filters) {
    setLoading(true);
    try {
      const data = await fetchCustomers({ ...nextFilters, limit: 1000 });
      // Filter out deleted/inactive if we want to hide them, but the API might already filter them or we just show them as inactive.
      // Assuming 'Inactive' property exists if added to backend, for now just show all.
      setCustomers(data.filter(c => (c as any).Inactive !== 'I')); 
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  async function loadCustomerRequests() {
    try {
      setCustomerRequests(await fetchCustomerRequests());
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadCustomers();
    loadCustomerRequests();
    fetchCustomerFilters().then(setFilterOptions).catch(console.error);
  }, []);

  const submitCustomerRequest = async () => {
    if (!requestForm.CustName.trim()) {
      alert('กรุณาระบุชื่อลูกค้า');
      return;
    }
    setRequestSaving(true);
    try {
      await createCustomerRequest({ ...requestForm, CustName: requestForm.CustName.trim() });
      setRequestForm({ CustName: '', ContactName: '', Tel: '', Mobile: '', TaxId: '', Address: '', Note: '' });
      setRequestFormOpen(false);
      await loadCustomerRequests();
    } catch (err) {
      alert('บันทึกคำขอไม่สำเร็จ');
      console.error(err);
    }
    setRequestSaving(false);
  };

  const closeCustomerRequest = async (reqRow: CustomerRequest, status: 'COMPLETED' | 'REJECTED') => {
    const winspeedCustId = status === 'COMPLETED' ? window.prompt('รหัสลูกค้าใน WINSpeed (ถ้ามี):', reqRow.WinspeedCustId || '') || undefined : undefined;
    const reviewNote = window.prompt('หมายเหตุ:', reqRow.ReviewNote || '') || undefined;
    try {
      await reviewCustomerRequest(reqRow.Id, { status, winspeedCustId, reviewNote });
      await loadCustomerRequests();
      await loadCustomers();
    } catch (err) {
      alert('อัปเดตคำขอไม่สำเร็จ');
      console.error(err);
    }
  };

  const updateFilter = (key: keyof typeof filters, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    loadCustomers(next);
  };

  const clearFilters = () => {
    const next = { salesperson: '', area: '', group: '', employee: '' };
    setFilters(next);
    loadCustomers(next);
  };

  const hasFilters = Object.values(filters).some(Boolean);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => 
      (c.CustID?.toString() ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.CustName ?? '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [customers, searchQuery]);

  const sortedCustomers = useMemo(() => {
    const sortableItems = [...filteredCustomers];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        let aVal: any = a[sortConfig.key as keyof EMCust] || '';
        let bVal: any = b[sortConfig.key as keyof EMCust] || '';
        
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredCustomers, sortConfig]);

  const totalPages = Math.ceil(sortedCustomers.length / itemsPerPage);
  const paginatedCustomers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedCustomers.slice(start, start + itemsPerPage);
  }, [sortedCustomers, currentPage]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filters]);

  const handleEdit = (cust: EMCust) => {
    setEditingId(cust.CustID);
    setEditForm({ ...cust });
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await updateCustomer(editingId, editForm);
      setCustomers(prev => prev.map(c => c.CustID === editingId ? { ...c, ...editForm } as EMCust : c));
      setEditingId(null);
    } catch (err) {
      alert('บันทึกไม่สำเร็จ');
      console.error(err);
    }
    setSaving(false);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteLoading(true);
    try {
      // Calling the delete API we just made
      await fetch(`${API_BASE}/master/customers/${deletingId}`, { 
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      // Remove from list
      setCustomers(prev => prev.filter(c => c.CustID !== deletingId));
      setDeletingId(null);
    } catch (err) {
      alert('ไม่สามารถลบข้อมูลได้');
      console.error(err);
    }
    setDeleteLoading(false);
  };

  const renderFilterSelect = (
    key: keyof typeof filters,
    label: string,
    options: import('../../types').CustomerFilterOption[] | undefined,
    disabled: boolean
  ) => (
    <label className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
      <span className="whitespace-nowrap">{label}</span>
      <select
        value={filters[key]}
        disabled={disabled}
        onChange={e => updateFilter(key, e.target.value)}
        className="h-9 min-w-[150px] rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700 disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
      >
        <option value="">ทั้งหมด</option>
        {(options || []).map(o => (
          <option key={o.value} value={o.value}>{o.label || o.value} ({o.count})</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 shrink-0">
        <DataSummaryCard
          title="ลูกค้าทั้งหมด"
          value={customers.length.toLocaleString()}
          icon={<Users size={24} />}
          colorClass="bg-blue-100 text-blue-600"
        />
        <DataSummaryCard
          title="ค้นพบ"
          value={filteredCustomers.length.toLocaleString()}
          icon={<Search size={24} />}
          colorClass="bg-emerald-100 text-emerald-600"
        />
        <DataSummaryCard
          title="ติดต่อได้ (มีเบอร์)"
          value={customers.filter(c => c.Tel && c.Tel.trim().length > 0).length.toLocaleString()}
          icon={<Phone size={24} />}
          colorClass="bg-orange-100 text-orange-600"
        />
      </div>

      <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-[#0C447C]" />
            <div>
              <div className="text-sm font-bold text-gray-800">คำขอเปิดลูกค้าใหม่</div>
              <div className="text-[11px] text-gray-500">เก็บคำขอใน wf เพื่อให้ Sale Admin ดำเนินการใน WINSpeed</div>
            </div>
          </div>
          <button
            onClick={() => setRequestFormOpen(v => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C447C] px-3 py-2 text-xs font-bold text-white hover:bg-[#0a3866]"
          >
            <UserPlus size={14} /> เพิ่มคำขอ
          </button>
        </div>
        {requestFormOpen && (
          <div className="mt-3 grid gap-2 border-t border-gray-100 pt-3 sm:grid-cols-4">
            <input value={requestForm.CustName} onChange={e => setRequestForm({ ...requestForm, CustName: e.target.value })} placeholder="ชื่อลูกค้า *" className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40" />
            <input value={requestForm.ContactName} onChange={e => setRequestForm({ ...requestForm, ContactName: e.target.value })} placeholder="ผู้ติดต่อ" className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40" />
            <input value={requestForm.Tel} onChange={e => setRequestForm({ ...requestForm, Tel: e.target.value })} placeholder="โทรศัพท์" className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40" />
            <input value={requestForm.Mobile} onChange={e => setRequestForm({ ...requestForm, Mobile: e.target.value })} placeholder="มือถือ" className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40" />
            <input value={requestForm.TaxId} onChange={e => setRequestForm({ ...requestForm, TaxId: e.target.value })} placeholder="เลขผู้เสียภาษี" className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40" />
            <input value={requestForm.Address} onChange={e => setRequestForm({ ...requestForm, Address: e.target.value })} placeholder="ที่อยู่" className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40 sm:col-span-2" />
            <input value={requestForm.Note} onChange={e => setRequestForm({ ...requestForm, Note: e.target.value })} placeholder="หมายเหตุ" className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40" />
            <div className="flex gap-2 sm:col-span-4">
              <button onClick={submitCustomerRequest} disabled={requestSaving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {requestSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} บันทึกคำขอ
              </button>
              <button onClick={() => setRequestFormOpen(false)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50">ยกเลิก</button>
            </div>
          </div>
        )}
        {customerRequests.length > 0 && (
          <div className="mt-3 max-h-44 overflow-auto rounded-lg border border-gray-100">
            {customerRequests.slice(0, 8).map(r => (
              <div key={r.Id} className="flex flex-wrap items-center gap-2 border-b border-gray-50 px-3 py-2 last:border-0">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.Status === 'PENDING' ? 'bg-amber-50 text-amber-700' : r.Status === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{r.Status}</span>
                <span className="min-w-[180px] flex-1 text-sm font-semibold text-gray-800">{r.CustName}</span>
                <span className="text-xs text-gray-500">{r.ContactName || r.Tel || r.Mobile || '-'}</span>
                {r.WinspeedCustId && <span className="font-mono text-xs text-[#0C447C]">{r.WinspeedCustId}</span>}
                {r.Status === 'PENDING' && (
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => closeCustomerRequest(r, 'COMPLETED')} className="inline-flex items-center gap-1 rounded border border-emerald-200 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"><CheckCircle2 size={12} /> เสร็จแล้ว</button>
                    <button onClick={() => closeCustomerRequest(r, 'REJECTED')} className="rounded border border-red-200 px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50">ปฏิเสธ</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 grid grid-rows-[auto_1fr_auto] bg-white rounded-none sm:rounded-lg sm:rounded-2xl shadow-sm sm:shadow-sm shadow-none border-y sm:border border-gray-100 overflow-hidden relative min-h-0">
        <div className="p-2 sm:p-4 border-b border-gray-100 flex flex-row items-center gap-2 bg-gray-50/50 overflow-x-auto scrollbar-hide w-full">
          <div className="relative flex-1 min-w-[140px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="ค้นหารหัส หรือ ชื่อลูกค้า..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C] focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="h-9 w-px bg-gray-200 shrink-0" />
          <div className="flex items-center gap-2 shrink-0">
            <Filter size={15} className="text-gray-400" />
            {renderFilterSelect('salesperson', 'เซลล์', filterOptions?.salesperson, !filterOptions?.columns.salesperson)}
            {renderFilterSelect('area', 'เขต', filterOptions?.area, !filterOptions?.columns.area)}
            {renderFilterSelect('group', 'กลุ่ม', filterOptions?.group, !filterOptions?.columns.group)}
            {renderFilterSelect('employee', 'พนักงาน', filterOptions?.employee, !filterOptions?.columns.employee)}
            {hasFilters && (
              <button onClick={clearFilters} className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50">
                ล้าง
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => loadCustomers()} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="overflow-auto min-h-0 relative">
          <table className="w-full text-sm text-left min-w-full">
            <thead className="bg-gray-50 sticky top-0 z-10 text-gray-600 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">
              <tr>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('CustID')}>
                  <div className="flex items-center gap-1">รหัสลูกค้า <ArrowUpDown size={12} className={sortConfig.key === 'CustID' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('CustName')}>
                  <div className="flex items-center gap-1">ชื่อลูกค้า <ArrowUpDown size={12} className={sortConfig.key === 'CustName' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('salespersonName')}>
                  <div className="flex items-center gap-1">เซลล์ <ArrowUpDown size={12} className={sortConfig.key === 'salespersonName' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('areaId')}>
                  <div className="flex items-center gap-1">เขต <ArrowUpDown size={12} className={sortConfig.key === 'areaId' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('groupId')}>
                  <div className="flex items-center gap-1">กลุ่มลูกค้า <ArrowUpDown size={12} className={sortConfig.key === 'groupId' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('employeeName')}>
                  <div className="flex items-center gap-1">พนักงาน <ArrowUpDown size={12} className={sortConfig.key === 'employeeName' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('Tel')}>
                  <div className="flex items-center gap-1">โทรศัพท์ <ArrowUpDown size={12} className={sortConfig.key === 'Tel' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('Remark')}>
                  <div className="flex items-center gap-1">หมายเหตุเพิ่มเติม <ArrowUpDown size={12} className={sortConfig.key === 'Remark' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-6 py-4 border-b border-gray-100 text-right whitespace-nowrap">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-16 text-center whitespace-nowrap">
                    <div className="flex flex-col items-center justify-center text-[#0C447C]">
                      <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
                      <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูลลูกค้า...</p>
                    </div>
                  </td>
                </tr>
              ) : paginatedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-400 whitespace-nowrap">
                    <Users size={32} className="mx-auto mb-3 opacity-30" />
                    <p>ไม่พบข้อมูลลูกค้า</p>
                  </td>
                </tr>
              ) : (
                paginatedCustomers.map(cust => {
                  const isEditing = editingId === cust.CustID;
                  
                  return (
                    <tr key={cust.CustID} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-3 font-medium text-gray-800 whitespace-nowrap">{cust.CustID}</td>
                      <td className="px-6 py-3 whitespace-nowrap">
                        {isEditing ? (
                          <input 
                            type="text" 
                            value={editForm.CustName || ''} 
                            onChange={e => setEditForm({ ...editForm, CustName: e.target.value })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#0C447C]"
                          />
                        ) : cust.CustName}
                      </td>
                      <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{cust.salespersonName || cust.salespersonId || '-'}</td>
                      <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{cust.areaId || '-'}</td>
                      <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{cust.groupId || '-'}</td>
                      <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{cust.employeeName || cust.employeeId || '-'}</td>
                      <td className="px-6 py-3 text-gray-600 whitespace-nowrap">
                        {isEditing ? (
                          <input 
                            type="text" 
                            value={editForm.Tel || ''} 
                            onChange={e => setEditForm({ ...editForm, Tel: e.target.value })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#0C447C]"
                          />
                        ) : cust.Tel || '-'}
                      </td>
                      <td className="px-6 py-3 text-gray-600 whitespace-nowrap">
                        {isEditing ? (
                          <input 
                            type="text" 
                            placeholder="หมายเหตุ..."
                            value={editForm.Remark || ''} 
                            onChange={e => setEditForm({ ...editForm, Remark: e.target.value })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#0C447C]"
                          />
                        ) : cust.Remark || '-'}
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                              <X size={16} />
                            </button>
                            <button onClick={handleSave} disabled={saving} className="p-1.5 text-white bg-[#0C447C] hover:bg-[#0a3866] rounded disabled:opacity-50 flex items-center gap-1 text-xs">
                              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} บันทึก
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            {onViewTrucks && (
                              <button onClick={() => onViewTrucks(cust.CustName)} className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center" title="ดูประวัติรถบรรทุกของลูกค้านี้">
                                <Truck size={16} />
                              </button>
                            )}
                            <button onClick={() => handleEdit(cust)} className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center" title="แก้ไขข้อมูล">
                              <Edit2 size={16} />
                            </button>
                            <button onClick={() => setDeletingId(cust.CustID)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center justify-center" title="ปิดสถานะ (Inactive)">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <span className="text-sm text-gray-500">
              แสดง {((currentPage - 1) * itemsPerPage) + 1} ถึง {Math.min(currentPage * itemsPerPage, filteredCustomers.length)} จาก {filteredCustomers.length}
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
        )}
      </div>

      <DeleteConfirmModal
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDeleteConfirm}
        title="ยืนยันการลบลูกค้า"
        itemName={customers.find(c => c.CustID === deletingId)?.CustName || ''}
        loading={deleteLoading}
      />
    </div>
  );
};
