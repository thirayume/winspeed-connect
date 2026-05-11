import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Boxes, ShoppingCart, Warehouse } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { NotificationBell } from "./NotificationBell";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/sales", label: "Sales", icon: ShoppingCart, desc: "Outbound orders" },
  { to: "/store/outbound", label: "Store", icon: Warehouse, desc: "Inbound & outbound" },
] as const;

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
            <Boxes className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">WINSpeed</span>
            <span className="text-[11px] text-muted-foreground">ERP Console</span>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => {
            const active =
              item.to === "/sales"
                ? pathname.startsWith("/sales")
                : pathname.startsWith("/store");
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="mt-0.5 h-4 w-4" />
                <div className="flex flex-col">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-[11px] text-muted-foreground">{item.desc}</span>
                </div>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-4 text-[11px] text-muted-foreground">
          Connected to: <span className="text-foreground">WINSpeed (mock)</span>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3 md:hidden">
            <Boxes className="h-5 w-5" />
            <span className="text-sm font-semibold">WINSpeed</span>
          </div>
          <div className="hidden text-sm text-muted-foreground md:block">
            {pathname.startsWith("/sales")
              ? "Sales Portal"
              : pathname.startsWith("/store")
                ? "Store / Warehouse Portal"
                : "Dashboard"}
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <div className="hidden items-center gap-2 sm:flex">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-foreground/80 to-foreground" />
              <div className="text-xs leading-tight">
                <div className="font-medium">Operator</div>
                <div className="text-muted-foreground">Plant 01</div>
              </div>
            </div>
          </div>
        </header>

        <nav className="flex gap-1 border-b border-border bg-background px-3 py-2 md:hidden">
          {nav.map((item) => {
            const active =
              item.to === "/sales"
                ? pathname.startsWith("/sales")
                : pathname.startsWith("/store");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-center text-xs font-medium",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>

      <Toaster richColors position="top-right" />
    </div>
  );
}
