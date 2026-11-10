import { useAuthStore } from '../../store/auth-store';
import { useCompanyStore } from '../../store/company-store';
import { req } from '../../services/api';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Network, Search, RefreshCw, AlertTriangle, Check, Users, Download,
  ChevronDown, ChevronUp, UserPlus, UserMinus, Building2, UserCheck,
  AlertCircle, X, ZoomIn, ZoomOut, Maximize2, Layers, Filter,
  Plus, Edit2, Trash2, FolderTree
} from 'lucide-react';
import {
  listOrgPositions, createOrgPosition, updateOrgPosition, deleteOrgPosition,
  updateUser, fetchOrgHints,
  type OrgPosition, type OrgHintUser
} from '../../services/api';
import type { AdminUser } from '../../types';

const UNASSIGNED = '__none__';

/** สีประจำสายงาน ให้กวาดตาแล้วเห็นกลุ่มได้เร็ว */
const UNIT_STYLE: Record<string, { bg: string; text: string; border: string; pill: string; bar: string }> = {
  'บริหาร': {
    bg: 'bg-purple-50/70',
    text: 'text-purple-900',
    border: 'border-purple-200',
    pill: 'bg-purple-100 text-purple-800 border-purple-300',
    bar: 'bg-purple-600'
  },
  'บัญชี-การเงิน': {
    bg: 'bg-emerald-50/70',
    text: 'text-emerald-900',
    border: 'border-emerald-200',
    pill: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    bar: 'bg-emerald-600'
  },
  'โรงงาน': {
    bg: 'bg-amber-50/70',
    text: 'text-amber-900',
    border: 'border-amber-200',
    pill: 'bg-amber-100 text-amber-800 border-amber-300',
    bar: 'bg-amber-600'
  },
  'ขาย-การตลาด': {
    bg: 'bg-sky-50/70',
    text: 'text-sky-900',
    border: 'border-sky-200',
    pill: 'bg-sky-100 text-sky-800 border-sky-300',
    bar: 'bg-[#0C447C]'
  },
};

const getUnitTheme = (u?: string | null) =>
  (u && UNIT_STYLE[u]) || {
    bg: 'bg-slate-50',
    text: 'text-slate-900',
    border: 'border-slate-200',
    pill: 'bg-slate-100 text-slate-700 border-slate-300',
    bar: 'bg-slate-500'
  };

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
  totalDescendants: number;
}

