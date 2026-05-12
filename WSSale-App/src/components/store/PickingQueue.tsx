import React, { useState } from 'react';
import { Package, CheckCircle, AlertCircle, Play, PackageCheck, Truck, RefreshCw } from 'lucide-react';
import { Button, Card, cn } from '../ui/Base';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SOStatusBadge } from '../sales/SOStatusBadge';
import { useErpStore } from '../../store/erp-store';
import { updateSOStatus, resolveUnlockRequest, syncToWINSpeed } from '../../services/api';
import type { SOWithDetails } from '../../types';

export const PickingQueue = ({ orders, onUpdate }: { orders: SOWithDetails[], onUpdate: () => void }) => {
  const unlockRequests = useErpStore(s => s.unlockRequests);
  const customers = useErpStore(s => s.customers);
  const items = useErpStore(s => s.items);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    soId: string;
    type: 'approve' | 'reject';
  }>({ isOpen: false, soId: '', type: 'approve' });

  const handleStatusUpdate = async (soId: string, status: 'Picking' | 'Shipped') => {
    setBusyId(soId);
    await updateSOStatus(soId, status);
    if (status === 'Shipped') {
        await syncToWINSpeed('SO', soId);
    }
    setBusyId(null);
    onUpdate();
  };

  const processApproveUnlock = async (soId: string) => {
    const pending = unlockRequests.filter(r => r.SOID === soId && !r.resolved);
    if (pending.length > 0) {
        setBusyId(soId);
        try {
          // Resolve all pending requests for this SOID
          await Promise.all(pending.map(r => resolveUnlockRequest(r.id)));
          await updateSOStatus(soId, 'Draft');
        } catch (err) {
          console.error(err);
          alert("Failed to process unlock approval");
        } finally {
          setBusyId(null);
          onUpdate();
        }
    }
  };

  const processRejectUnlock = async (soId: string) => {
    const pending = unlockRequests.filter(r => r.SOID === soId && !r.resolved);
    if (pending.length > 0) {
        setBusyId(soId);
        try {
          // Resolve all pending requests for this SOID
          await Promise.all(pending.map(r => resolveUnlockRequest(r.id)));
        } catch (err) {
          console.error(err);
          alert("Failed to reject unlock");
        } finally {
          setBusyId(null);
          onUpdate();
        }
    }
  };

  if (orders.length === 0) {
    return (
      <Card className="flex flex-col h-48 items-center justify-center text-center border-dashed border-2 opacity-50">
        <Package className="text-muted-foreground mb-3" size={40} />
        <p className="text-sm font-bold uppercase tracking-widest">Queue Clear</p>
        <p className="text-xs mt-1">Confirmed orders will appear here for processing.</p>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
        {orders.map(order => {
          const isUnlockRequested = unlockRequests.some(r => r.SOID === order.SOID && !r.resolved);
          const custName = customers.find(c => c.CustID === order.CustID)?.CustName || order.CustID;
          const total = order.lines.reduce((s, l) => s + l.GoodQty1 * l.GoodPrice1, 0);
          const busy = busyId === order.SOID;
          
          return (
            <Card key={order.SOID} className="p-5 flex flex-col group relative overflow-hidden transition-all hover:shadow-xl border-border/60">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-black text-foreground">{order.SOID}</span>
                    <SOStatusBadge status={order.Status} />
                  </div>
                  <div className="text-sm font-bold text-foreground truncate max-w-[180px]">{custName}</div>
                  <div className="text-[11px] text-muted-foreground font-medium">
                    {order.DocuDate} · {order.lines.length} items
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase font-black text-muted-foreground tracking-tighter">Net Total</div>
                  <div className="text-lg font-black tabular text-primary">
                    ฿{total.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="my-4 space-y-1 rounded-xl bg-slate-50/50 p-3 border border-slate-100 text-xs max-h-[120px] overflow-y-auto custom-scrollbar">
                {order.lines.map((l) => {
                  const item = items.find((g) => g.GoodID === l.GoodID);
                  return (
                    <div key={l.ListNo} className="flex justify-between items-center py-0.5 tabular text-foreground border-b border-slate-100 last:border-0">
                      <span className="truncate text-muted-foreground pr-2">
                        {item?.GoodName1 ?? l.GoodID}
                      </span>
                      <span className="font-bold shrink-0">
                        ×{l.GoodQty1}
                      </span>
                    </div>
                  );
                })}
              </div>
              
              <div className="mt-auto pt-3 border-t border-slate-100">
                {isUnlockRequested ? (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl space-y-3 animate-in zoom-in-95 duration-300">
                    <div className="flex items-center gap-2 text-[11px] font-black text-red-600 uppercase tracking-tighter">
                       <AlertCircle size={14} /> Unlock Requested
                    </div>
                    <p className="text-xs text-red-700 italic bg-white/60 p-2 rounded-lg border border-red-100/50">
                      "{unlockRequests.find(r => r.SOID === order.SOID && !r.resolved)?.reason}"
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button 
                        variant="danger" 
                        className="h-10 text-xs font-bold rounded-lg shadow-sm shadow-red-200" 
                        onClick={() => setConfirmDialog({ isOpen: true, soId: order.SOID, type: 'approve' })} 
                        disabled={busy}
                      >
                        {busy ? "..." : "Approve"}
                      </Button>
                      <Button 
                        variant="outline" 
                        className="h-10 text-xs font-bold rounded-lg border-red-200 text-red-600 hover:bg-red-50" 
                        onClick={() => setConfirmDialog({ isOpen: true, soId: order.SOID, type: 'reject' })} 
                        disabled={busy}
                      >
                        {busy ? "..." : "Reject"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {order.Status === 'Confirmed' && (
                      <Button className="w-full h-11 gap-2 rounded-xl shadow-lg shadow-primary/10 font-bold transition-all hover:scale-[1.02]" onClick={() => handleStatusUpdate(order.SOID, 'Picking')} disabled={busy}>
                        <PackageCheck size={18} />
                        {busy ? "Starting..." : "Start Picking"}
                      </Button>
                    )}
                    {order.Status === 'Picking' && (
                      <Button className="w-full h-11 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white border-transparent rounded-xl shadow-lg shadow-emerald-200 font-bold transition-all hover:scale-[1.02]" onClick={() => handleStatusUpdate(order.SOID, 'Shipped')} disabled={busy}>
                        <Truck size={18} />
                        {busy ? "Dispatching..." : "Confirm Dispatch"}
                      </Button>
                    )}
                  </>
                )}
              </div>
              
              {busy && (
                <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center z-10">
                  <RefreshCw className="animate-spin text-primary" size={24} />
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => confirmDialog.type === 'approve' ? processApproveUnlock(confirmDialog.soId) : processRejectUnlock(confirmDialog.soId)}
        title={confirmDialog.type === 'approve' ? 'Approve Unlock Request?' : 'Reject Unlock Request?'}
        message={confirmDialog.type === 'approve' 
          ? `Are you sure you want to approve the unlock for ${confirmDialog.soId}? This will stop warehouse processing and return the order to Sales as a Draft.`
          : `Are you sure you want to reject the request for ${confirmDialog.soId}? The order will remain in the picking queue and the Sales team will be notified.`
        }
        confirmText={confirmDialog.type === 'approve' ? 'Approve & Reset' : 'Reject Request'}
        variant={confirmDialog.type === 'approve' ? 'danger' : 'primary'}
      />
    </>
  );
};
