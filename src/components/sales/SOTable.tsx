import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { listSOs } from "@/services/api";
import { useErpStore } from "@/store/erp-store";
import { SOStatusBadge } from "./SOStatusBadge";
import { SODetailsSheet } from "./SODetailsSheet";
import type { SOWithDetails } from "@/services/winspeed-types";

export function SOTable() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["sos"],
    queryFn: listSOs,
    refetchInterval: 800,
  });
  const customers = useErpStore((s) => s.customers);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // refresh on store mutations
  useEffect(() => {
    return useErpStore.subscribe(() => qc.invalidateQueries({ queryKey: ["sos"] }));
  }, [qc]);

  const rows = (data ?? []).filter((s) => {
    const cust = customers.find((c) => c.CustID === s.CustID)?.CustName ?? "";
    const q = query.toLowerCase();
    return (
      s.SOID.toLowerCase().includes(q) ||
      cust.toLowerCase().includes(q) ||
      s.Status.toLowerCase().includes(q)
    );
  });

  const selected: SOWithDetails | null =
    rows.find((r) => r.SOID === selectedId) ??
    data?.find((r) => r.SOID === selectedId) ??
    null;

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search SO, customer, status..."
            className="pl-8"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>SO ID</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && !data ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Loading orders...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No sales orders match your search.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((so) => {
                const cust = customers.find((c) => c.CustID === so.CustID);
                const total = so.lines.reduce(
                  (s, l) => s + l.GoodQty1 * l.GoodPrice1,
                  0,
                );
                return (
                  <TableRow
                    key={so.SOID}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(so.SOID)}
                  >
                    <TableCell className="font-mono text-xs font-medium">
                      {so.SOID}
                    </TableCell>
                    <TableCell>{cust?.CustName ?? so.CustID}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {so.DocuDate}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {so.lines.length}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      ฿{total.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <SOStatusBadge status={so.Status} />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <SODetailsSheet
        so={selected}
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
    </>
  );
}
