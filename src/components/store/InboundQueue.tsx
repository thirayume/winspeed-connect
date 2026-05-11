import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { listPOs, receivePO, syncToWINSpeed } from "@/services/api";
import { useErpStore } from "@/store/erp-store";
import type { POWithDetails } from "@/services/winspeed-types";

export function InboundQueue() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["pos"],
    queryFn: listPOs,
    refetchInterval: 1000,
  });
  const vendors = useErpStore((s) => s.vendors);
  const items = useErpStore((s) => s.items);
  const [active, setActive] = useState<POWithDetails | null>(null);
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (active) {
      const init: Record<number, number> = {};
      active.lines.forEach((l) => (init[l.ListNo] = l.GoodQty1));
      setQtys(init);
    }
  }, [active]);

  const pending = (data ?? []).filter((p) => p.Status === "Pending Receipt");

  const handleReceive = async () => {
    if (!active) return;
    setBusy(true);
    const lines = active.lines.map((l) => ({
      GoodID: l.GoodID,
      GoodQty1: qtys[l.ListNo] ?? l.GoodQty1,
    }));
    await receivePO(active.POID, lines);
    await syncToWINSpeed("PO", active.POID);
    toast.success(`${active.POID} received`, { description: "Synced to WINSpeed ERP" });
    setBusy(false);
    setActive(null);
    qc.invalidateQueries({ queryKey: ["pos"] });
  };

  if (!pending.length) {
    return (
      <Card className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No inbound shipments waiting.
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {pending.map((po) => {
          const vendor = vendors.find((v) => v.VendorID === po.VendorID);
          return (
            <Card key={po.POID} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">
                      {po.POID}
                    </span>
                    <Badge
                      variant="outline"
                      className="border-status-picking/30 bg-status-picking/15 text-status-picking"
                    >
                      Pending Receipt
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-sm">{vendor?.VendorName}</div>
                  <div className="text-xs text-muted-foreground">
                    {po.DocuDate} · {po.lines.length} line
                    {po.lines.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>

              <div className="my-3 space-y-1 rounded-md bg-muted/40 p-2 text-xs">
                {po.lines.map((l) => {
                  const item = items.find((g) => g.GoodID === l.GoodID);
                  return (
                    <div
                      key={l.ListNo}
                      className="flex justify-between tabular-nums"
                    >
                      <span className="truncate text-muted-foreground">
                        {item?.GoodName1 ?? l.GoodID}
                      </span>
                      <span className="font-medium text-foreground">
                        ×{l.GoodQty1}
                      </span>
                    </div>
                  );
                })}
              </div>

              <Button className="w-full" onClick={() => setActive(po)}>
                <PackageOpen className="mr-1.5 h-4 w-4" /> Receive Goods
              </Button>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Receive {active?.POID}</DialogTitle>
            <DialogDescription>
              Confirm received quantities. This will sync to WINSpeed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {active?.lines.map((l) => {
              const item = items.find((g) => g.GoodID === l.GoodID);
              return (
                <div
                  key={l.ListNo}
                  className="grid grid-cols-12 items-center gap-2 rounded-md border border-border p-2"
                >
                  <div className="col-span-7">
                    <div className="text-sm font-medium">
                      {item?.GoodName1 ?? l.GoodID}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {l.GoodID} · ordered {l.GoodQty1}
                    </div>
                  </div>
                  <div className="col-span-5">
                    <Input
                      type="number"
                      min={0}
                      value={qtys[l.ListNo] ?? l.GoodQty1}
                      onChange={(e) =>
                        setQtys((q) => ({
                          ...q,
                          [l.ListNo]: Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActive(null)}>
              Cancel
            </Button>
            <Button onClick={handleReceive} disabled={busy}>
              {busy ? "Receiving..." : "Confirm Receipt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
