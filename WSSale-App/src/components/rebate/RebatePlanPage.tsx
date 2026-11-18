import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ClipboardList, RefreshCw, Plus, X, Square, CheckSquare, Coins, FileSignature,
  Printer, FileText, Building, Users, Calendar, DollarSign, Trash2, Tag, Layers
} from 'lucide-react';
import {
  fetchRebatePlans, createRebatePlan, updateRebatePlan, allocateRebatePlan,
  listUsers, fetchGoods, fetchRebateRegions, fetchCustomers
} from '../../services/api';
import type { RebatePlan, AdminUser, EMGood } from '../../types';
import { PlanApprovalDialog } from './RebatePlanApproval';
import { RebatePlanPrintModal } from './RebatePlanPrintModal';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { SearchableSelect } from '../ui/SearchableSelect';
import { appAlert, appConfirm } from '../ui/AppAlert';

const CANONICAL_SALE_REGIONS = [
  { RegionCode: '01', RegionName: 'กรุงเทพและปริมณฑล' },
  { RegionCode: '02', RegionName: 'ภาคกลาง-ตะวันตก' },
  { RegionCode: '03', RegionName: 'ภาคตะวันออกเฉียงเหนือ' },
  { RegionCode: '04', RegionName: 'ภาคเหนือ' },
  { RegionCode: '05', RegionName: 'ภาคใต้' },
  { RegionCode: '06', RegionName: 'ภาคตะวันออก' },
  { RegionCode: '10', RegionName: 'ภาคอีสานบน' },
  { RegionCode: '11', RegionName: 'ภาคอีสานกลาง' },
  { RegionCode: '12', RegionName: 'ภาคอีสานล่าง' },
  { RegionCode: '13', RegionName: 'ภาคปุ๋ยเทพ 1' },
  { RegionCode: '14', RegionName: 'ภาคปุ๋ยเทพ 2' },
  { RegionCode: '15', RegionName: 'โรงงานและหน่วยงานราชการ' },
  { RegionCode: '16', RegionName: 'เคาน์เตอร์เซลล์' },
  { RegionCode: '99', RegionName: 'ไม่ระบุ' },
];

const PLAN_CATEGORIES = [
  'งบจัดเลี้ยงรับรองลูกค้าประจำเขตการขาย',
  'งบท่องเที่ยว/ดูงานต่างประเทศสำหรับพนักงาน (ตอบแทนผลงาน)',
  'งบท่องเที่ยว/สัมมนาลูกค้า VIP ประจำปี',
  'งบกิจกรรมส่งเสริมการขาย/สัมมนาตัวแทนจำหน่าย',
  'งบสนับสนุนการขายและส่วนลดส่งเสริมการขาย',
  'งบศึกษาดูงานและอบรมพัฒนาทีมงาน',
  'อื่นๆ (โปรดระบุในหมายเหตุ)',
];

const THB = (n?: number | null) => n != null ? `฿${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 0 })}` : '-';
const STATUS_META: Record<string, { label: string; cls: string }> = {
  DRAFT:         { label: 'ร่าง',                cls: 'bg-gray-100 text-gray-600' },
  TIER2_PENDING: { label: 'รอผู้จัดการภาค',       cls: 'bg-amber-50 text-amber-700' },
  TIER3_PENDING: { label: 'รอผู้จัดการฝ่ายขาย',   cls: 'bg-amber-50 text-amber-700' },
  TIER4_PENDING: { label: 'รอกรรมการบริหาร',      cls: 'bg-amber-50 text-amber-700' },
  APPROVED:      { label: 'อนุมัติแล้ว',          cls: 'bg-emerald-50 text-emerald-700' },
  ACTIVE:        { label: 'ใช้งาน',              cls: 'bg-green-50 text-green-700' },
  REJECTED:      { label: 'ไม่อนุมัติ',           cls: 'bg-red-50 text-red-700' },
  CLOSED:        { label: 'ปิดแล้ว',             cls: 'bg-gray-200 text-gray-500' },
  INACTIVE:      { label: 'ยกเลิก',              cls: 'bg-gray-200 text-gray-500' },
};
const statusMeta = (s?: string) =>
  STATUS_META[String(s || 'DRAFT')] || { label: String(s || '—'), cls: 'bg-gray-100 text-gray-600' };

