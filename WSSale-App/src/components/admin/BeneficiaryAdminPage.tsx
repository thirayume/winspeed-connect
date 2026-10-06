import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, Search, Plus, Trash2, Check, AlertTriangle,
  Ticket, RefreshCw, X, Calendar, ArrowRight, ShieldCheck
} from 'lucide-react';
import {
  fetchCustomers,
  fetchCouponBeneficiaries,
  grantCouponBeneficiary,
  revokeCouponBeneficiary
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { EMCust } from '../../types';

export interface CouponBeneficiary {
  Id: number;
  OwnerCustId: string;
  OwnerCustCode: string | null;
  OwnerCustName: string | null;
  BeneficiaryCustId: string;
  BeneficiaryCustCode: string | null;
  BeneficiaryCustName: string | null;
  EffectiveFrom: string | null;
  EffectiveTo: string | null;
  Scope: string;
  Reason: string;
  Status: 'ACTIVE' | 'REVOKED';
  CreatedBy: number;
  CreatedAt: string;
  UpdatedAt: string | null;
  RevokedAt: string | null;
  RevokedBy: number | null;
  RevokeReason: string | null;
}

export const BeneficiaryAdminPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role || '';
  const isAuthorized = ['ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'].includes(userRole);

  // Data states
  const [grants, setGrants] = useState<CouponBeneficiary[]>([]);
  const [loadingGrants, setLoadingGrants] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'REVOKED'>('ACTIVE');
  const [tableSearch, setTableSearch] = useState('');

  // Grant Form states
  const [rootQuery, setRootQuery] = useState('');
  const [rootResults, setRootResults] = useState<EMCust[]>([]);
  const [searchingRoot, setSearchingRoot] = useState(false);
  const [selectedRoot, setSelectedRoot] = useState<EMCust | null>(null);

  const [suggestedMembers, setSuggestedMembers] = useState<EMCust[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<EMCust[]>([]);
  const [searchingMember, setSearchingMember] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());

  const [grantReason, setGrantReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [submittingGrant, setSubmittingGrant] = useState(false);

  // Revoke Modal state
  const [revokeTarget, setRevokeTarget] = useState<CouponBeneficiary | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [submittingRevoke, setSubmittingRevoke] = useState(false);

  // Alert / Message toast
  const [alertInfo, setAlertInfo] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showAlert = (type: 'success' | 'error', message: string) => {
    setAlertInfo({ type, message });
    setTimeout(() => {
      setAlertInfo(null);
    }, 6000);
  };

  // Load grants
  const loadGrants = async () => {
    setLoadingGrants(true);
    try {
      const data = await fetchCouponBeneficiaries();
      setGrants(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('[BeneficiaryAdminPage] loadGrants failed:', err);
      showAlert('error', err.message || 'ไม่สามารถโหลดรายการสิทธิ์ตั๋วร่วมได้');
    } finally {
      setLoadingGrants(false);
    }
  };

  useEffect(() => {
    if (isAuthorized) {
      loadGrants();
    }
  }, [isAuthorized]);

  // Search Root Customer
  useEffect(() => {
    if (!rootQuery.trim() || rootQuery.length < 2) {
      setRootResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingRoot(true);
      try {
        const res = await fetchCustomers({ q: rootQuery.trim(), limit: 10 });
        setRootResults(Array.isArray(res) ? res : []);
      } catch (e) {
        console.error(e);
      } finally {
        setSearchingRoot(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [rootQuery]);

  // When Root is selected, look for prefix-matching suggested members
  useEffect(() => {
    if (!selectedRoot) {
      setSuggestedMembers([]);
      setSelectedMemberIds(new Set());
      return;
    }
    const baseCode = (selectedRoot.CustCode || '').split('-')[0].trim();
    if (!baseCode) return;

    fetchCustomers({ q: `${baseCode}-`, limit: 50 })
      .then((res) => {
        const list = Array.isArray(res) ? res : [];
        // Filter out the root itself
        const filtered = list.filter((c) => String(c.CustID) !== String(selectedRoot.CustID));
        setSuggestedMembers(filtered);
      })
      .catch((e) => console.error(e));
  }, [selectedRoot]);

  // Search additional Member Customers
  useEffect(() => {
    if (!memberQuery.trim() || memberQuery.length < 2) {
      setMemberResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingMember(true);
      try {
        const res = await fetchCustomers({ q: memberQuery.trim(), limit: 15 });
        const list = Array.isArray(res) ? res : [];
        // Filter out selected root
        setMemberResults(list.filter((c) => String(c.CustID) !== String(selectedRoot?.CustID)));
      } catch (e) {
        console.error(e);
      } finally {
        setSearchingMember(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [memberQuery, selectedRoot]);

  const toggleMemberSelection = (custId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(custId)) {
        next.delete(custId);
      } else {
        next.add(custId);
      }
      return next;
    });
  };

  // Submit Grants
  const handleGrantSubmit = async () => {
    if (!selectedRoot) {
      showAlert('error', 'กรุณาเลือกลูกค้าเจ้าของตั๋ว (Root Customer)');
      return;
    }
    if (selectedMemberIds.size === 0) {
      showAlert('error', 'กรุณาเลือกลูกค้าสมาชิกอย่างน้อย 1 ราย');
      return;
    }
    if (!grantReason.trim() || grantReason.trim().length < 5) {
      showAlert('error', 'กรุณาระบุเหตุผลการมอบสิทธิ์อย่างน้อย 5 ตัวอักษร');
      return;
    }

    setSubmittingGrant(true);
    let successCount = 0;
    const errors: string[] = [];

    for (const benId of Array.from(selectedMemberIds)) {
      try {
        await grantCouponBeneficiary({
          ownerCustId: String(selectedRoot.CustID),
          beneficiaryCustId: String(benId),
          reason: grantReason.trim(),
          effectiveFrom: effectiveFrom || undefined,
          effectiveTo: effectiveTo || undefined
        });
        successCount++;
      } catch (err: any) {
        errors.push(`ลูกค้า #${benId}: ${err.message || 'มอบสิทธิ์ไม่สำเร็จ'}`);
      }
    }

    setSubmittingGrant(false);

    if (successCount > 0) {
      showAlert('success', `มอบสิทธิ์สำเร็จ ${successCount} รายการ${errors.length > 0 ? ` (ไม่สำเร็จ ${errors.length} รายการ)` : ''}`);
      setSelectedMemberIds(new Set());
      setGrantReason('');
      loadGrants();
    }
    if (errors.length > 0 && successCount === 0) {
      showAlert('error', errors.join(' | '));
    }
  };

  // Submit Revoke
  const handleRevokeConfirm = async () => {
    if (!revokeTarget) return;
    if (!revokeReason.trim() || revokeReason.trim().length < 3) {
      showAlert('error', 'กรุณาระบุเหตุผลในการถอนสิทธิ์อย่างน้อย 3 ตัวอักษร');
      return;
    }

    setSubmittingRevoke(true);
    try {
      await revokeCouponBeneficiary(revokeTarget.Id, revokeReason.trim());
      showAlert('success', `ถอนสิทธิ์รายการ #${revokeTarget.Id} สำเร็จ`);
      setRevokeTarget(null);
      setRevokeReason('');
      loadGrants();
    } catch (err: any) {
      console.error(err);
      showAlert('error', err.message || 'ถอนสิทธิ์ไม่สำเร็จ');
    } finally {
      setSubmittingRevoke(false);
    }
  };

  // Filtered grants for table
  const filteredGrants = useMemo(() => {
    return grants.filter((g) => {
      if (statusFilter !== 'ALL' && g.Status !== statusFilter) return false;
      if (tableSearch.trim()) {
        const q = tableSearch.toLowerCase();
        const matchOwner = (g.OwnerCustName || '').toLowerCase().includes(q) || (g.OwnerCustCode || '').toLowerCase().includes(q);
        const matchBen = (g.BeneficiaryCustName || '').toLowerCase().includes(q) || (g.BeneficiaryCustCode || '').toLowerCase().includes(q);
        const matchReason = (g.Reason || '').toLowerCase().includes(q);
        const matchId = String(g.Id).includes(q);
        if (!matchOwner && !matchBen && !matchReason && !matchId) return false;
      }
      return true;
    });
  }, [grants, statusFilter, tableSearch]);

  if (!isAuthorized) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-amber-500 mb-3" />
        <h2 className="text-lg font-bold text-gray-800">ไม่มีสิทธิ์เข้าถึงหน้านี้</h2>
        <p className="text-sm text-gray-600 mt-1">
          หน้านี้สงวนไว้สำหรับผู้ดูแลระบบและฝ่ายบัญชี (ADMIN, MANAGER, C_LEVEL, ACCOUNTING) เท่านั้น
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Ticket className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">จัดการสิทธิ์ตั๋วร่วม (Shared Ticket Beneficiaries)</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            กำหนดและถอนสิทธิ์การใช้ตั๋วร่วมข้ามลูกค้าระหว่างแม่และสมาชิก (Root → Members) ตามนโยบายสหกรณ์
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadGrants}
            disabled={loadingGrants}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-white hover:bg-slate-50 text-gray-700 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingGrants ? 'animate-spin text-blue-600' : ''}`} />
            รีเฟรชข้อมูล
          </button>
        </div>
      </div>

      {/* Alert Notification */}
      {alertInfo && (
        <div
          className={`p-3 rounded-lg flex items-center justify-between text-xs font-medium transition ${
            alertInfo.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {alertInfo.type === 'success' ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span>{alertInfo.message}</span>
          </div>
          <button onClick={() => setAlertInfo(null)} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* SECTION 1: Form to Grant Rights */}
      <div className="bg-white rounded-xl border border-border shadow-sm p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-bold text-gray-900">มอบสิทธิ์ตั๋วร่วมใหม่ (New Grant)</h2>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200">
            ขอบเขต: ทุกสินค้า (Scope ALL)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Step 1: Select Root Customer */}
          <div className="space-y-3">
            <label className="block text-xs font-bold text-gray-700">
              1. เลือกลูกค้าเจ้าของตั๋ว (Root Customer) <span className="text-red-500">*</span>
            </label>
            {selectedRoot ? (
              <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/60 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-blue-900">{selectedRoot.CustName}</div>
                  <div className="text-[11px] text-blue-700 mt-0.5">
                    รหัส: <span className="font-mono font-semibold">{selectedRoot.CustCode}</span> (CustID: {selectedRoot.CustID})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRoot(null);
                    setSuggestedMembers([]);
                    setSelectedMemberIds(new Set());
                  }}
                  className="px-2 py-1 text-[11px] rounded bg-white text-gray-600 border border-gray-300 hover:bg-gray-100"
                >
                  เปลี่ยนลูกค้า
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="ค้นหาด้วยชื่อหรือรหัสลูกค้า เช่น 0342001 หรือ สุวรรณภัณฑ์..."
                  value={rootQuery}
                  onChange={(e) => setRootQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {searchingRoot && (
                  <div className="absolute right-3 top-2.5 text-[11px] text-gray-400">กำลังค้นหา...</div>
                )}
                {rootResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white rounded-lg border border-border shadow-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
                    {rootResults.map((c) => (
                      <div
                        key={c.CustID}
                        onClick={() => {
                          setSelectedRoot(c);
                          setRootQuery('');
                          setRootResults([]);
                        }}
                        className="p-2.5 text-xs hover:bg-blue-50 cursor-pointer flex justify-between items-center"
                      >
                        <div>
                          <div className="font-bold text-gray-900">{c.CustName}</div>
                          <div className="text-[11px] text-gray-500">รหัส: {c.CustCode} (ID: {c.CustID})</div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Grant Parameters */}
            <div className="pt-2 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  เหตุผลการมอบสิทธิ์ <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="ระบุเหตุผล เช่น สมาชิกสหกรณ์กลุ่มประจำปี 2569 (อย่างน้อย 5 ตัวอักษร)"
                  value={grantReason}
                  onChange={(e) => setGrantReason(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">วันที่มีผลเริ่มต้น (ไม่บังคับ)</label>
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs rounded-lg border border-border text-gray-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">วันที่มีผลสิ้นสุด (ไม่บังคับ)</label>
                  <input
                    type="date"
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs rounded-lg border border-border text-gray-700"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Step 2: Select Member Customers */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-gray-700">
                2. เลือกลูกค้าสมาชิกที่ได้รับสิทธิ์ (Members) <span className="text-red-500">*</span>
              </label>
              <span className="text-[11px] text-gray-500">เลือกแล้ว {selectedMemberIds.size} ราย</span>
            </div>

            {selectedRoot && suggestedMembers.length > 0 && (
              <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200 space-y-2">
                <div className="text-[11px] font-bold text-amber-900 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                  รายชื่อแนะนำตามรหัสลูกค้า (Code Prefix Suggestions):
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                  {suggestedMembers.map((m) => {
                    const isChecked = selectedMemberIds.has(String(m.CustID));
                    return (
                      <label
                        key={m.CustID}
                        className={`flex items-center gap-2 p-1.5 rounded cursor-pointer text-xs transition ${
                          isChecked ? 'bg-amber-100 text-amber-950 font-medium' : 'hover:bg-amber-100/50 text-gray-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleMemberSelection(String(m.CustID))}
                          className="rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-mono text-[11px] font-semibold">{m.CustCode}</span>
                        <span className="truncate">{m.CustName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Additional Search for any customer */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="ค้นหาสมาชิกอื่นด้วยชื่อหรือรหัส..."
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                disabled={!selectedRoot}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:cursor-not-allowed"
              />
              {searchingMember && (
                <div className="absolute right-3 top-2.5 text-[11px] text-gray-400">กำลังค้นหา...</div>
              )}
              {memberResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white rounded-lg border border-border shadow-lg max-h-40 overflow-y-auto divide-y divide-gray-100">
                  {memberResults.map((c) => {
                    const isChecked = selectedMemberIds.has(String(c.CustID));
                    return (
                      <div
                        key={c.CustID}
                        onClick={() => {
                          toggleMemberSelection(String(c.CustID));
                          setMemberResults([]);
                          setMemberQuery('');
                        }}
                        className={`p-2 text-xs hover:bg-blue-50 cursor-pointer flex justify-between items-center ${
                          isChecked ? 'bg-blue-50/70 font-semibold' : ''
                        }`}
                      >
                        <div>
                          <div className="text-gray-900">{c.CustName}</div>
                          <div className="text-[11px] text-gray-500">รหัส: {c.CustCode} (ID: {c.CustID})</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="rounded text-blue-600 focus:ring-blue-500"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-3">
              <button
                type="button"
                onClick={handleGrantSubmit}
                disabled={!selectedRoot || selectedMemberIds.size === 0 || submittingGrant || grantReason.trim().length < 5}
                className="w-full py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
              >
                {submittingGrant ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    กำลังบันทึกการมอบสิทธิ์...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    ยืนยันการมอบสิทธิ์ตั๋วร่วม ({selectedMemberIds.size} สมาชิก)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: Grants List Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-slate-50/50">
          <div>
            <h2 className="text-sm font-bold text-gray-900">รายการสิทธิ์ตั๋วร่วมทั้งหมด (Beneficiary Grants)</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">พบ {filteredGrants.length} รายการตามเงื่อนไขค้นหา</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-white p-0.5 text-xs">
              <button
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  statusFilter === 'ACTIVE' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                ใช้งานอยู่ (ACTIVE)
              </button>
              <button
                onClick={() => setStatusFilter('REVOKED')}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  statusFilter === 'REVOKED' ? 'bg-red-600 text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                ถอนสิทธิ์แล้ว (REVOKED)
              </button>
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  statusFilter === 'ALL' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                ทั้งหมด
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="กรองในตาราง..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-8 pr-2.5 py-1 text-xs rounded-lg border border-border bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-44"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/70 border-b border-border text-[11px] font-bold text-gray-600 uppercase">
              <tr>
                <th className="py-2.5 px-3">รหัสสิทธิ์</th>
                <th className="py-2.5 px-3">ลูกค้าเจ้าของตั๋ว (Root)</th>
                <th className="py-2.5 px-3">ลูกค้าผู้รับสิทธิ์ (Member)</th>
                <th className="py-2.5 px-3">ขอบเขต</th>
                <th className="py-2.5 px-3">วันที่มีผล</th>
                <th className="py-2.5 px-3">เหตุผล</th>
                <th className="py-2.5 px-3">สถานะ</th>
                <th className="py-2.5 px-3">วันที่มอบสิทธิ์</th>
                <th className="py-2.5 px-3 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredGrants.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-gray-400 text-xs">
                    {loadingGrants ? 'กำลังโหลดข้อมูล...' : 'ไม่พบรายการสิทธิ์ตามเงื่อนไขที่เลือก'}
                  </td>
                </tr>
              ) : (
                filteredGrants.map((g) => {
                  const isActive = g.Status === 'ACTIVE';
                  return (
                    <tr key={g.Id} className="hover:bg-slate-50/70 transition">
                      <td className="py-2.5 px-3 font-mono font-semibold text-gray-700">#{g.Id}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-gray-900">{g.OwnerCustName || '-'}</div>
                        <div className="text-[10px] text-gray-500 font-mono">
                          {g.OwnerCustCode || `ID:${g.OwnerCustId}`}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-gray-900">{g.BeneficiaryCustName || '-'}</div>
                        <div className="text-[10px] text-gray-500 font-mono">
                          {g.BeneficiaryCustCode || `ID:${g.BeneficiaryCustId}`}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          {g.Scope || 'ALL'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-gray-600">
                        {g.EffectiveFrom || g.EffectiveTo ? (
                          <div className="space-y-0.5">
                            <div>เริ่ม: {g.EffectiveFrom ? g.EffectiveFrom.slice(0, 10) : 'ทันที'}</div>
                            <div>สิ้นสุด: {g.EffectiveTo ? g.EffectiveTo.slice(0, 10) : 'ไม่มีกำหนด'}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">ตลอดไป</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-gray-700 max-w-xs truncate" title={g.Reason}>
                        {g.Reason}
                        {g.RevokeReason && (
                          <div className="text-[10px] text-red-600 mt-0.5 truncate" title={`เหตุผลถอน: ${g.RevokeReason}`}>
                            ถอน: {g.RevokeReason}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isActive
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-red-100 text-red-800 border border-red-300'
                          }`}
                        >
                          {g.Status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-gray-500">
                        {g.CreatedAt ? g.CreatedAt.slice(0, 10) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {isActive && (
                          <button
                            type="button"
                            onClick={() => {
                              setRevokeTarget(g);
                              setRevokeReason('');
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition"
                          >
                            <Trash2 className="h-3 w-3" />
                            ถอนสิทธิ์
                          </button>
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

      {/* Revoke Confirmation Modal */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl border border-border shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                <h3 className="text-sm font-bold text-gray-900">ยืนยันการถอนสิทธิ์ตั๋วร่วม</h3>
              </div>
              <button onClick={() => setRevokeTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-gray-600 space-y-2">
              <div className="p-3 rounded-lg bg-red-50/70 border border-red-200 space-y-1 text-red-950">
                <div className="font-bold">รายการสิทธิ์ #{revokeTarget.Id}</div>
                <div>เจ้าของตั๋ว: <span className="font-semibold">{revokeTarget.OwnerCustName}</span> ({revokeTarget.OwnerCustCode})</div>
                <div>ผู้รับสิทธิ์: <span className="font-semibold">{revokeTarget.BeneficiaryCustName}</span> ({revokeTarget.BeneficiaryCustCode})</div>
              </div>
              <p className="text-muted-foreground text-[11px]">
                เมื่อถอนสิทธิ์ สมาชิกจะไม่สามารถสร้างการจองตั๋วใหม่จากคูปองของเจ้าของรายนี้ได้
              </p>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  ระบุเหตุผลในการถอนสิทธิ์ <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="เช่น ยกเลิกการเป็นสมาชิกสหกรณ์, เปลี่ยนกลุ่มสมาชิก (อย่างน้อย 3 ตัวอักษร)"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-gray-700 hover:bg-gray-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleRevokeConfirm}
                disabled={submittingRevoke || revokeReason.trim().length < 3}
                className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition disabled:opacity-50"
              >
                {submittingRevoke ? 'กำลังถอนสิทธิ์...' : 'ยืนยันการถอนสิทธิ์'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BeneficiaryAdminPage;
