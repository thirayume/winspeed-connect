import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SOStatusBadge } from "@/components/sales/SOStatusBadge";
import { listSOs, syncToWINSpeed, updateSOStatus } from "@/services/api";
import { useErpStore } from "@/store/erp-store";

export function OutboundQueue() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["sos"],
    queryFn: listSOs,
    refetchInterval: 800,
  });
  const customers = useErpStore((s) => s.customers);
  const items = useErpStore((s) => s.items);
  const [busyId, setBusyId] = useState<string | null>(null);

  const queue = (data ?? []).filter(
    (s) => s.Status === "Confirmed" || s.Status === "Picking",
  );

  const start = async (id: string) => {
    setBusyId(id);
    await updateSOStatus(id, "Picking");
    toast.success(`${id} — picking started`);
    setBusyId(null);
    qc.invalidateQueries({ queryKey: ["sos"] });
  };

  const dispatch = async (id: string) => {
    setBusyId(id);
    await updateSOStatus(id, "Shipped");
    await syncToWINSpeed("SO", id);
    toast.success(`${id} dispatched`, { description: "Synced to WINSpeed ERP" });
    setBusyId(null);
    qc.invalidateQueries({ queryKey: ["sos"] });
  };

  if (!queue.length) {
    return (
      <Card className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Picking queue is empty.
      </Card>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {queue.map((so) => {
        const cust = customers.find((c) => c.CustID === so.CustID);
        const total = so.lines.reduce(
          (s, l) => s + l.GoodQty1 * l.GoodPrice1,
          0,
        );
        const busy = busyId === so.SOID;
        return (
          <Card key={so.SOID} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">
                    {so.SOID}
                  </span>
                  <SOStatusBadge status={so.Status} />
                </div>
                <div className="mt-0.5 text-sm">{cust?.CustName}</div>
                <div className="text-xs text-muted-foreground">
                  {so.DocuDate} · {so.lines.length} line
                  {so.lines.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="text-base font-semibold tabular-nums">
                  ฿{total.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="my-3 space-y-1 rounded-md bg-muted/40 p-2 text-xs">
              {so.lines.map((l) => {
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

            <div className="flex gap-2">
              {so.Status === "Confirmed" ? (
                <Button
                  className="flex-1"
                  onClick={() => start(so.SOID)}
                  disabled={busy}
                >
                  <PackageCheck className="mr-1.5 h-4 w-4" /> Start Picking
                </Button>
              ) : (
                <Button
                  className="flex-1"
                  onClick={() => dispatch(so.SOID)}
                  disabled={busy}
                >
                  <Truck className="mr-1.5 h-4 w-4" /> Confirm Dispatch
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
