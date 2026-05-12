import React, { useState, useEffect } from 'react';
import { Truck, ArrowDownCircle, CheckCircle, RefreshCw, PackageOpen } from 'lucide-react';
import { Button, Badge, Card } from '../ui/Base';
import { Modal } from '../ui/Modal';
import { receivePO, syncToWINSpeed } from '../../services/api';
import { useErpStore } from '../../store/erp-store';
import type { POWithDetails } from '../../types';

export const ReceivingQueue = ({ orders, onUpdate }: { orders: POWithDetails[], onUpdate: () => void }) => {
  const [selectedPO, setSelectedPO] = useState<POWithDetails | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [qtys, setQtys] = useState<Record<number, number>>({});
  
  const vendors = useErpStore(s => s.vendors);
  const items = useErpStore(s => s.items);

  useEffect(() => {
    if (selectedPO) {
      const initQtys: Record<number, number> = {};
      selectedPO.lines.forEach(l => {
        initQtys[l.ListNo] = l.GoodQty1;
      });
      setQtys(initQtys);
    }
  }, [selectedPO]);

  const handleReceiveGoods = async () => {
    if (!selectedPO) return;
    setSyncing(true);
    try {
      const receiveLines = selectedPO.lines.map(l => ({
         GoodID: l.GoodID,
         GoodQty1: qtys[l.ListNo] ?? l.GoodQty1
      }));
      await receivePO(selectedPO.POID, receiveLines);
      await syncToWINSpeed('PO', selectedPO.POID);
      setSelectedPO(null);
      onUpdate();
    } finally {
      setSyncing(false);
    }
  };

  if (orders.length === 0) {
    return (
      <Card className="flex flex-col h-48 items-center justify-center text-center">
        <Truck className="text-muted-foreground mb-3 opacity-50" size={40} />
        <p className="text-sm text-muted-foreground font-medium">Receiving queue is empty</p>
        <p className="text-xs text-muted-foreground mt-1 opacity-70">No inbound shipments waiting.</p>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {orders.map(po => {
          const vendor = vendors.find(v => v.VendorID === po.VendorID);
          return (
            <Card key={po.POID} className="p-4 sm:p-5 flex flex-col group">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-semibold text-foreground">{po.POID}</span>
                    <Badge variant={po.Status === 'Partially Received' ? 'warning' : 'default'} className="bg-[var(--color-status-picking)]/10 text-[var(--color-status-picking)] border-[var(--color-status-picking)]/20 px-2 py-0.5">
                      {po.Status}
                    </Badge>
                  </div>
                  <div className="text-sm text-foreground truncate max-w-[200px]">{vendor?.VendorName || po.VendorID}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {po.DocuDate} · {po.lines.length} line{po.lines.length !== 1 && 's'}
                  </div>
                </div>
              </div>

              <div className="my-4 space-y-1 rounded-lg bg-slate-50/80 p-3 border border-border text-xs">
                {po.lines.map((l) => {
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
                 <Button className="w-full gap-2" onClick={() => setSelectedPO(po)}>
                   <PackageOpen size={16} />
                   Receive Goods
                 </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Modal 
        isOpen={!!selectedPO} 
        onClose={() => !syncing && setSelectedPO(null)} 
        title={`Receive ${selectedPO?.POID}`}
      >
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
             Confirm received quantities. This will sync to WINSpeed.
          </p>
          
          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1 custom-scrollbar">
             {selectedPO?.lines.map(line => {
                const item = items.find((g) => g.GoodID === line.GoodID);
                return (
                  <div key={line.ListNo} className="grid grid-cols-12 items-center gap-3 rounded-xl border border-border p-3 sm:p-4 bg-slate-50/50">
                    <div className="col-span-8 sm:col-span-9">
                      <div className="text-sm font-medium text-foreground">
                        {item?.GoodName1 ?? line.GoodID}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {line.GoodID} · ordered {line.GoodQty1}
                      </div>
                    </div>
                    <div className="col-span-4 sm:col-span-3">
                      <input
                        type="number"
                        min={0}
                        value={qtys[line.ListNo] ?? line.GoodQty1}
                        onChange={(e) => setQtys(prev => ({ ...prev, [line.ListNo]: Number(e.target.value) }))}
                        className="w-full rounded-lg border border-border bg-white py-2 px-2.5 text-sm focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none transition-all shadow-sm tabular text-right"
                      />
                    </div>
                  </div>
                );
             })}
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-border">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setSelectedPO(null)} disabled={syncing}>
              Cancel
            </Button>
            <Button onClick={handleReceiveGoods} disabled={syncing} className="w-full sm:w-auto bg-foreground text-background">
              {syncing ? <RefreshCw className="animate-spin mr-2" size={16} /> : null}
              {syncing ? "Receiving..." : "Confirm Receipt"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
