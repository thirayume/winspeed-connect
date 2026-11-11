import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MapPin, UserCheck, FileText, History, RefreshCw, AlertTriangle,
  Plus, Trash2, Edit2, Users, Search, Check, X, ShieldAlert, AlertCircle, FileCheck
} from 'lucide-react';
import {
  fetchRegionCoverage, setUserRegion, removeUserRegion,
  createSaleRegion, updateSaleRegion, deleteSaleRegion,
  fetchRebateCandidates, listUsers,
  fetchNativeApprovers, updateNativeApprover, batchToggleNativeApprovers, fetchNativeApproverHistory,
  fetchRebateDocCodes, setRebateDocCode, autoAssignRebateDocCodes,
  type RegionCoverage, type NativeApprover, type RebateDocCodeRow, type RebateDocCodeEvidence
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import { appConfirm } from '../ui/AppAlert';

const NAVY = '#0C447C';

type ApproverTab = 'regions' | 'native116' | 'rebate-codes' | 'history';

export function ApproverGovernanceView({ initialSubTab }: { initialSubTab?: string }) {
  const sessionUser = useAuthStore(s => s.user);
  const primaryRole = String(sessionUser?.role || '');
  const userRoles = useMemo(() => {
    if (Array.isArray(sessionUser?.roles) && sessionUser.roles.length > 0) return sessionUser.roles;
    return [primaryRole].filter(Boolean);
  }, [sessionUser, primaryRole]);

  const isAdmin = userRoles.includes('ADMIN');
  const isCLevel = userRoles.includes('C_LEVEL');
  const isManager = userRoles.includes('MANAGER');
  const isAccounting = userRoles.includes('ACCOUNTING');

  const canManageRegions = isAdmin || isCLevel || isManager;
  const canManageNative116 = isAdmin || isCLevel;
  const canViewRebateCodes = isAdmin || isCLevel || isManager || isAccounting;
  const canEditRebateCodes = isAdmin || isCLevel;

  const getInitialTab = (): ApproverTab => {
    if (initialSubTab === 'native-approvers' || initialSubTab === 'native116') {
      if (canManageNative116) return 'native116';
    }
    if (initialSubTab === 'rebate-codes' && canViewRebateCodes) return 'rebate-codes';
    if (canManageRegions) return 'regions';
    if (canManageNative116) return 'native116';
    if (canViewRebateCodes) return 'rebate-codes';
    return 'regions';
  };

  const [activeTab, setActiveTab] = useState<ApproverTab>(getInitialTab);

  // ─────────────────────────────────────────────────────────────
  // Tab 1: Regional Rebate Approvers
  // ─────────────────────────────────────────────────────────────
  const [regionRows, setRegionRows] = useState<RegionCoverage[]>([]);
  const [candidates, setCandidates] = useState<{ Id: number; Username: string; DisplayName: string; Role: string; IsActive: boolean }[]>([]);
  const [regionLoading, setRegionLoading] = useState(false);
  const [regionBusy, setRegionBusy] = useState(false);
  const [regionErr, setRegionErr] = useState<string | null>(null);
  const [addForRegion, setAddForRegion] = useState<string | null>(null);
  const [pickedCandidateId, setPickedCandidateId] = useState<string>('');

  // Region Management (Add / Edit / Delete)
  const [createRegionOpen, setCreateRegionOpen] = useState(false);
  const [newRegionCode, setNewRegionCode] = useState('');
  const [newRegionName, setNewRegionName] = useState('');
  const [newRegionDesc, setNewRegionDesc] = useState('');

  const [editRegionOpen, setEditRegionOpen] = useState(false);
  const [editingRegionCode, setEditingRegionCode] = useState('');
  const [editingRegionName, setEditingRegionName] = useState('');
  const [editingRegionDesc, setEditingRegionDesc] = useState('');

  async function handleCreateRegion() {
    if (!newRegionCode.trim() || !newRegionName.trim()) {
      alert('กรุณาระบุรหัสภาคและชื่อภาค');
      return;
    }
    setRegionBusy(true);
    setRegionErr(null);
    try {
      await createSaleRegion({
        regionCode: newRegionCode.trim().toUpperCase(),
        regionName: newRegionName.trim(),
        description: newRegionDesc.trim() || undefined,
      });
      setCreateRegionOpen(false);
      setNewRegionCode('');
      setNewRegionName('');
      setNewRegionDesc('');
      await loadRegions();
    } catch (e: any) {
      setRegionErr(e?.message || 'เพิ่มเขตการขายไม่สำเร็จ');
    } finally {
      setRegionBusy(false);
    }
  }

  async function handleUpdateRegion() {
    if (!editingRegionName.trim()) {
      alert('กรุณาระบุชื่อภาค');
      return;
    }
    setRegionBusy(true);
    setRegionErr(null);
    try {
      await updateSaleRegion(editingRegionCode, {
        regionName: editingRegionName.trim(),
        description: editingRegionDesc.trim() || undefined,
      });
      setEditRegionOpen(false);
      await loadRegions();
    } catch (e: any) {
      setRegionErr(e?.message || 'แก้ไขเขตการขายไม่สำเร็จ');
    } finally {
      setRegionBusy(false);
    }
  }

  async function handleDeleteRegion(code: string, name: string) {
    if (!await appConfirm(`ยืนยันการลบเขตการขาย ${code} (${name})?`)) return;
    setRegionBusy(true);
    setRegionErr(null);
    try {
      await deleteSaleRegion(code);
      await loadRegions();
    } catch (e: any) {
      setRegionErr(e?.message || 'ลบเขตการขายไม่สำเร็จ');
    } finally {
      setRegionBusy(false);
    }
  }

  const loadRegions = useCallback(async () => {
    if (!canManageRegions) return;
    setRegionLoading(true);
    setRegionErr(null);
    try {
      const [cov, cands] = await Promise.all([
        fetchRegionCoverage(),
        fetchRebateCandidates().catch(() => listUsers().catch(() => []) as any)
      ]);
      setRegionRows(cov || []);
      setCandidates((cands || []).filter((u: any) => u.IsActive));
    } catch (e: any) {
      setRegionErr(e?.message || 'โหลดข้อมูลผู้ดูแลภาคไม่สำเร็จ');
    } finally {
      setRegionLoading(false);
    }
  }, [canManageRegions]);

  useEffect(() => {
    if (activeTab === 'regions') loadRegions();
  }, [activeTab, loadRegions]);

  async function handleAssignRegion(regionCode: string) {
    if (!pickedCandidateId) return;
    setRegionBusy(true);
    setRegionErr(null);
    try {
      await setUserRegion({
        userId: Number(pickedCandidateId),
        regionCode,
        isPrimary: true
      });
      setAddForRegion(null);
      setPickedCandidateId('');
      await loadRegions();
    } catch (e: any) {
      if (e?.statusCode === 409) {
        setRegionErr('ข้อมูลผู้ดูแลภาคมีการเปลี่ยนแปลงโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
      } else {
        setRegionErr(e?.message || 'บันทึกผู้ดูแลภาคไม่สำเร็จ');
      }
    } finally {
      setRegionBusy(false);
    }
  }

  async function handleRemoveRegion(userId: number, regionCode: string, name: string) {
    if (!await appConfirm(`ถอด ${name} ออกจากภาค ${regionCode}?\n\nคำขอเคลียร์รีเบทของภาคนี้จะกลับไปให้ผู้จัดการคนใดก็ได้อนุมัติชั้นที่ 2`)) return;
    setRegionBusy(true);
    setRegionErr(null);
    try {
      await removeUserRegion(userId, regionCode);
      await loadRegions();
    } catch (e: any) {
      setRegionErr(e?.message || 'ถอดผู้ดูแลภาคไม่สำเร็จ');
    } finally {
      setRegionBusy(false);
    }
  }

  const regionsGrouped = useMemo(() => {
    const map = new Map<string, { name: string; customers: number; people: RegionCoverage[] }>();
    for (const r of regionRows) {
      const g = map.get(r.RegionCode) || { name: r.RegionName, customers: r.Customers, people: [] };
      if (r.UserId) g.people.push(r);
      map.set(r.RegionCode, g);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [regionRows]);

  const emptyRegions = useMemo(() => regionsGrouped.filter(([, g]) => g.people.length === 0), [regionsGrouped]);

  // ─────────────────────────────────────────────────────────────
  // Tab 2: WinSpeed Native 116 Approvers
  // ─────────────────────────────────────────────────────────────
  const [nativeRows, setNativeRows] = useState<NativeApprover[]>([]);
  const [nativeLoading, setNativeLoading] = useState(false);
  const [nativeErr, setNativeErr] = useState<string | null>(null);
  const [nativeSearch, setNativeSearch] = useState('');
  const [nativeFilter, setNativeFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  // Confirmation toggle modal
  const [confirmToggleTarget, setConfirmToggleTarget] = useState<NativeApprover | null>(null);
  const [toggleNote, setToggleNote] = useState('');
  const [toggleBusy, setToggleBusy] = useState(false);

  // Native 116 Batch selection
  const [selectedNativeEmpIds, setSelectedNativeEmpIds] = useState<Set<number>>(new Set());
  const [batchNativeModalOpen, setBatchNativeModalOpen] = useState(false);
  const [batchNativeAction, setBatchNativeAction] = useState<boolean>(true);
  const [batchNativeNote, setBatchNativeNote] = useState('');
  const [batchNativeBusy, setBatchNativeBusy] = useState(false);

  async function handleExecuteBatchNativeToggle() {
    if (selectedNativeEmpIds.size === 0) return;
    setBatchNativeBusy(true);
    setNativeErr(null);
    try {
      await batchToggleNativeApprovers({
        empIds: Array.from(selectedNativeEmpIds),
        enabled: batchNativeAction,
        note: batchNativeNote.trim() || undefined,
      });
      await loadNativeApprovers();
      setSelectedNativeEmpIds(new Set());
      setBatchNativeModalOpen(false);
      setBatchNativeNote('');
    } catch (e: any) {
      setNativeErr(e?.message || 'บันทึกสถานะแบบกลุ่มไม่สำเร็จ');
    } finally {
      setBatchNativeBusy(false);
    }
  }

  const loadNativeApprovers = useCallback(async () => {
    if (!canManageNative116) return;
    setNativeLoading(true);
    setNativeErr(null);
    try {
      const res = await fetchNativeApprovers();
      setNativeRows(res.data || []);
    } catch (e: any) {
      setNativeErr(e?.message || 'โหลดรายชื่อผู้อนุมัติ WinSpeed ไม่สำเร็จ');
    } finally {
      setNativeLoading(false);
    }
  }, [canManageNative116]);

  useEffect(() => {
    if (activeTab === 'native116') loadNativeApprovers();
  }, [activeTab, loadNativeApprovers]);

  async function executeNativeToggle() {
    if (!confirmToggleTarget) return;
    setToggleBusy(true);
    setNativeErr(null);
    try {
      await updateNativeApprover(confirmToggleTarget.empId, {
        enabled: !confirmToggleTarget.enabled,
        note: toggleNote.trim() || undefined,
        expectedEnabled: confirmToggleTarget.enabled
      });
      setNativeRows(list => list.map(x =>
        x.empId === confirmToggleTarget.empId ? { ...x, listed: true, enabled: !confirmToggleTarget.enabled } : x
      ));
      setConfirmToggleTarget(null);
      setToggleNote('');
    } catch (e: any) {
      if (e?.statusCode === 409) {
        setNativeErr('สถานะของผู้อนุมัติต้นทางถูกเปลี่ยนโดยผู้อื่นแล้ว กรุณารีเฟรชข้อมูล');
      } else {
        setNativeErr(e?.message || 'บันทึกสถานะผู้อนุมัติไม่สำเร็จ');
      }
    } finally {
      setToggleBusy(false);
    }
  }

  const filteredNativeRows = useMemo(() => {
    const q = nativeSearch.trim().toLowerCase();
    return nativeRows.filter(r =>
      (nativeFilter === 'all' || (nativeFilter === 'enabled' ? r.enabled : !r.enabled)) &&
      (!q || r.empCode.toLowerCase().includes(q) || (r.empName || '').toLowerCase().includes(q))
    );
  }, [nativeRows, nativeSearch, nativeFilter]);

  const nativeEnabledCount = useMemo(() => nativeRows.filter(r => r.enabled).length, [nativeRows]);

  // ─────────────────────────────────────────────────────────────
  // Tab 3: Rebate Request Codes (RB Codes)
  // ─────────────────────────────────────────────────────────────
  const [docCodesAssigned, setDocCodesAssigned] = useState<RebateDocCodeRow[]>([]);
  const [docCodesEvidence, setDocCodesEvidence] = useState<RebateDocCodeEvidence[]>([]);
  const [docCodeDrafts, setDocCodeDrafts] = useState<Record<number, string>>({});
  const [docCodesLoading, setDocCodesLoading] = useState(false);
  const [docCodesBusy, setDocCodesBusy] = useState(false);
  const [docCodesMsg, setDocCodesMsg] = useState('');

  const loadDocCodes = useCallback(async () => {
    if (!canViewRebateCodes) return;
    setDocCodesLoading(true);
    setDocCodesMsg('');
    try {
      const d = await fetchRebateDocCodes();
      setDocCodesAssigned(d.assigned || []);
      setDocCodesEvidence(d.evidence || []);
      setDocCodeDrafts(Object.fromEntries((d.assigned || []).map(u => [u.UserId, u.RebateDocCode || ''])));
    } catch (e: any) {
      setDocCodesMsg(e?.message || 'โหลดรหัสผู้ขอรีเบทไม่สำเร็จ');
    } finally {
      setDocCodesLoading(false);
    }
  }, [canViewRebateCodes]);

  useEffect(() => {
    if (activeTab === 'rebate-codes') loadDocCodes();
  }, [activeTab, loadDocCodes]);

  async function handleAutoAssignDocCodes() {
    setDocCodesBusy(true);
    setDocCodesMsg('');
    try {
      const r = await autoAssignRebateDocCodes();
      await loadDocCodes();
      setDocCodesMsg(r.assigned ? `ตั้งรหัสให้ ${r.assigned} คนแล้ว` : 'ทุกคนมีรหัสแล้ว');
    } catch (e: any) {
      setDocCodesMsg(e?.message || 'ตั้งรหัสอัตโนมัติไม่สำเร็จ');
    } finally {
      setDocCodesBusy(false);
    }
  }

  async function handleSaveDocCode(userId: number) {
    setDocCodesBusy(true);
    setDocCodesMsg('');
    try {
      await setRebateDocCode(userId, (docCodeDrafts[userId] || '').trim().toUpperCase() || null);
      await loadDocCodes();
      setDocCodesMsg('บันทึกรหัสสำเร็จ');
    } catch (e: any) {
      setDocCodesMsg(e?.message || 'บันทึกรหัสไม่สำเร็จ');
    } finally {
      setDocCodesBusy(false);
    }
  }

  const waitingDocCodesCount = useMemo(() => {
    if (!canEditRebateCodes) return 0;
    return docCodesAssigned.filter(u => !u.RebateDocCode && u.suggested).length;
  }, [docCodesAssigned, canEditRebateCodes]);

  const getDocCodeHint = (code: string | null) => {
    if (!code) return '';
    if (code.length > 1) return `รหัสใหม่ · ใบแรกเป็น RB${code}<ปี>-001`;
    const top = docCodesEvidence.filter(e => e.SeriesCode === code).sort((a, b) => b.DocCount - a.DocCount)[0];
    return top ? `เดิม ${top.EmpName} ออก ${top.DocCount.toLocaleString()} ใบ` : '';
  };

  // ─────────────────────────────────────────────────────────────
  // Tab 4: Approver History
  // ─────────────────────────────────────────────────────────────
  const [nativeHistory, setNativeHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!canManageNative116) return;
    setHistoryLoading(true);
    setHistoryErr(null);
    try {
      const res = await fetchNativeApproverHistory();
      setNativeHistory(res.data || []);
    } catch (e: any) {
      setHistoryErr(e?.message || 'โหลดประวัติผู้อนุมัติไม่สำเร็จ');
    } finally {
      setHistoryLoading(false);
    }
  }, [canManageNative116]);

  useEffect(() => {
    if (activeTab === 'history') loadHistory();
  }, [activeTab, loadHistory]);

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      {/* Sub-navigation Header */}
      <div className="px-4 py-3 sm:px-6 bg-white border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0 shadow-xs">
        <div className="flex items-center gap-2 overflow-x-auto">
          {canManageRegions && (
            <button
              type="button"
              onClick={() => setActiveTab('regions')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'regions'
                  ? 'bg-[#0C447C] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              <MapPin size={15} />
              <span>ผู้อนุมัติรายภาค</span>
              {emptyRegions.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-amber-950">
                  {emptyRegions.length}
                </span>
              )}
            </button>
          )}

          {canManageNative116 && (
            <button
              type="button"
              onClick={() => setActiveTab('native116')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'native116'
                  ? 'bg-[#0C447C] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserCheck size={15} />
              <span>ผู้อนุมัติ WinSpeed</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700">
                {nativeEnabledCount}
              </span>
            </button>
          )}

          {canViewRebateCodes && (
            <button
              type="button"
              onClick={() => setActiveTab('rebate-codes')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'rebate-codes'
                  ? 'bg-[#0C447C] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileCheck size={15} />
              <span>รหัสผู้ขอรีเบท (RB Codes)</span>
              {waitingDocCodesCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-blue-400 text-blue-950 font-black">
                  {waitingDocCodesCount}
                </span>
              )}
            </button>
          )}

          {canManageNative116 && (
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'history'
                  ? 'bg-[#0C447C] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              <History size={15} />
              <span>ประวัติผู้อนุมัติ</span>
            </button>
          )}
        </div>

        {/* Global Refresh for current tab */}
        <div className="flex items-center gap-2 self-end md:self-auto">
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'regions') loadRegions();
              else if (activeTab === 'native116') loadNativeApprovers();
              else if (activeTab === 'rebate-codes') loadDocCodes();
              else if (activeTab === 'history') loadHistory();
            }}
            disabled={regionLoading || nativeLoading || docCodesLoading || historyLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={regionLoading || nativeLoading || docCodesLoading || historyLoading ? 'animate-spin' : ''}
            />
            <span>รีเฟรช</span>
          </button>
        </div>
      </div>

      {/* Main Tab Views */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* ── TAB 1: REGIONAL REBATE APPROVERS ──────────────── */}
        {activeTab === 'regions' && (
          <div className="w-full space-y-4">
            {/* Context Notice */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-blue-950 flex items-start gap-2.5">
              <MapPin size={17} className="text-[#0C447C] shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-[#0C447C]">ผู้อนุมัติชั้นที่ 2 ของใบขอเคลียร์รีเบท:</span> แบ่งตามภาคของลูกค้าที่ผูกไว้ในระบบ
                <div className="text-blue-800 mt-1">
                  การผูกภาคจะบันทึกลง <code>wf.UserSaleArea</code> และมีการบันทึกประวัติการเปลี่ยนแปลงพร้อม actor ตรวจสอบได้
                </div>
              </div>
            </div>

            {emptyRegions.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950 flex items-start gap-2.5">
                <AlertTriangle size={17} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">ยังไม่มีผู้อนุมัติ {emptyRegions.length} ภาค:</span>{' '}
                  {emptyRegions.map(([c, g]) => `${c} ${g.name}`).join(' · ')}
                  <div className="text-amber-800 mt-1">
                    ภาคเหล่านี้จะตกไปให้ผู้จัดการคนใดก็ได้อนุมัติชั้นที่ 2 จึงควรผูกผู้รับผิดชอบพื้นที่จริงให้ครบถ้วน
                  </div>
                </div>
              </div>
            )}

            {regionErr && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
                <span>{regionErr}</span>
                <button type="button" onClick={() => setRegionErr(null)} className="text-rose-500">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Regions List Header with Add Region Button */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500 font-semibold">
                เขตการขายทั้งหมด {regionsGrouped.length} ภาค
              </div>
              {canManageRegions && (
                <button
                  type="button"
                  onClick={() => {
                    setNewRegionCode('');
                    setNewRegionName('');
                    setNewRegionDesc('');
                    setCreateRegionOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#0C447C] text-white hover:bg-[#0A3866] transition shadow-xs"
                >
                  <Plus size={14} /> เพิ่มเขตการขายใหม่
                </button>
              )}
            </div>

            {/* Regions List */}
            <div className="space-y-3">
              {regionsGrouped.map(([code, g]) => (
                <div key={code} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          {code}
                        </span>
                        <h4 className="font-bold text-slate-900 text-base">{g.name}</h4>
                        {canManageRegions && (
                          <div className="flex items-center gap-1 ml-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRegionCode(code);
                                setEditingRegionName(g.name);
                                setEditingRegionDesc('');
                                setEditRegionOpen(true);
                              }}
                              className="p-1 rounded-md text-slate-400 hover:text-[#0C447C] hover:bg-slate-100 transition"
                              title="แก้ไขชื่อเขตการขาย"
                            >
                              <Edit2 size={13} />
                            </button>
                            {g.people.length === 0 && (
                              <button
                                type="button"
                                onClick={() => handleDeleteRegion(code, g.name)}
                                className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                                title="ลบเขตการขายนี้"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                        <Users size={12} /> ลูกค้า {g.customers.toLocaleString()} ราย
                      </div>
                    </div>

                    {addForRegion === code ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={pickedCandidateId}
                          onChange={e => setPickedCandidateId(e.target.value)}
                          className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white text-slate-800 max-w-xs"
                        >
                          <option value="">-- เลือกผู้ใช้เพื่อเป็นผู้อนุมัติ --</option>
                          {candidates.map(u => (
                            <option key={u.Id} value={u.Id}>
                              {u.DisplayName || u.Username} ({u.Role})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleAssignRegion(code)}
                          disabled={regionBusy || !pickedCandidateId}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0C447C] text-white disabled:opacity-40"
                        >
                          บันทึก
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddForRegion(null); setPickedCandidateId(''); }}
                          className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setAddForRegion(code); setPickedCandidateId(''); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 self-start sm:self-center"
                      >
                        <Plus size={14} /> เพิ่มผู้อนุมัติ
                      </button>
                    )}
                  </div>

                  {/* People in this region */}
                  <div className="mt-3.5 space-y-2">
                    {g.people.length === 0 ? (
                      <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 flex items-center gap-2">
                        <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                        <span>ยังไม่มีผู้ดูแลภาคนี้ — คำขอเคลียร์รีเบทจะตกให้ผู้จัดการคนใดก็ได้</span>
                      </div>
                    ) : (
                      g.people.map(p => (
                        <div
                          key={p.UserId}
                          className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-[10px]">
                              {(p.DisplayName || p.Username || '?').slice(0, 1)}
                            </span>
                            <span className="font-bold text-slate-900">{p.DisplayName || p.Username}</span>
                            <span className="text-[11px] text-slate-400 font-mono">@{p.Username} · {p.Role}</span>
                            {p.IsPrimary && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                หลัก
                              </span>
                            )}
                            {!p.IsActive && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                บัญชีปิดใช้งาน
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveRegion(p.UserId!, code, p.DisplayName || p.Username || '')}
                            disabled={regionBusy}
                            className="p-1 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                            title="ถอดออกจากภาคนี้"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TAB 2: NATIVE 116 APPROVERS ──────────────────── */}
        {activeTab === 'native116' && (
          <div className="w-full space-y-4">
            {/* Notice */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs text-xs text-slate-600 space-y-1">
              <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                <UserCheck size={16} className="text-[#0C447C]" />
                <span>รายชื่อผู้อนุมัติเอกสาร WinSpeed ใบตัดตั๋วปุ๋ย (116) ผ่าน Sale-App</span>
              </div>
              <p>
                ผู้อนุมัติคำขอใบตัดตั๋วปุ๋ย (116) ต้องเป็นพนักงานที่มีสถานะ <b>"ใช้อนุมัติได้"</b> ในรายการนี้ ·
                ข้อมูลพนักงานอ่านจาก WinSpeed (<code>dbo.EMEmp</code>) · การเปิด/ปิดใช้อนุมัติในหน้านี้<b>ไม่ได้ลบข้อมูลพนักงานใน WinSpeed</b>
              </p>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-64">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={nativeSearch}
                    onChange={e => setNativeSearch(e.target.value)}
                    placeholder="ค้นหารหัสหรือชื่อพนักงาน..."
                    className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-2.5 text-xs bg-white text-slate-800 focus:outline-hidden focus:border-[#0C447C]"
                  />
                </div>
                {(['all', 'enabled', 'disabled'] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setNativeFilter(f)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold border transition-all ${
                      nativeFilter === f
                        ? 'border-[#0C447C] bg-[#0C447C] text-white'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {f === 'all' ? 'ทั้งหมด' : f === 'enabled' ? 'ใช้อนุมัติได้' : 'ปิดไว้'}
                  </button>
                ))}
              </div>

              <div className="text-xs text-slate-500 font-medium">
                ทั้งหมด {nativeRows.length} · ใช้อนุมัติได้ {nativeEnabledCount} · ปิดไว้ {nativeRows.length - nativeEnabledCount}
              </div>
            </div>

            {nativeErr && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between">
                <span>{nativeErr}</span>
                <button type="button" onClick={() => setNativeErr(null)} className="text-rose-500">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Batch actions bar for Native Approvers */}
            {selectedNativeEmpIds.size > 0 && (
              <div className="bg-[#0C447C] text-white px-4 py-2.5 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-md animate-in slide-in-from-top-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold bg-white/20 px-2.5 py-0.5 rounded-full">
                    เลือก {selectedNativeEmpIds.size} ท่าน
                  </span>
                  <span>จากทั้งหมด {filteredNativeRows.length} รายการ</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBatchNativeAction(true);
                      setBatchNativeNote('');
                      setBatchNativeModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500 text-white rounded-lg text-xs font-bold hover:bg-emerald-600 transition shadow-xs"
                  >
                    <Check size={13} /> เปิดใช้อนุมัติ ({selectedNativeEmpIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBatchNativeAction(false);
                      setBatchNativeNote('');
                      setBatchNativeModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 transition shadow-xs"
                  >
                    <X size={13} /> ปิดการใช้อนุมัติ ({selectedNativeEmpIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedNativeEmpIds(new Set())}
                    className="text-xs text-white/70 hover:text-white px-2 py-1"
                  >
                    ยกเลิกการเลือก
                  </button>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
                    <th className="px-3 py-2.5 text-center w-10">
                      <input
                        type="checkbox"
                        checked={filteredNativeRows.length > 0 && filteredNativeRows.every(r => selectedNativeEmpIds.has(r.empId))}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedNativeEmpIds(new Set(filteredNativeRows.map(r => r.empId)));
                          } else {
                            setSelectedNativeEmpIds(new Set());
                          }
                        }}
                        className="rounded border-slate-300 text-[#0C447C] focus:ring-[#0C447C]"
                      />
                    </th>
                    <th className="px-3.5 py-2.5 text-left">รหัสพนักงาน</th>
                    <th className="px-3.5 py-2.5 text-left">ชื่อพนักงาน</th>
                    <th className="px-3.5 py-2.5 text-center">ประเภท</th>
                    <th className="px-3.5 py-2.5 text-center">สถานะ WinSpeed</th>
                    <th className="px-3.5 py-2.5 text-center">บัญชีแอป</th>
                    <th className="px-3.5 py-2.5 text-center">เคยอนุมัติ</th>
                    <th className="px-3.5 py-2.5 text-center">สถานะ Sale-App</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredNativeRows.map(r => (
                    <tr key={r.empId} className={`hover:bg-slate-50/70 ${!r.enabled ? 'bg-slate-50/40 opacity-70' : ''}`}>
                      <td className="px-3 py-2 text-center w-10">
                        <input
                          type="checkbox"
                          checked={selectedNativeEmpIds.has(r.empId)}
                          onChange={() => {
                            const next = new Set(selectedNativeEmpIds);
                            if (next.has(r.empId)) next.delete(r.empId);
                            else next.add(r.empId);
                            setSelectedNativeEmpIds(next);
                          }}
                          className="rounded border-slate-300 text-[#0C447C] focus:ring-[#0C447C]"
                        />
                      </td>
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-800">{r.empCode}</td>
                      <td className="px-3.5 py-2 font-medium text-slate-900">{r.empName}</td>
                      <td className="px-3.5 py-2 text-center text-slate-500">{r.empType || '–'}</td>
                      <td className="px-3.5 py-2 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700">
                          {r.empStatus || '–'}
                        </span>
                      </td>
                      <td className="px-3.5 py-2 text-center text-slate-600">{r.appUserCount || '–'}</td>
                      <td className="px-3.5 py-2 text-center text-slate-600">{r.approvalCount || '–'}</td>
                      <td className="px-3.5 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmToggleTarget(r);
                            setToggleNote('');
                          }}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                            r.enabled
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${r.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          <span>{r.enabled ? 'เปิดใช้อนุมัติ' : 'ปิดการใช้อนุมัติ'}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredNativeRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                        ไม่พบพนักงานตรงตามเงื่อนไข
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 3: REBATE REQUEST CODES (RB CODES) ────────── */}
        {activeTab === 'rebate-codes' && (
          <div className="w-full space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-5">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FileCheck size={18} className="text-[#0C447C]" />
                รหัสผู้ขอใช้รีเบทบนเลขที่เอกสาร RB
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                เลขที่เอกสารคืนรีเบทใน WinSpeed คือ <code>RB&lt;รหัส&gt;&lt;ปี พ.ศ.&gt;-&lt;ลำดับ&gt;</code> เช่น <code>RBD68-049</code> ·
                WinSpeed ไม่ได้บันทึก EmpID ผู้ขอ รหัสอักษร 1–2 ตัวนี้จึงเป็นหลักฐานเดียวที่ผูกกับบัญชีผู้ใช้
              </p>

              {waitingDocCodesCount > 0 && canEditRebateCodes && (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleAutoAssignDocCodes}
                    disabled={docCodesBusy}
                    className="px-4 py-2 text-xs rounded-xl text-white font-bold bg-[#0C447C] hover:bg-[#0A3866] disabled:opacity-50"
                  >
                    ตั้งรหัสอัตโนมัติให้ {waitingDocCodesCount} คนที่ยังไม่มี
                  </button>
                </div>
              )}

              {docCodesMsg && (
                <div className="mt-3 text-xs p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
                  {docCodesMsg}
                </div>
              )}

              <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <tr className="text-left">
                      <th className="px-3.5 py-2.5">ผู้ใช้งาน</th>
                      <th className="px-3.5 py-2.5">บทบาท</th>
                      <th className="px-3.5 py-2.5 w-32">รหัสอักษร</th>
                      <th className="px-3.5 py-2.5">หลักฐานจากเอกสารเดิม</th>
                      <th className="px-3.5 py-2.5 text-right w-24">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {docCodesAssigned.map(u => (
                      <tr key={u.UserId} className="hover:bg-slate-50/70">
                        <td className="px-3.5 py-2">
                          <span className="font-semibold text-slate-900">{u.DisplayName || u.Username}</span>
                          <span className="text-[10px] text-slate-400 font-mono ml-2">@{u.Username}</span>
                        </td>
                        <td className="px-3.5 py-2 text-slate-500">{u.Role}</td>
                        <td className="px-3.5 py-2">
                          <input
                            type="text"
                            value={docCodeDrafts[u.UserId] ?? ''}
                            maxLength={2}
                            disabled={!canEditRebateCodes}
                            onChange={e => setDocCodeDrafts({ ...docCodeDrafts, [u.UserId]: e.target.value.toUpperCase() })}
                            placeholder="—"
                            className="w-16 border border-slate-300 rounded px-2 py-1 text-center font-mono font-bold uppercase tracking-widest text-xs bg-white text-slate-800 disabled:bg-slate-100"
                          />
                        </td>
                        <td className="px-3.5 py-2 text-slate-500">
                          {u.RebateDocCode ? (
                            <span>{getDocCodeHint(docCodeDrafts[u.UserId] || u.RebateDocCode)}</span>
                          ) : u.suggested && canEditRebateCodes ? (
                            <button
                              type="button"
                              onClick={() => setDocCodeDrafts({ ...docCodeDrafts, [u.UserId]: u.suggested! })}
                              className="text-blue-600 hover:underline"
                            >
                              เสนอ {u.suggested} ({u.suggestedSource === 'HISTORY' ? 'อักษรเดิมใน WinSpeed' : 'จากชื่อ'})
                            </button>
                          ) : (
                            <span className="text-slate-400">ยังไม่มีรหัส</span>
                          )}
                        </td>
                        <td className="px-3.5 py-2 text-right">
                          {canEditRebateCodes && (docCodeDrafts[u.UserId] ?? '') !== (u.RebateDocCode ?? '') && (
                            <button
                              type="button"
                              onClick={() => handleSaveDocCode(u.UserId)}
                              disabled={docCodesBusy}
                              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-[#0C447C] text-white disabled:opacity-40"
                            >
                              บันทึก
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {docCodesAssigned.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                          ไม่มีผู้ใช้ที่ต้องตั้งรหัส
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 4: APPROVER HISTORY ──────────────────────── */}
        {activeTab === 'history' && (
          <div className="w-full space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-5">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-3">
                <History size={18} className="text-[#0C447C]" />
                ประวัติการเปิด/ปิดผู้อนุมัติเอกสาร WinSpeed ใบ 116 (ล่าสุด 100 รายการ)
              </h3>

              {historyErr && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 mb-3">
                  {historyErr}
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <tr className="text-left">
                      <th className="px-3.5 py-2.5">เวลา</th>
                      <th className="px-3.5 py-2.5">พนักงาน WinSpeed</th>
                      <th className="px-3.5 py-2.5">คำสั่ง</th>
                      <th className="px-3.5 py-2.5">ผู้ทำรายการ</th>
                      <th className="px-3.5 py-2.5">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {nativeHistory.map(h => (
                      <tr key={h.Id} className="hover:bg-slate-50/70">
                        <td className="px-3.5 py-2 font-mono text-slate-500 whitespace-nowrap">
                          {new Date(h.CreatedAt).toLocaleString('th-TH')}
                        </td>
                        <td className="px-3.5 py-2">
                          <span className="font-semibold text-slate-900">{h.EmpName}</span>
                          <span className="text-[10px] text-slate-400 font-mono ml-1.5">[{h.EmpCode}]</span>
                        </td>
                        <td className="px-3.5 py-2">
                          {h.IsEnabled ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              เปิดใช้อนุมัติ
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                              ปิดใช้อนุมัติ
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2 text-slate-700">
                          <div>{h.ChangedByName || '–'}</div>
                          {h.ChangedByActorName && h.ChangedByActorName !== h.ChangedByName && (
                            <div className="text-[10px] text-slate-400">(Actor: {h.ChangedByActorName})</div>
                          )}
                        </td>
                        <td className="px-3.5 py-2 text-slate-500">{h.Note || '–'}</td>
                      </tr>
                    ))}
                    {nativeHistory.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                          ยังไม่มีประวัติการเปลี่ยนแปลง
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Native Approver Toggle */}
      {confirmToggleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldAlert size={18} className="text-[#0C447C]" />
                ยืนยันการเปลี่ยนสถานะผู้อนุมัติ WinSpeed
              </h3>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <div>พนักงาน: <strong>{confirmToggleTarget.empName}</strong> ({confirmToggleTarget.empCode})</div>
                <div>
                  สถานะเดิม: <strong>{confirmToggleTarget.enabled ? 'เปิดใช้อนุมัติ' : 'ปิดใช้อนุมัติ'}</strong> →
                  สถานะใหม่: <strong className={!confirmToggleTarget.enabled ? 'text-emerald-700' : 'text-rose-700'}>
                    {!confirmToggleTarget.enabled ? 'เปิดใช้อนุมัติผ่าน Sale-App' : 'ปิดใช้อนุมัติผ่าน Sale-App'}
                  </strong>
                </div>
              </div>

              <p className="text-slate-600">
                ℹ️ ข้อมูลพนักงานในโปรแกรม WinSpeed ไม่ได้ถูกลบหรือแก้ไข การตั้งค่านี้มีผลเฉพาะสิทธิ์การเป็นผู้อนุมัติใบตัดตั๋ว (116) ในระบบ Sale-App เท่านั้น
              </p>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  หมายเหตุ / เหตุผล (ระบุหรือไม่ก็ได้):
                </label>
                <input
                  type="text"
                  maxLength={255}
                  value={toggleNote}
                  onChange={e => setToggleNote(e.target.value)}
                  placeholder="เช่น ปรับเปลี่ยนตามคำสั่งฝ่ายบุคคล..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white text-slate-800 focus:outline-hidden focus:border-[#0C447C]"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmToggleTarget(null)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={executeNativeToggle}
                disabled={toggleBusy}
                className={`px-4 py-2 text-xs font-bold rounded-xl text-white ${
                  !confirmToggleTarget.enabled ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                } disabled:opacity-50`}
              >
                {toggleBusy ? 'กำลังบันทึก...' : !confirmToggleTarget.enabled ? 'ยืนยันเปิดใช้อนุมัติ' : 'ยืนยันปิดใช้อนุมัติ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Batch Native Approver Toggle */}
      {batchNativeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldAlert size={18} className="text-[#0C447C]" />
                {batchNativeAction ? 'เปิดใช้อนุมัติแบบชุด' : 'ปิดการใช้อนุมัติแบบชุด'}
              </h3>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>จำนวนพนักงานที่เลือก: <strong className="text-sm font-bold text-[#0C447C]">{selectedNativeEmpIds.size} ท่าน</strong></div>
                <div className="mt-1">
                  คำสั่ง: <strong className={batchNativeAction ? 'text-emerald-700' : 'text-rose-700'}>
                    {batchNativeAction ? 'เปิดใช้อนุมัติใบตัดตั๋ว (116) ผ่าน Sale-App' : 'ปิดการใช้อนุมัติใบตัดตั๋ว (116) ผ่าน Sale-App'}
                  </strong>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  หมายเหตุ / เหตุผลบันทึกประวัติ (ระบุหรือไม่ก็ได้):
                </label>
                <input
                  type="text"
                  maxLength={255}
                  value={batchNativeNote}
                  onChange={e => setBatchNativeNote(e.target.value)}
                  placeholder="เช่น มอบหมายหน้าที่อนุมัติตามโครงสร้างใหม่..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white text-slate-800 focus:outline-hidden focus:border-[#0C447C]"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBatchNativeModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleExecuteBatchNativeToggle}
                disabled={batchNativeBusy}
                className={`px-4 py-2 text-xs font-bold rounded-xl text-white ${
                  batchNativeAction ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                } disabled:opacity-50`}
              >
                {batchNativeBusy ? 'กำลังบันทึก...' : `ยืนยัน (${selectedNativeEmpIds.size} ท่าน)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Region */}
      {createRegionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Plus size={18} className="text-[#0C447C]" />
                เพิ่มเขตการขายใหม่
              </h3>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  รหัสเขต/ภาค (RegionCode) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={10}
                  value={newRegionCode}
                  onChange={e => setNewRegionCode(e.target.value.toUpperCase())}
                  placeholder="เช่น 07, 17, PT01..."
                  className="w-full font-mono rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white text-slate-800 focus:outline-hidden focus:border-[#0C447C]"
                />
                <span className="text-[10px] text-slate-400">ควรตรงกับ 2 หลักแรกของรหัสเขตใน WinSpeed (EMSaleArea)</span>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  ชื่อเขตการขาย (RegionName) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={newRegionName}
                  onChange={e => setNewRegionName(e.target.value)}
                  placeholder="เช่น ภาคอีสานเหนือ, เขตเฉพาะกิจ..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white text-slate-800 focus:outline-hidden focus:border-[#0C447C]"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  คำอธิบายเพิ่มเติม:
                </label>
                <input
                  type="text"
                  maxLength={255}
                  value={newRegionDesc}
                  onChange={e => setNewRegionDesc(e.target.value)}
                  placeholder="รายละเอียดเขตหรือพื้นที่ครอบคลุม..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white text-slate-800 focus:outline-hidden focus:border-[#0C447C]"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateRegionOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleCreateRegion}
                disabled={regionBusy || !newRegionCode.trim() || !newRegionName.trim()}
                className="px-4 py-2 text-xs font-bold rounded-xl text-white bg-[#0C447C] hover:bg-[#0A3866] disabled:opacity-50"
              >
                {regionBusy ? 'กำลังบันทึก...' : 'บันทึกเขตการขาย'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Region */}
      {editRegionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Edit2 size={18} className="text-[#0C447C]" />
                แก้ไขเขตการขาย: {editingRegionCode}
              </h3>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  ชื่อเขตการขาย (RegionName) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={editingRegionName}
                  onChange={e => setEditingRegionName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white text-slate-800 focus:outline-hidden focus:border-[#0C447C]"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  คำอธิบายเพิ่มเติม:
                </label>
                <input
                  type="text"
                  maxLength={255}
                  value={editingRegionDesc}
                  onChange={e => setEditingRegionDesc(e.target.value)}
                  placeholder="รายละเอียดเขตหรือพื้นที่ครอบคลุม..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white text-slate-800 focus:outline-hidden focus:border-[#0C447C]"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditRegionOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleUpdateRegion}
                disabled={regionBusy || !editingRegionName.trim()}
                className="px-4 py-2 text-xs font-bold rounded-xl text-white bg-[#0C447C] hover:bg-[#0A3866] disabled:opacity-50"
              >
                {regionBusy ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
