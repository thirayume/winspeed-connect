import React, { useState } from 'react';
import { Package, CheckCircle, AlertCircle, Play, PackageCheck, Truck } from 'lucide-react';
import { Button, Card, cn } from '../ui/Base';
import { SOStatusBadge } from '../sales/SOStatusBadge';
import { useErpStore } from '../../store/erp-store';
import { updateSOStatus, resolveUnlockRequest, syncToWINSpeed } from '../../services/api';
import type { SOWithDetails } from '../../types';

export const PickingQueue = ({ orders, onUpdate }: { orders: SOWithDetails[], onUpdate: () => void }) => {
  const unlockRequests = useErpStore(s => s.unlockRequests);
  const customers = useErpStore(s => s.customers);
  const items = useErpStore(s => s.items);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleStatusUpdate = async (soId: string, status: 'Picking' | 'Shipped') => {
    setBusyId(soId);
    await updateSOStatus(soId, status);
    if (status === 'Shipped') {
        await syncToWINSpeed('SO', soId);
    }
    setBusyId(null);
    onUpdate();
  };

  const handleApproveUnlock = async (soId: string) => {
    const request = unlockRequests.find(r => r.SOID === soId && !r.resolved);
    if (request) {
        setBusyId(soId);
        await resolveUnlockRequest(request.id);
        setBusyId(null);
        onUpdate();
    }
  };

  if (orders.length === 0) {
    return (
      <Card className="flex flex-col h-48 items-center justify-center text-center">
        <Package className="text-muted-foreground mb-3 opacity-50" size={40} />
        <p className="text-sm text-muted-foreground font-medium">Picking queue is empty</p>
        <p className="text-xs text-muted-foreground mt-1 opacity-70">Confirmed orders will appear here for processing.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {orders.map(order => {
        const isUnlockRequested = unlockRequests.some(r => r.SOID === order.SOID && !r.resolved);
        const custName = customers.find(c => c.CustID === order.CustID)?.CustName || order.CustID;
        const total = order.lines.reduce((s, l) => s + l.GoodQty1 * l.GoodPrice1, 0);
        const busy = busyId === order.SOID;
        
        return (
          <Card key={order.SOID} className="p-4 sm:p-5 flex flex-col group">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-mono text-sm font-semibold text-foreground">{order.SOID}</span>
                  <SOStatusBadge status={order.Status} />
                  {isUnlockRequested && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold animate-pulse w-fit">
                        <AlertCircle size={12} />
                        UNLOCK REQUESTED
                      </div>
                      {unlockRequests.find(r => r.SOID === order.SOID && !r.resolved)?.reason && (
                        <div className="text-[10px] italic text-red-500 font-medium px-1">
                          "{unlockRequests.find(r => r.SOID === order.SOID && !r.resolved)?.reason}"
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-sm text-foreground truncate max-w-[200px]">{custName}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {order.DocuDate} · {order.lines.length} line{order.lines.length !== 1 && 's'}
                </div>
              </div>
              <div className="text-right pl-2">
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="text-base font-semibold tabular text-foreground">
                  ฿{total.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="my-4 space-y-1 rounded-lg bg-slate-50/80 p-3 border border-border text-xs">
              {order.lines.map((l) => {
                const item = items.find((g) => g.GoodID === l.GoodID);
                return (
                  <div
                    key={l.ListNo}
                    className="flex justify-between tabular text-foreground"
                  >
                    <span className="truncate text-muted-foreground max-w-[220px]">
                      {item?.GoodName1 ?? l.GoodID}
                    </span>
                    <span className="font-medium">
                      ×{l.GoodQty1}
                    </span>
                  </div>
                );
              })}
            </div>
            
            <div className="mt-auto pt-2">
              {isUnlockRequested && (
                <Button variant="danger" className="w-full" onClick={() => handleApproveUnlock(order.SOID)} disabled={busy}>
                  {busy ? "Processing..." : "Approve & Reset to Draft"}
                </Button>
              )}
              {order.Status === 'Confirmed' && !isUnlockRequested && (
                <Button className="w-full gap-2" onClick={() => handleStatusUpdate(order.SOID, 'Picking')} disabled={busy}>
                  <PackageCheck size={16} />
                  {busy ? "Starting..." : "Start Picking"}
                </Button>
              )}
              {order.Status === 'Picking' && !isUnlockRequested && (
                <Button className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white border-transparent" onClick={() => handleStatusUpdate(order.SOID, 'Shipped')} disabled={busy}>
                  <Truck size={16} />
                  {busy ? "Dispatching..." : "Confirm Dispatch"}
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
};
