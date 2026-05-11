import { Link, Outlet, createFileRoute, redirect, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/store")({
  head: () => ({
    meta: [
      { title: "Store Portal — WINSpeed" },
      {
        name: "description",
        content:
          "Warehouse picking, dispatch, and receiving against WINSpeed ERP documents.",
      },
      { property: "og:title", content: "Store Portal — WINSpeed" },
      {
        property: "og:description",
        content: "Inbound and outbound warehouse operations for WINSpeed ERP.",
      },
    ],
  }),
  beforeLoad: ({ location }) => {
    if (location.pathname === "/store") {
      throw redirect({ to: "/store/outbound" });
    }
  },
  component: StoreLayout,
});

const tabs = [
  { to: "/store/outbound", label: "Outbound — Picking" },
  { to: "/store/inbound", label: "Inbound — Receiving" },
] as const;

function StoreLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Warehouse</h1>
        <p className="text-sm text-muted-foreground">
          Run picking and receiving — actions sync to WINSpeed automatically.
        </p>
      </div>
      <div className="mb-5 inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
        {tabs.map((t) => {
          const active = pathname.startsWith(t.to);
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}
