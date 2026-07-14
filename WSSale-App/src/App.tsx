import { useState, useEffect, lazy, Suspense } from 'react';
import {
  Boxes, ShoppingCart, Warehouse, ChevronLeft, ChevronRight, Bell, LogOut,
  Users, LayoutDashboard, Coins, FileCheck, FileCheck2, Gift, FileText, LayoutGrid, Database, Clock, Ticket, ClipboardList, Stamp, BarChart3, Scale, ShieldCheck, Activity, BookOpen, ScrollText, Landmark, Inbox,
  Menu, ChevronDown, Settings, CheckCircle2,
  Folder, Wallet, Calculator, Truck, Unlock
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useErpStore } from './store/erp-store';
import { useAuthStore } from './store/auth-store';
import { getMe, listAccessAsCandidates, listUnlockRequests, startAccessAs, stopAccessAs } from './services/api';
import type { AdminUser, UserRole } from './types';
import LoginPage from './pages/LoginPage';
import { DbModeSwitch } from './components/common/DbModeSwitch';
import { useAppStore } from './store/app-store';
import { GlobalLoader } from './components/common/GlobalLoader';
import { MobileDrawer } from './components/common/MobileDrawer';
import type { NavItem, NavGroup } from './components/common/MobileDrawer';
import { UnlockReviewModal } from './components/papertrail/UnlockReviewModal';

export type PortalKey = 'dashboard' | 'sales' | 'quotation' | 'store' | 'papertrail' | 'rebate' | 'rebate-plan' | 'cn-rebate' | 'control-ticket' | 'accounting' | 'recon' | 'giveaway' | 'aging' | 'reports' | 'truckscale' | 'weigh-inbox' | 'policy' | 'governance' | 'ops' | 'admin' | 'master' | 'profile';

