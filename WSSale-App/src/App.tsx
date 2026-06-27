import { useState, useEffect } from 'react';
import {
  Boxes, ShoppingCart, Warehouse, ChevronLeft, ChevronRight, Bell, LogOut,
  Users, LayoutDashboard, Coins, FileCheck, FileCheck2, Gift, FileText, LayoutGrid, Database, Clock, Ticket, ClipboardList
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SalesPortal } from './components/sales/SalesPortal';
import { StorePortal } from './components/store/StorePortal';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { RebatePage } from './components/rebate/RebatePage';
import { CnRebatePage } from './components/rebate/CnRebatePage';
import { RebatePlanPage } from './components/rebate/RebatePlanPage';
import { AccountingPage } from './components/accounting/AccountingPage';
import { GiveawayPage } from './components/giveaway/GiveawayPage';
import { QuotationPage } from './components/quotation/QuotationPage';
import { PaperTrailPage } from './components/papertrail/PaperTrailPage';
import { AdminUsersPage } from './components/admin/AdminUsersPage';
import { MasterDataPortal } from './components/master/MasterDataPortal';
import { AgingPage } from './components/aging/AgingPage';
import { VoucherPage } from './components/voucher/VoucherPage';
import { useErpStore } from './store/erp-store';
import { useAuthStore } from './store/auth-store';
import { fetchUnlockRequests, getMe } from './services/api';
import type { UserRole } from './types';
import LoginPage from './pages/LoginPage';
import { DbModeSwitch } from './components/common/DbModeSwitch';
import { useAppStore } from './store/app-store';
import { GlobalLoader } from './components/common/GlobalLoader';

export type PortalKey = 'dashboard' | 'sales' | 'quotation' | 'store' | 'papertrail' | 'rebate' | 'rebate-plan' | 'cn-rebate' | 'voucher' | 'accounting' | 'giveaway' | 'aging' | 'admin' | 'master';

type NavItem = {
  key: PortalKey;
  label: string;
  sub: string;
  icon: LucideIcon;
  roles?: UserRole[];   // ถ้ามี = แสดงเฉพาะ role เหล่านี้
  badge?: boolean;      // แสดง pendingUnlocks badge
};

const NAV: NavItem[] = [
  { key: 'dashboard',  label: 'Dashboard',  sub: 'ภาพรวม',              icon: LayoutDashboard },
  { key: 'sales',      label: 'ขาย',         sub: 'ใบสั่งขาย (POS)',     icon: ShoppingCart },
  { key: 'quotation',  label: 'เสนอราคา',    sub: 'Quotation → SO',      icon: FileText },
  { key: 'store',      label: 'คลัง',        sub: 'รับสินค้า/ส่งออก',     icon: Warehouse, badge: true },
  { key: 'papertrail', label: 'Paper Trail', sub: 'Kanban เอกสาร',       icon: LayoutGrid },
  { key: 'rebate',     label: 'รีเบท (App)', sub: 'Pool · เคลม · wf',      icon: Coins },
  { key: 'rebate-plan',label: 'Rebate Plan', sub: 'แผน · จัดสรรงบ',        icon: ClipboardList, roles: ['ADMIN', 'MANAGER', 'APPROVER', 'ACCOUNTING'] },
  { key: 'cn-rebate',  label: 'CN Rebate',   sub: 'ใบลดหนี้ · Winspeed',   icon: FileCheck2, roles: ['ACCOUNTING', 'ADMIN', 'MANAGER', 'SALES'] },
  { key: 'voucher',    label: 'Voucher',     sub: 'คูปองคงค้าง · Winspeed', icon: Ticket },
  { key: 'accounting', label: 'บัญชี',       sub: 'Sync · อนุมัติ CN',    icon: FileCheck, roles: ['ACCOUNTING', 'ADMIN', 'MANAGER'] },
  { key: 'giveaway',   label: 'ของแถม',      sub: 'งบรายภาค · เบิก',     icon: Gift },
  { key: 'aging',      label: 'ตั๋วคงค้าง',   sub: 'SO คงค้าง · ค้นหา',   icon: Clock },
  { key: 'admin',      label: 'ผู้ใช้งาน',    sub: 'Map พนักงาน',         icon: Users, roles: ['ADMIN'] },
  { key: 'master',     label: 'ข้อมูลหลัก',  sub: 'สินค้า · ลูกค้า',       icon: Database, roles: ['ADMIN'] },
];

function App() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);

  useEffect(() => {
    if (isAuthenticated && !user) {
      getMe().then(u => {
        useAuthStore.setState({ user: u });
      }).catch(() => logout());
    }
  }, [isAuthenticated, user, logout]);

  if (!isAuthenticated) return <LoginPage />;
  if (isAuthenticated && !user) return <div className="h-screen w-screen flex items-center justify-center bg-[#F1EFE8]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0C447C]"></div></div>;

  return <AppShell user={user} logout={logout} />;
}

