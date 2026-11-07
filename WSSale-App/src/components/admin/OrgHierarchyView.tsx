import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Network, Search, RefreshCw, AlertTriangle, Check, Users, ShieldCheck, Download,
  ChevronRight, ChevronDown, UserPlus, UserMinus, Building2, Briefcase, UserCheck, AlertCircle, X
} from 'lucide-react';
import {
  listUsers, listOrgPositions, updateUser, fetchOrgHints,
  type OrgPosition, type OrgHintUser
} from '../../services/api';
import type { AdminUser } from '../../types';

const NAVY = '#0C447C';
const UNASSIGNED = '__none__';

const num = (v: unknown) => Number(v ?? 0).toLocaleString('th-TH');

/** สีประจำสายงาน ให้กวาดตาแล้วเห็นกลุ่มได้เร็ว */
const UNIT_STYLE: Record<string, { bg: string; text: string; border: string; pill: string }> = {
  'บริหาร': { bg: 'bg-purple-50/70', text: 'text-purple-900', border: 'border-purple-200', pill: 'bg-purple-100 text-purple-800' },
  'บัญชี-การเงิน': { bg: 'bg-emerald-50/70', text: 'text-emerald-900', border: 'border-emerald-200', pill: 'bg-emerald-100 text-emerald-800' },
  'โรงงาน': { bg: 'bg-amber-50/70', text: 'text-amber-900', border: 'border-amber-200', pill: 'bg-amber-100 text-amber-800' },
  'ขาย-การตลาด': { bg: 'bg-sky-50/70', text: 'text-sky-900', border: 'border-sky-200', pill: 'bg-sky-100 text-sky-800' },
};

const getUnitTheme = (u?: string | null) =>
  (u && UNIT_STYLE[u]) || { bg: 'bg-slate-50', text: 'text-slate-900', border: 'border-slate-200', pill: 'bg-slate-100 text-slate-700' };

function getUserBaseRoles(u: AdminUser): string[] {
  if (Array.isArray(u.Roles) && u.Roles.length > 0) return u.Roles;
  return [u.Role].filter(Boolean);
}

function isDefaultRoleMismatched(u: AdminUser): boolean {
  if (!u.PositionCode || !u.PositionDefaultRole) return false;
  const userBaseRoles = getUserBaseRoles(u);
  return !userBaseRoles.includes(u.PositionDefaultRole);
}

interface TreePositionNode {
  position: OrgPosition;
  children: TreePositionNode[];
  occupants: AdminUser[];
  activeOccupants: AdminUser[];
  inactiveOccupants: AdminUser[];
  isCycle?: boolean;
}