export function OrgHierarchyView() {
  const companyInfo = useCompanyStore(s => s.companyInfo);
  const fetchCompanyInfo = useCompanyStore(s => s.fetchCompanyInfo);
  const session = useAuthStore(s => s.user);
  const canEdit = Boolean(session?.capabilities?.actions.includes("users.manage")) && !session?.isImpersonating;
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [positions, setPositions] = useState<OrgPosition[]>([]);
  const [, setHints] = useState<Map<number, OrgHintUser>>(new Map());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // View state: 'diagram' (tree diagram) | 'matrix' (tabular)
  const [viewMode, setViewMode] = useState<'diagram' | 'matrix'>('diagram');
  const [searchQuery, setSearchQuery] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);

  // Diagram zoom & expansion state
  const [zoom, setZoom] = useState(1);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const canvasRef = useRef<HTMLDivElement>(null);

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

  // Position CRUD Modal state
  const [posModal, setPosModal] = useState<{
    isOpen: boolean;
    mode: 'create' | 'edit';
    code: string;
    name: string;
    reportsTo: string;
    orgUnit: string;
    tier: number;
    defaultRole: string;
    canApprove: boolean;
    isActive: boolean;
    note: string;
    saving: boolean;
    err: string | null;
  }>({
    isOpen: false,
    mode: 'create',
    code: '',
    name: '',
    reportsTo: '',
    orgUnit: 'บริหาร',
    tier: 1,
    defaultRole: '',
    canApprove: false,
    isActive: true,
    note: '',
    saving: false,
    err: null
  });

  const [delModal, setDelModal] = useState<{
    isOpen: boolean;
    position: OrgPosition | null;
    deleting: boolean;
    err: string | null;
  }>({
    isOpen: false,
    position: null,
    deleting: false,
    err: null
  });

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [u, p, h] = await Promise.all([req<AdminUser[]>("/auth/org-users"), listOrgPositions(), fetchOrgHints()]);
      setUsers(u);
      setPositions(p);
      setHints(new Map((h.data || []).map(x => [Number(x.id), x])));

      // Default expand Tier 1 and Tier 2 nodes for comfortable initial view
      const initialExpanded = new Set<string>();
      p.filter(pos => pos.Tier <= 2 || !pos.ReportsTo).forEach(pos => initialExpanded.add(pos.PositionCode));
      setExpandedNodes(prev => prev.size > 0 ? prev : initialExpanded);
    } catch (e: any) {
      setErr(e?.message || 'โหลดข้อมูลผังองค์กรไม่สำเร็จ');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCompanyInfo();
    load();
  }, [fetchCompanyInfo, load]);

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
          isCycle: true,
          totalDescendants: 0,
        };
      }

      const nextPath = new Set(path);
      nextPath.add(pos.PositionCode);

      const childPositions = childrenMap.get(pos.PositionCode) || [];
      childPositions.sort((a, b) => a.Tier - b.Tier || a.PositionName.localeCompare(b.PositionName, 'th'));

      const children = childPositions.map(c => buildNode(c, nextPath));
      const totalDescendants = children.reduce((sum, c) => sum + 1 + c.totalDescendants, 0);

      return {
        position: pos,
        children,
        occupants,
        activeOccupants,
        inactiveOccupants,
        totalDescendants,
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

  const expandExecutiveTiers = () => {
    const execSet = new Set<string>();
    positions.filter(p => p.Tier <= 2 || !p.ReportsTo).forEach(p => execSet.add(p.PositionCode));
    setExpandedNodes(execSet);
  };

  const isDescendantOf = useCallback((candidateCode: string, ancestorCode: string): boolean => {
    if (candidateCode === ancestorCode) return true;
    let curr = positionsByCode.get(candidateCode);
    const visited = new Set<string>();
    while (curr && curr.ReportsTo) {
      if (curr.ReportsTo === ancestorCode) return true;
      if (visited.has(curr.ReportsTo)) break;
      visited.add(curr.ReportsTo);
      curr = positionsByCode.get(curr.ReportsTo);
    }
    return false;
  }, [positionsByCode]);

  const handleOpenCreate = useCallback((parentCode?: string) => {
    let reportsTo = '';
    let tier = 1;
    let orgUnit = units[0] || 'บริหาร';
    let defaultRole = '';
    let canApprove = false;

    if (parentCode) {
      const parent = positionsByCode.get(parentCode);
      if (parent) {
        reportsTo = parent.PositionCode;
        tier = Math.min(5, parent.Tier + 1);
        orgUnit = parent.OrgUnit;
        defaultRole = parent.DefaultRole || '';
        canApprove = false;
      }
    }

    setPosModal({
      isOpen: true,
      mode: 'create',
      code: '',
      name: '',
      reportsTo,
      orgUnit,
      tier,
      defaultRole,
      canApprove,
      isActive: true,
      note: '',
      saving: false,
      err: null
    });
  }, [positionsByCode, units]);

  const handleOpenEdit = useCallback((p: OrgPosition) => {
    setPosModal({
      isOpen: true,
      mode: 'edit',
      code: p.PositionCode,
      name: p.PositionName,
      reportsTo: p.ReportsTo || '',
      orgUnit: p.OrgUnit,
      tier: p.Tier,
      defaultRole: p.DefaultRole || '',
      canApprove: p.CanApprove,
      isActive: p.IsActive,
      note: p.Note || '',
      saving: false,
      err: null
    });
  }, []);

  const handleOpenDelete = useCallback((p: OrgPosition) => {
    setDelModal({
      isOpen: true,
      position: p,
      deleting: false,
      err: null
    });
  }, []);

  const handleSavePosition = async () => {
    if (!posModal.name.trim()) {
      setPosModal(s => ({ ...s, err: 'กรุณาระบุชื่อตำแหน่ง' }));
      return;
    }
    if (posModal.mode === 'create') {
      const trimmedCode = posModal.code.trim().toUpperCase();
      if (!trimmedCode || !/^[A-Z0-9_-]{2,30}$/.test(trimmedCode)) {
        setPosModal(s => ({ ...s, err: 'รหัสตำแหน่งต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข ขีดกลาง หรือขีดล่าง (2-30 ตัวอักษร)' }));
        return;
      }
    }

    setPosModal(s => ({ ...s, saving: true, err: null }));
    try {
      if (posModal.mode === 'create') {
        await createOrgPosition({
          positionCode: posModal.code.trim().toUpperCase(),
          positionName: posModal.name.trim(),
          reportsTo: posModal.reportsTo || null,
          orgUnit: posModal.orgUnit,
          tier: posModal.tier,
          defaultRole: posModal.defaultRole || null,
          canApprove: posModal.canApprove,
          note: posModal.note.trim() || null
        });
      } else {
        await updateOrgPosition(posModal.code, {
          positionName: posModal.name.trim(),
          reportsTo: posModal.reportsTo || null,
          orgUnit: posModal.orgUnit,
          tier: posModal.tier,
          defaultRole: posModal.defaultRole || null,
          canApprove: posModal.canApprove,
          isActive: posModal.isActive,
          note: posModal.note.trim() || null
        });
      }

      setPosModal(s => ({ ...s, isOpen: false, saving: false }));
      await load();
    } catch (e: any) {
      setPosModal(s => ({ ...s, saving: false, err: e?.message || 'บันทึกตำแหน่งไม่สำเร็จ' }));
    }
  };

  const handleConfirmDelete = async () => {
    if (!delModal.position) return;
    setDelModal(s => ({ ...s, deleting: true, err: null }));
    try {
      await deleteOrgPosition(delModal.position.PositionCode);
      setDelModal({ isOpen: false, position: null, deleting: false, err: null });
      await load();
    } catch (e: any) {
      setDelModal(s => ({ ...s, deleting: false, err: e?.message || 'ลบตำแหน่งไม่สำเร็จ' }));
    }
  };

  // Auto-expand ancestors when search matches
  const matchCount = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return 0;
    let count = 0;
    for (const p of positions) {
      const occupants = usersByPosition.get(p.PositionCode) || [];
      const matchesPosition = p.PositionName.toLowerCase().includes(q) || p.PositionCode.toLowerCase().includes(q);
      const matchesOccupant = occupants.some(u =>
        u.DisplayName.toLowerCase().includes(q) ||
        u.Username.toLowerCase().includes(q) ||
        (u.EmpCode && u.EmpCode.toLowerCase().includes(q))
      );
      if (matchesPosition || matchesOccupant) count++;
    }
    return count;
  }, [searchQuery, positions, usersByPosition]);

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
    if (!canEdit) return;
    const targetCode = nextCode === UNASSIGNED ? null : nextCode;
    if ((user.PositionCode ?? null) === targetCode) return;
    setSavingId(user.Id);
    setErr(null);
    try {
      await updateUser(user.Id, {
        positionCode: targetCode,
        expectedPositionCode: user.PositionCode ?? null
      });
      const freshUsers = await req<AdminUser[]>("/auth/org-users");
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
    if (!canEdit) return;
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
      const freshUsers = await req<AdminUser[]>("/auth/org-users");
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
    if (!canEdit) return;
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
      const freshUsers = await req<AdminUser[]>("/auth/org-users");
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

  // Zoom handlers
  const handleZoomIn = () => setZoom(z => Math.min(1.6, Number((z + 0.1).toFixed(1))));
  const handleZoomOut = () => setZoom(z => Math.max(0.4, Number((z - 0.1).toFixed(1))));
  const handleResetZoom = () => setZoom(1);

  // ─────────────────────────────────────────────────────────────
  // INTERNATIONAL STANDARD ORG CHART NODE CARD
  // ─────────────────────────────────────────────────────────────
  const renderDiagramCard = (node: TreePositionNode) => {
    const { position: p, children, occupants, isCycle, totalDescendants } = node;
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

    const isFilteredUnit = !unitFilter || p.OrgUnit === unitFilter;
    const mismatchedOccupants = occupants.filter(isDefaultRoleMismatched);

    return (
      <div
        id={`org-node-${p.PositionCode}`}
        className={`w-[270px] shrink-0 bg-white rounded-2xl border transition-all duration-200 shadow-xs relative flex flex-col ${
          isSearchMatch
            ? 'ring-4 ring-amber-400 border-amber-500 shadow-xl bg-amber-50/50 scale-[1.02] z-20'
            : isFilteredUnit
            ? `${theme.border} hover:shadow-md hover:border-slate-400 z-10`
            : 'border-slate-200 opacity-40 hover:opacity-100 z-0'
        }`}
      >
        {/* Unit Top Indicator Bar */}
        <div className={`h-1.5 w-full rounded-t-2xl ${theme.bar}`} />

        {/* Card Header */}
        <div className="p-3.5 pb-2.5">
          <div className="flex items-start justify-between gap-1.5 mb-1.5">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${theme.pill}`}>
              {p.OrgUnit}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                Tier {p.Tier}
              </span>
              {p.CanApprove && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-0.5" title="มีสิทธิ์อนุมัติเอกสาร">
                  <UserCheck size={11} /> อนุมัติ
                </span>
              )}
              {canEdit && (
                <div className="flex items-center gap-0.5 ml-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleOpenEdit(p); }}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-[#0C447C] transition-colors"
                    title="แก้ไขตำแหน่ง"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleOpenDelete(p); }}
                    className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"
                    title="ลบตำแหน่ง"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <h3 className="text-sm font-black text-slate-900 leading-snug line-clamp-2 min-h-[2.5rem]">
            {p.PositionName}
          </h3>

          <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1 font-mono">
            <span className="bg-slate-100 px-1.5 py-0.5 rounded font-bold text-slate-700">
              {p.PositionCode}
            </span>
            {p.DefaultRole && (
              <span className="text-slate-500 font-sans text-[10px]">
                Role: <strong className="text-slate-800">{p.DefaultRole}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Occupants Container */}
        <div className="px-3.5 py-2 border-t border-slate-100 bg-slate-50/50 flex-1 flex flex-col justify-center">
          {occupants.length === 0 ? (
            <div className="py-2.5 px-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-amber-900">
                <AlertTriangle size={13} className="text-amber-600" />
                <span>ตำแหน่งว่าง (0 คน)</span>
              </div>
              <p className="text-[10px] text-amber-700 mt-0.5">ยังไม่มีผู้ครองตำแหน่งนี้</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium px-0.5">
                <span>ผู้ครองตำแหน่ง ({occupants.length}):</span>
                {mismatchedOccupants.length > 0 && (
                  <span className="text-amber-700 font-bold flex items-center gap-0.5">
                    <AlertCircle size={10} /> บทบาทไม่ตรง
                  </span>
                )}
              </div>
              {occupants.map(u => {
                const isMismatched = isDefaultRoleMismatched(u);
                return (
                  <div
                    key={u.Id}
                    className={`flex items-center justify-between p-1.5 rounded-lg border text-xs ${
                      !u.IsActive
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : isMismatched
                        ? 'bg-amber-50 text-amber-900 border-amber-300'
                        : 'bg-white text-slate-800 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-[#0C447C] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                        {u.DisplayName.slice(0, 1)}
                      </div>
                      <div className="min-w-0 truncate">
                        <span className="font-bold text-[11px] block truncate">{u.DisplayName}</span>
                        <span className="text-[9px] text-slate-400 font-mono">@{u.Username}</span>
                      </div>
                    </div>
                    {u.EmpCode && (
                      <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                        {u.EmpCode}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Card Footer Actions */}
        <div className="p-2 border-t border-slate-100 bg-white rounded-b-2xl flex items-center justify-between gap-1">
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => setAssignModal({ isOpen: true, position: p })}
            className="flex-1 py-1 px-2 rounded-lg text-xs font-bold text-[#0C447C] hover:bg-blue-50 border border-blue-200 flex items-center justify-center gap-1 transition-colors"
          >
            <UserPlus size={13} />
            <span>มอบหมายคน</span>
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={() => handleOpenCreate(p.PositionCode)}
              className="py-1 px-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 border border-slate-200 flex items-center justify-center gap-1 transition-colors"
              title="เพิ่มตำแหน่งย่อยขึ้นตรงต่อตำแหน่งนี้"
            >
              <Plus size={13} />
              <span>+ตำแหน่งย่อย</span>
            </button>
          )}

          {isCycle && (
            <span className="text-[10px] font-bold text-red-600 px-1 py-0.5 bg-red-50 rounded">
              Cycle
            </span>
          )}
        </div>

        {/* Expand / Collapse Button Attached to Bottom */}
        {hasChildren && (
          <button
            type="button"
            onClick={() => toggleNode(p.PositionCode)}
            className={`absolute -bottom-3.5 left-1/2 -translate-x-1/2 z-30 px-2.5 py-0.5 rounded-full text-[11px] font-black shadow-xs border transition-all flex items-center gap-1 ${
              isExpanded
                ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                : 'bg-[#0C447C] text-white border-[#0a3866] hover:bg-[#0a3866]'
            }`}
            title={isExpanded ? 'ยุบสายงานใต้ตำแหน่งนี้' : `ขยาย ${children.length} ตำแหน่งย่อย`}
          >
            {isExpanded ? (
              <>
                <ChevronUp size={12} />
                <span>ยุบ</span>
              </>
            ) : (
              <>
                <ChevronDown size={12} />
                <span>+ {children.length} ({totalDescendants})</span>
              </>
            )}
          </button>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // RECURSIVE ORTHOGONAL TREE BRANCH RENDERER
  // ─────────────────────────────────────────────────────────────
  const renderDiagramSubtree = (node: TreePositionNode) => {
    const { position: p, children } = node;
    const isExpanded = expandedNodes.has(p.PositionCode);
    const hasChildren = children.length > 0;

    return (
      <div key={p.PositionCode} className="flex flex-col items-center">
        {/* Node Card */}
        {renderDiagramCard(node)}

        {/* Children Branch Container */}
        {hasChildren && isExpanded && (
          <div className="flex flex-col items-center w-full">
            {/* Vertical stem descending from parent card */}
            <div className="w-0.5 h-8 bg-slate-300 shrink-0" />

            {/* Horizontal Bus Bar & Children Nodes */}
            <div className="flex justify-center items-start relative pt-8">
              {/* Horizontal Crossbar line across multiple children */}
              {children.length > 1 && (
                <div
                  className="absolute top-0 h-0.5 bg-slate-300"
                  style={{
                    left: `calc(${100 / (children.length * 2)}%)`,
                    right: `calc(${100 / (children.length * 2)}%)`,
                  }}
                />
              )}

              {/* Child Subtrees */}
              {children.map(child => (
                <div
                  key={child.position.PositionCode}
                  className="flex flex-col items-center px-3 sm:px-4 relative shrink-0"
                >
                  {/* Vertical drop line from bus bar into child card */}
                  <div className="absolute -top-8 w-0.5 h-8 bg-slate-300" />
                  {renderDiagramSubtree(child)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#F1EFE8]">
      {/* ── UNIFIED TOOLBAR & CONTROLS ───────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-3.5 shadow-xs shrink-0 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Left: View Mode Switcher & Summary Chips */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setViewMode('diagram')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                viewMode === 'diagram'
                  ? 'bg-white text-[#0C447C] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Network size={15} />
              <span>ผังองค์กร (Diagram)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('matrix')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                viewMode === 'matrix'
                  ? 'bg-white text-[#0C447C] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers size={15} />
              <span>ตารางรายชื่อ (Matrix)</span>
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200 hidden sm:block" />

          {/* Quick Metrics */}
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-blue-50 text-[#0C447C] border border-blue-200 font-bold">
              ตำแหน่งทั้งหมด: {positions.length}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">
              ผูกแล้ว: {assignedActiveCount}/{activeUsers.length} คน
            </span>
            {vacantPositionsCount > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-bold">
                ตำแหน่งว่าง: {vacantPositionsCount}
              </span>
            )}
            {mismatchedUsersCount > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-rose-50 text-rose-800 border border-rose-200 font-bold">
                บทบาทไม่ตรง: {mismatchedUsersCount}
              </span>
            )}
          </div>
        </div>

        {/* Right: Search, Zoom & Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search bar */}
          <div className="relative min-w-[220px] sm:min-w-[260px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ค้นหาตำแหน่ง, รหัส, ชื่อบุคคล..."
              className="w-full pl-9 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:border-[#0C447C] focus:bg-white"
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

          {searchQuery && matchCount > 0 && (
            <span className="text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-1 rounded-lg">
              พบ {matchCount} รายการ
            </span>
          )}

          {viewMode === 'diagram' ? (
            <>
              {/* Zoom Controls */}
              <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-0.5 text-xs">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  className="p-1.5 rounded-lg hover:bg-white text-slate-700 transition-colors"
                  title="ย่อขนาด (-)"
                >
                  <ZoomOut size={15} />
                </button>
                <button
                  type="button"
                  onClick={handleResetZoom}
                  className="px-2 py-1 rounded-lg hover:bg-white font-mono text-[11px] font-bold text-slate-800"
                  title="รีเซ็ตขนาด 100%"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  className="p-1.5 rounded-lg hover:bg-white text-slate-700 transition-colors"
                  title="ขยายขนาด (+)"
                >
                  <ZoomIn size={15} />
                </button>
              </div>

              {/* Tree Expansion Shortcuts */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={expandAll}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  title="ขยายทุกกิ่งตำแหน่ง"
                >
                  ขยายทั้งหมด
                </button>
                <button
                  type="button"
                  onClick={expandExecutiveTiers}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  title="ขยายเฉพาะระดับผู้บริหาร Tier 1-2"
                >
                  ผู้บริหาร (Tier 1-2)
                </button>
                <button
                  type="button"
                  onClick={collapseAll}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  title="ยุบกิ่งทั้งหมดเหลือเฉพาะราก"
                >
                  ยุบทั้งหมด
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-xs"
            >
              <Download size={13} />
              <span>ส่งออก CSV</span>
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={() => handleOpenCreate()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-[#0C447C] text-white hover:bg-[#0A3866] shadow-xs transition-colors shrink-0"
              title="เพิ่มตำแหน่งใหม่ในผังองค์กร"
            >
              <Plus size={14} />
              <span>+ เพิ่มตำแหน่ง</span>
            </button>
          )}

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
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

      {/* ── MAIN CONTENT VIEW (FULL-WIDTH) ─────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col p-3 sm:p-5">
        {viewMode === 'diagram' ? (
          /* ── DIAGRAM VIEW: INTERNATIONAL STANDARD ORG CHART ── */
          <div
            ref={canvasRef}
            className="w-full flex-1 overflow-auto bg-[#F8F9FA] rounded-2xl border border-slate-200 p-6 sm:p-10 relative shadow-inner"
          >
            {/* Filter Pills Float Bar */}
            <div className="sticky top-0 left-0 z-30 mb-6 flex flex-wrap items-center gap-2 bg-white/90 backdrop-blur-xs p-2 rounded-xl border border-slate-200 shadow-xs max-w-fit">
              <span className="text-xs font-bold text-slate-600 flex items-center gap-1 pl-1">
                <Filter size={13} /> สายงาน:
              </span>
              <button
                type="button"
                onClick={() => setUnitFilter('')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  !unitFilter ? 'bg-[#0C447C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                ทั้งหมด ({positions.length})
              </button>
              {units.map(u => {
                const count = positions.filter(p => p.OrgUnit === u).length;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnitFilter(u === unitFilter ? '' : u)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      unitFilter === u
                        ? `${getUnitTheme(u).pill} shadow-xs font-black`
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {u} ({count})
                  </button>
                );
              })}
            </div>

            {loading && positions.length === 0 ? (
              <div className="py-24 text-center text-slate-400">
                <RefreshCw size={28} className="animate-spin mx-auto mb-2 text-[#0C447C]" />
                <p className="text-sm font-semibold">กำลังโหลดโครงสร้างผังองค์กรสากล...</p>
              </div>
            ) : rootNodes.length === 0 ? (
              <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
                <Network size={36} className="mx-auto mb-2 text-slate-300" />
                <p className="text-base font-bold text-slate-700">ไม่พบข้อมูลตำแหน่งในผังองค์กร</p>
              </div>
            ) : (
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top center',
                  transition: 'transform 0.15s ease-out'
                }}
                className="inline-block min-w-full pb-20 text-center"
              >
                {/* ── APEX ROOT: COMPANY HEADQUARTERS ─────────────── */}
                <div className="flex flex-col items-center">
                  <div className="w-[420px] bg-linear-to-r from-[#0C447C] to-[#1E62A6] text-white rounded-2xl p-4 shadow-lg border-2 border-white/20 relative z-10">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
                        <Building2 size={24} className="text-white" />
                      </div>
                      <div className="text-left min-w-0 flex-1">
                        {(companyInfo.taxId13 || companyInfo.taxId) && (
                          <div className="flex items-center justify-end mb-1">
                            <span className="text-[9px] font-mono bg-white/10 px-1.5 py-0.2 rounded text-blue-100 border border-white/15">
                              TAX: {companyInfo.taxId13 || companyInfo.taxId}
                            </span>
                          </div>
                        )}
                        <h2 className="text-base font-black tracking-wide truncate">
                          {companyInfo.compName || 'บริษัท เวิลด์ เฟอท จำกัด'}
                        </h2>
                        <p className="text-[11px] text-blue-100 truncate">
                          {companyInfo.compNameEng || 'WORLD FERT CO., LTD.'} · ผังองค์กร พ.ศ. 2568
                        </p>
                      </div>
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-white/15 flex items-center justify-between text-[11px] text-blue-100">
                      <span>สายงานราก: <strong>{rootNodes.length}</strong> สาย</span>
                      <span>ตำแหน่ง: <strong>{positions.length}</strong> อัตรา</span>
                      <span>ครองตำแหน่ง: <strong>{assignedActiveCount}</strong> คน</span>
                    </div>
                  </div>

                  {/* Vertical stem from company root to executive bus bar */}
                  <div className="w-0.5 h-8 bg-slate-300 shrink-0" />

                  {/* Horizontal Bus Bar for Tier 1 Executive Roots */}
                  <div className="flex justify-center items-start relative pt-8">
                    {rootNodes.length > 1 && (
                      <div
                        className="absolute top-0 h-0.5 bg-slate-300"
                        style={{
                          left: `calc(${100 / (rootNodes.length * 2)}%)`,
                          right: `calc(${100 / (rootNodes.length * 2)}%)`,
                        }}
                      />
                    )}

                    {/* Executive Branches */}
                    {rootNodes.map(rootNode => (
                      <div
                        key={rootNode.position.PositionCode}
                        className="flex flex-col items-center px-4 sm:px-6 relative shrink-0"
                      >
                        {/* Vertical drop line from company bus bar */}
                        <div className="absolute -top-8 w-0.5 h-8 bg-slate-300" />
                        {renderDiagramSubtree(rootNode)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── MATRIX VIEW: TABULAR / REASSIGNMENT VIEW ────── */
          <div className="w-full flex-1 flex flex-col overflow-hidden space-y-3">
            {/* Filter controls */}
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-wrap items-center gap-3 text-xs shadow-xs shrink-0">
              <span className="font-bold text-slate-700">กรองตาราง:</span>
              <select
                value={unitFilter}
                onChange={e => setUnitFilter(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-1.5 bg-slate-50 text-xs font-semibold"
              >
                <option value="">ทุกสายงาน ({units.length})</option>
                {units.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 font-medium">
                <input
                  type="checkbox"
                  checked={onlyUnassigned}
                  onChange={e => setOnlyUnassigned(e.target.checked)}
                  className="rounded text-[#0C447C]"
                />
                <span>เฉพาะที่ยังไม่ผูกตำแหน่ง ({unassignedActiveCount})</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 font-medium">
                <input
                  type="checkbox"
                  checked={onlyActive}
                  onChange={e => setOnlyActive(e.target.checked)}
                  className="rounded text-[#0C447C]"
                />
                <span>เฉพาะผู้ใช้งานที่เปิดใช้งาน (Active)</span>
              </label>

              <div className="ml-auto text-xs text-slate-500 font-medium">
                แสดง {matrixShown.length} จาก {users.length} รายการ
              </div>
            </div>

            {/* Full-Width Table */}
            <div className="flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-bold text-slate-600 text-left sticky top-0 z-10 backdrop-blur-xs">
                    <th className="px-4 py-3">ผู้ใช้</th>
                    <th className="px-4 py-3">บทบาท (Roles)</th>
                    <th className="px-4 py-3">รหัสพนักงาน</th>
                    <th className="px-4 py-3 min-w-[320px]">ตำแหน่งในผังองค์กร</th>
                    <th className="px-4 py-3">สายงาน</th>
                    <th className="px-4 py-3">ผู้อนุมัติ</th>
                    <th className="px-4 py-3 text-center">สถานะ</th>
                    <th className="px-4 py-3 text-center">จัดการตำแหน่ง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {matrixShown.map(u => {
                    const isMismatched = isDefaultRoleMismatched(u);
                    const userRoles = getUserBaseRoles(u);
                    const isSaving = savingId === u.Id;
                    const isSaved = savedId === u.Id;
                    const currentPos = u.PositionCode ? positionsByCode.get(u.PositionCode) : null;

                    return (
                      <tr key={u.Id} className={`hover:bg-slate-50/80 transition-colors ${!u.IsActive ? 'opacity-60 bg-slate-50/40' : ''}`}>
                        <td className="px-4 py-2.5">
                          <div className="font-bold text-slate-800">{u.DisplayName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">@{u.Username}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {userRoles.map(r => (
                              <span key={r} className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                {r}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600 font-semibold">
                          {u.EmpCode || '–'}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <select
                              value={u.PositionCode || UNASSIGNED}
                              onChange={e => handleMatrixAssign(u, e.target.value)}
                              disabled={!canEdit || isSaving}
                              className={`w-full max-w-md rounded-xl border px-3 py-1.5 text-xs bg-white transition-colors ${
                                isMismatched
                                  ? 'border-amber-300 bg-amber-50/50 text-amber-900 font-bold'
                                  : !u.PositionCode
                                  ? 'border-slate-300 text-slate-400'
                                  : 'border-slate-200 text-slate-800 font-medium'
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
                            {isSaving && <RefreshCw size={14} className="animate-spin text-[#0C447C] shrink-0" />}
                            {isSaved && <Check size={15} className="text-emerald-600 shrink-0" />}
                          </div>
                          {isMismatched && (
                            <div className="text-[10px] text-amber-700 mt-1 flex items-center gap-1 font-medium">
                              <AlertCircle size={11} /> บทบาทแนะนำ: {u.PositionDefaultRole} (ผู้ใช้มี {userRoles.join(', ')})
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {u.OrgUnit ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getUnitTheme(u.OrgUnit).pill}`}>
                              {u.OrgUnit}
                            </span>
                          ) : '–'}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {u.ApproverName || '–'}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {u.IsActive ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              ใช้งาน
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                              ปิดใช้งาน
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {currentPos ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => handleOpenEdit(currentPos)}
                                className="p-1 rounded text-slate-500 hover:text-[#0C447C] hover:bg-slate-100 disabled:opacity-40 transition-colors"
                                title="แก้ไขตำแหน่งนี้"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => handleOpenDelete(currentPos)}
                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors"
                                title="ลบตำแหน่งนี้"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-300">–</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {matrixShown.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-slate-400 font-semibold">
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

      {/* ── MODAL: ASSIGN USER TO POSITION ─────────────────── */}
      {assignModal.isOpen && assignModal.position && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
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
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2 font-medium">
                  <AlertTriangle size={15} className="text-rose-600 shrink-0" />
                  <span>{modalErr}</span>
                </div>
              )}

              {/* Position details */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5">
                <div className="flex justify-between text-slate-600">
                  <span>สายงาน:</span>
                  <span className="font-bold text-slate-900">{assignModal.position.OrgUnit}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>ระดับสายบังคับบัญชา:</span>
                  <span className="font-bold text-slate-900">Tier {assignModal.position.Tier}</span>
                </div>
                {assignModal.position.DefaultRole && (
                  <div className="flex justify-between text-slate-600">
                    <span>บทบาทแนะนำ:</span>
                    <span className="font-bold text-[#0C447C]">{assignModal.position.DefaultRole}</span>
                  </div>
                )}
                {assignModal.position.ReportsTo && (
                  <div className="flex justify-between text-slate-600">
                    <span>รายงานตรงต่อ:</span>
                    <span className="font-mono text-slate-800">{assignModal.position.ReportsTo}</span>
                  </div>
                )}
              </div>

              {/* Current Occupants */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  ผู้ครองตำแหน่งปัจจุบัน ({usersByPosition.get(assignModal.position.PositionCode)?.length || 0} คน):
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-xl p-2 bg-slate-50/50">
                  {(usersByPosition.get(assignModal.position.PositionCode) || []).length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-3">ยังไม่มีผู้ครองตำแหน่งนี้</div>
                  ) : (
                    (usersByPosition.get(assignModal.position.PositionCode) || []).map(u => (
                      <div key={u.Id} className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-slate-200 text-xs">
                        <div>
                          <span className="font-bold text-slate-800">{u.DisplayName}</span>
                          <span className="text-[10px] text-slate-400 ml-1.5 font-mono">@{u.Username}</span>
                          {!u.IsActive && <span className="ml-1.5 text-[9px] font-bold text-rose-600">[ปิดใช้งาน]</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleModalUnassign(u.Id)}
                          disabled={!canEdit || modalSaving}
                          className="text-rose-600 hover:text-rose-800 p-1 rounded-lg hover:bg-rose-50 text-[11px] font-bold flex items-center gap-1"
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
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs bg-white text-slate-800 font-medium focus:outline-hidden focus:border-[#0C447C]"
                >
                  <option value="">-- เลือกผู้ใช้งานในระบบ --</option>
                  {users
                    .filter(u => u.IsActive && u.PositionCode !== assignModal.position?.PositionCode)
                    .sort((a, b) => a.DisplayName.localeCompare(b.DisplayName, 'th'))
                    .map(u => (
                      <option key={u.Id} value={u.Id}>
                        {u.DisplayName} (@{u.Username}) {u.PositionName ? `[ตำแหน่งปัจจุบัน: ${u.PositionName}]` : '[ยังไม่มีตำแหน่ง]'}
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
                  <div className="space-y-2 p-3.5 bg-amber-50/80 border border-amber-300 rounded-xl text-xs text-amber-900">
                    <div className="font-bold text-slate-800">
                      สรุปการเปลี่ยนแปลงตำแหน่ง:
                    </div>
                    <div className="text-[11px] space-y-1">
                      <div>ตำแหน่งเดิม: <strong>{targetUser.PositionName || 'ยังไม่ผูกตำแหน่ง'}</strong></div>
                      <div>ตำแหน่งใหม่: <strong className="text-[#0C447C] font-black">{assignModal.position?.PositionName}</strong></div>
                    </div>

                    {hasDefaultMismatch && (
                      <div className="text-amber-900 pt-1.5 border-t border-amber-200 flex items-start gap-1 font-medium">
                        <AlertTriangle size={14} className="shrink-0 text-amber-600 mt-0.5" />
                        <span>
                          บทบาทของผู้ใช้ ({userRoles.join(', ')}) ไม่ตรงกับบทบาทแนะนำ ({assignModal.position?.DefaultRole}) — ระบบจะไม่เปลี่ยน Role ของผู้ใช้ให้อัตโนมัติ
                        </span>
                      </div>
                    )}

                    <div className="text-[10px] text-slate-600 pt-1 border-t border-amber-200">
                      ℹ️ การเปลี่ยนตำแหน่งจะส่งผลต่อขอบเขตการมองเห็นข้อมูล (Visible Scope) ของผู้ใช้ทันที
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
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleModalAssign}
                disabled={!canEdit || modalSaving || !assignModal.selectedUserId}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-[#0C447C] text-white hover:bg-[#0A3866] disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
              >
                {modalSaving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                <span>บันทึกการมอบหมาย</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CREATE / EDIT ORG POSITION ────────────────── */}
      {posModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <FolderTree size={18} className="text-[#0C447C]" />
                  {posModal.mode === 'create' ? 'เพิ่มตำแหน่งใหม่ในผังองค์กร' : 'แก้ไขตำแหน่งในผังองค์กร'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {posModal.mode === 'create'
                    ? 'กำหนดตำแหน่งใหม่ สายงาน ระดับ และสายการบังคับบัญชา'
                    : `${posModal.code} — ${posModal.name}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPosModal(s => ({ ...s, isOpen: false }))}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4">
              {posModal.err && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2 font-medium">
                  <AlertTriangle size={15} className="text-rose-600 shrink-0" />
                  <span>{posModal.err}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Position Code */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    รหัสตำแหน่ง (Position Code) *
                  </label>
                  <input
                    type="text"
                    disabled={posModal.mode === 'edit'}
                    value={posModal.code}
                    onChange={e => setPosModal(s => ({ ...s, code: e.target.value.toUpperCase() }))}
                    placeholder="เช่น ACC-COST-MAT"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono uppercase bg-slate-50 focus:bg-white focus:border-[#0C447C] focus:outline-hidden disabled:opacity-60 disabled:bg-slate-100"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    ตัวอักษรภาษาอังกฤษ A-Z, ตัวเลข 0-9, ขีดกลาง หรือขีดล่าง (2-30 ตัวอักษร)
                  </p>
                </div>

                {/* Position Name */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ชื่อตำแหน่ง (Position Name) *
                  </label>
                  <input
                    type="text"
                    value={posModal.name}
                    onChange={e => setPosModal(s => ({ ...s, name: e.target.value }))}
                    placeholder="เช่น บัญชีต้นทุน-วัตถุดิบ"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:border-[#0C447C] focus:outline-hidden"
                  />
                </div>

                {/* Org Unit */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    สายงาน (Org Unit) *
                  </label>
                  <select
                    value={posModal.orgUnit}
                    onChange={e => setPosModal(s => ({ ...s, orgUnit: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white focus:border-[#0C447C] focus:outline-hidden"
                  >
                    <option value="บริหาร">บริหาร (Executive / C-Level)</option>
                    <option value="บัญชี-การเงิน">บัญชี-การเงิน (Accounting & Finance)</option>
                    <option value="โรงงาน">โรงงาน (Plant & Production)</option>
                    <option value="ขาย-การตลาด">ขาย-การตลาด (Sales & Marketing)</option>
                  </select>
                </div>

                {/* Tier */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ระดับสายบังคับบัญชา (Tier) *
                  </label>
                  <select
                    value={posModal.tier}
                    onChange={e => setPosModal(s => ({ ...s, tier: parseInt(e.target.value, 10) || 1 }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white focus:border-[#0C447C] focus:outline-hidden"
                  >
                    <option value={1}>Tier 1: ผู้บริหารระดับสูง (C-Level / กรรมการบริหาร)</option>
                    <option value={2}>Tier 2: ผู้ช่วยกรรมการ / ผู้บริหารสายงาน</option>
                    <option value={3}>Tier 3: ผู้จัดการฝ่าย / ผู้อำนวยการ (Manager / Approver)</option>
                    <option value={4}>Tier 4: ผู้ช่วยผู้จัดการ / หัวหน้าแผนก (Chief / Head)</option>
                    <option value={5}>Tier 5: พนักงานปฏิบัติการ (Staff / Specialist)</option>
                  </select>
                </div>

                {/* Reports To */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    รายงานตรงต่อ / ผู้บังคับบัญชา (Reports To)
                  </label>
                  <select
                    value={posModal.reportsTo}
                    onChange={e => setPosModal(s => ({ ...s, reportsTo: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white focus:border-[#0C447C] focus:outline-hidden"
                  >
                    <option value="">(ไม่มี - ตำแหน่งสูงสุด / Tier 1 Root)</option>
                    {units.map(unit => (
                      <optgroup key={unit} label={`สายงาน ${unit}`}>
                        {positions
                          .filter(p => p.OrgUnit === unit && (posModal.mode === 'create' || p.PositionCode !== posModal.code))
                          .sort((a, b) => a.Tier - b.Tier || a.PositionName.localeCompare(b.PositionName, 'th'))
                          .map(p => {
                            const isCycle = posModal.mode === 'edit' && isDescendantOf(p.PositionCode, posModal.code);
                            return (
                              <option key={p.PositionCode} value={p.PositionCode} disabled={isCycle}>
                                {p.PositionName} ({p.PositionCode}) [Tier {p.Tier}]{isCycle ? ' (วงวนรอบ - ห้ามเลือก)' : ''}
                              </option>
                            );
                          })}
                      </optgroup>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">
                    เลือกหัวหน้างานเพื่อกำหนดสายบังคับบัญชา และลำดับการอนุมัติเอกสารอัตโนมัติ
                  </p>
                </div>

                {/* Default Role */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    บทบาทเริ่มต้นในแอป (Default Role)
                  </label>
                  <select
                    value={posModal.defaultRole}
                    onChange={e => setPosModal(s => ({ ...s, defaultRole: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white focus:border-[#0C447C] focus:outline-hidden"
                  >
                    <option value="">(ไม่ระบุบทบาทเฉพาะ)</option>
                    <option value="C_LEVEL">C_LEVEL</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="APPROVER">APPROVER</option>
                    <option value="ACCOUNTING">ACCOUNTING</option>
                    <option value="WAREHOUSE">WAREHOUSE</option>
                    <option value="WEIGHBRIDGE">WEIGHBRIDGE</option>
                    <option value="SALES">SALES</option>
                    <option value="COUNTER_SALES">COUNTER_SALES</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>

                {/* Toggles */}
                <div className="flex flex-col justify-center space-y-2 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={posModal.canApprove}
                      onChange={e => setPosModal(s => ({ ...s, canApprove: e.target.checked }))}
                      className="rounded text-[#0C447C] w-4 h-4"
                    />
                    <span>มีสิทธิ์อนุมัติเอกสารในระบบ (Can Approve)</span>
                  </label>

                  {posModal.mode === 'edit' && (
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={posModal.isActive}
                        onChange={e => setPosModal(s => ({ ...s, isActive: e.target.checked }))}
                        className="rounded text-[#0C447C] w-4 h-4"
                      />
                      <span>เปิดใช้งานตำแหน่งนี้ (Active)</span>
                    </label>
                  )}
                </div>

                {/* Note */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    หมายเหตุ / หน้าที่รับผิดชอบ
                  </label>
                  <textarea
                    rows={2}
                    value={posModal.note}
                    onChange={e => setPosModal(s => ({ ...s, note: e.target.value }))}
                    placeholder="ระบุคำอธิบายหรือหน้าที่ความรับผิดชอบของตำแหน่งนี้..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:border-[#0C447C] focus:outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPosModal(s => ({ ...s, isOpen: false }))}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSavePosition}
                disabled={posModal.saving}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-[#0C447C] text-white hover:bg-[#0A3866] disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
              >
                {posModal.saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                <span>{posModal.mode === 'create' ? 'สร้างตำแหน่ง' : 'บันทึกการแก้ไข'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: DELETE ORG POSITION CONFIRMATION ─────────── */}
      {delModal.isOpen && delModal.position && (() => {
        const p = delModal.position;
        const occupants = usersByPosition.get(p.PositionCode) || [];
        const children = positions.filter(child => child.ReportsTo === p.PositionCode);
        const cannotDelete = occupants.length > 0 || children.length > 0;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
              <div className="p-6">
                <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
                  <Trash2 size={24} />
                </div>
                <h3 className="text-base font-black text-slate-900 mb-1">
                  ยืนยันการลบตำแหน่ง
                </h3>
                <p className="text-xs text-slate-600 font-bold mb-3">
                  {p.PositionName} ({p.PositionCode}) [Tier {p.Tier}]
                </p>

                {delModal.err && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 mb-3 font-medium">
                    {delModal.err}
                  </div>
                )}

                {cannotDelete ? (
                  <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 space-y-2">
                    <div className="font-bold flex items-center gap-1.5 text-amber-800">
                      <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                      <span>ไม่สามารถลบตำแหน่งนี้ได้ในขณะนี้:</span>
                    </div>
                    {occupants.length > 0 && (
                      <p className="text-[11px]">
                        • มีผู้ใช้งาน <strong>{occupants.length}</strong> คนผูกอยู่กับตำแหน่งนี้ ({occupants.map(u => u.DisplayName).join(', ')}) — กรุณาย้ายผู้ใช้ออกก่อน
                      </p>
                    )}
                    {children.length > 0 && (
                      <p className="text-[11px]">
                        • มีตำแหน่งย่อย <strong>{children.length}</strong> ตำแหน่งขึ้นตรงต่อตำแหน่งนี้ ({children.map(c => c.PositionName).join(', ')}) — กรุณาย้ายสายบังคับบัญชาก่อน
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    คุณแน่ใจหรือไม่ว่าต้องการลบตำแหน่งนี้ออกจากผังองค์กร? เมื่อลบแล้วผังบังคับบัญชาจะถูกปรับปรุงทันที และไม่สามารถเรียกคืนได้
                  </p>
                )}
              </div>

              <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDelModal({ isOpen: false, position: null, deleting: false, err: null })}
                  className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={cannotDelete || delModal.deleting}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 flex items-center gap-1.5 shadow-xs"
                >
                  {delModal.deleting ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  <span>ยืนยันลบตำแหน่ง</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
