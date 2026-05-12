import { useState, useEffect } from 'react';
import { Boxes, ShoppingCart, Warehouse, ChevronLeft, ChevronRight, Bell } from 'lucide-react';
import { SalesPortal } from './components/sales/SalesPortal';
import { StorePortal } from './components/store/StorePortal';
import { KPIReport } from './components/reports/KPIReport';
import { useErpStore } from './store/erp-store';
import { fetchUnlockRequests } from './services/api';

function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [activePortal, setActivePortal] = useState<'sales' | 'store' | 'reports'>('sales');
  const setUnlockRequests = useErpStore(s => s.setUnlockRequests);
  const pendingUnlocks = useErpStore(s => s.unlockRequests.filter(r => !r.resolved).length);

  // Background poller for unlock requests to keep UI "Live"
  useEffect(() => {
    const poll = async () => {
      try {
        const reqs = await fetchUnlockRequests();
        setUnlockRequests(reqs);
      } catch (e) {
        console.error("Polling failed", e);
      }
    };
    
    poll(); // Initial fetch
    const timer = setInterval(poll, 5000); // Every 5 seconds
    return () => clearInterval(timer);
  }, [setUnlockRequests]);

  const portalLabel = activePortal === 'sales' ? 'Sales Portal' : activePortal === 'store' ? 'Store / Warehouse' : 'KPI Reports';

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className={`hidden shrink-0 flex-col border-r border-border bg-sidebar md:flex transition-all duration-300 ${isSidebarCollapsed ? 'w-16' : 'w-60'}`}>
        <div className={`flex h-14 items-center border-b border-border transition-all ${isSidebarCollapsed ? 'justify-center' : 'gap-2.5 px-5'}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <Boxes className="h-4 w-4" />
          </div>
          {!isSidebarCollapsed && (
            <div className="flex flex-col leading-tight animate-in fade-in duration-300">
              <span className="text-sm font-semibold">WINSpeed</span>
              <span className="text-[11px] text-muted-foreground">ERP Console</span>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1.5 p-2">
          <button
            onClick={() => setActivePortal('sales')}
            title={isSidebarCollapsed ? "Sales" : ""}
            className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-all ${
              activePortal === 'sales'
                ? 'bg-accent text-accent-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            } ${isSidebarCollapsed ? 'justify-center' : ''}`}
          >
            <ShoppingCart className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && (
              <div className="flex flex-col text-left animate-in fade-in slide-in-from-left-2 duration-300">
                <span className="font-medium">Sales</span>
                <span className="text-[11px] text-muted-foreground">Outbound orders</span>
              </div>
            )}
          </button>
          
          <button
            onClick={() => setActivePortal('store')}
            title={isSidebarCollapsed ? "Store" : ""}
            className={`relative w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-all ${
              activePortal === 'store'
                ? 'bg-accent text-accent-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            } ${isSidebarCollapsed ? 'justify-center' : ''}`}
          >
            <Warehouse className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && (
              <div className="flex flex-col text-left animate-in fade-in slide-in-from-left-2 duration-300">
                <span className="font-medium">Store</span>
                <span className="text-[11px] text-muted-foreground">Inbound & outbound</span>
              </div>
            )}
            {pendingUnlocks > 0 && (
              <span className={`absolute bg-amber-500 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${
                isSidebarCollapsed ? 'top-1.5 right-1.5 h-3.5 w-3.5' : 'top-3 right-3 h-4 w-4'
              }`}>
                {pendingUnlocks}
              </span>
            )}
          </button>

          <button
            onClick={() => setActivePortal('reports')}
            title={isSidebarCollapsed ? "Reports" : ""}
            className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-all ${
              activePortal === 'reports'
                ? 'bg-accent text-accent-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            } ${isSidebarCollapsed ? 'justify-center' : ''}`}
          >
            <Boxes className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && (
              <div className="flex flex-col text-left animate-in fade-in slide-in-from-left-2 duration-300">
                <span className="font-medium">Reports</span>
                <span className="text-[11px] text-muted-foreground">Sales performance KPI</span>
              </div>
            )}
          </button>
        </nav>

        <div className="p-2 border-t border-border">
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="w-full flex h-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col pb-16 md:pb-0">
        {/* Top Header */}
        <header className="glass-header sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-4 md:px-6">
          {/* Mobile branding */}
          <div className="flex items-center gap-2.5 md:hidden">
            <Boxes className="h-5 w-5" />
            <span className="text-sm font-semibold">WINSpeed</span>
          </div>
          {/* Desktop breadcrumb */}
          <div className="hidden text-sm text-muted-foreground md:block">
            {portalLabel}
          </div>
          {/* Right: Notification + Avatar */}
          <div className="flex items-center gap-3">
            <button
              className="relative rounded-lg p-2 text-muted-foreground hover:bg-accent transition-colors"
              onClick={() => setActivePortal('store')}
            >
              <Bell className="h-5 w-5" />
              {pendingUnlocks > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                  {pendingUnlocks}
                </span>
              )}
            </button>
            <div className="hidden items-center gap-2 sm:flex">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-foreground/70 to-foreground" />
              <div className="text-xs leading-tight">
                <div className="font-medium">Operator</div>
                <div className="text-muted-foreground">Plant 01</div>
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
              {activePortal === 'store' && <StorePortal />}
              {activePortal === 'reports' && <KPIReport />}
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-background safe-bottom md:hidden">
        <button
          onClick={() => setActivePortal('sales')}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
            activePortal === 'sales' ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          <ShoppingCart className="h-5 w-5" />
          Sales
        </button>
        <button
          onClick={() => setActivePortal('store')}
          className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
            activePortal === 'store' ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          <Warehouse className="h-5 w-5" />
          Store
          {pendingUnlocks > 0 && (
            <span className="absolute top-1.5 right-1/4 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
              {pendingUnlocks}
            </span>
          )}
        </button>
        <button
          onClick={() => setActivePortal('reports')}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
            activePortal === 'reports' ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          <Boxes className="h-5 w-5" />
          Reports
        </button>
      </nav>
    </div>
  );
}

export default App;