export function OrgHierarchyView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [positions, setPositions] = useState<OrgPosition[]>([]);
  const [hints, setHints] = useState<Map<number, OrgHintUser>>(new Map());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // View state: 'tree' | 'matrix'
  const [viewMode, setViewMode] = useState<'tree' | 'matrix'>('tree');
  const [searchQuery, setSearchQuery] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);

  // Tree expansion state
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Inline saving state for matrix
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  // Modal assignment state
  const [assignModal, setAssignModal] = useState<{
    isOpen: boolean;
    position: OrgPosition | null;
    selectedUserId?: number;
  }>({ isOpen: false, position: null });
  const [modalSaving, setModalSaving] = useState(false);
  const [modalErr, setModalErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [u, p, h] = await Promise.all([listUsers(), listOrgPositions(), fetchOrgHints()]);
      setUsers(u);
      setPositions(p);
      setHints(new Map((h.data || []).map(x => [Number(x.id), x])));

      // Default expand Tier 1 and Tier 2 nodes
      const initialExpanded = new Set<string>();
      p.filter(pos => pos.Tier <= 2 || !pos.ReportsTo).forEach(pos => initialExpanded.add(pos.PositionCode));
      setExpandedNodes(prev => prev.size > 0 ? prev : initialExpanded);
    } catch (e: any) {
      setErr(e?.message || 'โหลดข้อมูลผังองค์กรไม่สำเร็จ');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const units = useMemo(
    () => Array.from(new Set(positions.map(p => p.OrgUnit).filter(Boolean))),
    [positions]
  );

  // Map users to positions
  const usersByPosition = useMemo(() => {
    const map = new Map<string, AdminUser[]>();
    for (const u of users) {
      if (!u.PositionCode) continue;
      if (!map.has(u.PositionCode)) map.set(u.PositionCode, []);
      map.get(u.PositionCode)!.push(u);
    }
    return map;
  }, [users]);

  // Build Hierarchical Tree structure
  const { rootNodes, positionsByCode } = useMemo(() => {
    const posMap = new Map<string, OrgPosition>();
    for (const p of positions) posMap.set(p.PositionCode, p);

    const childrenMap = new Map<string, OrgPosition[]>();
    const roots: OrgPosition[] = [];

    for (const p of positions) {
      if (!p.IsActive) continue;
      if (!p.ReportsTo || !posMap.has(p.ReportsTo)) {
        roots.push(p);
      } else {
        if (!childrenMap.has(p.ReportsTo)) childrenMap.set(p.ReportsTo, []);
        childrenMap.get(p.ReportsTo)!.push(p);
      }
    }

    // Sort roots by Tier then Name
    roots.sort((a, b) => a.Tier - b.Tier || a.PositionName.localeCompare(b.PositionName, 'th'));

    // Recursive tree builder with cycle protection
    function buildNode(pos: OrgPosition, path: Set<string>): TreePositionNode {
      const occupants = usersByPosition.get(pos.PositionCode) || [];
      const activeOccupants = occupants.filter(u => u.IsActive);
      const inactiveOccupants = occupants.filter(u => !u.IsActive);

      if (path.has(pos.PositionCode)) {
        return {
          position: pos,
          children: [],
          occupants,
          activeOccupants,
          inactiveOccupants,
          isCycle: true
        };
      }

      const nextPath = new Set(path);
      nextPath.add(pos.PositionCode);

      const childPositions = childrenMap.get(pos.PositionCode) || [];
      childPositions.sort((a, b) => a.Tier - b.Tier || a.PositionName.localeCompare(b.PositionName, 'th'));

      const children = childPositions.map(c => buildNode(c, nextPath));

      return {
        position: pos,
        children,
        occupants,
        activeOccupants,
        inactiveOccupants
      };
    }

    const tree = roots.map(r => buildNode(r, new Set()));
    return { rootNodes: tree, positionsByCode: posMap };
  }, [positions, usersByPosition]);

  // Toggle node expansion
  const toggleNode = (code: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedNodes(new Set(positions.map(p => p.PositionCode)));
  };

  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  // Auto-expand ancestors when search matches
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;

    const matchedCodes = new Set<string>();
    for (const p of positions) {
      const occupants = usersByPosition.get(p.PositionCode) || [];
      const matchesPosition = p.PositionName.toLowerCase().includes(q) || p.PositionCode.toLowerCase().includes(q);
      const matchesOccupant = occupants.some(u =>
        u.DisplayName.toLowerCase().includes(q) ||
        u.Username.toLowerCase().includes(q) ||
        (u.EmpCode && u.EmpCode.toLowerCase().includes(q))
      );
      if (matchesPosition || matchesOccupant) {
        // Add ancestors
        let curr: OrgPosition | undefined = p;
        while (curr && curr.ReportsTo && positionsByCode.has(curr.ReportsTo)) {
          matchedCodes.add(curr.ReportsTo);
          curr = positionsByCode.get(curr.ReportsTo);
        }
      }
    }

    if (matchedCodes.size > 0) {
      setExpandedNodes(prev => new Set([...prev, ...matchedCodes]));
    }
  }, [searchQuery, positions, usersByPosition, positionsByCode]);

  // Overall statistics
  const activeUsers = useMemo(() => users.filter(u => u.IsActive), [users]);
  const assignedActiveCount = useMemo(() => activeUsers.filter(u => u.PositionCode).length, [activeUsers]);
  const unassignedActiveCount = activeUsers.length - assignedActiveCount;
  const vacantPositionsCount = useMemo(() => positions.filter(p => p.IsActive && (!usersByPosition.has(p.PositionCode) || usersByPosition.get(p.PositionCode)!.filter(u => u.IsActive).length === 0)).length, [positions, usersByPosition]);
  const mismatchedUsersCount = useMemo(() => activeUsers.filter(isDefaultRoleMismatched).length, [activeUsers]);

  // Matrix view filtered rows
  const matrixShown = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return users
      .filter(u => (onlyActive ? u.IsActive : true))
      .filter(u => (onlyUnassigned ? !u.PositionCode : true))
      .filter(u => (unitFilter ? u.OrgUnit === unitFilter : true))
      .filter(u => !needle || [u.DisplayName, u.Username, u.EmpCode, u.PositionName, u.PositionCode]
        .some(v => String(v ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => Number(!!a.PositionCode) - Number(!!b.PositionCode)
        || String(a.DisplayName).localeCompare(String(b.DisplayName), 'th'));
  }, [users, searchQuery, unitFilter, onlyUnassigned, onlyActive]);

  // Inline assignment from Matrix view
  async function handleMatrixAssign(user: AdminUser, nextCode: string) {
    const targetCode = nextCode === UNASSIGNED ? null : nextCode;
    if ((user.PositionCode ?? null) === targetCode) return;
    setSavingId(user.Id);
    setErr(null);
    try {
      await updateUser(user.Id, {
        positionCode: targetCode,
        expectedPositionCode: user.PositionCode ?? null
      });
      const freshUsers = await listUsers();
      setUsers(freshUsers);
      setPositions(await listOrgPositions());
      setSavedId(user.Id);
      setTimeout(() => setSavedId(v => (v === user.Id ? null : v)), 1800);
    } catch (e: any) {
      if (e?.statusCode === 409) {
        setErr(`ตำแหน่งของ ${user.DisplayName} มีการเปลี่ยนแปลงโดยผู้อื่น กรุณารีเฟรช`);
      } else {
        setErr(`บันทึกตำแหน่งของ ${user.DisplayName} ไม่สำเร็จ: ${e?.message || ''}`);
      }
    }
    setSavingId(null);
  }

  // Handle assignment modal submission
  async function handleModalAssign() {
    if (!assignModal.position || !assignModal.selectedUserId) return;
    const targetUser = users.find(u => u.Id === assignModal.selectedUserId);
    if (!targetUser) return;

    setModalSaving(true);
    setModalErr(null);
    try {
      await updateUser(targetUser.Id, {
        positionCode: assignModal.position.PositionCode,
        expectedPositionCode: targetUser.PositionCode ?? null
      });
      const freshUsers = await listUsers();
      setUsers(freshUsers);
      setPositions(await listOrgPositions());
      setAssignModal({ isOpen: false, position: null });
    } catch (e: any) {
      setModalErr(e?.message || 'บันทึกการมอบหมายตำแหน่งไม่สำเร็จ');
    } finally {
      setModalSaving(false);
    }
  }

  // Handle unassign user from position modal
  async function handleModalUnassign(userId: number) {
    const targetUser = users.find(u => u.Id === userId);
    if (!targetUser) return;
    if (!confirm(`ต้องการปลด ${targetUser.DisplayName} ออกจากตำแหน่งนี้ใช่หรือไม่?`)) return;

    setModalSaving(true);
    setModalErr(null);
    try {
      await updateUser(targetUser.Id, {
        positionCode: null,
        expectedPositionCode: targetUser.PositionCode ?? null
      });
      const freshUsers = await listUsers();
      setUsers(freshUsers);
      setPositions(await listOrgPositions());
    } catch (e: any) {
      setModalErr(e?.message || 'ปลดตำแหน่งไม่สำเร็จ');
    } finally {
      setModalSaving(false);
    }
  }

  function exportCsv() {
    const headers = ['UserId', 'Username', 'DisplayName', 'Roles', 'EmpCode', 'PositionCode', 'PositionName', 'OrgUnit', 'Tier', 'ReportsTo', 'IsActive', 'Mismatched'];
    const rows = matrixShown.map(u => [
      u.Id,
      `"${u.Username}"`,
      `"${u.DisplayName}"`,
      `"${getUserBaseRoles(u).join(', ')}"`,
      `"${u.EmpCode || ''}"`,
      `"${u.PositionCode || ''}"`,
      `"${u.PositionName || ''}"`,
      `"${u.OrgUnit || ''}"`,
      u.Tier ?? '',
      `"${u.ApproverName || ''}"`,
      u.IsActive ? '1' : '0',
      isDefaultRoleMismatched(u) ? 'MISMATCH' : 'OK',
    ]);
    const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `worldfert-org-assignment-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Tree Card Render Helper
  const renderTreeNode = (node: TreePositionNode, depth: number = 0) => {
    const { position: p, children, occupants, activeOccupants, inactiveOccupants, isCycle } = node;
    const isExpanded = expandedNodes.has(p.PositionCode);
    const hasChildren = children.length > 0;
    const theme = getUnitTheme(p.OrgUnit);

    const needle = searchQuery.trim().toLowerCase();
    const isSearchMatch = Boolean(
      needle && (
        p.PositionName.toLowerCase().includes(needle) ||
        p.PositionCode.toLowerCase().includes(needle) ||
        occupants.some(u =>
          u.DisplayName.toLowerCase().includes(needle) ||
          u.Username.toLowerCase().includes(needle) ||
          (u.EmpCode && u.EmpCode.toLowerCase().includes(needle))
        )
      )
    );

    // Mismatched occupants in this node
    const mismatchedOccupants = occupants.filter(isDefaultRoleMismatched);

    return (
      <div key={p.PositionCode} className="relative flex flex-col">
        {/* Node Card */}
        <div
          className={`group rounded-xl border transition-all duration-150 p-3.5 mb-2.5 ${
            isSearchMatch ? 'ring-2 ring-amber-400 bg-amber-50/40 border-amber-300' : 'bg-white'
          } ${theme.border} hover:shadow-md`}
          style={{ marginLeft: depth > 0 ? `${Math.min(depth * 20, 160)}px` : '0px' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            {/* Position info & Collapse button */}
            <div className="flex items-start gap-2.5 min-w-0">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleNode(p.PositionCode)}
                  className="mt-0.5 p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                  title={isExpanded ? 'ยุบสายงาน' : 'ขยายสายงาน'}
                >
                  {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
              ) : (
                <div className="w-6 h-6 flex items-center justify-center shrink-0 text-slate-300 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                </div>
              )}

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold text-slate-900 leading-snug">
                    {p.PositionName}
                  </span>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                    {p.PositionCode}
                  </span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${theme.pill} ${theme.border}`}>
                    {p.OrgUnit}
                  </span>
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    Tier {p.Tier}
                  </span>
                  {p.CanApprove && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                      <UserCheck size={11} /> มีสิทธิ์อนุมัติ
                    </span>
                  )}
                  {isCycle && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-300">
                      ⚠️ วนซ้ำ (Cycle)
                    </span>
                  )}
                </div>

                {/* Sub details: default role & reports to */}
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                  {p.ReportsTo && (
                    <span>
                      สายบังคับบัญชา: <strong className="text-slate-700 font-mono">{p.ReportsTo}</strong>
                      {p.ReportsToName ? ` (${p.ReportsToName})` : ''}
                    </span>
                  )}
                  {p.DefaultRole && (
                    <span>
                      บทบาทแนะนำ: <span className="font-semibold text-slate-700">{p.DefaultRole}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Manage occupants action button */}
            <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
              <button
                type="button"
                onClick={() => setAssignModal({ isOpen: true, position: p })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors"
              >
                <UserPlus size={14} />
                <span>มอบหมายคน ({occupants.length})</span>
              </button>
            </div>
          </div>

          {/* Occupants list */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
            {occupants.length === 0 ? (
              <div className="flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                <AlertTriangle size={13} className="text-amber-600" />
                <span>⚠️ ตำแหน่งว่าง (0 คน)</span>
              </div>
            ) : (
              <>
                <span className="text-xs text-slate-400 font-medium mr-1">ผู้ครองตำแหน่ง:</span>
                {occupants.map(u => {
                  const isMismatched = isDefaultRoleMismatched(u);
                  return (
                    <div
                      key={u.Id}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                        !u.IsActive
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : isMismatched
                          ? 'bg-amber-50 text-amber-900 border-amber-300'
                          : 'bg-slate-50 text-slate-800 border-slate-200'
                      }`}
                    >
                      <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-700 shrink-0">
                        {u.DisplayName.slice(0, 1)}
                      </span>
                      <span className="font-semibold">{u.DisplayName}</span>
                      <span className="text-[10px] text-slate-400 font-mono">@{u.Username}</span>
                      {u.EmpCode && (
                        <span className="text-[10px] text-slate-400 font-mono">[{u.EmpCode}]</span>
                      )}
                      {!u.IsActive && (
                        <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-rose-200 text-rose-800">
                          ปิดใช้งาน
                        </span>
                      )}
                      {isMismatched && (
                        <span
                          className="text-[9px] font-bold px-1 py-0.2 rounded bg-amber-200 text-amber-900 cursor-help"
                          title={`บทบาท (${getUserBaseRoles(u).join(', ')}) ไม่ตรงกับบทบาทแนะนำของตำแหน่ง (${p.DefaultRole})`}
                        >
                          บทบาทไม่ตรง
                        </span>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {mismatchedOccupants.length > 0 && (
              <span className="text-[11px] text-amber-700 ml-auto flex items-center gap-1">
                <AlertCircle size={12} /> บทบาทไม่ตรง {mismatchedOccupants.length} คน
              </span>
            )}
          </div>
        </div>

        {/* Child branches */}
        {hasChildren && isExpanded && (
          <div className="flex flex-col">
            {children.map(childNode => renderTreeNode(childNode, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      {/* Top Controls Bar */}
      <div className="px-4 py-3 sm:px-6 sm:py-3.5 bg-white border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setViewMode('tree')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                viewMode === 'tree'
                  ? 'bg-white text-[#0C447C] shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Network size={15} />
              <span>ผังโครงสร้าง (Tree View)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('matrix')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                viewMode === 'matrix'
                  ? 'bg-white text-[#0C447C] shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Briefcase size={15} />
              <span>ตารางผูกตำแหน่ง (Matrix View)</span>
            </button>
          </div>

          {/* Quick stats pills */}
          <div className="hidden lg:flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">
              ตำแหน่งทั้งหมด: <strong className="text-slate-900">{positions.length}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
              ผูกแล้ว: <strong>{assignedActiveCount}</strong>/{activeUsers.length} คน
            </span>
            {vacantPositionsCount > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-medium">
                ตำแหน่งว่าง: <strong>{vacantPositionsCount}</strong>
              </span>
            )}
            {mismatchedUsersCount > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-rose-50 text-rose-800 border border-rose-200 font-medium">
                บทบาทไม่ตรง: <strong>{mismatchedUsersCount}</strong> คน
              </span>
            )}
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] sm:min-w-[260px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อตำแหน่ง, รหัส, ชื่อบุคคล..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#0C447C] focus:bg-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {viewMode === 'tree' ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={expandAll}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                + ขยายทั้งหมด
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                - ยุบทั้งหมด
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              <Download size={13} /> Export CSV
            </button>
          )}

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {err && (
        <div className="mx-4 mt-3 bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-rose-600 shrink-0" />
            <span>{err}</span>
          </div>
          <button type="button" onClick={() => setErr(null)} className="text-rose-500 hover:text-rose-700">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {viewMode === 'tree' ? (
          /* Tree View */
          <div className="max-w-5xl mx-auto space-y-4">
            {/* Virtual Company Root Banner */}
            <div className="rounded-2xl border-2 border-[#0C447C] bg-linear-to-r from-[#0C447C] to-[#1E62A6] text-white p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                    <Building2 size={24} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg sm:text-xl font-black tracking-wide">
                      บริษัท เวิลด์เฟอร์ติไลเซอร์ จำกัด (WorldFert)
                    </h2>
                    <p className="text-xs text-blue-100 mt-0.5">
                      โครงสร้างองค์กร 2568 · แสดงตามสายบังคับบัญชาจริง (ReportsTo)
                    </p>
                  </div>
                </div>
                <div className="hidden sm:block text-right text-xs text-blue-100">
                  <div>ตำแหน่งราก: <strong>{rootNodes.length}</strong> สายงาน</div>
                  <div>พนักงานผูกตำแหน่งแล้ว: <strong>{assignedActiveCount}</strong>/{activeUsers.length} คน</div>
                </div>
              </div>
            </div>

            {/* Tree Nodes List */}
            {loading && positions.length === 0 ? (
              <div className="py-20 text-center text-slate-400">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-[#0C447C]" />
                <p className="text-sm">กำลังโหลดโครงสร้างผังองค์กร...</p>
              </div>
            ) : rootNodes.length === 0 ? (
              <div className="py-16 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
                <Network size={32} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm font-semibold">ไม่พบข้อมูลตำแหน่งในผังองค์กร</p>
              </div>
            ) : (
              <div className="space-y-1">
                {rootNodes.map(rootNode => renderTreeNode(rootNode, 0))}
              </div>
            )}
          </div>
        ) : (
          /* Matrix View */
          <div className="space-y-3">
            {/* Filter controls */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-wrap items-center gap-3 text-xs">
              <span className="font-semibold text-slate-700">กรองตาราง:</span>
              <select
                value={unitFilter}
                onChange={e => setUnitFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50 text-xs"
              >
                <option value="">ทุกสายงาน ({units.length})</option>
                {units.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={onlyUnassigned}
                  onChange={e => setOnlyUnassigned(e.target.checked)}
                  className="rounded text-[#0C447C]"
                />
                <span>เฉพาะที่ยังไม่ผูก ({unassignedActiveCount})</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={onlyActive}
                  onChange={e => setOnlyActive(e.target.checked)}
                  className="rounded text-[#0C447C]"
                />
                <span>เฉพาะที่ใช้งานอยู่</span>
              </label>

              <div className="ml-auto text-xs text-slate-500">
                แสดง {matrixShown.length} จาก {users.length} รายการ
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-600 text-left">
                    <th className="px-3.5 py-2.5">ผู้ใช้</th>
                    <th className="px-3.5 py-2.5">บทบาท (Roles)</th>
                    <th className="px-3.5 py-2.5">รหัสพนักงาน</th>
                    <th className="px-3.5 py-2.5 min-w-[280px]">ตำแหน่งในผังองค์กร</th>
                    <th className="px-3.5 py-2.5">สายงาน</th>
                    <th className="px-3.5 py-2.5">ผู้อนุมัติ</th>
                    <th className="px-3.5 py-2.5 text-center">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {matrixShown.map(u => {
                    const isMismatched = isDefaultRoleMismatched(u);
                    const userRoles = getUserBaseRoles(u);
                    const isSaving = savingId === u.Id;
                    const isSaved = savedId === u.Id;

                    return (
                      <tr key={u.Id} className={`hover:bg-slate-50/70 ${!u.IsActive ? 'opacity-60 bg-slate-50/40' : ''}`}>
                        <td className="px-3.5 py-2">
                          <div className="font-semibold text-slate-800">{u.DisplayName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">@{u.Username}</div>
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="flex flex-wrap gap-1">
                            {userRoles.map(r => (
                              <span key={r} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                                {r}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3.5 py-2 font-mono text-slate-600">
                          {u.EmpCode || '–'}
                        </td>
                        <td className="px-3.5 py-2">
                          <div className="flex items-center gap-2">
                            <select
                              value={u.PositionCode || UNASSIGNED}
                              onChange={e => handleMatrixAssign(u, e.target.value)}
                              disabled={isSaving}
                              className={`w-full max-w-sm rounded-lg border px-2.5 py-1 text-xs bg-white transition-colors ${
                                isMismatched
                                  ? 'border-amber-300 bg-amber-50/50 text-amber-900 font-medium'
                                  : !u.PositionCode
                                  ? 'border-slate-300 text-slate-400'
                                  : 'border-slate-200 text-slate-800'
                              }`}
                            >
                              <option value={UNASSIGNED}>-- ยังไม่ผูกตำแหน่ง --</option>
                              {units.map(unit => (
                                <optgroup key={unit} label={`สายงาน ${unit}`}>
                                  {positions
                                    .filter(p => p.OrgUnit === unit && p.IsActive)
                                    .sort((a, b) => a.Tier - b.Tier || a.PositionName.localeCompare(b.PositionName, 'th'))
                                    .map(p => (
                                      <option key={p.PositionCode} value={p.PositionCode}>
                                        {p.PositionName} ({p.PositionCode}) [Tier {p.Tier}]
                                      </option>
                                    ))}
                                </optgroup>
                              ))}
                            </select>
                            {isSaving && <RefreshCw size={13} className="animate-spin text-[#0C447C] shrink-0" />}
                            {isSaved && <Check size={14} className="text-emerald-600 shrink-0" />}
                          </div>
                          {isMismatched && (
                            <div className="text-[10px] text-amber-700 mt-0.5 flex items-center gap-1">
                              <AlertCircle size={10} /> บทบาทแนะนำ: {u.PositionDefaultRole} (ผู้ใช้มี {userRoles.join(', ')})
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-2">
                          {u.OrgUnit ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${getUnitTheme(u.OrgUnit).pill} ${getUnitTheme(u.OrgUnit).border}`}>
                              {u.OrgUnit}
                            </span>
                          ) : '–'}
                        </td>
                        <td className="px-3.5 py-2 text-slate-600">
                          {u.ApproverName || '–'}
                        </td>
                        <td className="px-3.5 py-2 text-center">
                          {u.IsActive ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              ใช้งาน
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                              ปิดใช้งาน
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {matrixShown.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                        ไม่พบข้อมูลผู้ใช้ตามเงื่อนไขที่เลือก
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Assignment Modal */}
      {assignModal.isOpen && assignModal.position && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <UserPlus size={18} className="text-[#0C447C]" />
                  มอบหมายผู้ครองตำแหน่ง
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {assignModal.position.PositionName} ({assignModal.position.PositionCode})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignModal({ isOpen: false, position: null })}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4">
              {modalErr && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
                  <AlertTriangle size={15} className="text-rose-600 shrink-0" />
                  <span>{modalErr}</span>
                </div>
              )}

              {/* Position details pill */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>สายงาน:</span>
                  <span className="font-semibold text-slate-900">{assignModal.position.OrgUnit}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>ระดับสายบังคับบัญชา:</span>
                  <span className="font-semibold text-slate-900">Tier {assignModal.position.Tier}</span>
                </div>
                {assignModal.position.DefaultRole && (
                  <div className="flex justify-between text-slate-600">
                    <span>บทบาทแนะนำ:</span>
                    <span className="font-semibold text-slate-900">{assignModal.position.DefaultRole}</span>
                  </div>
                )}
              </div>

              {/* Current Occupants */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  ผู้ครองตำแหน่งปัจจุบัน ({usersByPosition.get(assignModal.position.PositionCode)?.length || 0} คน):
                </label>
                <div className="space-y-1.5 max-h-36 overflow-y-auto border border-slate-200 rounded-xl p-2 bg-slate-50/50">
                  {(usersByPosition.get(assignModal.position.PositionCode) || []).length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-2">ยังไม่มีผู้ครองตำแหน่งนี้</div>
                  ) : (
                    (usersByPosition.get(assignModal.position.PositionCode) || []).map(u => (
                      <div key={u.Id} className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-slate-200 text-xs">
                        <div>
                          <span className="font-semibold text-slate-800">{u.DisplayName}</span>
                          <span className="text-[10px] text-slate-400 ml-1.5">@{u.Username}</span>
                          {!u.IsActive && <span className="ml-1.5 text-[9px] font-bold text-rose-600">[ปิดใช้งาน]</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleModalUnassign(u.Id)}
                          disabled={modalSaving}
                          className="text-rose-600 hover:text-rose-800 p-1 rounded hover:bg-rose-50 text-[11px] font-semibold flex items-center gap-1"
                        >
                          <UserMinus size={13} /> ปลด
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Add New Occupant */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  เลือกผู้ใช้เพื่อมอบหมายตำแหน่งนี้:
                </label>
                <select
                  value={assignModal.selectedUserId || ''}
                  onChange={e => setAssignModal(prev => ({ ...prev, selectedUserId: Number(e.target.value) || undefined }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white text-slate-800 focus:outline-hidden focus:border-[#0C447C]"
                >
                  <option value="">-- เลือกผู้ใช้งานในระบบ --</option>
                  {users
                    .filter(u => u.IsActive && u.PositionCode !== assignModal.position?.PositionCode)
                    .sort((a, b) => a.DisplayName.localeCompare(b.DisplayName, 'th'))
                    .map(u => (
                      <option key={u.Id} value={u.Id}>
                        {u.DisplayName} (@{u.Username}) {u.PositionName ? `[ปัจจุบัน: ${u.PositionName}]` : '[ยังไม่มีตำแหน่ง]'}
                      </option>
                    ))}
                </select>
              </div>

              {/* Warnings and Diff Preview */}
              {assignModal.selectedUserId && (() => {
                const targetUser = users.find(u => u.Id === assignModal.selectedUserId);
                if (!targetUser) return null;
                const userRoles = getUserBaseRoles(targetUser);
                const hasDefaultMismatch = assignModal.position?.DefaultRole && !userRoles.includes(assignModal.position.DefaultRole);

                return (
                  <div className="space-y-2 p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-900">
                    <div className="font-semibold text-slate-800">
                      ก่อน → หลัง:
                    </div>
                    <div className="text-[11px] space-y-0.5">
                      <div>ตำแหน่งเดิม: <strong>{targetUser.PositionName || 'ยังไม่ผูกตำแหน่ง'}</strong></div>
                      <div>ตำแหน่งใหม่: <strong className="text-[#0C447C]">{assignModal.position?.PositionName}</strong></div>
                    </div>

                    {hasDefaultMismatch && (
                      <div className="text-amber-800 pt-1 border-t border-amber-200/70 flex items-start gap-1">
                        <AlertTriangle size={13} className="shrink-0 text-amber-600 mt-0.5" />
                        <span>
                          บทบาทของผู้ใช้ ({userRoles.join(', ')}) ไม่ตรงกับบทบาทแนะนำของตำแหน่ง ({assignModal.position?.DefaultRole}) — ระบบจะไม่เปลี่ยน Role ของผู้ใช้ให้อัตโนมัติ
                        </span>
                      </div>
                    )}

                    <div className="text-[10px] text-slate-600 pt-1 border-t border-amber-200/70">
                      ℹ️ การเปลี่ยนตำแหน่งอาจส่งผลต่อการมองเห็นข้อมูล (Visible Scope) ของผู้ใช้และสายงานที่อยู่ใต้ตำแหน่งนี้
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setAssignModal({ isOpen: false, position: null })}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleModalAssign}
                disabled={modalSaving || !assignModal.selectedUserId}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-[#0C447C] text-white hover:bg-[#0A3866] disabled:opacity-50 flex items-center gap-1.5"
              >
                {modalSaving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                <span>บันทึกการมอบหมาย</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
