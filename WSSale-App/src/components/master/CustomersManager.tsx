import { useEffect, useState, useMemo } from 'react';
import {
  Search, Edit2, Save, X, RefreshCw, Truck, Trash2, Users, ArrowUpDown, Phone,
  Filter, UserPlus, CheckCircle2, Mail, MessageSquare, CreditCard, Clock,
  ShieldAlert, Building2
} from 'lucide-react';
import {
  fetchCustomers, fetchCustomerFilters, updateCustomer, getToken,
  fetchCustomerRequests, createCustomerRequest, reviewCustomerRequest
} from '../../services/api';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import { DeleteConfirmModal } from '../ui/DeleteConfirmModal';
import { appPrompt } from '../ui/AppAlert';
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

  // Comprehensive Edit Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCust, setEditingCust] = useState<EMCust | null>(null);
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
    const winspeedCustId = status === 'COMPLETED' ? (await appPrompt('รหัสลูกค้าใน WINSpeed (ถ้ามี):', reqRow.WinspeedCustId || '')) || undefined : undefined;
    const reviewNote = (await appPrompt('หมายเหตุ:', reqRow.ReviewNote || '')) || undefined;
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
      (c.CustName ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.PrimaryPhone ?? c.Tel ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.LineId ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.Email ?? '').toLowerCase().includes(searchQuery.toLowerCase())
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

  const handleOpenEdit = (cust: EMCust) => {
    setEditingCust(cust);
    setEditForm({
      CustID: cust.CustID,
      CustName: cust.CustName || '',
      PrimaryPhone: cust.PrimaryPhone || cust.Tel || '',
      SecondaryPhone: cust.SecondaryPhone || cust.Mobile || '',
      Email: cust.Email || '',
      LineId: cust.LineId || '',
      CreditLimit: cust.CreditLimit ?? 0,
      AgingDays: cust.AgingDays ?? 60,
      CreditHold: Boolean(cust.CreditHold),
      salespersonId: cust.salespersonId || '',
      areaId: cust.areaId || '',
      groupId: cust.groupId || '',
      employeeId: cust.employeeId || '',
      Remark: cust.Remark || '',
    });
    setEditModalOpen(true);
  };

  const handleSaveCustomer = async () => {
    if (!editingCust) return;
    if (!editForm.CustName?.trim()) {
      alert('กรุณาระบุชื่อลูกค้า');
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<EMCust> = {
        CustName: editForm.CustName.trim(),
        PrimaryPhone: editForm.PrimaryPhone?.trim() || (null as any),
        Tel: editForm.PrimaryPhone?.trim() || (null as any),
        SecondaryPhone: editForm.SecondaryPhone?.trim() || (null as any),
        Mobile: editForm.SecondaryPhone?.trim() || (null as any),
        Email: editForm.Email?.trim() || (null as any),
        LineId: editForm.LineId?.trim() || (null as any),
        CreditLimit: (editForm.CreditLimit !== undefined && (editForm.CreditLimit as any) !== '') ? Number(editForm.CreditLimit) : (null as any),
        AgingDays: (editForm.AgingDays !== undefined && (editForm.AgingDays as any) !== '') ? Number(editForm.AgingDays) : 60,
        CreditHold: Boolean(editForm.CreditHold),
        salespersonId: editForm.salespersonId || null,
        areaId: editForm.areaId || null,
        groupId: editForm.groupId || null,
        employeeId: editForm.employeeId || null,
        Remark: editForm.Remark?.trim() || (null as any),
      };

      await updateCustomer(editingCust.CustID, payload);

      // Reflect into state
      setCustomers(prev => prev.map(c => c.CustID === editingCust.CustID ? { ...c, ...payload } as EMCust : c));
      setEditModalOpen(false);
      setEditingCust(null);
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + ((err as Error)?.message || 'ไม่ทราบสาเหตุ'));
      console.error(err);
    }
    setSaving(false);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteLoading(true);
    try {
      await fetch(`${API_BASE}/master/customers/${deletingId}`, { 
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
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
          title="ติดต่อได้ (เบอร์หลัก/Portal)"
          value={customers.filter(c => (c.PrimaryPhone || c.Tel || '').trim().length > 0).length.toLocaleString()}
          icon={<Phone size={24} />}
          colorClass="bg-orange-100 text-orange-600"
        />
      </div>

      {/* Customer Requests Section */}
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

      {/* Main Customers Table Container */}
      <div className="flex-1 grid grid-rows-[auto_1fr_auto] bg-white rounded-none sm:rounded-lg sm:rounded-2xl shadow-sm border-y sm:border border-gray-100 overflow-hidden relative min-h-0">
        
        {/* Search & Filter Toolbar */}
        <div className="p-2 sm:p-4 border-b border-gray-100 flex flex-row items-center gap-2 bg-gray-50/50 overflow-x-auto scrollbar-hide w-full">
          <div className="relative flex-1 min-w-[140px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="ค้นหารหัส, ชื่อลูกค้า, เบอร์, อีเมล, Line..."
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
            <button onClick={() => loadCustomers()} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors" title="โหลดข้อมูลใหม่">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-auto min-h-0 relative">
          <table className="w-full text-sm text-left min-w-full">
            <thead className="bg-gray-50 sticky top-0 z-10 text-gray-600 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">
              <tr>
                <th className="px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('CustID')}>
                  <div className="flex items-center gap-1">รหัสลูกค้า <ArrowUpDown size={12} className={sortConfig.key === 'CustID' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('CustName')}>
                  <div className="flex items-center gap-1">ชื่อลูกค้า <ArrowUpDown size={12} className={sortConfig.key === 'CustName' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('salespersonName')}>
                  <div className="flex items-center gap-1">เซลล์ / เขต / กลุ่ม <ArrowUpDown size={12} className={sortConfig.key === 'salespersonName' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('Tel')}>
                  <div className="flex items-center gap-1">เบอร์หลัก & ข้อมูลติดต่อ Portal <ArrowUpDown size={12} className={sortConfig.key === 'Tel' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('CreditLimit')}>
                  <div className="flex items-center gap-1">วงเงิน & Aging <ArrowUpDown size={12} className={sortConfig.key === 'CreditLimit' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap" onClick={() => requestSort('Remark')}>
                  <div className="flex items-center gap-1">หมายเหตุเพิ่มเติม <ArrowUpDown size={12} className={sortConfig.key === 'Remark' ? 'text-[#0C447C] font-bold' : 'text-gray-400'} /></div>
                </th>
                <th className="px-5 py-3 border-b border-gray-100 text-right whitespace-nowrap">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center whitespace-nowrap">
                    <div className="flex flex-col items-center justify-center text-[#0C447C]">
                      <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
                      <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูลลูกค้า...</p>
                    </div>
                  </td>
                </tr>
              ) : paginatedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400 whitespace-nowrap">
                    <Users size={32} className="mx-auto mb-3 opacity-30" />
                    <p>ไม่พบข้อมูลลูกค้า</p>
                  </td>
                </tr>
              ) : (
                paginatedCustomers.map(cust => {
                  const primaryPhone = cust.PrimaryPhone || cust.Tel;
                  const secondaryPhone = cust.SecondaryPhone || cust.Mobile;
                  const hasPortalInfo = secondaryPhone || cust.Email || cust.LineId;

                  return (
                    <tr key={cust.CustID} className="hover:bg-gray-50/50 transition-colors">
                      {/* 1. CustID */}
                      <td className="px-5 py-3 font-semibold text-gray-900 whitespace-nowrap">
                        <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs text-gray-800">{cust.CustID}</span>
                      </td>

                      {/* 2. CustName */}
                      <td className="px-5 py-3 font-medium text-gray-800 whitespace-nowrap">
                        <div className="max-w-[280px] truncate" title={cust.CustName}>
                          {cust.CustName}
                        </div>
                      </td>

                      {/* 3. Sales / Area / Group */}
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                        <div className="text-xs">
                          <span className="font-semibold text-gray-800">{cust.salespersonName || cust.salespersonId || '-'}</span>
                          <span className="text-gray-400 mx-1">·</span>
                          <span className="text-gray-500">{cust.areaId ? `เขต ${cust.areaId}` : '-'}</span>
                          {cust.groupId && (
                            <>
                              <span className="text-gray-400 mx-1">·</span>
                              <span className="text-gray-500">{cust.groupId}</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* 4. Phone & Portal Contacts */}
                      <td className="px-5 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-800">
                            <Phone size={12} className="text-[#0C447C]" />
                            {primaryPhone ? primaryPhone : <span className="text-gray-400">-</span>}
                          </div>
                          {hasPortalInfo ? (
                            <div className="flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
                              {secondaryPhone && (
                                <span className="rounded bg-blue-50 px-1 py-0.2 text-[#0C447C]" title={`เบอร์สำรอง: ${secondaryPhone}`}>
                                  +{secondaryPhone.split(',').length} เบอร์สำรอง
                                </span>
                              )}
                              {cust.Email && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0.2 text-emerald-700" title={`อีเมล: ${cust.Email}`}>
                                  <Mail size={10} /> {cust.Email.split(',')[0]}
                                </span>
                              )}
                              {cust.LineId && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-green-50 px-1 py-0.2 text-green-700" title={`Line ID: ${cust.LineId}`}>
                                  <MessageSquare size={10} /> {cust.LineId}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-400">ยังไม่ระบุ Portal Info</span>
                          )}
                        </div>
                      </td>

                      {/* 5. Credit & Aging */}
                      <td className="px-5 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="text-xs font-semibold text-gray-800 flex items-center gap-1">
                              <CreditCard size={12} className="text-[#0C447C]" />
                              {cust.CreditLimit != null && Number(cust.CreditLimit) > 0 ? (
                                `฿${Number(cust.CreditLimit).toLocaleString()}`
                              ) : (
                                <span className="text-gray-400">ไม่จำกัดวงเงิน</span>
                              )}
                            </div>
                            <div className="text-[11px] text-gray-500 flex items-center gap-1">
                              <Clock size={11} className="text-amber-600" />
                              <span>Aging {cust.AgingDays ?? 60} วัน</span>
                            </div>
                          </div>
                          {cust.CreditHold && (
                            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 flex items-center gap-0.5">
                              <ShieldAlert size={10} /> Hold
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 6. Remark */}
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                        <div className="max-w-[180px] truncate text-xs text-gray-500" title={cust.Remark || ''}>
                          {cust.Remark || '-'}
                        </div>
                      </td>

                      {/* 7. Actions */}
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {onViewTrucks && (
                            <button
                              onClick={() => onViewTrucks(cust.CustName)}
                              className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center"
                              title="ดูประวัติรถบรรทุกของลูกค้านี้"
                            >
                              <Truck size={16} />
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenEdit(cust)}
                            className="p-1.5 text-gray-400 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center justify-center"
                            title="แก้ไขข้อมูลลูกค้าครบทุกฟิลด์"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => setDeletingId(cust.CustID)}
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center justify-center"
                            title="ปิดสถานะ (Inactive)"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
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

      {/* Comprehensive Customer Edit Modal */}
      {editModalOpen && editingCust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/70">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-[#0C447C]/10 p-2 text-[#0C447C]">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">แก้ไขข้อมูลลูกค้า</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-xs bg-gray-200 text-gray-800 font-semibold px-2 py-0.5 rounded">
                      รหัสลูกค้า (PK): {editingCust.CustID}
                    </span>
                    <span className="text-[11px] text-gray-400 font-medium">(Primary Key ห้ามแก้ไข)</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setEditModalOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Form Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Section 1: Customer Profile & Classification */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5">
                  <Users size={14} className="text-[#0C447C]" /> ข้อมูลหลักและองค์กร
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      ชื่อลูกค้า <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editForm.CustName || ''}
                      onChange={e => setEditForm({ ...editForm, CustName: e.target.value })}
                      placeholder="ระบุชื่อลูกค้า..."
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">เซลล์ผู้ดูแล</label>
                    <select
                      value={editForm.salespersonId || ''}
                      onChange={e => setEditForm({ ...editForm, salespersonId: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    >
                      <option value="">(ไม่ระบุ)</option>
                      {(filterOptions?.salesperson || []).map(o => (
                        <option key={o.value} value={o.value}>{o.label || o.value}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">เขตการขาย</label>
                    <select
                      value={editForm.areaId || ''}
                      onChange={e => setEditForm({ ...editForm, areaId: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    >
                      <option value="">(ไม่ระบุ)</option>
                      {(filterOptions?.area || []).map(o => (
                        <option key={o.value} value={o.value}>{o.label || o.value}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">กลุ่มลูกค้า</label>
                    <select
                      value={editForm.groupId || ''}
                      onChange={e => setEditForm({ ...editForm, groupId: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    >
                      <option value="">(ไม่ระบุ)</option>
                      {(filterOptions?.group || []).map(o => (
                        <option key={o.value} value={o.value}>{o.label || o.value}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">พนักงานรับผิดชอบ</label>
                    <select
                      value={editForm.employeeId || ''}
                      onChange={e => setEditForm({ ...editForm, employeeId: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    >
                      <option value="">(ไม่ระบุ)</option>
                      {(filterOptions?.employee || []).map(o => (
                        <option key={o.value} value={o.value}>{o.label || o.value}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 2: Contact & Customer Portal Setup */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#0C447C] flex items-center gap-1.5">
                    <Phone size={14} /> ข้อมูลติดต่อ & เตรียมความพร้อม Customer Portal
                  </h4>
                  <span className="text-[10px] bg-blue-100 text-[#0C447C] px-2 py-0.5 rounded-full font-semibold">
                    Portal Ready
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      เบอร์โทรศัพท์หลัก (1 เบอร์)
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                      <input
                        type="text"
                        value={editForm.PrimaryPhone || ''}
                        onChange={e => setEditForm({ ...editForm, PrimaryPhone: e.target.value })}
                        placeholder="08X-XXX-XXXX"
                        className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      เบอร์โทรสำรอง <span className="text-[11px] text-gray-400 font-normal">(ใช้ "," คั่นได้)</span>
                    </label>
                    <input
                      type="text"
                      value={editForm.SecondaryPhone || ''}
                      onChange={e => setEditForm({ ...editForm, SecondaryPhone: e.target.value })}
                      placeholder="081-111-1111, 082-222-2222"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      อีเมล์ติดต่อ <span className="text-[11px] text-gray-400 font-normal">(ใช้ "," คั่นได้)</span>
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                      <input
                        type="text"
                        value={editForm.Email || ''}
                        onChange={e => setEditForm({ ...editForm, Email: e.target.value })}
                        placeholder="contact@company.com, info@company.com"
                        className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Line ID
                    </label>
                    <div className="relative">
                      <MessageSquare className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                      <input
                        type="text"
                        value={editForm.LineId || ''}
                        onChange={e => setEditForm({ ...editForm, LineId: e.target.value })}
                        placeholder="@company หรือ line_id"
                        className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: Credit Limit & AR Aging Policy */}
              <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                    <CreditCard size={14} /> นโยบายวงเงินเครดิต & อายุหนี้ (Credit Limit & Aging)
                  </h4>
                  <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-semibold">
                    ค่าเริ่มต้น Aging 60 วัน
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      วงเงินเครดิต (บาท)
                    </label>
                    <input
                      type="number"
                      step="1000"
                      min="0"
                      value={editForm.CreditLimit ?? ''}
                      onChange={e => setEditForm({ ...editForm, CreditLimit: e.target.value === '' ? undefined : Number(e.target.value) })}
                      placeholder="เช่น 100000 (0 = ไม่จำกัด)"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">ยอดค้างชำระตรวจสอบจาก dbo.SOInvHD</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Aging สูงสุด (จำนวนวัน)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={editForm.AgingDays ?? 60}
                      onChange={e => setEditForm({ ...editForm, AgingDays: e.target.value === '' ? 60 : Number(e.target.value) })}
                      placeholder="60"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">มาตรฐาน 60 วัน เกินกำหนดจะแจ้งเตือน</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      สถานะระงับเครดิต (Hold)
                    </label>
                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(editForm.CreditHold)}
                        onChange={e => setEditForm({ ...editForm, CreditHold: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
                      />
                      <span className="text-xs font-bold text-red-600">ระงับการสั่งซื้อ (Credit Hold)</span>
                    </label>
                    <p className="text-[10px] text-gray-400 mt-1">บล็อกการขายทุกกรณี</p>
                  </div>
                </div>
              </div>

              {/* Section 4: Remark */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  หมายเหตุเพิ่มเติม
                </label>
                <textarea
                  rows={2}
                  value={editForm.Remark || ''}
                  onChange={e => setEditForm({ ...editForm, Remark: e.target.value })}
                  placeholder="ระบุข้อความบันทึกเพิ่มเติมสำหรับลูกค้านี้..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                />
              </div>

            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-100 bg-gray-50/70">
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSaveCustomer}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0C447C] text-xs font-bold text-white hover:bg-[#0a3866] disabled:opacity-50 transition shadow-sm"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                บันทึกการแก้ไข
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Inactive Confirm Modal */}
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
