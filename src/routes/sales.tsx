import { createFileRoute } from "@tanstack/react-router";
import { CreateSODialog } from "@/components/sales/CreateSODialog";
import { SOTable } from "@/components/sales/SOTable";

export const Route = createFileRoute("/sales")({
  head: () => ({
    meta: [
      { title: "Sales Portal — WINSpeed" },
      {
        name: "description",
        content:
          "Create, confirm, and track sales orders flowing into the WINSpeed ERP.",
      },
      { property: "og:title", content: "Sales Portal — WINSpeed" },
      {
        property: "og:description",
        content:
          "Modern frontend for WINSpeed ERP — manage outbound sales orders.",
      },
    ],
  }),
  component: SalesPage,
});

function SalesPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales Orders</h1>
          <p className="text-sm text-muted-foreground">
            Outbound documents — drafted here, fulfilled by the warehouse.
          </p>
        </div>
        <CreateSODialog />
      </div>
      <SOTable />
    </div>
  );
}
