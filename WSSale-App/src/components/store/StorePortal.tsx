import React, { useState, useEffect } from 'react';
import { Package, Truck, RefreshCw } from 'lucide-react';
import { cn } from '../ui/Base';
import { fetchSalesOrders, fetchPurchaseOrders, fetchUnlockRequests } from '../../services/api';
import { PickingQueue } from './PickingQueue';
import { ReceivingQueue } from './ReceivingQueue';
import { useErpStore } from '../../store/erp-store';
import type { SOWithDetails, POWithDetails } from '../../types';

export const StorePortal = () => {
  const [activeTab, setActiveTab] = useState<'outbound' | 'inbound'>('outbound');
  const [soOrders, setSoOrders] = useState<SOWithDetails[]>([]);
  const [poOrders, setPoOrders] = useState<POWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  
  const setUnlockRequests = useErpStore(s => s.setUnlockRequests);

  const loadData = async () => {
    setLoading(true);
    try {
        const [sosRes, pos, requests] = await Promise.all([
          fetchSalesOrders({ limit: 200 }), // Increased limit for better filtering
          fetchPurchaseOrders(),
          fetchUnlockRequests()
        ]);
        setSoOrders(sosRes.data || []);
        setPoOrders(pos || []);
        setUnlockRequests(requests || []);
    } catch(e) {
        console.error(e);
        setSoOrders([]);
        setPoOrders([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredSOs = soOrders.filter(o => {
    const matchesStatus = ['Confirmed', 'Picking'].includes(o.Status);
    const matchesSearch = o.SOID.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (o.CustName && o.CustName.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (o.CustID && o.CustID.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  const inboundOrders = poOrders.filter(p => p.Status === 'Pending Receipt');

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Store & Warehouse</h2>
            <p className="text-sm text-muted-foreground mt-1">Processing inbound receipts and outbound picking queues.</p>
          </div>
          
          <div className="relative flex-1 sm:w-64">
            <input 
              type="text"
              placeholder="Search SO ID or Customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-11 pl-4 pr-10 rounded-xl border border-border bg-white shadow-sm focus:ring-2 focus:ring-primary/10 outline-none text-sm"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        
        <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
          <button 
            onClick={() => setActiveTab('outbound')}
            className={cn(
              "flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-all",
              activeTab === 'outbound' ? "bg-white text-foreground shadow-sm ring-1 ring-slate-200" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Package size={16} />
            Outbound
            {filteredSOs.length > 0 && (
              <span className={cn(
                "ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                activeTab === 'outbound' ? "bg-slate-100 text-slate-700" : "bg-slate-200/50 text-slate-500"
              )}>
                {filteredSOs.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => setActiveTab('inbound')}
            className={cn(
              "flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-all",
              activeTab === 'inbound' ? "bg-white text-foreground shadow-sm ring-1 ring-slate-200" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Truck size={16} />
            Inbound
            {inboundOrders.length > 0 && (
              <span className={cn(
                "ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                activeTab === 'inbound' ? "bg-slate-100 text-slate-700" : "bg-slate-200/50 text-slate-500"
              )}>
                {inboundOrders.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {loading ? (
         <div className="h-64 flex flex-col items-center justify-center bg-card rounded-xl border border-border shadow-sm">
           <RefreshCw className="animate-spin text-muted-foreground mb-4" size={32} />
           <p className="text-sm text-muted-foreground font-medium">Synchronizing with ERP...</p>
         </div>
      ) : activeTab === 'outbound' ? (
        <PickingQueue orders={filteredSOs} onUpdate={loadData} />
      ) : (
        <ReceivingQueue orders={inboundOrders} onUpdate={loadData} />
      )}
    </div>
  );
};
