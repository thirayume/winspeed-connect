import { useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { SOStatusBadge } from "./SOStatusBadge";
import type { SOWithDetails } from "@/services/winspeed-types";
import { useErpStore } from "@/store/erp-store";
import { requestUnlock, updateSOStatus } from "@/services/api";

const isLocked = (status: string) =>
  status === "Picking" || status === "Shipped";

export function SODetailsSheet({
  so,
  open,
  onOpenChange,
}: {
  so: SOWithDetails | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const customers = useErpStore((s) => s.customers);
  const items = useErpStore((s) => s.items);
  const requests = useErpStore((s) => s.unlockRequests);
  const [busy, setBusy] = useState(false);

  if (!so) return null;
  const customer = customers.find((c) => c.CustID === so.CustID);
  const total = so.lines.reduce((s, l) => s + l.GoodQty1 * l.GoodPrice1, 0);
  const locked = isLocked(so.Status);
  const pendingReq = requests.find((r) => r.SOID === so.SOID && !r.resolved);

  const handleConfirm = async () => {
    setBusy(true);
    await updateSOStatus(so.SOID, "Confirmed");
    toast.success(`${so.SOID} confirmed`);
    setBusy(false);
  };

  const handleUnlock = async () => {
    setBusy(true);
    await requestUnlock(so.SOID);
    toast.success("Unlock requested", {
      description: "Store has been notified.",
    });
    setBusy(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-5">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl">{so.SOID}</SheetTitle>
            <SOStatusBadge status={so.Status} />
          </div>
          <SheetDescription>
            {customer?.CustName} · {so.DocuDate}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 p-6">
          {locked && (
            <div className="flex items-start gap-3 rounded-md border border-status-locked/30 bg-status-locked/5 p-3 text-sm">
              <Lock className="mt-0.5 h-4 w-4 text-status-locked" />
              <div className="flex-1">
                <div className="font-medium text-foreground">
                  This SO is locked
                </div>
                <div className="text-xs text-muted-foreground">
                  Editing and cancellation are disabled while warehouse is
                  processing.
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Line Items
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">#</th>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {so.lines.map((l) => {
                    const item = items.find((g) => g.GoodID === l.GoodID);
                    return (
                      <tr
                        key={l.ListNo}
                        className="border-t border-border tabular-nums"
                      >
                        <td className="px-3 py-2 text-muted-foreground">
                          {l.ListNo}
                        </td>
                        <td className="px-3 py-2">
                          <div>{item?.GoodName1 ?? l.GoodID}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {l.GoodID}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">{l.GoodQty1}</td>
                        <td className="px-3 py-2 text-right">
                          ฿{l.GoodPrice1.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          ฿{(l.GoodQty1 * l.GoodPrice1).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Order total</span>
            <span className="text-lg font-semibold tabular-nums">
              ฿{total.toLocaleString()}
            </span>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            {so.Status === "Draft" && (
              <Button onClick={handleConfirm} disabled={busy}>
                Confirm Order
              </Button>
            )}
            {so.Status === "Picking" &&
              (pendingReq ? (
                <Button variant="secondary" disabled>
                  Unlock requested · awaiting Store
                </Button>
              ) : (
                <Button onClick={handleUnlock} disabled={busy} variant="default">
                  <Unlock className="mr-1.5 h-4 w-4" /> Request Unlock
                </Button>
              ))}
            <Button variant="outline" disabled={locked}>
              Edit
            </Button>
            <Button variant="outline" disabled={locked}>
              Cancel SO
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
