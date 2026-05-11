import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useErpStore } from "@/store/erp-store";
import { createSO } from "@/services/api";

type Line = { GoodID: string; GoodQty1: number; GoodPrice1: number };

export function CreateSODialog({ onCreated }: { onCreated?: () => void }) {
  const customers = useErpStore((s) => s.customers);
  const items = useErpStore((s) => s.items);
  const [open, setOpen] = useState(false);
  const [custId, setCustId] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { GoodID: "", GoodQty1: 1, GoodPrice1: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.GoodQty1 * l.GoodPrice1, 0),
    [lines],
  );

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const onItemChange = (i: number, goodId: string) => {
    const item = items.find((g) => g.GoodID === goodId);
    updateLine(i, { GoodID: goodId, GoodPrice1: item?.GoodPrice1 ?? 0 });
  };

  const reset = () => {
    setCustId("");
    setLines([{ GoodID: "", GoodQty1: 1, GoodPrice1: 0 }]);
  };

  const handleSubmit = async () => {
    if (!custId) return toast.error("Select a customer");
    const valid = lines.filter((l) => l.GoodID && l.GoodQty1 > 0);
    if (!valid.length) return toast.error("Add at least one item");
    setSubmitting(true);
    try {
      const so = await createSO({ CustID: custId, lines: valid });
      toast.success(`Created ${so.SOID}`, { description: "Status: Draft" });
      setOpen(false);
      reset();
      onCreated?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1.5 h-4 w-4" /> Create SO
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Sales Order</DialogTitle>
          <DialogDescription>
            Draft a new outbound order. It can be confirmed once reviewed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Customer</Label>
            <Select value={custId} onValueChange={setCustId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.CustID} value={c.CustID}>
                    {c.CustID} — {c.CustName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line Items</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    { GoodID: "", GoodQty1: 1, GoodPrice1: 0 },
                  ])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add line
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className="grid grid-cols-12 items-end gap-2 rounded-md border border-border bg-card p-2"
                >
                  <div className="col-span-6">
                    <Label className="text-[11px] text-muted-foreground">
                      Item
                    </Label>
                    <Select
                      value={line.GoodID}
                      onValueChange={(v) => onItemChange(i, v)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select item" />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((g) => (
                          <SelectItem key={g.GoodID} value={g.GoodID}>
                            {g.GoodID} — {g.GoodName1}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[11px] text-muted-foreground">
                      Qty
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={line.GoodQty1}
                      onChange={(e) =>
                        updateLine(i, { GoodQty1: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-[11px] text-muted-foreground">
                      Price
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={line.GoodPrice1}
                      onChange={(e) =>
                        updateLine(i, { GoodPrice1: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground"
                      onClick={() =>
                        setLines((ls) => ls.filter((_, idx) => idx !== i))
                      }
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-muted/50 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Order total</span>
            <span className="text-base font-semibold tabular-nums">
              ฿{total.toLocaleString()}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Creating..." : "Create Draft SO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