export function RebatePlanPage() {
  const [plans, setPlans] = useState<RebatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RebatePlan | null>(null);
  const [allocFor, setAllocFor] = useState<RebatePlan | null>(null);
  const [approvalFor, setApprovalFor] = useState<RebatePlan | null>(null);
  const [printPlans, setPrintPlans] = useState<RebatePlan[] | null>(null);
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try { setPlans(await fetchRebatePlans(statusFilter || undefined)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(p: RebatePlan, status: string) {
    try { await updateRebatePlan(p.PlanId, { status }); await load(); }
    catch (e) { await appAlert((e as Error).message, 'error'); }
  }

  const toggleSelectPlan = (id: number) => {
    setSelectedPlanIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedPlanIds.size === plans.length) {
      setSelectedPlanIds(new Set());
    } else {
      setSelectedPlanIds(new Set(plans.map(p => p.PlanId)));
    }
  };

  const handlePrintBatch = () => {
    const selected = plans.filter(p => selectedPlanIds.has(p.PlanId));
    if (selected.length === 0) return;
    setPrintPlans(selected);
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      {/* Header */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <ClipboardList className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> <span className="truncate">แผนส่งเสริมการขายและงบประมาณประจำปี (Budget Plan)</span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
            จัดทำแผนงบประมาณโครงการส่งเสริมการขาย งานจัดเลี้ยงลูกค้าในเขต ท่องเที่ยวพนักงาน/ลูกค้า VIP พร้อมแบบฟอร์มขออนุมัติและพิมพ์รายงาน
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm focus:outline-none focus:border-[#0C447C]"
          >
            <option value="">ทุกสถานะ</option>
            <option value="DRAFT">ร่าง</option>
            <option value="REJECTED">ไม่อนุมัติ (ตีกลับ)</option>
            <option value="APPROVED">อนุมัติแล้ว</option>
            <option value="ACTIVE">ใช้งาน</option>
            <option value="CLOSED">ปิดแล้ว</option>
          </select>

          {selectedPlanIds.size > 0 && (
            <button
              onClick={handlePrintBatch}
              className="px-3 py-1.5 sm:px-3 sm:py-2 rounded-lg bg-emerald-700 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 hover:bg-emerald-800 transition-colors shadow-sm"
            >
              <Printer size={15} /> พิมพ์ที่เลือก ({selectedPlanIds.size})
            </button>
          )}

          <button
            onClick={() => setPrintPlans(plans)}
            disabled={plans.length === 0}
            className="px-3 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-colors shadow-sm disabled:opacity-50"
            title="ออกรายงานรวมทุกแผนงาน"
          >
            <FileText size={15} className="text-[#0C447C]" /> พิมพ์รวมทุกแผน
          </button>

          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="px-3 py-1.5 sm:px-3 sm:py-2 rounded-lg text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 hover:bg-[#0a3866] transition-colors shadow-sm"
            style={{ background: '#0C447C' }}
          >
            <Plus size={16} /> สร้างแผนงาน
          </button>

          <button onClick={load} className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors shadow-sm shrink-0">
            <RefreshCw size={14} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="flex-1 overflow-auto p-0 sm:p-6">
        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 flex justify-center"><RefreshCw size={26} className="animate-spin text-gray-300" /></div>
          ) : plans.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">ยังไม่มีแผนส่งเสริมการขาย — กด “สร้างแผนงาน” ด้านบน</p>
          ) : (
            <table className="w-full text-sm min-w-full">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                <tr>
                  <th className="px-3 py-3 text-center w-10">
                    <input
                      type="checkbox"
                      checked={selectedPlanIds.size === plans.length && plans.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
                    />
                  </th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">เลขที่ / ชื่อแผนงาน</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">หมวดหมู่งบประมาณ</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Ref Doc</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">ภาค/เขต</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">ช่วงเวลา</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">งบจัดสรร</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">สะสมจริง</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">สถานะ</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {plans.map(p => {
                  const sm = statusMeta(p.Status);
                  const isChecked = selectedPlanIds.has(p.PlanId);
                  return (
                    <tr key={p.PlanId} className={`hover:bg-gray-50/60 ${isChecked ? 'bg-blue-50/30' : ''}`}>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectPlan(p.PlanId)}
                          className="rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
                        />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-mono font-bold text-[#0C447C]">{p.PlanNo}</div>
                        <div className="text-xs text-gray-800 font-medium">{p.Title || '-'}</div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-gray-600">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          <Tag size={10} /> {p.PlanCategory || 'งบทั่วไป'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs text-gray-600">{p.RefDoc || '-'}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap font-medium">{p.Region}</td>
                      <td className="px-4 py-2.5 text-center text-xs text-gray-500 whitespace-nowrap">
                        {(p.ValidFrom?.substring(0,10) || '—')} → {(p.ValidTo?.substring(0,10) || '—')}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap text-emerald-700">{THB(p.AllocatedAmount)}</td>
                      <td className="px-4 py-2.5 text-right text-[#0C447C] font-bold whitespace-nowrap">{THB(p.AccruedAmt)}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${sm.cls}`}>{sm.label}</span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => setPrintPlans([p])}
                            title="พิมพ์แบบขออนุมัติแผนงาน (A4)"
                            className="h-7 w-7 flex items-center justify-center rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                          >
                            <Printer size={13} />
                          </button>
                          <button
                            onClick={() => setApprovalFor(p)}
                            title="สายอนุมัติ / ยื่นขออนุมัติ"
                            className="h-7 w-7 flex items-center justify-center rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                          >
                            <FileSignature size={13} />
                          </button>
                          {['APPROVED', 'ACTIVE'].includes(String(p.Status)) && (
                            <button
                              onClick={() => setStatus(p, 'CLOSED')}
                              title="ปิดโครงการ"
                              className="h-7 w-7 flex items-center justify-center rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                            >
                              <Square size={13} />
                            </button>
                          )}
                          {['APPROVED', 'ACTIVE'].includes(String(p.Status)) && (
                            <button
                              onClick={() => setAllocFor(p)}
                              title="จัดสรรงบเข้า Pool"
                              className="h-7 w-7 flex items-center justify-center rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                            >
                              <Coins size={13} />
                            </button>
                          )}
                          {['DRAFT', 'REJECTED'].includes(String(p.Status || 'DRAFT')) && (
                            <button
                              onClick={() => { setEditing(p); setShowForm(true); }}
                              className="text-xs text-gray-700 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 font-medium transition-colors"
                            >
                              แก้ไข
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modals */}
      {showForm && (
        <PlanForm
          plan={editing}
          onClose={() => setShowForm(false)}
          onDone={() => { setShowForm(false); load(); }}
        />
      )}
      {allocFor && <AllocateModal plan={allocFor} onClose={() => setAllocFor(null)} onDone={() => { setAllocFor(null); load(); }} />}
      {approvalFor && <PlanApprovalDialog plan={approvalFor} onClose={() => setApprovalFor(null)} onChanged={() => { load(); setApprovalFor(null); }} />}
      {printPlans && <RebatePlanPrintModal plans={printPlans} onClose={() => setPrintPlans(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Form Modal — ขนาดใหญ่ที่สุด (Full / Wide dialog)
// ─────────────────────────────────────────────────────────────
function PlanForm({ plan, onClose, onDone }: { plan: RebatePlan | null; onClose: () => void; onDone: () => void }) {
  const [goods, setGoods] = useState<EMGood[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [staffUsers, setStaffUsers] = useState<AdminUser[]>([]);
  const [regionList, setRegionList] = useState(CANONICAL_SALE_REGIONS);

  // Form State
  const [f, setF] = useState({
    title: plan?.Title || '',
    planCategory: plan?.PlanCategory || PLAN_CATEGORIES[0],
    refDoc: plan?.RefDoc || '',
    goodCodePattern: plan?.GoodCodePattern || '',
    region: plan?.Region || 'ALL',
    returnType: plan?.ReturnType || 'REBATE',
    netPrice: plan?.NetPrice ?? '',
    validFrom: plan?.ValidFrom?.substring(0,10) || '',
    validTo: plan?.ValidTo?.substring(0,10) || '',
    allocatedAmount: plan?.AllocatedAmount ?? '',
    priority: plan?.Priority ?? 100,
    note: plan?.Note || '',
    objective: plan?.Objective || '',
  });

  // Details State
  const initialDetails = useMemo(() => {
    if (!plan?.DetailsJson) return { internalParticipants: [], externalParticipants: [], expenseItems: [] };
    try {
      return typeof plan.DetailsJson === 'string' ? JSON.parse(plan.DetailsJson) : plan.DetailsJson;
    } catch {
      return { internalParticipants: [], externalParticipants: [], expenseItems: [] };
    }
  }, [plan]);

  const [internalList, setInternalList] = useState<Array<{ name: string; role: string; dept: string }>>(
    initialDetails.internalParticipants || []
  );
  const [externalList, setExternalList] = useState<Array<{ custCode: string; custName: string; note: string }>>(
    initialDetails.externalParticipants || []
  );
  const [expenseList, setExpenseList] = useState<Array<{ item: string; amount: number; note: string }>>(
    initialDetails.expenseItems || []
  );

  // New Participant Inputs
  const [newStaffUser, setNewStaffUser] = useState('');
  const [newCustId, setNewCustId] = useState('');
  const [newExpenseItem, setNewExpenseItem] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');
  const [newExpenseNote, setNewExpenseNote] = useState('');

  const [activeTab, setActiveTab] = useState<'info' | 'participants' | 'expenses'>('info');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: string, v: unknown) => setF(s => ({ ...s, [k]: v }));

  useEffect(() => {
    fetchGoods().then(g => setGoods(g || [])).catch(() => setGoods([]));
    fetchCustomers({ limit: 500 }).then((c: any) => setCustomers(Array.isArray(c) ? c : c?.data || [])).catch(() => setCustomers([]));
    listUsers().then(u => setStaffUsers(u || [])).catch(() => setStaffUsers([]));
    fetchRebateRegions().then(res => {
      if (res?.regions?.length) setRegionList(res.regions);
    }).catch(() => {});
  }, []);

  // Add Internal Staff
  const handleAddInternal = () => {
    if (!newStaffUser) return;
    const user = staffUsers.find(u => String(u.Id) === newStaffUser);
    if (!user) return;
    setInternalList(prev => [
      ...prev,
      {
        name: user.DisplayName,
        role: user.Role,
        dept: user.PositionCode || user.Role,
      }
    ]);
    setNewStaffUser('');
  };

  // Add External Customer
  const handleAddExternal = () => {
    if (!newCustId) return;
    const cust = customers.find(c => String(c.CustID) === newCustId);
    if (!cust) return;
    setExternalList(prev => [
      ...prev,
      {
        custCode: cust.CustCode || '-',
        custName: cust.CustName,
        note: 'ลูกค้าเป้าหมาย',
      }
    ]);
    setNewCustId('');
  };

  // Add Expense Item
  const handleAddExpense = () => {
    if (!newExpenseItem || !newExpenseAmount) return;
    const amt = Number(newExpenseAmount);
    if (isNaN(amt) || amt <= 0) return;
    setExpenseList(prev => [
      ...prev,
      {
        item: newExpenseItem,
        amount: amt,
        note: newExpenseNote,
      }
    ]);
    setNewExpenseItem('');
    setNewExpenseAmount('');
    setNewExpenseNote('');
  };

  const totalExpenseSum = useMemo(() => {
    return expenseList.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }, [expenseList]);

  async function submit() {
    setBusy(true);
    setErr('');
    try {
      const detailsJson = JSON.stringify({
        internalParticipants: internalList,
        externalParticipants: externalList,
        expenseItems: expenseList,
      });

      const payload = {
        title: f.title || undefined,
        planCategory: f.planCategory || undefined,
        refDoc: f.refDoc || undefined,
        goodCodePattern: f.goodCodePattern || undefined,
        region: f.region,
        returnType: f.returnType,
        netPrice: f.netPrice !== '' ? Number(f.netPrice) : undefined,
        validFrom: f.validFrom || undefined,
        validTo: f.validTo || undefined,
        allocatedAmount: f.allocatedAmount !== '' ? Number(f.allocatedAmount) : undefined,
        priority: Number(f.priority) || 100,
        note: f.note || undefined,
        objective: f.objective || undefined,
        detailsJson,
      };

      if (plan) await updateRebatePlan(plan.PlanId, payload);
      else await createRebatePlan(payload);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2 sm:p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[96vw] max-w-5xl h-[92vh] max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50/70 shrink-0">
          <div>
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2" style={{ color: '#0C447C' }}>
              <ClipboardList size={22} />
              {plan ? `แก้ไขแผนงาน: ${plan.PlanNo} — ${plan.Title || ''}` : 'สร้างแผนงานส่งเสริมการขายและงบประมาณประจำปี (Budget Plan)'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              จัดทำข้อเสนอโครงการงบประมาณประจำปี ผู้มีส่วนร่วมภายใน/ภายนอก และรายการประมาณการค่าใช้จ่าย
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Form Navigation Tabs */}
        <div className="px-6 py-2.5 bg-white border-b border-gray-200 flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('info')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all ${
              activeTab === 'info'
                ? 'bg-[#0C447C] text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Layers size={16} /> 1. ข้อมูลโครงการและงบประมาณ
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('participants')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all ${
              activeTab === 'participants'
                ? 'bg-[#0C447C] text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Users size={16} /> 2. ผู้มีส่วนร่วม ({internalList.length + externalList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('expenses')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all ${
              activeTab === 'expenses'
                ? 'bg-[#0C447C] text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <DollarSign size={16} /> 3. ประมาณการค่าใช้จ่าย ({expenseList.length})
          </button>
        </div>

        {/* Tab Content (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {activeTab === 'info' && (
            <div className="space-y-4 max-w-4xl mx-auto bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="ชื่อแผนงาน / โครงการส่งเสริมการขาย *">
                  <input
                    value={f.title}
                    onChange={e => set('title', e.target.value)}
                    placeholder="เช่น โครงการพาลูกค้า VIP สัมมนาต่างประเทศประจำปี 2569"
                    className="inp font-semibold text-gray-800"
                  />
                </Field>

                <Field label="หมวดหมู่งบประมาณ (Budget Category) *">
                  <select
                    value={f.planCategory}
                    onChange={e => set('planCategory', e.target.value)}
                    className="inp font-medium text-[#0C447C]"
                  >
                    {PLAN_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="เลขอ้างอิงโครงการ (Ref Doc)">
                  <input
                    value={f.refDoc}
                    onChange={e => set('refDoc', e.target.value)}
                    placeholder="เช่น WF-VIP-2026/01 หรือ เลขที่มติ"
                    className="inp font-mono"
                  />
                </Field>

                <Field label="เขตการขาย / ภาค">
                  <select value={f.region} onChange={e => set('region', e.target.value)} className="inp">
                    <option value="ALL">ALL (ทุกภาค / ส่วนกลาง)</option>
                    {regionList.map(r => (
                      <option key={r.RegionCode} value={r.RegionCode}>
                        {r.RegionCode} — {r.RegionName}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="วงเงินงบประมาณที่ขออนุมัติ (บาท) *">
                  <input
                    type="number"
                    value={f.allocatedAmount}
                    onChange={e => set('allocatedAmount', e.target.value)}
                    placeholder="เช่น 500000"
                    className="inp font-bold text-emerald-700"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="วันเริ่มต้นโครงการ">
                  <ThaiDatePicker value={f.validFrom} onChange={v => set('validFrom', v)} className="inp" />
                </Field>
                <Field label="วันสิ้นสุดโครงการ">
                  <ThaiDatePicker value={f.validTo} onChange={v => set('validTo', v)} className="inp" />
                </Field>
              </div>

              <Field label="วัตถุประสงค์และรายละเอียดโครงการ (Objective & Scope)">
                <textarea
                  rows={3}
                  value={f.objective}
                  onChange={e => set('objective', e.target.value)}
                  placeholder="ระบุวัตถุประสงค์ เช่น เพื่อตอบแทนร้านค้าตัวแทนจำหน่ายที่ทำยอดขายตามเป้าหมาย หรือเพื่อสร้างความสัมพันธ์อันดีในแต่ละเขตการขาย..."
                  className="inp"
                />
              </Field>

              {/* Advanced optional rebate attributes */}
              <div className="pt-4 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                  ข้อมูลการผูกสูตรสินค้าและสิทธิประโยชน์ (Optional)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">สูตร/สินค้า (เว้นว่าง=ทุกสูตร)</label>
                    <input
                      value={f.goodCodePattern}
                      onChange={e => set('goodCodePattern', e.target.value)}
                      placeholder="เช่น 7-151515 หรือ 15-15-15"
                      className="inp font-mono text-xs mb-1"
                    />
                    {goods.length > 0 && (
                      <SearchableSelect
                        value=""
                        onChange={val => { if (val) set('goodCodePattern', val); }}
                        placeholder="-- เลือกสูตรอ้างอิง --"
                        searchPlaceholder="ค้นหารหัส/ชื่อสินค้า..."
                        options={goods.map(g => ({
                          value: g.GoodCode,
                          label: `${g.GoodCode}${g.GoodName ? ` · ${g.GoodName}` : ''}`,
                        }))}
                      />
                    )}
                  </div>

                  <Field label="ประเภทสิทธิประโยชน์">
                    <select value={f.returnType} onChange={e => set('returnType', e.target.value)} className="inp">
                      <option value="REBATE">คืนรีเบท (Rebate)</option>
                      <option value="PRICEDIFF">คืนส่วนต่าง (Price Diff)</option>
                    </select>
                  </Field>

                  <Field label="ราคา NET อ้างอิง (บาท/ตัน)">
                    <input
                      type="number"
                      value={f.netPrice}
                      onChange={e => set('netPrice', e.target.value)}
                      placeholder="เช่น 15000"
                      className="inp"
                    />
                  </Field>
                </div>
              </div>

              <Field label="หมายเหตุเพิ่มเติม">
                <input
                  value={f.note}
                  onChange={e => set('note', e.target.value)}
                  placeholder="ระบุเงื่อนไขพิเศษหรือข้อกำหนดโครงการเพิ่มเติม"
                  className="inp"
                />
              </Field>
            </div>
          )}

          {activeTab === 'participants' && (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Internal Participants */}
              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                <h3 className="font-bold text-sm text-[#0C447C] mb-2 flex items-center gap-2">
                  <Building size={16} /> ผู้มีส่วนร่วมฝ่าย Internal (พนักงาน / แผนก / เขตการขาย)
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  ระบุทีมงาน พนักงานขาย ผู้จัดการเขต หรือแผนกที่มีส่วนร่วมหรือได้รับสิทธิ์ในโครงการนี้
                </p>

                <div className="flex gap-2 mb-4">
                  <div className="flex-1">
                    <SearchableSelect
                      value={newStaffUser}
                      onChange={setNewStaffUser}
                      placeholder="-- เลือกพนักงานในระบบ --"
                      searchPlaceholder="ค้นหาชื่อพนักงาน..."
                      options={staffUsers.map(u => ({
                        value: String(u.Id),
                        label: `${u.DisplayName} (${u.Role})`,
                        sublabel: u.PositionCode || undefined,
                      }))}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddInternal}
                    className="px-4 py-2 rounded-lg bg-[#0C447C] text-white text-xs font-bold hover:bg-[#093561]"
                  >
                    + เพิ่มพนักงาน
                  </button>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="p-2.5 text-left">ชื่อ-นามสกุล</th>
                        <th className="p-2.5 text-left">สิทธิ์ / บทบาท</th>
                        <th className="p-2.5 text-left">ตำแหน่ง / แผนก</th>
                        <th className="p-2.5 text-center w-16">ลบ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {internalList.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="p-2.5 font-semibold text-gray-800">{item.name}</td>
                          <td className="p-2.5 text-gray-600">{item.role}</td>
                          <td className="p-2.5 text-gray-600">{item.dept}</td>
                          <td className="p-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => setInternalList(prev => prev.filter((_, i) => i !== idx))}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {internalList.length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-4 text-center text-gray-400">
                            ยังไม่มีรายชื่อพนักงาน — เลือกระบุจากเมนูด้านบน
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* External Participants */}
              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                <h3 className="font-bold text-sm text-[#0C447C] mb-2 flex items-center gap-2">
                  <Users size={16} /> ผู้มีส่วนร่วมฝ่าย External (ลูกค้า VIP / ร้านค้าตัวแทน)
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  กรณีเป็นโครงการพาลูกค้า VIP ท่องเที่ยว หรือจัดเลี้ยงสังสรรค์ตัวแทนจำหน่ายในเขต
                </p>

                <div className="flex gap-2 mb-4">
                  <div className="flex-1">
                    <SearchableSelect
                      value={newCustId}
                      onChange={setNewCustId}
                      placeholder="-- เลือกลูกค้าในระบบ --"
                      searchPlaceholder="ค้นหารหัส หรือ ชื่อลูกค้า..."
                      options={customers.map(c => ({
                        value: String(c.CustID),
                        label: `[${c.CustCode || c.CustID}] ${c.CustName}`,
                      }))}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddExternal}
                    className="px-4 py-2 rounded-lg bg-[#0C447C] text-white text-xs font-bold hover:bg-[#093561]"
                  >
                    + เพิ่มลูกค้า
                  </button>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="p-2.5 text-left w-32">รหัสลูกค้า</th>
                        <th className="p-2.5 text-left">ชื่อร้านค้า / ลูกค้า</th>
                        <th className="p-2.5 text-left">หมายเหตุ</th>
                        <th className="p-2.5 text-center w-16">ลบ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {externalList.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="p-2.5 font-mono text-gray-700">{item.custCode}</td>
                          <td className="p-2.5 font-semibold text-gray-800">{item.custName}</td>
                          <td className="p-2.5 text-gray-500">{item.note}</td>
                          <td className="p-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => setExternalList(prev => prev.filter((_, i) => i !== idx))}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {externalList.length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-4 text-center text-gray-400">
                            ยังไม่มีรายชื่อลูกค้าภายนอก — เลือกระบุจากเมนูด้านบน
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'expenses' && (
            <div className="max-w-4xl mx-auto bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-[#0C447C]">ประมาณการค่าใช้จ่ายย่อย (Budget Breakdown)</h3>
                  <p className="text-xs text-gray-500">แจกแจงรายการค่าใช้จ่าย เช่น ค่าเดินทาง, ค่าที่พัก, ค่าอาหาร, ค่าของรางวัล</p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">รวมประมาณการย่อย:</div>
                  <div className="text-base font-bold text-emerald-700">{THB(totalExpenseSum)}</div>
                </div>
              </div>

              {/* Add Expense Row */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-5">
                  <input
                    value={newExpenseItem}
                    onChange={e => setNewExpenseItem(e.target.value)}
                    placeholder="รายการ (เช่น ตั๋วเครื่องบิน/เดินทาง, ค่าอาหารจัดเลี้ยง)"
                    className="inp text-xs"
                  />
                </div>
                <div className="sm:col-span-3">
                  <input
                    type="number"
                    value={newExpenseAmount}
                    onChange={e => setNewExpenseAmount(e.target.value)}
                    placeholder="จำนวนเงิน (บาท)"
                    className="inp text-xs font-bold"
                  />
                </div>
                <div className="sm:col-span-3">
                  <input
                    value={newExpenseNote}
                    onChange={e => setNewExpenseNote(e.target.value)}
                    placeholder="หมายเหตุ (จำนวนคน/วัน)"
                    className="inp text-xs"
                  />
                </div>
                <div className="sm:col-span-1">
                  <button
                    type="button"
                    onClick={handleAddExpense}
                    className="w-full h-full min-h-[32px] rounded-lg bg-[#0C447C] text-white font-bold flex items-center justify-center hover:bg-[#093561]"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {/* Expense Table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="p-2.5 text-center w-12">ลำดับ</th>
                      <th className="p-2.5 text-left">รายการค่าใช้จ่าย</th>
                      <th className="p-2.5 text-left">หมายเหตุ</th>
                      <th className="p-2.5 text-right w-36">จำนวนเงิน (บาท)</th>
                      <th className="p-2.5 text-center w-16">ลบ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {expenseList.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="p-2.5 text-center text-gray-400">{idx + 1}</td>
                        <td className="p-2.5 font-semibold text-gray-800">{item.item}</td>
                        <td className="p-2.5 text-gray-500">{item.note}</td>
                        <td className="p-2.5 text-right font-bold text-gray-900">{THB(item.amount)}</td>
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => setExpenseList(prev => prev.filter((_, i) => i !== idx))}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {expenseList.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-gray-400">
                          ยังไม่มีรายการประมาณการค่าใช้จ่ายย่อย
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {expenseList.length > 0 && (
                    <tfoot className="bg-blue-50/50 font-bold border-t border-gray-200">
                      <tr>
                        <td colSpan={3} className="p-2.5 text-right text-gray-700">รวมประมาณการค่าใช้จ่ายย่อย:</td>
                        <td className="p-2.5 text-right text-[#0C447C]">{THB(totalExpenseSum)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-white flex items-center justify-between shrink-0">
          <div>
            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">{err}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-200 rounded-xl text-xs sm:text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              ยกเลิก
            </button>
            <button
              disabled={busy}
              onClick={submit}
              className="px-6 py-2 rounded-xl text-white text-xs sm:text-sm font-bold disabled:opacity-50 flex items-center gap-2"
              style={{ background: '#0C447C' }}
            >
              {busy ? 'กำลังบันทึก...' : (plan ? 'บันทึกการแก้ไข' : 'สร้างแผนงาน (ร่าง)')}
            </button>
          </div>
        </div>
      </div>
      <style>{`.inp{width:100%;border:1px solid #E5E7EB;border-radius:8px;padding:8px 12px;font-size:13px;outline:none}.inp:focus{border-color:#0C447C}`}</style>
    </div>
  );
}

function AllocateModal({ plan, onClose, onDone }: { plan: RebatePlan; onClose: () => void; onDone: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [salesUserId, setSalesUserId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    listUsers()
      .then(u => setUsers(u.filter(x => ['SALES', 'ADMIN', 'MANAGER', 'C_LEVEL'].includes(x.Role))))
      .catch(console.error);
  }, []);

  async function submit() {
    if (!salesUserId || !amount) { setErr('เลือกพนักงานและกรอกจำนวน'); return; }
    setBusy(true); setErr('');
    try {
      await allocateRebatePlan(plan.PlanId, { salesUserId: Number(salesUserId), amount: Number(amount) });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Coins size={18} /> จัดสรรงบ — {plan.PlanNo}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">พนักงานขาย</label>
            <select
              value={salesUserId}
              onChange={e => setSalesUserId(e.target.value ? Number(e.target.value) : '')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs"
            >
              <option value="">— เลือก —</option>
              {users.map(u => <option key={u.Id} value={u.Id}>{u.DisplayName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">จำนวนเงิน (฿) → Pool เดือนนี้</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs"
            />
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          <button
            disabled={busy}
            onClick={submit}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50"
            style={{ background: '#0C447C' }}
          >
            {busy ? 'กำลังบันทึก...' : 'จัดสรร'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 block mb-1">{label}</label>
      {children}
    </div>
  );
}