const SalesPortal = lazy(() => import('./components/sales/SalesPortal').then(m => ({ default: m.SalesPortal })));
const StorePortal = lazy(() => import('./components/store/StorePortal').then(m => ({ default: m.StorePortal })));
const DashboardPage = lazy(() => import('./components/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const RebatePage = lazy(() => import('./components/rebate/RebatePage').then(m => ({ default: m.RebatePage })));
const CnRebatePage = lazy(() => import('./components/rebate/CnRebatePage').then(m => ({ default: m.CnRebatePage })));
const RebatePlanPage = lazy(() => import('./components/rebate/RebatePlanPage').then(m => ({ default: m.RebatePlanPage })));
const ControlTicketPage = lazy(() => import('./components/master/ControlTicketPage').then(m => ({ default: m.ControlTicketPage })));
const ReportsPage = lazy(() => import('./components/reports/ReportsPage').then(m => ({ default: m.ReportsPage })));
const TruckScalePage = lazy(() => import('./components/truckscale/TruckScalePage').then(m => ({ default: m.TruckScalePage })));
const WeighInboxPage = lazy(() => import('./components/truckscale/WeighInboxPage').then(m => ({ default: m.WeighInboxPage })));
const AccountingPage = lazy(() => import('./components/accounting/AccountingPage').then(m => ({ default: m.AccountingPage })));
const GiveawayPage = lazy(() => import('./components/giveaway/GiveawayPage').then(m => ({ default: m.GiveawayPage })));
const QuotationPage = lazy(() => import('./components/quotation/QuotationPage').then(m => ({ default: m.QuotationPage })));
const PaperTrailPage = lazy(() => import('./components/papertrail/PaperTrailPage').then(m => ({ default: m.PaperTrailPage })));
const AdminUsersPage = lazy(() => import('./components/admin/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const ProfilePage = lazy(() => import('./components/profile/ProfilePage'));
const MasterDataPortal = lazy(() => import('./components/master/MasterDataPortal').then(m => ({ default: m.MasterDataPortal })));
const AgingPage = lazy(() => import('./components/aging/AgingPage').then(m => ({ default: m.AgingPage })));

const ReconciliationPage = lazy(() => import('./components/recon/ReconciliationPage').then(m => ({ default: m.ReconciliationPage })));
const OpsStatusPage = lazy(() => import('./components/ops/OpsStatusPage').then(m => ({ default: m.OpsStatusPage })));
const ApprovalPolicyPage = lazy(() => import('./components/policy/ApprovalPolicyPage').then(m => ({ default: m.ApprovalPolicyPage })));
const DataGovernancePage = lazy(() => import('./components/governance/DataGovernancePage').then(m => ({ default: m.DataGovernancePage })));

// ── Grouped Navigation ──────────────────────────────────────
const NAV_GROUPS: NavGroup[] = [
  {
    groupLabel: 'หลัก',
    icon: Folder,
    color: 'text-blue-600',
    items: [
      { key: 'dashboard',  label: 'Dashboard',  sub: 'ภาพรวม',              icon: LayoutDashboard },
      { key: 'sales',      label: 'ขาย',         sub: 'ใบสั่งขาย (POS)',     icon: ShoppingCart },
      { key: 'quotation',  label: 'เสนอราคา',    sub: 'Quotation → SO',      icon: FileText },
      { key: 'store',      label: 'คลัง',        sub: 'รับสินค้า/ส่งออก',     icon: Warehouse, badge: true },
      { key: 'papertrail', label: 'Paper Trail', sub: 'Kanban เอกสาร',       icon: LayoutGrid },
      { key: 'aging',      label: 'ตั๋วคงค้าง',   sub: 'SO คงค้าง · ค้นหา',   icon: Clock },
    ],
  },
  {
    groupLabel: 'การเงิน',
    icon: Wallet,
    color: 'text-emerald-600',
    items: [
      { key: 'rebate',     label: 'รีเบท (App)', sub: 'Pool · เคลม · wf',      icon: Coins, roles: ['ADMIN', 'MANAGER', 'ACCOUNTING', 'APPROVER', 'SALES'] },
      { key: 'rebate-plan',label: 'Rebate Plan', sub: 'แผน · จัดสรรงบ',        icon: ClipboardList, roles: ['ADMIN', 'MANAGER', 'APPROVER', 'ACCOUNTING'] },
      { key: 'cn-rebate',  label: 'CN Rebate',   sub: 'ใบลดหนี้ · Winspeed',   icon: FileCheck2, roles: ['ACCOUNTING', 'ADMIN', 'MANAGER'] },
      { key: 'giveaway',   label: 'ของแถม',      sub: 'งบรายภาค · เบิก',     icon: Gift },
    ],
  },
  {
    groupLabel: 'บัญชี',
    icon: Calculator,
    color: 'text-purple-600',
    items: [
      { key: 'accounting', label: 'บัญชี',       sub: 'Sync · อนุมัติ CN',    icon: FileCheck, roles: ['ACCOUNTING', 'ADMIN', 'MANAGER'] },
      { key: 'recon',      label: 'กระทบยอด',    sub: 'Recon · ตรวจออกของ',   icon: ShieldCheck, roles: ['ACCOUNTING', 'ADMIN', 'MANAGER'] },
      { key: 'reports',    label: 'รายงาน',      sub: 'สรุป · Export Excel',  icon: BarChart3, roles: ['ADMIN', 'MANAGER', 'ACCOUNTING', 'APPROVER'] },
      { key: 'control-ticket', label: 'ชุดตั๋วคุม', sub: 'คงเหลือ · ตัดออก',   icon: Stamp },
    ],
  },
  {
    groupLabel: 'คลัง/ชั่ง',
    icon: Truck,
    color: 'text-orange-600',
    items: [
      { key: 'truckscale', label: 'TruckScale',  sub: 'เครื่องชั่ง · MySQL',  icon: Scale, roles: ['WAREHOUSE', 'WEIGHBRIDGE', 'COUNTER_SALES', 'ADMIN', 'MANAGER'] },
      { key: 'weigh-inbox',label: 'Weigh Inbox', sub: 'ดึงชั่ง · จับคู่ SO',     icon: Inbox, roles: ['WAREHOUSE', 'WEIGHBRIDGE', 'COUNTER_SALES', 'ADMIN', 'MANAGER'] },
    ],
  },
  {
    groupLabel: 'ตั้งค่าระบบ',
    icon: Settings,
    color: 'text-slate-600',
    items: [
      { key: 'master',     label: 'ข้อมูลหลัก',  sub: 'สินค้า · ลูกค้า',       icon: Database, roles: ['ADMIN'] },
      { key: 'policy',     label: 'นโยบายอนุมัติ', sub: 'อำนาจ · วงเงิน',       icon: ScrollText, roles: ['ADMIN', 'MANAGER'] },
      { key: 'governance', label: 'กำกับข้อมูล',  sub: 'เครดิต · สต๊อก · PDPA',  icon: Landmark, roles: ['ADMIN', 'MANAGER', 'ACCOUNTING'] },
      { key: 'ops',        label: 'สถานะระบบ',   sub: 'Health · error · alert', icon: Activity, roles: ['ADMIN', 'MANAGER'] },
      { key: 'admin',      label: 'ผู้ใช้งาน',    sub: 'Map พนักงาน',         icon: Users, roles: ['ADMIN', 'MANAGER', 'ACCOUNTING'] },
    ],
  },
];

// Flatten for lookups
const ALL_NAV: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

// Mobile bottom tab bar items (fixed 4 + "More")
const MOBILE_TABS: (NavItem & { isMobileOnly?: boolean })[] = [
  { key: 'dashboard',  label: 'Dashboard',  sub: '',  icon: LayoutDashboard },
  { key: 'papertrail', label: 'เอกสาร',      sub: '',  icon: LayoutGrid },
  { key: 'sales',      label: 'ขาย',         sub: '',  icon: ShoppingCart },
  { key: 'store',      label: 'คลัง',        sub: '',  icon: Warehouse, badge: true },
];

const ACCESS_AS_ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTING', 'APPROVER', 'COUNTER_SALES'];

function PageFallback() {
  return (
    <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-3 shadow-sm">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0C447C] border-t-transparent" />
        <span>กำลังโหลดหน้า...</span>
      </div>
    </div>
  );
}

function App() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);

  useEffect(() => {
    if (isAuthenticated && !user) {
      getMe().then(u => {
        useAuthStore.getState().login(useAuthStore.getState().token || '', u);
        useAuthStore.setState({ user: u });
      }).catch(() => logout());
    }
  }, [isAuthenticated, user, logout]);

  useEffect(() => {
    const onAuthExpired = () => logout();
    window.addEventListener('wssale:auth-expired', onAuthExpired);
    return () => window.removeEventListener('wssale:auth-expired', onAuthExpired);
  }, [logout]);

  if (!isAuthenticated) return <LoginPage />;
  if (isAuthenticated && !user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F1EFE8]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0C447C]" />
      </div>
    );
  }

  return <AppShell user={user} logout={logout} />;
}