function AppShell({ user, logout }: { user: ReturnType<typeof useAuthStore>['getState']['user']; logout: () => void }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const { activePortal, navigate } = useAppStore();
  const setUnlockRequests = useErpStore(s => s.setUnlockRequests);
  const pendingUnlocks = useErpStore(s => s.unlockRequests.filter(r => !r.resolved).length);

  const role = user?.role;
  const visibleNav = NAV.filter(n => !n.roles || (role && n.roles.includes(role)));

  // Background poller for unlock requests (PICKING orders) — keeps badge live
  useEffect(() => {
    const poll = async () => {
      try { setUnlockRequests(await fetchUnlockRequests()); }
      catch (e) { console.error('Polling failed', e); }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, [setUnlockRequests]);

  const current = NAV.find(n => n.key === activePortal);
  const portalLabel = current ? `${current.label} — ${current.sub}` : '';

  const navBtnClass = (active: boolean, collapsed: boolean) =>
    `relative w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-all ${
      active ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
    } ${collapsed ? 'justify-center' : ''}`;

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className={`hidden shrink-0 flex-col border-r border-border bg-sidebar md:flex transition-all duration-300 ${isSidebarCollapsed ? 'w-16' : 'w-60'}`}>
        <div className={`flex h-14 items-center border-b border-border transition-all ${isSidebarCollapsed ? 'justify-center' : 'gap-2.5 px-5'}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: '#0C447C' }}>
            <span className="text-xs font-bold">WF</span>
          </div>
          {!isSidebarCollapsed && (
            <div className="flex flex-col leading-tight animate-in fade-in duration-300">
              <span className="text-sm font-semibold flex items-center gap-1.5">
                WS-Sale-App
                <span className="text-[9px] bg-blue-100 text-blue-800 px-1 rounded font-bold">v4.1</span>
              </span>
              <span className="text-[11px] text-muted-foreground">World Fert</span>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1.5 p-2 overflow-y-auto">
          {visibleNav.map(n => {
            const Icon = n.icon;
            return (
              <button key={n.key} onClick={() => navigate(n.key as PortalKey)}
                title={isSidebarCollapsed ? n.label : ''} className={navBtnClass(activePortal === n.key, isSidebarCollapsed)}>
                <Icon className="h-4 w-4 shrink-0" />
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
        </nav>

        <div className="p-2 border-t border-border space-y-1">
          {!isSidebarCollapsed && user && (
            <div className="px-3 py-2 mx-1 mb-2 bg-gray-50 border border-gray-100 rounded-lg flex flex-col">
              <span className="text-xs font-bold text-gray-800">{user.displayName}</span>
              <span className="text-[10px] font-semibold text-[#0C447C] mt-0.5">Role: {user.role}</span>
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

      {/* Main content area */}
      <div className="flex flex-1 flex-col pb-16 md:pb-0">
        <header className="glass-header sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-4 md:px-6">
          <div className="flex items-center gap-2.5 md:hidden">
            <Boxes className="h-5 w-5" />
            <span className="text-sm font-semibold">WS-Sale-App</span>
          </div>
          <div className="hidden text-sm text-muted-foreground md:block">{portalLabel}</div>
          <div className="flex items-center gap-3">
            <button className="relative rounded-lg p-2 text-muted-foreground hover:bg-accent transition-colors" onClick={() => navigate('store')}>
              <Bell className="h-5 w-5" />
              {pendingUnlocks > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                  {pendingUnlocks}
                </span>
              )}
            </button>
            <div className="hidden items-center gap-2 sm:flex">
              <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: '#0C447C' }}>
                {user?.displayName?.charAt(0) ?? '?'}
              </div>
              <div className="text-xs leading-tight">
                <div className="font-medium">{user?.displayName}</div>
                <div className="text-muted-foreground">{user?.role}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          {activePortal === 'sales' ? (
            <SalesPortal />
          ) : (
            <div className="h-full overflow-y-auto custom-scrollbar">
              {activePortal === 'dashboard'  && <DashboardPage />}
              {activePortal === 'quotation'  && <QuotationPage />}
              {activePortal === 'store'      && <StorePortal />}
              {activePortal === 'papertrail' && <PaperTrailPage />}
              {activePortal === 'rebate'     && <RebatePage />}
              {activePortal === 'rebate-plan' && <RebatePlanPage />}
              {activePortal === 'cn-rebate'  && <CnRebatePage />}
              {activePortal === 'voucher'    && <VoucherPage />}
              {activePortal === 'accounting' && <AccountingPage />}
              {activePortal === 'giveaway'   && <GiveawayPage />}
              {activePortal === 'aging'      && <AgingPage />}
              {activePortal === 'admin'      && role === 'ADMIN' && <AdminUsersPage />}
              {activePortal === 'master'     && role === 'ADMIN' && <MasterDataPortal />}
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar — first 5 visible nav items */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-background safe-bottom md:hidden">
        {visibleNav.slice(0, 5).map(n => {
          const Icon = n.icon;
          return (
            <button key={n.key} onClick={() => navigate(n.key as PortalKey)}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
                activePortal === n.key ? 'text-foreground' : 'text-muted-foreground'}`}>
              <Icon className="h-5 w-5" />
              {n.label}
              {n.badge && pendingUnlocks > 0 && (
                <span className="absolute top-1.5 right-1/4 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                  {pendingUnlocks}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <GlobalLoader />
    </div>
  );
}

export default App;
