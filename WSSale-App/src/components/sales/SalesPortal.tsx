import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Search, RefreshCw, ChevronRight, Filter, ChevronLeft, ChevronsLeft, ChevronsRight } from 'lucide-react';
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
      setPage(1); // Reset to page 1 on new search
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
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8 flex flex-col min-h-screen">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sales Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Outbound documents — drafted here, fulfilled by the warehouse.
          </p>
        </div>
        <Button onClick={() => setIsModalOpen(true)} className="gap-2 w-full sm:w-auto shadow-md">
          <Plus size={18} />
          Create SO
        </Button>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden p-0 border-border bg-card shadow-sm mb-16 md:mb-0">
        <div className="border-b border-border bg-slate-50/50">
          <div className="px-4 py-3 sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex w-full sm:max-w-sm gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <input 
                  type="text" 
                  placeholder="Search SO, Doc No..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-4 text-sm focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none transition-all shadow-sm"
                />
              </div>
              <Button 
                variant={showFilters || customerFilter || statusFilter ? "primary" : "outline"} 
                className="px-3"
                onClick={() => setShowFilters(!showFilters)}
                title="Advanced Filters"
              >
                <Filter size={16} />
              </Button>
            </div>
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <div className="text-xs text-muted-foreground hidden sm:block">
                Showing {(page - 1) * limit + 1}-{Math.min(page * limit, totalOrders)} of {totalOrders}
              </div>
              <Button variant="ghost" onClick={loadData} className="text-muted-foreground h-9 w-9 p-0 rounded-lg flex items-center justify-center">
                <RefreshCw size={16} className={cn(loading && 'animate-spin')} />
              </Button>
            </div>
          </div>
          
          {/* Advanced Filters Panel */}
          {showFilters && (
            <div className="px-4 pb-4 sm:px-6 pt-1 border-t border-border/50 grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50/80">
              <div>
                <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Customer</label>
                <select 
                  value={customerFilter} 
                  onChange={handleFilterChange(setCustomerFilter)}
                  className="w-full rounded-md border border-border bg-white py-1.5 px-2.5 text-sm focus:border-ring focus:outline-none shadow-sm"
                >
                  <option value="">All Customers</option>
                  {customers.map(c => (
                    <option key={c.CustID} value={c.CustID}>{c.CustName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Status</label>
                <select 
                  value={statusFilter} 
                  onChange={handleFilterChange(setStatusFilter)}
                  className="w-full rounded-md border border-border bg-white py-1.5 px-2.5 text-sm focus:border-ring focus:outline-none shadow-sm"
                >
                  <option value="">All Statuses</option>
                  <option value="Draft">Draft</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Picking">Picking</option>
                  <option value="Shipped">Shipped</option>
                </select>
              </div>
              <div className="flex items-end">
                <Button 
                  variant="ghost" 
                  className="text-muted-foreground hover:text-foreground text-xs"
                  onClick={() => {
                    setCustomerFilter('');
                    setStatusFilter('');
                    setSearchQuery('');
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          )}
        </div>
        
        {/* Desktop Table View */}
        <div className="hidden md:block flex-1 overflow-x-hidden">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="bg-slate-50/50 text-muted-foreground font-medium border-b border-border sticky top-0 z-10">
              <tr>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider">SO ID</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider">Customer</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider">Date</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-center">Lines</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider text-right">Total</th>
                <th className="px-4 py-4 text-xs font-bold uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-4 py-4"><div className="h-4 bg-slate-100 rounded w-full"></div></td>
                  </tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No sales orders found matching your criteria.
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const custName = customers.find(c => c.CustID === order.CustID)?.CustName || order.CustID;
                  const isUnlockPending = unlockRequests.find(r => r.SOID === order.SOID && !r.resolved);
                  
                  return (
                    <tr 
                      key={order.SOID} 
                      className="group hover:bg-slate-50/80 cursor-pointer transition-colors"
                      onClick={() => setSelectedSoId(order.SOID)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono font-medium text-foreground text-xs">{order.SOID}</div>
                        {order.DocuNo && <div className="text-[10px] text-muted-foreground mt-0.5">{order.DocuNo}</div>}
                      </td>
                      <td className="px-4 py-3 text-foreground truncate max-w-[140px] xl:max-w-[250px] text-xs">{custName}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{order.DocuDate}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground text-xs">{order.lines.length}</td>
                      <td className="px-4 py-3 text-right font-medium text-foreground tabular text-xs">
                        ฿{order.TotalAmt?.toLocaleString() ?? '0'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <SOStatusBadge status={order.Status} />
                          {isUnlockPending && (
                            <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" title="Unlock Requested" />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card List View */}
        <div className="md:hidden flex-1 overflow-y-auto divide-y divide-border">
          {loading ? (
             Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-4 animate-pulse space-y-3">
                  <div className="flex justify-between"><div className="h-4 bg-slate-100 rounded w-1/3" /><div className="h-4 bg-slate-100 rounded w-1/4" /></div>
                  <div className="h-4 bg-slate-100 rounded w-1/2" />
                </div>
             ))
          ) : orders.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
               No sales orders found matching your criteria.
            </div>
          ) : (
            orders.map(order => {
              const custName = customers.find(c => c.CustID === order.CustID)?.CustName || order.CustID;
              const isUnlockPending = unlockRequests.find(r => r.SOID === order.SOID && !r.resolved);

              return (
                <div 
                  key={order.SOID} 
                  className="p-4 active:bg-slate-50 transition-colors"
                  onClick={() => setSelectedSoId(order.SOID)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                       <span className="font-mono font-semibold text-foreground text-sm">{order.SOID}</span>
                       <SOStatusBadge status={order.Status} />
                       {isUnlockPending && <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />}
                    </div>
                    <span className="font-semibold text-foreground tabular text-sm">฿{order.TotalAmt?.toLocaleString()}</span>
                  </div>
                  <div className="text-sm text-foreground truncate">{custName}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {order.DocuDate} · {order.lines.length} line{order.lines.length !== 1 && 's'}
                    {order.DocuNo && ` · ${order.DocuNo}`}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination Footer */}
        <div className="border-t border-border bg-slate-50/50 px-4 py-3 sm:px-6 flex items-center justify-between mt-auto">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden sm:inline">Rows per page:</span>
            <select 
              value={limit} 
              onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
              className="bg-transparent border-none focus:ring-0 text-sm font-medium cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              Page <span className="font-medium text-foreground">{page}</span> of {totalPages}
            </div>
            <div className="flex items-center gap-1">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 w-8 p-0" 
                onClick={() => setPage(1)} 
                disabled={page === 1}
              >
                <ChevronsLeft size={14} />
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 w-8 p-0" 
                onClick={() => setPage(p => Math.max(1, p - 1))} 
                disabled={page === 1}
              >
                <ChevronLeft size={14} />
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 w-8 p-0" 
                onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                disabled={page >= totalPages || totalOrders === 0}
              >
                <ChevronRight size={14} />
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 w-8 p-0 hidden sm:flex" 
                onClick={() => setPage(totalPages)} 
                disabled={page >= totalPages || totalOrders === 0}
              >
                <ChevronsRight size={14} />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <CreateSODialog 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onCreated={loadData}
      />

      <SODetailsPanel
        so={selectedSo}
        isOpen={!!selectedSoId}
        onClose={() => setSelectedSoId(null)}
        onUpdate={loadData}
        onEdit={handleEdit}
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
