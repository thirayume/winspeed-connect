import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Search, RefreshCw, ChevronRight, Filter, ChevronLeft, Package, Calendar, User, X } from 'lucide-react';
import { Button, Card, cn } from '../ui/Base';
import { useErpStore } from '../../store/erp-store';
import { useAppStore } from '../../store/app-store';
import { fetchSalesOrders, fetchSalesOrder } from '../../services/api';
import { useSocketEvent } from '../../hooks/useSocket';
import { SOStatusBadge } from './SOStatusBadge';
import { CreateSODialog } from './CreateSODialog';
import { SODetailsPanel } from './SODetailsPanel';
import type { SalesOrder, SOStatus } from '../../types';

export const SalesPortal = () => {
  const [orders, setOrders]         = useState<SalesOrder[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [externalSelectedSo, setExternalSelectedSo] = useState<SalesOrder | null>(null);

  const navParams = useAppStore(s => s.navParams);
  const clearNavParams = useAppStore(s => s.clearNavParams);

  const [page, setPage]               = useState(1);
  const [limit]                        = useState(20);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SOStatus | ''>('');

  const unlockRequests  = useErpStore(s => s.unlockRequests);
  const setUnlockRequests = useErpStore(s => s.setUnlockRequests);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(searchQuery); setPage(1); }, 500);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSalesOrders({
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        page,
        limit,
      });
      setOrders(res.data || []);
      setTotalOrders(res.total || 0);
    } catch (e) {
      console.error('fetchSalesOrders failed', e);
      setOrders([]);
    }
    setLoading(false);
  }, [page, limit, debouncedSearch, statusFilter, setUnlockRequests]);

  useEffect(() => { loadData(); }, [loadData]);

  // Listen for real-time updates
  useSocketEvent('so_updated', () => {
    console.log('[Socket] so_updated event received. Refreshing SalesPortal...');
    loadData();
  });

  // Handle Jump to SO
  useEffect(() => {
    if (navParams?.soId) {
      setSelectedId(navParams.soId);
      fetchSalesOrder(navParams.soId).then(so => {
        setExternalSelectedSo(so);
      }).catch(console.error);
      clearNavParams();
    }
  }, [navParams, clearNavParams]);

  useEffect(() => {
    if (!selectedId) setExternalSelectedSo(null);
  }, [selectedId]);

  const totalPages = Math.ceil(totalOrders / limit) || 1;
  const selectedSo = orders.find(o => o.id === selectedId) || externalSelectedSo;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={{ background: '#F1EFE8' }}>
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Package size={26} />
            Sales Portal
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">สั่งขายปุ๋ย · World Fert Co., Ltd.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadData} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="h-10 px-5 flex items-center gap-2 rounded-xl text-white text-sm font-semibold"
            style={{ background: '#0C447C' }}
          >
            <Plus size={18} /> สร้างใบสั่งขาย
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* List pane */}
        <div className={cn('flex flex-col overflow-hidden border-r border-gray-200 bg-white/50', 'flex-1 lg:flex-none lg:w-[480px] xl:w-[540px]')}>
          {/* Search */}
          <div className="p-4 space-y-3 bg-white border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="ค้นหา ลูกค้า / WfRef..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-8 text-sm focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': '#0C447C' } as React.CSSProperties}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowFilters(f => !f)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  statusFilter ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 bg-white hover:bg-gray-50'
                )}
                style={statusFilter ? { background: '#0C447C' } : {}}
              >
                <Filter size={12} /> ตัวกรอง
              </button>
              {statusFilter && (
                <button onClick={() => setStatusFilter('')}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  {statusFilter} ✕
                </button>
              )}
            </div>
            {showFilters && (
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">สถานะ</label>
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value as SOStatus | ''); setPage(1); }}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2 px-3 text-sm"
                >
                  <option value="">ทุกสถานะ</option>
                  {(['DRAFT','CONFIRMED','PICKING','SHIPPED','IMPORTED','CANCELLED'] as SOStatus[]).map(s =>
                    <option key={s} value={s}>{s}</option>
                  )}
                </select>
              </div>
            )}
          </div>

          {/* Order list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 bg-white rounded-xl animate-pulse border border-gray-100" />
              ))
            ) : orders.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-30 text-center">
                <Package size={48} className="mb-3" />
                <p className="font-semibold">ไม่พบใบสั่งขาย</p>
              </div>
            ) : orders.map(order => {
              const isSelected = selectedId === order.id;
              const totalAmt = (order.lines || []).reduce((s, l) => s + (l.qtyTon * l.pricePerTon), 0);
              const isUnlockPending = unlockRequests.some(r => r.SOID === String(order.id) && !r.resolved);

              return (
                <div
                  key={order.id}
                  onClick={() => setSelectedId(isSelected ? null : (order.id ?? null))}
                  className={cn(
                    'relative p-4 rounded-xl cursor-pointer border transition-all',
                    isSelected
                      ? 'border-blue-700 bg-white shadow-md'
                      : 'border-gray-100 bg-white hover:shadow-sm hover:border-gray-200'
                  )}
                >
                  {isSelected && <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full" style={{ background: '#0C447C' }} />}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-gray-700">{order.wfRef || `#${order.id}`}</span>
                      <SOStatusBadge status={order.status} isUnlockRequested={isUnlockPending} />
                    </div>
                    <span className="text-sm font-bold" style={{ color: '#0C447C' }}>
                      ฿{totalAmt.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2 truncate">
                    <User size={13} className="text-gray-400 shrink-0" />
                    {order.custName}
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Calendar size={11} /> {order.createdAt?.slice(0, 10)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Package size={11} /> {(order.lines || []).filter(l => !l.isGiveaway).length} รายการ
                      </span>
                    </div>
                    <ChevronRight size={14} className={cn('transition-transform', isSelected && 'rotate-90')} style={isSelected ? { color: '#0C447C' } : {}} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="p-3 border-t border-gray-100 bg-white flex items-center justify-between">
            <span className="text-xs text-gray-400">หน้า {page} / {totalPages} ({totalOrders} รายการ)</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Detail pane (desktop) */}
        <div className="hidden lg:flex flex-col flex-1 bg-white overflow-hidden transition-all">
          {selectedSo ? (
            <SODetailsPanel so={selectedSo} onClose={() => setSelectedId(null)} onUpdate={loadData} isInline />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-20">
              <Package size={64} className="mb-4" />
              <p className="font-bold">เลือกใบสั่งขายจากรายการ</p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile detail drawer */}
      <div className="lg:hidden">
        {selectedSo && (
          <SODetailsPanel so={selectedSo} onClose={() => setSelectedId(null)} onUpdate={loadData} isInline={false} />
        )}
      </div>

      <CreateSODialog isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onCreated={loadData} />
    </div>
  );
};