function AppShell({ user, logout }: { user: NonNullable<ReturnType<typeof useAuthStore.getState>['user']>; logout: () => void }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ 'หลัก': true });
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [showUnlockReview, setShowUnlockReview] = useState(false);
  const [showAccessAs, setShowAccessAs] = useState(false);
  const [accessAsUsers, setAccessAsUsers] = useState<AdminUser[]>([]);
  const [accessAsLoading, setAccessAsLoading] = useState(false);
  const [accessAsSearch, setAccessAsSearch] = useState('');
  const { activePortal, navigate } = useAppStore();
  const setUnlockRequests = useErpStore(s => s.setUnlockRequests);
  const pendingUnlocks = useErpStore(s => s.unlockRequests.length);
  const role = user?.role;
  const actorRole = user?.actorRole || role;
  const canReviewUnlocks = ['APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING'].includes(role || '');
  const canUseAccessAs = Boolean(actorRole && ACCESS_AS_ROLES.includes(actorRole));

  useEffect(() => {
    const activeGroup = NAV_GROUPS.find(g => g.items.some(n => n.key === activePortal));
    if (activeGroup && !expandedGroups[activeGroup.groupLabel]) {
      setExpandedGroups(prev => ({ ...prev, [activeGroup.groupLabel]: true }));
    }
  }, [activePortal, expandedGroups]);

  useEffect(() => {
    const poll = async () => {
      try { setUnlockRequests(await listUnlockRequests('PENDING', true)); }
      catch (e) { console.error('Polling failed', e); }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, [setUnlockRequests]);

  useEffect(() => {
    if (!showAccessAs || !canUseAccessAs) return;
    setAccessAsLoading(true);
    listAccessAsCandidates()
      .then(setAccessAsUsers)
      .catch(e => console.error('Access As users failed', e))
      .finally(() => setAccessAsLoading(false));
  }, [showAccessAs, canUseAccessAs]);

  const filteredAccessAsUsers = accessAsUsers.filter(u => {
    const term = accessAsSearch.trim().toLowerCase();
    if (!term) return true;
    return [u.DisplayName, u.Username, u.Role, u.EmpCode, u.EmpName]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(term));
  });

  const switchAccessAs = async (targetId: number) => {
    setAccessAsLoading(true);
    try {
      const session = await startAccessAs(targetId);
      useAuthStore.getState().login(session.accessToken, session.user);
      setShowAccessAs(false);
      setAccessAsSearch('');
    } catch (e) {
      alert((e as Error).message || 'Access As failed');
    } finally {
      setAccessAsLoading(false);
    }
  };

  const stopAccessAsSession = async () => {
    setAccessAsLoading(true);
    try {
      const session = await stopAccessAs();
      useAuthStore.getState().login(session.accessToken, session.user);
      setShowAccessAs(false);
      setAccessAsSearch('');
    } catch (e) {
      alert((e as Error).message || 'Stop Access As failed');
    } finally {
      setAccessAsLoading(false);
    }
  };

  const current = ALL_NAV.find(n => n.key === activePortal);
  const portalLabel = current ? `${current.label} — ${current.sub}` : '';
  const toggleGroup = (groupLabel: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupLabel]: !prev[groupLabel] }));
  };
  const navBtnClass = (active: boolean, collapsed: boolean) =>
    `relative w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-all ${
      active ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
    } ${collapsed ? 'justify-center' : ''}`;
  const isGroupActive = (group: NavGroup) => group.items.some(n => n.key === activePortal);
  const getVisibleItems = (items: NavItem[]) =>
    items.filter(n => !n.roles || (role && n.roles.includes(role)));

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <aside className={`hidden shrink-0 flex-col border-r border-border bg-sidebar md:flex transition-all duration-300 ${isSidebarCollapsed ? 'w-16' : 'w-60'}`}>
        <div className={`flex h-14 items-center border-b border-border transition-all ${isSidebarCollapsed ? 'justify-center' : 'gap-2.5 px-5'}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: '#0C447C' }}>
            <span className="text-xs font-bold">WF</span>
          </div>
          {!isSidebarCollapsed && (
            <div className="flex flex-col leading-tight animate-in fade-in duration-300">
              <span className="text-sm font-semibold flex items-center gap-1.5">
                WS-Sale-App
                <span className="text-[9px] bg-blue-100 text-blue-800 px-1 rounded font-bold">v5.0.12</span>
              </span>
              <span className="text-[11px] text-muted-foreground">World Fert</span>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 overflow-y-auto custom-scrollbar">
          {NAV_GROUPS.map((group, gi) => {
            const visibleItems = getVisibleItems(group.items);
            if (visibleItems.length === 0) return null;
            const isExpanded = expandedGroups[group.groupLabel] ?? false;
            const groupActive = isGroupActive(group);
            return (
              <div key={group.groupLabel}>
                {gi > 0 && <div className="nav-group-divider" />}
                <button
                  onClick={() => toggleGroup(group.groupLabel)}
                  className={`w-full flex items-center cursor-pointer transition-colors ${
                    isSidebarCollapsed 
                      ? 'justify-center p-2 mb-1 rounded-lg hover:bg-accent/60' 
                      : 'nav-group-label justify-between hover:text-foreground'
                  } ${groupActive && isSidebarCollapsed ? 'bg-accent/40' : ''} ${groupActive && !isSidebarCollapsed ? group.color : 'text-muted-foreground'}`}
                  title={isSidebarCollapsed ? group.groupLabel : ''}
                >
                  {isSidebarCollapsed ? (
                    group.icon && <group.icon size={18} className={group.color} />
                  ) : (
                    <>
                      <div className={`flex items-center gap-2 ${group.color}`}>
                        {group.icon && <group.icon size={14} />}
                        <span>{group.groupLabel}</span>
                      </div>
                      <ChevronDown size={12} className={`transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
                    </>
                  )}
                </button>
                <div
                  className={`nav-group-items space-y-0.5 ${isExpanded ? 'expanded' : 'collapsed'}`}
                  style={isExpanded ? { maxHeight: `${visibleItems.length * 52}px` } : undefined}
                >
                  {visibleItems.map(n => {
                    const Icon = n.icon;
                    return (
                      <button key={n.key} onClick={() => {
                        if (n.key === 'approvals') {
                          setShowUnlockReview(true);
                          return;
                        }
                        navigate(n.key as PortalKey);
                      }}
                        title={isSidebarCollapsed ? n.label : ''} className={navBtnClass(activePortal === n.key, isSidebarCollapsed)}>
                        <Icon className={`shrink-0 ${isSidebarCollapsed ? 'h-5 w-5' : 'h-4 w-4'} ${activePortal === n.key ? '' : (group.color || '')}`} />
                        {!isSidebarCollapsed && (
                          <div className="flex flex-col text-left animate-in fade-in slide-in-from-left-2 duration-300">
                            <span className="font-medium">{n.label}</span>
                            <span className="text-[11px] text-muted-foreground">{n.sub}</span>
                          </div>
                        )}
                        {n.badge && pendingUnlocks > 0 && (
                          <span className={`absolute bg-amber-500 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${
                            isSidebarCollapsed ? 'top-1.5 right-1.5 h-3.5 w-3.5' : 'top-3 right-3 h-4 w-4'}`}>
                            {pendingUnlocks}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-2 border-t border-border space-y-1">
          {!isSidebarCollapsed && user && (
            <div className="px-3 py-2 mx-1 mb-2 bg-gray-50 border border-gray-100 rounded-lg flex flex-col">
              <span className="text-xs font-bold text-gray-800">{user.displayName}</span>
              <span className="text-[10px] font-semibold text-[#0C447C] mt-0.5">Role: {user.role}</span>
              {user.isImpersonating && (
                <span className="text-[10px] text-amber-700 mt-0.5">By: {user.actorDisplayName}</span>
              )}
            </div>
          )}
          {role === 'ADMIN' && <DbModeSwitch collapsed={isSidebarCollapsed} />}
          <button onClick={logout} title="ออกจากระบบ"
            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors ${isSidebarCollapsed ? 'justify-center' : ''}`}>
            <LogOut className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && <span>ออกจากระบบ</span>}
          </button>
          <button onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="w-full flex h-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col pb-16 md:pb-0 min-w-0">
        <header className="glass-header sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-4 md:px-6">
          <div className="flex items-center gap-2.5 md:hidden">
            <Boxes className="h-5 w-5" />
            <span className="text-sm font-semibold">WS-Sale-App</span>
          </div>
          <div className="hidden text-sm text-muted-foreground md:block">{portalLabel}</div>
          <div className="flex items-center gap-3">
            <button className="relative rounded-lg p-2 text-muted-foreground hover:bg-accent transition-colors" onClick={() => navigate('store')} title="แจ้งเตือน">
              <Bell className="h-5 w-5" />
            </button>
            {canReviewUnlocks && (
              <button className="relative rounded-lg p-2 text-muted-foreground hover:bg-amber-50 hover:text-amber-700 transition-colors" onClick={() => setShowUnlockReview(true)} title="คำขออนุมัติ">
                <Unlock className="h-5 w-5" />
                {pendingUnlocks > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                    {pendingUnlocks}
                  </span>
                )}
              </button>
            )}
            {canUseAccessAs && (
              <div className="relative">
                <button
                  className={`relative rounded-lg p-2 transition-colors ${
                    user?.isImpersonating
                      ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                  onClick={() => setShowAccessAs(v => !v)}
                  title="Access As"
                >
                  <Users className="h-5 w-5" />
                  {user?.isImpersonating && (
                    <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
                  )}
                </button>
                {showAccessAs && (
                  <div className="absolute right-0 mt-2 w-80 rounded-xl border border-border bg-white p-3 shadow-xl z-50">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-gray-900">Access As</div>
                        <div className="text-[11px] text-muted-foreground">
                          ตัวจริง: {user?.actorDisplayName || user?.displayName} ({actorRole})
                        </div>
                      </div>
                      <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAccessAs(false)}>ปิด</button>
                    </div>

                    {user?.isImpersonating && (
                      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2">
                        <div className="text-xs font-semibold text-amber-900">กำลังทำงานแทน {user.displayName}</div>
                        <button
                          onClick={stopAccessAsSession}
                          disabled={accessAsLoading}
                          className="mt-2 w-full rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          กลับเป็น {user.actorDisplayName || 'ตัวจริง'}
                        </button>
                      </div>
                    )}

                    <input
                      value={accessAsSearch}
                      onChange={e => setAccessAsSearch(e.target.value)}
                      placeholder="ค้นหาชื่อ / username / role"
                      className="mb-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0C447C]/20"
                    />

                    <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-1">
                      {accessAsLoading ? (
                        <div className="py-5 text-center text-xs text-muted-foreground">กำลังโหลด...</div>
                      ) : filteredAccessAsUsers.length === 0 ? (
                        <div className="py-5 text-center text-xs text-muted-foreground">ไม่มีผู้ใช้ที่สามารถ Access As ได้</div>
                      ) : filteredAccessAsUsers.map(u => (
                        <button
                          key={u.Id}
                          onClick={() => switchAccessAs(u.Id)}
                          className="w-full rounded-lg px-3 py-2 text-left hover:bg-accent transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-gray-900">{u.DisplayName}</span>
                            <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">{u.Role}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {u.Username}{u.EmpName ? ` · ${u.EmpName}` : ''}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="hidden items-center gap-2 sm:flex">
              <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm" style={{ background: '#0C447C' }}>
                {user?.displayName?.charAt(0) ?? '?'}
              </div>
              <div className="text-xs leading-tight">
                <div className="font-medium">{user?.displayName}</div>
                <div className="text-muted-foreground">
                  {user?.isImpersonating ? `Access as ${user.role}` : user?.role}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden min-w-0 max-w-full flex flex-col">
          <Suspense fallback={<PageFallback />}>
            {activePortal === 'sales' ? (
              <SalesPortal />
            ) : (
              <div className="h-full w-full overflow-auto custom-scrollbar">
                {activePortal === 'dashboard'  && <DashboardPage />}
                {activePortal === 'quotation'  && <QuotationPage />}
                {activePortal === 'store'      && <StorePortal />}
                {activePortal === 'papertrail' && <PaperTrailPage />}
                {activePortal === 'rebate'     && <RebatePage />}
                {activePortal === 'rebate-plan' && <RebatePlanPage />}
                {activePortal === 'cn-rebate'  && <CnRebatePage />}
                {activePortal === 'control-ticket' && <ControlTicketPage />}
                {activePortal === 'reports'    && <ReportsPage />}
                {activePortal === 'truckscale' && <TruckScalePage />}
                {activePortal === 'weigh-inbox' && <WeighInboxPage />}
                {activePortal === 'accounting' && <AccountingPage />}
                {activePortal === 'recon'      && <ReconciliationPage />}

                {activePortal === 'policy'     && <ApprovalPolicyPage />}
                {activePortal === 'governance' && <DataGovernancePage />}
                {activePortal === 'ops'        && <OpsStatusPage />}
                {activePortal === 'giveaway'   && <GiveawayPage />}
                {activePortal === 'aging'      && <AgingPage />}
                {activePortal === 'profile'    && <ProfilePage />}
                {activePortal === 'admin'      && ['ADMIN', 'MANAGER', 'ACCOUNTING'].includes(role || '') && <AdminUsersPage />}
                {activePortal === 'master'     && role === 'ADMIN' && <MasterDataPortal />}
              </div>
            )}
          </Suspense>
        </main>
      </div>

      {/* Mobile Bottom Tab Bar — 4 fixed + "More" */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-background safe-bottom md:hidden h-[60px] items-center px-1">
        {MOBILE_TABS.map(n => {
          const Icon = n.icon;
          const isSales = n.key === 'sales';
          const isActive = activePortal === n.key;
          
          if (isSales) {
            return (
              <div key={n.key} className="relative flex flex-1 justify-center">
                <button 
                  onClick={() => { navigate(n.key as PortalKey); setIsMobileDrawerOpen(false); }}
                  className="absolute -top-6 flex flex-col items-center justify-center w-14 h-14 rounded-full shadow-lg transition-transform active:scale-95"
                  style={{ background: '#0C447C', color: 'white' }}
                >
                  <Icon className="h-6 w-6 mb-0.5" />
                  <span className="text-[9px] font-bold leading-none">{n.label}</span>
                </button>
              </div>
            );
          }

          return (
            <button key={n.key} onClick={() => {
              if (n.key === 'approvals') {
                setShowUnlockReview(true);
                setIsMobileDrawerOpen(false);
                return;
              }
              navigate(n.key as PortalKey);
              setIsMobileDrawerOpen(false);
            }}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
                isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
              <Icon className="h-5 w-5" />
              {n.label}
              {n.badge && pendingUnlocks > 0 && (
                <span className="absolute top-1 right-1/4 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                  {pendingUnlocks}
                </span>
              )}
            </button>
          );
        })}
        {/* "More" tab */}
        <button
          onClick={() => setIsMobileDrawerOpen(true)}
          className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
            isMobileDrawerOpen || !MOBILE_TABS.some(t => t.key === activePortal) ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          <Menu className="h-5 w-5" />
          เพิ่มเติม
        </button>
      </nav>

      {/* Mobile Navigation Drawer */}
      <MobileDrawer
        isOpen={isMobileDrawerOpen}
        onClose={() => setIsMobileDrawerOpen(false)}
        groups={NAV_GROUPS}
        activePortal={activePortal}
        userRole={role}
        pendingUnlocks={pendingUnlocks}
        onNavigate={(key) => {
          if (key === 'approvals') {
            setShowUnlockReview(true);
            return;
          }
          navigate(key as PortalKey);
        }}
      />

      {showUnlockReview && (
        <UnlockReviewModal
          onClose={() => setShowUnlockReview(false)}
          onDone={() => setUnlockRequests([]) /* Force repoll logic by clearing local state */}
        />
      )}

      <GlobalLoader />
    </div>
  );
}

export default App;
