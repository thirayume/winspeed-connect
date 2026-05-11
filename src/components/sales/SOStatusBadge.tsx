import { Badge } from "@/components/ui/badge";
import type { SOStatus } from "@/services/winspeed-types";
import { cn } from "@/lib/utils";

const styles: Record<SOStatus, string> = {
  Draft: "bg-muted text-muted-foreground border-border",
  Confirmed: "bg-status-confirmed/15 text-status-confirmed border-status-confirmed/30",
  Picking: "bg-status-picking/15 text-status-picking border-status-picking/30",
  Shipped: "bg-status-shipped/15 text-status-shipped border-status-shipped/40",
};

export function SOStatusBadge({ status }: { status: SOStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", styles[status])}>
      {status}
    </Badge>
  );
}
