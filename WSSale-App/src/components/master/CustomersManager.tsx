import { useEffect, useState, useMemo } from 'react';
import {
  Search, Edit2, Save, X, RefreshCw, Truck, Trash2, Users, ArrowUpDown, Phone,
  Filter, UserPlus, CheckCircle2, Mail, MessageSquare, CreditCard, Clock,
  ShieldAlert, Building2, Check, Plus, AlertTriangle
} from 'lucide-react';
import {
  fetchCustomers, fetchCustomerFilters, updateCustomer, batchEditCustomers, getToken,
  fetchCustomerRequests, createCustomerRequest, reviewCustomerRequest,
  fetchCustomerGroups, createCustomerGroup, updateCustomerGroup, deleteCustomerGroup,
  fetchSystemSettings
} from '../../services/api';
import { DataSummaryCard } from '../ui/DataSummaryCard';
import { DeleteConfirmModal } from '../ui/DeleteConfirmModal';
import { appAlert, appPrompt, appConfirm } from '../ui/AppAlert';
import { SearchableSelect } from '../ui/SearchableSelect';
import type { CustomerRequest, EMCust, CustomerGroup } from '../../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

function CreditAgingSection({
  title,
  creditLimit,
  onCreditLimitChange,
  creditLimitLabel,
  agingDays,
  onAgingDaysChange,
  creditHold,
  onCreditHoldChange,
  defaultAgingDays,
  maxAgingDays,
}: {
  title: string;
  creditLimit: number | null | undefined;
  onCreditLimitChange: (v: number | null) => void;
  creditLimitLabel: string;
  agingDays: number | null | undefined;
  onAgingDaysChange: (v: number | null) => void;
  creditHold: boolean;
  onCreditHoldChange: (v: boolean) => void;
  defaultAgingDays: number;
  maxAgingDays: number;
}) {
  const isDefault = agingDays === null || agingDays === undefined;
  const isCash = agingDays === 0;
  const isOverPolicyMax = !isDefault && Number(agingDays) > maxAgingDays;

  return (
    <div className={`rounded-xl border p-4 ${isOverPolicyMax ? 'border-rose-300 bg-rose-50/40' : 'border-amber-100 bg-amber-50/30'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${isOverPolicyMax ? 'text-rose-800' : 'text-amber-800'}`}>
          <CreditCard size={14} /> {title}
        </h4>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-semibold">
            มาตรฐาน {defaultAgingDays} วัน
          </span>
          <span className="text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-semibold">
            สูงสุดไม่เกิน {maxAgingDays} วัน
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            {creditLimitLabel}
          </label>
          <input
            type="number"
            step="1000"
            min="0"
            value={creditLimit ?? ''}
            onChange={e => onCreditLimitChange(e.target.value === '' ? null : Number(e.target.value))}
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
            min="0"
            max="730"
            value={isDefault ? '' : agingDays}
            onChange={e => {
              const raw = e.target.value;
              if (raw === '') onAgingDaysChange(null);
              else {
                const n = Number(raw);
                onAgingDaysChange(Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0);
              }
            }}
            placeholder={`เว้นว่าง = มาตรฐาน (${defaultAgingDays} วัน)`}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              isOverPolicyMax
                ? 'border-rose-500 bg-rose-50 text-rose-900 font-bold focus:ring-rose-400'
                : 'border-gray-200 bg-white focus:ring-[#0C447C]/40'
            }`}
          />
          <div className="flex flex-wrap gap-1 mt-1.5">
            <button
              type="button"
              onClick={() => onAgingDaysChange(0)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition ${
                isCash ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
              }`}
            >
              0 (เงินสด)
            </button>
            <button
              type="button"
              onClick={() => onAgingDaysChange(null)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition ${
                isDefault ? 'bg-[#0C447C] text-white border-[#0C447C]' : 'bg-white text-[#0C447C] border-blue-200 hover:bg-blue-50'
              }`}
            >
              มาตรฐาน ({defaultAgingDays})
            </button>
            <button
              type="button"
              onClick={() => onAgingDaysChange(30)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition ${
                agingDays === 30 ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              30 วัน
            </button>
            <button
              type="button"
              onClick={() => onAgingDaysChange(maxAgingDays)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition ${
                agingDays === maxAgingDays ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {maxAgingDays} วัน
            </button>
          </div>
          <p className={`text-[10px] mt-1 font-medium ${isCash ? 'text-emerald-700' : isDefault ? 'text-blue-700' : 'text-gray-500'}`}>
            {isCash
              ? '💵 ขายเงินสด (0 วัน · ไม่มีเครดิต)'
              : isDefault
                ? `ใช้ค่ามาตรฐานระบบ (${defaultAgingDays} วัน)`
                : `กำหนดเฉพาะราย: ${agingDays} วัน`}
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            สถานะระงับเครดิต (Hold)
          </label>
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(creditHold)}
              onChange={e => onCreditHoldChange(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
            />
            <span className="text-xs font-bold text-red-600">ระงับการสั่งซื้อ (Credit Hold)</span>
          </label>
          <p className="text-[10px] text-gray-400 mt-1">บล็อกการขายทุกกรณี</p>
        </div>
      </div>

      {isOverPolicyMax && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-100/90 px-3 py-2 text-xs text-rose-900">
          <AlertTriangle size={15} className="text-rose-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">คำเตือน: เกินกว่าค่า Aging สูงสุดตามนโยบาย ({agingDays} &gt; {maxAgingDays} วัน)</span>
            <div className="text-[11px] text-rose-800 mt-0.5">
              กรุณาตรวจสอบว่าไม่ได้กรอกตัวเลขผิด (เช่น 10 → 100) หากตั้งค่าเกินนโยบาย ระบบจะขึ้นแจ้งเตือนในหน้าเปิดบิล
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const CustomersManager = ({ onViewTrucks }: { onViewTrucks?: (custName: string) => void }) => {
  const [customers, setCustomers] = useState<EMCust[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultAgingDays, setDefaultAgingDays] = useState(60);
  const [maxAgingDays, setMaxAgingDays] = useState(90);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOptions, setFilterOptions] = useState<import('../../types').CustomerFilterOptions | null>(null);
  const [filters, setFilters] = useState({ salesperson: '', area: '', group: '', employee: '' });
  const [customerRequests, setCustomerRequests] = useState<CustomerRequest[]>([]);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestSaving, setRequestSaving] = useState(false);
  const [requestForm, setRequestForm] = useState({
    CustName: '',
    ContactName: '',
    Tel: '',
    Mobile: '',
    Email: '',
    LineId: '',
    TaxId: '',
    Address: '',
    SalespersonUserId: '',
    RegionCode: '',
    CustGroupId: '',
    CreditLimit: 0,
    AgingDays: null as number | null,
    CreditHold: false,
    Note: '',
  });

  // Customer Groups CRUD State
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);
  const [customerGroups, setCustomerGroups] = useState<CustomerGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupEditForm, setGroupEditForm] = useState<{ CustGroupCode: string; CustGroupName: string; CustGroupNameEng: string; Remark: string }>({
    CustGroupCode: '', CustGroupName: '', CustGroupNameEng: '', Remark: ''
  });
  const [newGroupForm, setNewGroupForm] = useState({
    CustGroupCode: '', CustGroupName: '', CustGroupNameEng: '', Remark: ''
  });
  const [groupSaving, setGroupSaving] = useState(false);

  // Multi-select & Batch Edit State
  const [selectedCustIds, setSelectedCustIds] = useState<Set<string>>(new Set());
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchForm, setBatchForm] = useState<{ salespersonUserId: string; areaId: string; groupId: string; creditHold: 'keep' | 'hold' | 'unhold' }>({
    salespersonUserId: '',
    areaId: '',
    groupId: '',
    creditHold: 'keep',
  });
  const [batchSaving, setBatchSaving] = useState(false);

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

  async function handleExecuteBatchEdit() {
    if (selectedCustIds.size === 0) return;
    const payload: any = { custIds: Array.from(selectedCustIds) };
    if (batchForm.salespersonUserId) {
      payload.salespersonUserId = batchForm.salespersonUserId === 'clear' ? null : Number(batchForm.salespersonUserId);
    }
    if (batchForm.areaId) {
      payload.areaId = batchForm.areaId === 'clear' ? null : batchForm.areaId;
    }
    if (batchForm.groupId) {
      payload.groupId = batchForm.groupId === 'clear' ? null : batchForm.groupId;
    }
    if (batchForm.creditHold === 'hold') payload.creditHold = true;
    else if (batchForm.creditHold === 'unhold') payload.creditHold = false;

    setBatchSaving(true);
    try {
      await batchEditCustomers(payload);
      setBatchModalOpen(false);
      setSelectedCustIds(new Set());
      setBatchForm({ salespersonUserId: '', areaId: '', groupId: '', creditHold: 'keep' });
      await loadCustomers();
      fetchCustomerFilters().then(setFilterOptions).catch(console.error);
      await appAlert(`อัปเดตข้อมูลลูกค้า ${selectedCustIds.size} รายการสำเร็จ`, 'success');
    } catch (e: any) {
      await appAlert(e?.message || 'บันทึกข้อมูลแบบกลุ่มไม่สำเร็จ', 'error');
    } finally {
      setBatchSaving(false);
    }
  }

  async function handleQuickBatchHold(hold: boolean) {
    if (selectedCustIds.size === 0) return;
    const actionText = hold ? 'ระงับการสั่งซื้อ (Credit Hold)' : 'ยกเลิกระงับการสั่งซื้อ';
    if (!await appConfirm(`ยืนยันการ${actionText}สำหรับลูกค้า ${selectedCustIds.size} รายการที่เลือก?`)) return;
    try {
      await batchEditCustomers({
        custIds: Array.from(selectedCustIds),
        creditHold: hold,
      });
      setSelectedCustIds(new Set());
      await loadCustomers();
    } catch (e: any) {
      await appAlert(e?.message || 'บันทึกสถานะไม่สำเร็จ', 'error');
    }
  }

  async function loadCustomerRequests() {
    try {
      setCustomerRequests(await fetchCustomerRequests());
    } catch (err) {
      console.error(err);
    }
  }

  async function loadCustomerGroups() {
    setGroupsLoading(true);
    try {
      setCustomerGroups(await fetchCustomerGroups());
    } catch (err) {
      console.error(err);
    } finally {
      setGroupsLoading(false);
    }
  }

  async function handleCreateGroup() {
    if (!newGroupForm.CustGroupName.trim()) {
      await appAlert('กรุณาระบุชื่อกลุ่มลูกค้า', 'warning');
      return;
    }
    setGroupSaving(true);
    try {
      await createCustomerGroup({
        CustGroupCode: newGroupForm.CustGroupCode.trim() || undefined,
        CustGroupName: newGroupForm.CustGroupName.trim(),
        CustGroupNameEng: newGroupForm.CustGroupNameEng.trim() || undefined,
        Remark: newGroupForm.Remark.trim() || undefined,
      });
      setNewGroupForm({ CustGroupCode: '', CustGroupName: '', CustGroupNameEng: '', Remark: '' });
      await loadCustomerGroups();
      fetchCustomerFilters().then(setFilterOptions).catch(console.error);
      await appAlert('เพิ่มกลุ่มลูกค้าสำเร็จ', 'success');
    } catch (e: any) {
      await appAlert(e?.message || 'เพิ่มกลุ่มลูกค้าไม่สำเร็จ', 'error');
    } finally {
      setGroupSaving(false);
    }
  }

  async function handleUpdateGroup(id: number) {
    if (!groupEditForm.CustGroupName.trim()) {
      await appAlert('กรุณาระบุชื่อกลุ่มลูกค้า', 'warning');
      return;
    }
    setGroupSaving(true);
    try {
      await updateCustomerGroup(id, {
        CustGroupCode: groupEditForm.CustGroupCode.trim() || undefined,
        CustGroupName: groupEditForm.CustGroupName.trim(),
        CustGroupNameEng: groupEditForm.CustGroupNameEng.trim() || undefined,
        Remark: groupEditForm.Remark.trim() || undefined,
      });
      setEditingGroupId(null);
      await loadCustomerGroups();
      fetchCustomerFilters().then(setFilterOptions).catch(console.error);
      await appAlert('บันทึกการแก้ไขกลุ่มลูกค้าสำเร็จ', 'success');
    } catch (e: any) {
      await appAlert(e?.message || 'แก้ไขกลุ่มลูกค้าไม่สำเร็จ', 'error');
    } finally {
      setGroupSaving(false);
    }
  }

  async function handleDeleteGroup(g: CustomerGroup) {
    if ((g.CustomerCount || 0) > 0) {
      await appAlert(`ไม่สามารถลบกลุ่ม "${g.CustGroupName}" ได้ เนื่องจากมีลูกค้าอยู่ในกลุ่มนี้ ${g.CustomerCount} ราย`, 'warning');
      return;
    }
    if (!await appConfirm(`ยืนยันการลบกลุ่มลูกค้า "${g.CustGroupName}"?`)) return;
    setGroupSaving(true);
    try {
      await deleteCustomerGroup(g.CustGroupID);
      await loadCustomerGroups();
      fetchCustomerFilters().then(setFilterOptions).catch(console.error);
      await appAlert('ลบกลุ่มลูกค้าสำเร็จ', 'success');
    } catch (e: any) {
      await appAlert(e?.message || 'ลบกลุ่มลูกค้าไม่สำเร็จ', 'error');
    } finally {
      setGroupSaving(false);
    }
  }

  useEffect(() => {
    loadCustomers();
    loadCustomerRequests();
    loadCustomerGroups();
    fetchCustomerFilters().then(setFilterOptions).catch(console.error);
    fetchSystemSettings()
      .then(res => {
        const raw = res?.raw || {};
        const set = res?.settings || {};
        const defVal = Number(raw.CREDIT_AGING_DEFAULT_DAYS ?? set.CREDIT_AGING_DEFAULT_DAYS);
        const maxVal = Number(raw.CREDIT_AGING_MAX_DAYS ?? set.CREDIT_AGING_MAX_DAYS);
        if (Number.isFinite(defVal) && defVal >= 0) setDefaultAgingDays(defVal);
        if (Number.isFinite(maxVal) && maxVal >= 0) setMaxAgingDays(maxVal);
      })
      .catch(() => {});
  }, []);

  const submitCustomerRequest = async () => {
    if (!requestForm.CustName.trim()) {
      await appAlert('กรุณาระบุชื่อลูกค้า', 'warning');
      return;
    }
    if (requestForm.AgingDays !== null && requestForm.AgingDays > maxAgingDays) {
      const proceed = await appConfirm(
        `⚠️ ค่า Aging ที่กำหนด (${requestForm.AgingDays} วัน) เกินกว่าเกณฑ์สูงสุดตามนโยบาย (${maxAgingDays} วัน)\nกรุณาตรวจสอบว่าไม่ได้พิมพ์ผิด (เช่น 10 → 100)\n\nยืนยันส่งคำขอด้วยค่า ${requestForm.AgingDays} วันใช่หรือไม่?`
      );
      if (!proceed) return;
    }
    setRequestSaving(true);
    try {
      const spObj = filterOptions?.salesperson?.find(s => s.value === requestForm.SalespersonUserId);
      const grpObj = filterOptions?.group?.find(g => g.value === requestForm.CustGroupId);
      await createCustomerRequest({
        CustName: requestForm.CustName.trim(),
        ContactName: requestForm.ContactName.trim() || null,
        Tel: requestForm.Tel.trim() || null,
        Mobile: requestForm.Mobile.trim() || null,
        Email: requestForm.Email.trim() || null,
        LineId: requestForm.LineId.trim() || null,
        TaxId: requestForm.TaxId.trim() || null,
        Address: requestForm.Address.trim() || null,
        SalespersonUserId: requestForm.SalespersonUserId ? Number(requestForm.SalespersonUserId) : null,
        SalespersonName: spObj?.label || null,
        RegionCode: requestForm.RegionCode || null,
        CustGroupId: requestForm.CustGroupId ? Number(requestForm.CustGroupId) : null,
        CustGroupName: grpObj?.label || null,
        CreditLimit: Number(requestForm.CreditLimit) || 0,
        AgingDays: requestForm.AgingDays,
        CreditHold: Boolean(requestForm.CreditHold),
        Note: requestForm.Note.trim() || null,
      });
      setRequestForm({
        CustName: '',
        ContactName: '',
        Tel: '',
        Mobile: '',
        Email: '',
        LineId: '',
        TaxId: '',
        Address: '',
        SalespersonUserId: '',
        RegionCode: '',
        CustGroupId: '',
        CreditLimit: 0,
        AgingDays: null,
        CreditHold: false,
        Note: '',
      });
      setRequestModalOpen(false);
      await loadCustomerRequests();
      await appAlert('บันทึกคำขอเปิดลูกค้าใหม่เรียบร้อยแล้ว', 'success');
    } catch (err: any) {
      await appAlert(err?.message || 'บันทึกคำขอไม่สำเร็จ', 'error');
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
      await appAlert('อัปเดตคำขอไม่สำเร็จ', 'error');
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
    const initialAging = cust.RawAgingDays !== undefined ? cust.RawAgingDays : (cust.AgingDays ?? null);
    setEditForm({
      CustID: cust.CustID,
      CustName: cust.CustName || '',
      PrimaryPhone: cust.PrimaryPhone || cust.Tel || '',
      SecondaryPhone: cust.SecondaryPhone || cust.Mobile || '',
      Email: cust.Email || '',
      LineId: cust.LineId || '',
      CreditLimit: cust.CreditLimit ?? 0,
      AgingDays: initialAging,
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
      await appAlert('กรุณาระบุชื่อลูกค้า', 'warning');
      return;
    }

    const parsedAging = (editForm.AgingDays !== undefined && editForm.AgingDays !== null && (editForm.AgingDays as any) !== '')
      ? Math.max(0, Math.trunc(Number(editForm.AgingDays)))
      : null;

    if (parsedAging !== null && parsedAging > maxAgingDays) {
      const proceed = await appConfirm(
        `⚠️ คำเตือน: Aging สูงสุดของลูกค้ารายนี้ (${parsedAging} วัน) เกินกว่าเกณฑ์สูงสุดตามนโยบาย (${maxAgingDays} วัน)\nกรุณาตรวจสอบว่าไม่ได้พิมพ์ผิด (เช่น 10 → 100)\n\nยืนยันบันทึกค่า ${parsedAging} วันใช่หรือไม่?`
      );
      if (!proceed) return;
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
        CreditLimit: (editForm.CreditLimit !== undefined && editForm.CreditLimit !== null && (editForm.CreditLimit as any) !== '') ? Number(editForm.CreditLimit) : (null as any),
        AgingDays: parsedAging,
        CreditHold: Boolean(editForm.CreditHold),
        salespersonId: editForm.salespersonId || null,
        areaId: editForm.areaId || null,
        groupId: editForm.groupId || null,
        employeeId: editForm.employeeId || null,
        Remark: editForm.Remark?.trim() || (null as any),
      };

      await updateCustomer(editingCust.CustID, payload);

      // Reflect into state accurately (including null -> system default fallback)
      const effectiveAging = parsedAging ?? defaultAgingDays;
      setCustomers(prev => prev.map(c => c.CustID === editingCust.CustID ? {
        ...c,
        ...payload,
        RawAgingDays: parsedAging,
        AgingDays: effectiveAging,
        CreditDays: effectiveAging,
        IsDefaultAging: parsedAging === null,
      } as EMCust : c));
      setEditModalOpen(false);
      setEditingCust(null);
    } catch (err) {
      await appAlert('บันทึกไม่สำเร็จ: ' + ((err as Error)?.message || 'ไม่ทราบสาเหตุ'), 'error');
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
      await appAlert('ไม่สามารถลบข้อมูลได้', 'error');
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
    <div className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
      <span className="whitespace-nowrap">{label}</span>
      <SearchableSelect
        value={filters[key]}
        disabled={disabled}
        onChange={val => updateFilter(key, val)}
        placeholder="ทั้งหมด"
        searchPlaceholder={`ค้นหา${label}...`}
        allowClear={Boolean(filters[key])}
        className="min-w-[165px]"
        options={[
          { value: '', label: 'ทั้งหมด' },
          ...(options || []).map(o => ({
            value: o.value,
            label: `${o.label || o.value} (${o.count})`,
          })),
        ]}
      />
    </div>
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

      {/* Customer Requests & Group Management Bar */}
      <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-[#0C447C]" />
            <div>
              <div className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span>คำขอเปิดลูกค้าใหม่</span>
                {customerRequests.filter(r => r.Status === 'PENDING').length > 0 && (
                  <span className="px-2 py-0.2 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                    รอตรวจสอบ {customerRequests.filter(r => r.Status === 'PENDING').length} รายการ
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-500">เก็บคำขอและข้อมูลสมบูรณ์ (เซลล์, เขต 14 ภาค, กลุ่ม, วงเงิน, Aging) เพื่อส่งต่อ Sale Admin ดำเนินการใน WINSpeed</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setGroupsModalOpen(true); loadCustomerGroups(); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shadow-xs"
            >
              <Building2 size={14} className="text-[#0C447C]" /> จัดการกลุ่มลูกค้า ({customerGroups.length || filterOptions?.group?.length || 0})
            </button>
            <button
              onClick={() => setRequestModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C447C] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#0a3866] transition shadow-xs"
            >
              <UserPlus size={14} /> เพิ่มคำขอเปิดลูกค้า
            </button>
          </div>
        </div>

        {customerRequests.length > 0 && (
          <div className="mt-3 max-h-48 overflow-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
            {customerRequests.slice(0, 10).map(r => (
              <div key={r.Id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-gray-50/60 transition">
                <div className="flex items-center gap-2 flex-wrap min-w-[200px] flex-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.Status === 'PENDING' ? 'bg-amber-50 text-amber-700 border border-amber-200' : r.Status === 'REJECTED' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                    {r.Status === 'PENDING' ? 'รอเปิดใน ERP' : r.Status === 'COMPLETED' ? 'เปิดสำเร็จ' : 'ปฏิเสธ'}
                  </span>
                  <span className="font-bold text-gray-800 text-sm">{r.CustName}</span>
                  {r.RegionCode && (
                    <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 border border-sky-100">
                      เขต {r.RegionCode}
                    </span>
                  )}
                  {r.SalespersonName && (
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                      เซลล์: {r.SalespersonName}
                    </span>
                  )}
                  {r.CustGroupName && (
                    <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                      กลุ่ม: {r.CustGroupName}
                    </span>
                  )}
                  {(r.Tel || r.Mobile) && (
                    <span className="text-gray-500 font-mono text-[11px] flex items-center gap-1">
                      <Phone size={11} /> {r.Tel || r.Mobile}
                    </span>
                  )}
                  {(r.CreditLimit != null && r.CreditLimit > 0 || r.AgingDays !== undefined) && (
                    <span className={`font-semibold text-[11px] ${
                      r.AgingDays != null && r.AgingDays > maxAgingDays ? 'text-rose-700' : 'text-emerald-700'
                    }`}>
                      {r.CreditLimit != null && r.CreditLimit > 0 ? `วงเงิน ฿${Number(r.CreditLimit).toLocaleString()} ` : ''}
                      {r.AgingDays === 0
                        ? '(ขายเงินสด 0 วัน)'
                        : r.AgingDays == null
                          ? `(Aging มาตรฐาน ${defaultAgingDays} วัน)`
                          : `(Aging ${r.AgingDays} วัน${r.AgingDays > maxAgingDays ? ` ⚠ เกิน ${maxAgingDays}` : ''})`}
                    </span>
                  )}
                  {r.WinspeedCustId && (
                    <span className="font-mono text-xs font-bold text-[#0C447C] bg-blue-50 px-1.5 py-0.5 rounded">
                      WINSpeed: {r.WinspeedCustId}
                    </span>
                  )}
                </div>
                {r.Status === 'PENDING' && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => closeCustomerRequest(r, 'COMPLETED')}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition shadow-2xs"
                    >
                      <CheckCircle2 size={13} /> อนุมัติ & ผูกรหัส ERP
                    </button>
                    <button
                      onClick={() => closeCustomerRequest(r, 'REJECTED')}
                      className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 transition"
                    >
                      ปฏิเสธ
                    </button>
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
                <th className="px-3.5 py-3 border-b border-gray-100 text-center w-10">
                  <input
                    type="checkbox"
                    checked={paginatedCustomers.length > 0 && paginatedCustomers.every(c => selectedCustIds.has(c.CustID))}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedCustIds(new Set([...selectedCustIds, ...paginatedCustomers.map(c => c.CustID)]));
                      } else {
                        const next = new Set(selectedCustIds);
                        paginatedCustomers.forEach(c => next.delete(c.CustID));
                        setSelectedCustIds(next);
                      }
                    }}
                    className="rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
                  />
                </th>
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
                  <td colSpan={8} className="px-6 py-16 text-center whitespace-nowrap">
                    <div className="flex flex-col items-center justify-center text-[#0C447C]">
                      <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
                      <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูลลูกค้า...</p>
                    </div>
                  </td>
                </tr>
              ) : paginatedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400 whitespace-nowrap">
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
                      {/* Checkbox */}
                      <td className="px-3.5 py-3 text-center w-10">
                        <input
                          type="checkbox"
                          checked={selectedCustIds.has(cust.CustID)}
                          onChange={() => {
                            const next = new Set(selectedCustIds);
                            if (next.has(cust.CustID)) next.delete(cust.CustID);
                            else next.add(cust.CustID);
                            setSelectedCustIds(next);
                          }}
                          className="rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
                        />
                      </td>

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
                          <span className="text-gray-600">{cust.areaName || (cust.areaId ? `เขต ${cust.areaId}` : '-')}</span>
                          {(cust.groupName || cust.groupId) && (
                            <>
                              <span className="text-gray-400 mx-1">·</span>
                              <span className="text-gray-500">{cust.groupName || cust.groupId}</span>
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
                            <div className="text-[11px] flex items-center gap-1">
                              {(() => {
                                const effectiveAging = cust.AgingDays ?? defaultAgingDays;
                                const isCash = effectiveAging === 0;
                                const isStd = Boolean(cust.IsDefaultAging) || cust.RawAgingDays === null;
                                const isOverMax = effectiveAging > maxAgingDays;
                                if (isCash) {
                                  return (
                                    <>
                                      <Clock size={11} className="text-emerald-600" />
                                      <span className="font-semibold text-emerald-700">เงินสด (0 วัน)</span>
                                    </>
                                  );
                                }
                                if (isOverMax) {
                                  return (
                                    <>
                                      <AlertTriangle size={11} className="text-rose-600" />
                                      <span className="font-bold text-rose-700">Aging {effectiveAging} วัน (เกิน {maxAgingDays})</span>
                                    </>
                                  );
                                }
                                return (
                                  <>
                                    <Clock size={11} className={isStd ? 'text-blue-600' : 'text-amber-600'} />
                                    <span className={isStd ? 'text-blue-700' : 'text-gray-500'}>
                                      {isStd ? `มาตรฐาน (${effectiveAging} วัน)` : `Aging ${effectiveAging} วัน`}
                                    </span>
                                  </>
                                );
                              })()}
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

        {/* Sticky Batch Actions Toolbar */}
        {selectedCustIds.size > 0 && (
          <div className="sticky bottom-0 z-20 bg-[#0C447C] text-white px-5 py-3 rounded-b-2xl flex flex-wrap items-center justify-between gap-3 shadow-xl animate-in slide-in-from-bottom-2">
            <div className="flex items-center gap-3">
              <span className="font-bold text-xs bg-white/20 px-3 py-1 rounded-full">
                เลือกแล้ว {selectedCustIds.size} ราย
              </span>
              <span className="text-xs text-white/80 hidden sm:inline">
                สามารถกำหนดเซลล์ผู้ดูแล, เขตการขาย, กลุ่มลูกค้า หรือระงับการขายพร้อมกันได้
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBatchModalOpen(true)}
                className="px-3.5 py-1.5 rounded-lg bg-white text-[#0C447C] font-bold text-xs hover:bg-blue-50 transition shadow-xs flex items-center gap-1.5"
              >
                <Edit2 size={13} /> กำหนดค่าแบบกลุ่ม (Batch Edit)
              </button>
              <button
                type="button"
                onClick={() => handleQuickBatchHold(true)}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold text-xs hover:bg-red-700 transition flex items-center gap-1"
              >
                <ShieldAlert size={13} /> ระงับการขาย
              </button>
              <button
                type="button"
                onClick={() => handleQuickBatchHold(false)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition flex items-center gap-1"
              >
                <Check size={13} /> ยกเลิกระงับ
              </button>
              <button
                type="button"
                onClick={() => setSelectedCustIds(new Set())}
                className="px-2.5 py-1.5 text-xs text-white/70 hover:text-white"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Comprehensive Customer Edit Modal */}
      {editModalOpen && editingCust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-3">
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
                    <label className="block text-xs font-semibold text-gray-700 mb-1">เซลล์ผู้ดูแล (Sales Rep)</label>
                    <SearchableSelect
                      value={editForm.salespersonId || editForm.employeeId || ''}
                      onChange={v => setEditForm({ ...editForm, salespersonId: v, employeeId: v })}
                      placeholder="(ไม่ระบุ)"
                      searchPlaceholder="ค้นหาเซลล์..."
                      allowClear
                      options={[
                        { value: '', label: '(ไม่ระบุ)' },
                        ...(filterOptions?.salesperson || []).map(o => ({ value: o.value, label: o.label || o.value })),
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">เขตการขาย (Sale Area)</label>
                    <SearchableSelect
                      value={editForm.areaId || ''}
                      onChange={v => setEditForm({ ...editForm, areaId: v })}
                      placeholder="(ไม่ระบุ)"
                      searchPlaceholder="ค้นหาเขตการขาย..."
                      allowClear
                      options={[
                        { value: '', label: '(ไม่ระบุ)' },
                        ...(filterOptions?.area || []).map(o => ({ value: o.value, label: o.label || o.value })),
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">กลุ่มลูกค้า (Customer Group)</label>
                    <SearchableSelect
                      value={editForm.groupId || ''}
                      onChange={v => setEditForm({ ...editForm, groupId: v })}
                      placeholder="(ไม่ระบุ)"
                      searchPlaceholder="ค้นหากลุ่มลูกค้า..."
                      allowClear
                      options={[
                        { value: '', label: '(ไม่ระบุ)' },
                        ...(filterOptions?.group || []).map(o => ({ value: o.value, label: o.label || o.value })),
                      ]}
                    />
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
              <CreditAgingSection
                title="นโยบายวงเงินเครดิต & อายุหนี้ (Credit Limit & Aging)"
                creditLimit={editForm.CreditLimit}
                onCreditLimitChange={v => setEditForm({ ...editForm, CreditLimit: v })}
                creditLimitLabel="วงเงินเครดิต (บาท)"
                agingDays={editForm.AgingDays}
                onAgingDaysChange={v => setEditForm({ ...editForm, AgingDays: v })}
                creditHold={Boolean(editForm.CreditHold)}
                onCreditHoldChange={v => setEditForm({ ...editForm, CreditHold: v })}
                defaultAgingDays={defaultAgingDays}
                maxAgingDays={maxAgingDays}
              />

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

      {/* Rich Customer Request Modal (สร้างคำขอเปิดลูกค้าใหม่) */}
      {requestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/70">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-[#0C447C]/10 p-2 text-[#0C447C]">
                  <UserPlus size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">เพิ่มคำขอเปิดลูกค้าใหม่ (Customer Request)</h3>
                  <p className="text-xs text-gray-500">กรอกข้อมูลครบถ้วนทั้งองค์กร ช่องทางติดต่อ และนโยบายเครดิต เพื่อส่งต่อเปิดใน WINSpeed</p>
                </div>
              </div>
              <button
                onClick={() => setRequestModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              
              {/* Section 1: ข้อมูลหลักและองค์กร */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5">
                  <Users size={14} className="text-[#0C447C]" /> ข้อมูลหลักและองค์กร
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      ชื่อลูกค้า / ชื่อสถานประกอบการ <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={requestForm.CustName}
                      onChange={e => setRequestForm({ ...requestForm, CustName: e.target.value })}
                      placeholder="ระบุชื่อลูกค้า (เช่น บริษัท เกษตรเจริญรุ่งเรือง จำกัด)..."
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">เซลล์ผู้ดูแล (Sales Rep)</label>
                    <SearchableSelect
                      value={requestForm.SalespersonUserId}
                      onChange={v => setRequestForm({ ...requestForm, SalespersonUserId: v })}
                      placeholder="(ไม่ระบุ)"
                      searchPlaceholder="ค้นหาเซลล์..."
                      allowClear
                      options={[
                        { value: '', label: '(ไม่ระบุ)' },
                        ...(filterOptions?.salesperson || []).map(o => ({ value: o.value, label: o.label || o.value })),
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">เขตการขาย (14 ภาคตามผู้อนุมัติ)</label>
                    <SearchableSelect
                      value={requestForm.RegionCode}
                      onChange={v => setRequestForm({ ...requestForm, RegionCode: v })}
                      placeholder="(ไม่ระบุ)"
                      searchPlaceholder="ค้นหาเขตการขาย..."
                      allowClear
                      options={[
                        { value: '', label: '(ไม่ระบุ)' },
                        ...(filterOptions?.area || []).map(o => ({ value: o.value, label: o.label || o.value })),
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">กลุ่มลูกค้า (Customer Group)</label>
                    <SearchableSelect
                      value={requestForm.CustGroupId}
                      onChange={v => setRequestForm({ ...requestForm, CustGroupId: v })}
                      placeholder="(ไม่ระบุ)"
                      searchPlaceholder="ค้นหากลุ่มลูกค้า..."
                      allowClear
                      options={[
                        { value: '', label: '(ไม่ระบุ)' },
                        ...(filterOptions?.group || []).map(o => ({ value: o.value, label: o.label || o.value })),
                      ]}
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Contact & Portal Setup */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#0C447C] flex items-center gap-1.5">
                    <Phone size={14} /> ข้อมูลติดต่อ & เตรียมความพร้อม CUSTOMER PORTAL
                  </h4>
                  <span className="text-[10px] bg-blue-100 text-[#0C447C] px-2 py-0.5 rounded-full font-semibold">
                    Portal Ready
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">ผู้ติดต่อหลัก (Contact Name)</label>
                    <input
                      type="text"
                      value={requestForm.ContactName}
                      onChange={e => setRequestForm({ ...requestForm, ContactName: e.target.value })}
                      placeholder="เช่น คุณสมศักดิ์ หรือ ฝ่ายจัดซื้อ"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">เลขประจำตัวผู้เสียภาษี (Tax ID)</label>
                    <input
                      type="text"
                      value={requestForm.TaxId}
                      onChange={e => setRequestForm({ ...requestForm, TaxId: e.target.value })}
                      placeholder="13 หลัก เช่น 0105551014997"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">เบอร์โทรศัพท์หลัก (1 เบอร์)</label>
                    <div className="relative">
                      <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                      <input
                        type="text"
                        value={requestForm.Tel}
                        onChange={e => setRequestForm({ ...requestForm, Tel: e.target.value })}
                        placeholder="08X-XXX-XXXX"
                        className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      เบอร์โทรสำรอง / มือถือ <span className="text-[11px] text-gray-400 font-normal">(ใช้ "," คั่นได้)</span>
                    </label>
                    <input
                      type="text"
                      value={requestForm.Mobile}
                      onChange={e => setRequestForm({ ...requestForm, Mobile: e.target.value })}
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
                        value={requestForm.Email}
                        onChange={e => setRequestForm({ ...requestForm, Email: e.target.value })}
                        placeholder="contact@company.com, info@company.com"
                        className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Line ID</label>
                    <div className="relative">
                      <MessageSquare className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                      <input
                        type="text"
                        value={requestForm.LineId}
                        onChange={e => setRequestForm({ ...requestForm, LineId: e.target.value })}
                        placeholder="@company หรือ line_id"
                        className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                      />
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">ที่อยู่ตาม ภ.พ.20 / สถานที่ส่งสินค้า</label>
                    <input
                      type="text"
                      value={requestForm.Address}
                      onChange={e => setRequestForm({ ...requestForm, Address: e.target.value })}
                      placeholder="ระบุที่อยู่ ตำบล อำเภอ จังหวัด..."
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Credit Limit & Aging */}
              <CreditAgingSection
                title="นโยบายวงเงินเครดิต & อายุหนี้ (CREDIT LIMIT & AGING)"
                creditLimit={requestForm.CreditLimit}
                onCreditLimitChange={v => setRequestForm({ ...requestForm, CreditLimit: v ?? 0 })}
                creditLimitLabel="วงเงินเครดิตขออนุมัติ (บาท)"
                agingDays={requestForm.AgingDays}
                onAgingDaysChange={v => setRequestForm({ ...requestForm, AgingDays: v })}
                creditHold={Boolean(requestForm.CreditHold)}
                onCreditHoldChange={v => setRequestForm({ ...requestForm, CreditHold: v })}
                defaultAgingDays={defaultAgingDays}
                maxAgingDays={maxAgingDays}
              />

              {/* Section 4: Remark */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">หมายเหตุเพิ่มเติม</label>
                <textarea
                  rows={2}
                  value={requestForm.Note}
                  onChange={e => setRequestForm({ ...requestForm, Note: e.target.value })}
                  placeholder="ระบุข้อความบันทึกเพิ่มเติมสำหรับคำขอนี้..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                />
              </div>

            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-100 bg-gray-50/70">
              <button
                type="button"
                onClick={() => setRequestModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={submitCustomerRequest}
                disabled={requestSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0C447C] text-xs font-bold text-white hover:bg-[#0a3866] disabled:opacity-50 transition shadow-sm"
              >
                {requestSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                บันทึกคำขอเปิดลูกค้า
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Groups CRUD Modal (จัดการกลุ่มลูกค้า dbo.EMCustGroup) */}
      {groupsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/70">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-[#0C447C]/10 p-2 text-[#0C447C]">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">จัดการกลุ่มลูกค้า (Customer Groups · dbo.EMCustGroup)</h3>
                  <p className="text-xs text-gray-500">บริหารรายชื่อกลุ่มลูกค้า กำหนดชื่อและหมายเหตุ พร้อมการตรวจนับจำนวนลูกค้าที่กำลังใช้งาน</p>
                </div>
              </div>
              <button
                onClick={() => setGroupsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              
              {/* Form to Add New Customer Group */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#0C447C] mb-3 flex items-center gap-1.5">
                  <Plus size={14} /> เพิ่มกลุ่มลูกค้าใหม่
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      ชื่อกลุ่มลูกค้า <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newGroupForm.CustGroupName}
                      onChange={e => setNewGroupForm({ ...newGroupForm, CustGroupName: e.target.value })}
                      placeholder="เช่น ลูกค้าทั่วไป, ตัวแทนจำหน่ายภาคกลาง..."
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      รหัสกลุ่ม (Code) <span className="text-[10px] text-gray-400">(เว้นว่างให้ออโต้)</span>
                    </label>
                    <input
                      type="text"
                      value={newGroupForm.CustGroupCode}
                      onChange={e => setNewGroupForm({ ...newGroupForm, CustGroupCode: e.target.value })}
                      placeholder="เช่น 008 หรือ G01"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">ชื่อภาษาอังกฤษ</label>
                    <input
                      type="text"
                      value={newGroupForm.CustGroupNameEng}
                      onChange={e => setNewGroupForm({ ...newGroupForm, CustGroupNameEng: e.target.value })}
                      placeholder="English name..."
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">หมายเหตุ</label>
                    <input
                      type="text"
                      value={newGroupForm.Remark}
                      onChange={e => setNewGroupForm({ ...newGroupForm, Remark: e.target.value })}
                      placeholder="คำอธิบายกลุ่มลูกค้านี้..."
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                    />
                  </div>
                  <div className="sm:col-span-1 flex items-end">
                    <button
                      type="button"
                      onClick={handleCreateGroup}
                      disabled={groupSaving || !newGroupForm.CustGroupName.trim()}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0C447C] text-xs font-bold text-white hover:bg-[#0a3866] disabled:opacity-50 transition shadow-xs"
                    >
                      {groupSaving ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                      เพิ่มกลุ่ม
                    </button>
                  </div>
                </div>
              </div>

              {/* Table of Groups */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-600">
                    รายการกลุ่มลูกค้าทั้งหมด ({customerGroups.length} กลุ่ม)
                  </h4>
                  <button
                    type="button"
                    onClick={loadCustomerGroups}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#0C447C]"
                  >
                    <RefreshCw size={12} className={groupsLoading ? 'animate-spin' : ''} /> รีเฟรช
                  </button>
                </div>

                <div className="rounded-xl border border-gray-100 overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 text-gray-600 font-semibold border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-2.5 w-16">รหัส (PK)</th>
                        <th className="px-3 py-2.5 w-24">รหัสกลุ่ม (Code)</th>
                        <th className="px-4 py-2.5">ชื่อกลุ่มลูกค้า</th>
                        <th className="px-4 py-2.5">ชื่อภาษาอังกฤษ</th>
                        <th className="px-3 py-2.5 text-center w-24">จำนวนลูกค้า</th>
                        <th className="px-4 py-2.5">หมายเหตุ</th>
                        <th className="px-4 py-2.5 text-right w-28">จัดการ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {groupsLoading && customerGroups.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                            กำลังโหลดกลุ่มลูกค้า...
                          </td>
                        </tr>
                      ) : customerGroups.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                            ยังไม่มีกลุ่มลูกค้าในระบบ
                          </td>
                        </tr>
                      ) : (
                        customerGroups.map(g => {
                          const isEditing = editingGroupId === g.CustGroupID;
                          const hasCustomers = (g.CustomerCount || 0) > 0;
                          return (
                            <tr key={g.CustGroupID} className="hover:bg-gray-50/70 transition">
                              <td className="px-4 py-2 font-mono text-gray-500">{g.CustGroupID}</td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={groupEditForm.CustGroupCode}
                                    onChange={e => setGroupEditForm({ ...groupEditForm, CustGroupCode: e.target.value })}
                                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                                  />
                                ) : (
                                  <span className="font-mono font-medium text-gray-700">{g.CustGroupCode || '-'}</span>
                                )}
                              </td>
                              <td className="px-4 py-2 font-semibold text-gray-800">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={groupEditForm.CustGroupName}
                                    onChange={e => setGroupEditForm({ ...groupEditForm, CustGroupName: e.target.value })}
                                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                                  />
                                ) : (
                                  g.CustGroupName
                                )}
                              </td>
                              <td className="px-4 py-2 text-gray-500">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={groupEditForm.CustGroupNameEng}
                                    onChange={e => setGroupEditForm({ ...groupEditForm, CustGroupNameEng: e.target.value })}
                                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                                  />
                                ) : (
                                  g.CustGroupNameEng || '-'
                                )}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${hasCustomers ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-gray-100 text-gray-500'}`}>
                                  {g.CustomerCount || 0} ราย
                                </span>
                              </td>
                              <td className="px-4 py-2 text-gray-400">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={groupEditForm.Remark}
                                    onChange={e => setGroupEditForm({ ...groupEditForm, Remark: e.target.value })}
                                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                                  />
                                ) : (
                                  g.Remark || '-'
                                )}
                              </td>
                              <td className="px-4 py-2 text-right whitespace-nowrap">
                                {isEditing ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateGroup(g.CustGroupID)}
                                      disabled={groupSaving}
                                      className="p-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                      title="บันทึก"
                                    >
                                      <Save size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingGroupId(null)}
                                      className="p-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                                      title="ยกเลิก"
                                    >
                                      <X size={13} />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingGroupId(g.CustGroupID);
                                        setGroupEditForm({
                                          CustGroupCode: g.CustGroupCode || '',
                                          CustGroupName: g.CustGroupName || '',
                                          CustGroupNameEng: g.CustGroupNameEng || '',
                                          Remark: g.Remark || '',
                                        });
                                      }}
                                      className="p-1 rounded text-gray-500 hover:text-blue-700 hover:bg-blue-50 transition"
                                      title="แก้ไขกลุ่ม"
                                    >
                                      <Edit2 size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteGroup(g)}
                                      disabled={hasCustomers}
                                      className={`p-1 rounded transition ${hasCustomers ? 'text-gray-300 cursor-not-allowed' : 'text-red-500 hover:bg-red-50'}`}
                                      title={hasCustomers ? `มีลูกค้าในกลุ่ม ${g.CustomerCount} ราย (ลบไม่ได้)` : 'ลบกลุ่มลูกค้า'}
                                    >
                                      <Trash2 size={13} />
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
              </div>

            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-100 bg-gray-50/70">
              <button
                type="button"
                onClick={() => setGroupsModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition"
              >
                ปิดหน้าต่าง
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

      {/* Batch Edit Customers Modal */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/70">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-[#0C447C]/10 p-2 text-[#0C447C]">
                  <Edit2 size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">แก้ไขข้อมูลลูกค้าแบบกลุ่ม (Batch Edit)</h3>
                  <p className="text-xs text-gray-500">
                    มีผลกับลูกค้าที่เลือกจำนวน <strong className="text-[#0C447C] font-bold">{selectedCustIds.size} ราย</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setBatchModalOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-blue-900">
                💡 เลือกเฉพาะฟิลด์ที่ต้องการเปลี่ยนแปลง ฟิลด์ที่เลือก "(ไม่เปลี่ยนแปลง)" จะคงค่าเดิมของลูกค้าแต่ละรายไว้
              </div>

              {/* 1. เซลล์ผู้ดูแล */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">เซลล์ผู้ดูแล (Sales Rep)</label>
                <SearchableSelect
                  value={batchForm.salespersonUserId}
                  onChange={v => setBatchForm({ ...batchForm, salespersonUserId: v })}
                  placeholder="(ไม่เปลี่ยนแปลง)"
                  searchPlaceholder="ค้นหาเซลล์..."
                  allowClear
                  options={[
                    { value: '', label: '(ไม่เปลี่ยนแปลง)' },
                    ...(filterOptions?.salesperson || []).map(o => ({ value: o.value, label: o.label || o.value })),
                    { value: 'clear', label: '-- ล้างค่า / ไม่ระบุเซลล์ --' },
                  ]}
                />
              </div>

              {/* 2. เขตการขาย */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">เขตการขาย (Sale Area)</label>
                <SearchableSelect
                  value={batchForm.areaId}
                  onChange={v => setBatchForm({ ...batchForm, areaId: v })}
                  placeholder="(ไม่เปลี่ยนแปลง)"
                  searchPlaceholder="ค้นหาเขตการขาย..."
                  allowClear
                  options={[
                    { value: '', label: '(ไม่เปลี่ยนแปลง)' },
                    ...(filterOptions?.area || []).map(o => ({ value: o.value, label: o.label || o.value })),
                    { value: 'clear', label: '-- ล้างค่า / ไม่ระบุเขต --' },
                  ]}
                />
              </div>

              {/* 3. กลุ่มลูกค้า */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">กลุ่มลูกค้า (Customer Group)</label>
                <SearchableSelect
                  value={batchForm.groupId}
                  onChange={v => setBatchForm({ ...batchForm, groupId: v })}
                  placeholder="(ไม่เปลี่ยนแปลง)"
                  searchPlaceholder="ค้นหากลุ่มลูกค้า..."
                  allowClear
                  options={[
                    { value: '', label: '(ไม่เปลี่ยนแปลง)' },
                    ...(filterOptions?.group || []).map(o => ({ value: o.value, label: o.label || o.value })),
                    { value: 'clear', label: '-- ล้างค่า / ไม่ระบุกลุ่ม --' },
                  ]}
                />
              </div>

              {/* 4. สถานะระงับการขาย */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">สถานะระงับการขาย (Credit Hold)</label>
                <select
                  value={batchForm.creditHold}
                  onChange={e => setBatchForm({ ...batchForm, creditHold: e.target.value as any })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#0C447C]/40"
                >
                  <option value="keep">(ไม่เปลี่ยนแปลง)</option>
                  <option value="hold">🔴 ระงับการสั่งซื้อ (Credit Hold = True)</option>
                  <option value="unhold">🟢 ปกติ ไม่ระงับการสั่งซื้อ (Credit Hold = False)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50/70">
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleExecuteBatchEdit}
                disabled={batchSaving || (!batchForm.salespersonUserId && !batchForm.areaId && !batchForm.groupId && batchForm.creditHold === 'keep')}
                className="px-4 py-2 rounded-xl bg-[#0C447C] text-xs font-bold text-white hover:bg-[#0A3866] transition shadow-xs disabled:opacity-50 flex items-center gap-1.5"
              >
                {batchSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                <span>บันทึกข้อมูล {selectedCustIds.size} ราย</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
