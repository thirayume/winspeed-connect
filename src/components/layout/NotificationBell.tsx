import { Bell, Unlock } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useErpStore } from "@/store/erp-store";
import { approveUnlock } from "@/services/api";

export function NotificationBell() {
  const navigate = useNavigate();
  const requests = useErpStore((s) => s.unlockRequests);
  const pending = requests.filter((r) => !r.resolved);

  const handleApprove = async (id: string, soid: string) => {
    await approveUnlock(id);
    toast.success(`Unlocked ${soid}`, { description: "SO reverted to Draft." });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {pending.length > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-locked px-1 text-[10px] font-semibold text-white">
              {pending.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border p-3">
          <div className="text-sm font-semibold">Unlock Requests</div>
          <div className="text-xs text-muted-foreground">
            From Sales — review and approve
          </div>
        </div>
        <div className="max-h-80 overflow-auto">
          {pending.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No pending requests
            </div>
          ) : (
            pending.map((r) => (
              <div
                key={r.id}
                className="flex items-start gap-3 border-b border-border p-3 last:border-b-0"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-status-locked/10 text-status-locked">
                  <Unlock className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.SOID}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Requested {new Date(r.createdAt).toLocaleTimeString()}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs"
                      onClick={() => handleApprove(r.id, r.SOID)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => navigate({ to: "/store/outbound" })}
                    >
                      View queue
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
