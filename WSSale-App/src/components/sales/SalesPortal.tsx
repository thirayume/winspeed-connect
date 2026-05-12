import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Search, RefreshCw, ChevronRight, Filter, ChevronLeft, ChevronsLeft, ChevronsRight, Package, Calendar, User, DollarSign } from 'lucide-react';
import { Button, Card, cn } from '../ui/Base';
import { useErpStore } from '../../store/erp-store';
import { fetchSalesOrders } from '../../services/api';
import { SOStatusBadge } from './SOStatusBadge';
import { CreateSODialog } from './CreateSODialog';
import { EditSODialog } from './EditSODialog';
import { SODetailsPanel } from './SODetailsPanel';
import type { SOWithDetails } from '../../types';

export const SalesPortal = () => {
  const [orders, setOrders] = useState<SOWithDetails[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSoId, setSelectedSoId] = useState<string | null>(null);
  
  // Pagination & Filtering state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [customerFilter, setCustomerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingSo, setEditingSo] = useState<SOWithDetails | null>(null);

  const customers = useErpStore(s => s.customers);
  const unlockRequests = useErpStore(s => s.unlockRequests);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); 
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
        const result = await fetchSalesOrders({
          page,
          limit,
          search: debouncedSearch,
          customer: customerFilter,
          status: statusFilter
        });
        setOrders(result.data || []);
        setTotalOrders(result.total || 0);
    } catch (err) {
        console.error("Failed to load data", err);
        setOrders([]);
        setTotalOrders(0);
    }
    setLoading(false);
  }, [page, limit, debouncedSearch, customerFilter, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFilterChange = (setter: React.Dispatch<React.SetStateAction<string>>) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  const handleEdit = (so: SOWithDetails) => {
    setEditingSo(so);
    setIsEditDialogOpen(true);
  };

  const totalPages = Math.ceil(totalOrders / limit) || 1;
  const selectedSo = useMemo(() => orders.find(o => o.SOID === selectedSoId) || null, [orders, selectedSoId]);

  return (
    <div className="mx-auto w-full max-w-[1600px] h-screen flex flex-col overflow-hidden bg-slate-50/30">
      {/* Header */}
      <div className="px-6 py-6 border-b border-border bg-white shadow-sm z-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Package className="text-primary" size={28} />
            Sales Portal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and track your industrial sales orders.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={loadData} className="h-11 w-11 p-0 rounded-xl">
             <RefreshCw size={18} className={cn(loading && 'animate-spin')} />
          </Button>
          <Button onClick={() => setIsModalOpen(true)} className="h-11 px-6 gap-2 rounded-xl shadow-lg shadow-primary/20 font-bold transition-all hover:scale-[1.02] active:scale-[0.98]">
            <Plus size={20} />
            New Order
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Master Pane: Order List */}
        <div className={cn(
          "flex-1 flex flex-col overflow-hidden border-r border-border transition-all duration-300",
          selectedSoId && "lg:max-w-[450px] xl:max-w-[550px]"
        )}>
          {/* Search & Filters Area */}
          <div className="p-4 space-y-4 bg-white border-b border-border shadow-sm">
             <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                <input 
                  type="text" 
                  placeholder="Search by SO ID, Customer, or Doc No..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-border bg-slate-50/50 py-3 pl-11 pr-4 text-sm focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none transition-all"
                />
             </div>
             
             <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                <Button 
                  variant={customerFilter || statusFilter ? "primary" : "outline"} 
                  size="sm"
                  className="rounded-full h-9 gap-2 shrink-0 font-medium"
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <Filter size={14} />
                  Filters
                  {(customerFilter || statusFilter) && <span className="w-2 h-2 rounded-full bg-white animate-pulse" />}
                </Button>
                
                {statusFilter && (
                  <Badge variant="primary" className="rounded-full px-3 py-1 cursor-pointer" onClick={() => setStatusFilter('')}>
                    Status: {statusFilter} ✕
                  </Badge>
                )}
             </div>

             {showFilters && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-border animate-in slide-in-from-top-2">
                   <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-muted-foreground tracking-wider">Customer</label>
                      <select 
                        value={customerFilter} 
                        onChange={handleFilterChange(setCustomerFilter)}
                        className="w-full rounded-lg border border-border bg-white py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">All Customers</option>
                        {customers.map(c => <option key={c.CustID} value={c.CustID}>{c.CustName}</option>)}
                      </select>
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-muted-foreground tracking-wider">Status</label>
                      <select 
                        value={statusFilter} 
                        onChange={handleFilterChange(setStatusFilter)}
                        className="w-full rounded-lg border border-border bg-white py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">All Statuses</option>
                        <option value="Draft">Draft</option>
                        <option value="Confirmed">Confirmed</option>
                        <option value="Picking">Picking</option>
                        <option value="Shipped">Shipped</option>
                      </select>
                   </div>
                </div>
             )}
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {loading ? (
               Array.from({ length: 6 }).map((_, i) => (
                 <Card key={i} className="p-5 animate-pulse border-border/50">
                    <div className="flex justify-between mb-4"><div className="h-5 bg-slate-100 rounded w-1/3" /><div className="h-5 bg-slate-100 rounded w-1/4" /></div>
                    <div className="h-4 bg-slate-100 rounded w-2/3 mb-2" />
                    <div className="h-4 bg-slate-100 rounded w-1/2" />
                 </Card>
               ))
            ) : orders.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 opacity-40">
                 <Package size={48} className="mb-4" />
                 <p className="font-bold">No orders found</p>
                 <p className="text-sm">Try adjusting your filters or search query.</p>
              </div>
            ) : (
              orders.map(order => {
                const isSelected = selectedSoId === order.SOID;
                const custName = customers.find(c => c.CustID === order.CustID)?.CustName || order.CustID;
                const isUnlockPending = unlockRequests.find(r => r.SOID === order.SOID && !r.resolved);

                return (
                  <Card 
                    key={order.SOID} 
                    onClick={() => setSelectedSoId(isSelected ? null : order.SOID)}
                    className={cn(
                      "p-5 cursor-pointer transition-all border-border/50 group relative overflow-hidden",
                      isSelected ? "ring-2 ring-primary border-primary bg-primary/[0.02] shadow-md scale-[1.01]" : "hover:shadow-lg hover:border-border active:scale-[0.99] bg-white"
                    )}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-foreground text-sm tracking-tight">{order.SOID}</span>
                        <SOStatusBadge status={order.Status} />
                        {isUnlockPending && <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />}
                      </div>
                      <span className="font-black text-foreground tabular text-base text-primary">฿{order.TotalAmt?.toLocaleString()}</span>
                    </div>
                    
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3 truncate">
                       <User size={14} className="text-muted-foreground" />
                       {custName}
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><Calendar size={12} /> {order.DocuDate}</span>
                        <span className="flex items-center gap-1"><Package size={12} /> {order.lines.length} items</span>
                      </div>
                      <ChevronRight size={16} className={cn("transition-transform", isSelected && "rotate-90 text-primary")} />
                    </div>

                    {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                  </Card>
                );
              })
            )}
          </div>

          {/* Pagination Footer */}
          <div className="p-4 border-t border-border bg-white flex items-center justify-between">
             <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                Page {page} of {totalPages}
             </div>
             <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-9 w-9 p-0 rounded-lg" 
                  onClick={() => setPage(p => Math.max(1, p - 1))} 
                  disabled={page === 1}
                >
                  <ChevronLeft size={16} />
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-9 w-9 p-0 rounded-lg" 
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                  disabled={page >= totalPages || totalOrders === 0}
                >
                  <ChevronRight size={16} />
                </Button>
             </div>
          </div>
        </div>

        {/* Detail Pane (Tablet/Desktop Split View) */}
        <div className={cn(
          "hidden lg:flex flex-col flex-1 bg-white overflow-hidden transition-all duration-500 ease-in-out",
          !selectedSoId ? "translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100"
        )}>
          {selectedSoId ? (
            <SODetailsPanel
              so={selectedSo}
              isOpen={true}
              onClose={() => setSelectedSoId(null)}
              onUpdate={loadData}
              onEdit={handleEdit}
              isInline={true}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 opacity-20">
               <Package size={80} className="mb-6" />
               <h2 className="text-2xl font-black">Select an Order</h2>
               <p className="mt-2 max-w-xs">Pick a sales order from the left to view detailed information and take actions.</p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Drawer (fallback for mobile/small tablet) */}
      <div className="lg:hidden">
        <SODetailsPanel
          so={selectedSo}
          isOpen={!!selectedSoId}
          onClose={() => setSelectedSoId(null)}
          onUpdate={loadData}
          onEdit={handleEdit}
          isInline={false}
        />
      </div>

      <CreateSODialog 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onCreated={loadData}
      />

      <EditSODialog
        isOpen={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        onUpdated={loadData}
        so={editingSo}
      />
    </div>
  );
};
