
# WINSpeed Frontend — Sales & Store Portals

A polished, enterprise-SaaS-style frontend (Vercel/Linear feel) wrapping a mock WINSpeed ERP. Built on the project's existing TanStack Start + React 19 + Tailwind v4 + shadcn/ui stack (Next.js isn't supported here, but every component pattern from your spec applies identically).

## Scope

Two portals, one app, shared mock store, full SO state machine + PO receiving.

## Routes

```text
/                 -> landing redirect to /sales
/sales            -> Sales Dashboard (SO table + create + details drawer)
/store            -> Store layout with tabs
/store/outbound   -> Picking Queue (Confirmed/Picking SOs)
/store/inbound    -> Receiving Queue (Pending POs)
```

Top-level shell (in `__root.tsx`) gets a left sidebar with two portal entries (Sales / Store), a header, and a notification bell that surfaces unlock requests from Sales.

## State Machine

```text
Draft ──confirm──> Confirmed ──startPicking──> Picking ──confirmDispatch──> Shipped
  ▲                                              │
  └──────── store approves unlock ───────────────┘
```

Rules enforced in UI + store layer:
- Sales edit/cancel buttons disabled when status ∈ {Picking, Shipped}.
- "Request Unlock" visible only in Picking; creates an `UnlockRequest` notification.
- Store approves → SO reverts to Draft, request marked resolved.
- "Confirm Dispatch" (Picking → Shipped) calls `syncToWINSpeed` mock.

## File Layout

```text
src/
  routes/
    index.tsx                 # redirect to /sales
    sales.tsx                 # Sales Dashboard
    store.tsx                 # Store layout w/ <Outlet/> + tab nav
    store.outbound.tsx        # Picking queue
    store.inbound.tsx         # Receiving queue
  components/
    layout/AppShell.tsx       # sidebar + header + notif bell
    layout/NotificationBell.tsx
    sales/
      SOTable.tsx
      SOStatusBadge.tsx
      CreateSODialog.tsx      # customer select, item rows, qty, price, total
      SODetailsSheet.tsx      # shows state + Request Unlock when locked
    store/
      OutboundQueue.tsx       # Start Picking / Confirm Dispatch buttons
      InboundQueue.tsx
      ReceiveGoodsDialog.tsx  # confirm qty per line, syncs to ERP
      UnlockRequestList.tsx
  services/
    api.ts                    # mock fetch fns (1s delay)
    winspeed-types.ts         # EMCust / EMGood / SOHD / SODT / POHD / POdt
  store/
    erp-store.ts              # zustand store w/ seed data + actions
  lib/utils.ts                # (existing)
```

## Mock API (`services/api.ts`)

All return `Promise<T>` resolved after 1s, easy to swap for SQL Express later:
- `listCustomers()`, `listItems()`
- `listSOs()`, `getSO(id)`, `createSO(payload)`, `updateSOStatus(id, status)`
- `requestUnlock(soId)`, `approveUnlock(requestId)`
- `listPOs()`, `receivePO(id, lines)`
- `syncToWINSpeed(entity, id)` — logged + toasted

State is held in a zustand store seeded with sample customers, items, 4–5 SOs across all statuses, and 2–3 pending POs. API functions read/write that store so the UI stays reactive while still going through the async boundary.

## UI / Design

- Tailwind v4 tokens already defined in `src/styles.css` (oklch). Add a couple of semantic accents for status badges:
  - `--status-draft` (muted), `--status-confirmed` (blue), `--status-picking` (amber), `--status-shipped` (green), `--status-locked` (rose).
  - All registered in `@theme inline` so `bg-status-picking` etc. work.
- shadcn components used: `table`, `badge`, `button`, `dialog`, `sheet`, `tabs`, `select`, `input`, `card`, `separator`, `tooltip`, `dropdown-menu`, `sonner` for toasts.
- Lucide icons: `ShoppingCart`, `Warehouse`, `PackageCheck`, `Truck`, `Lock`, `Unlock`, `Bell`, `Plus`, `RefreshCw`.
- Layout: 240px sidebar, sticky header, content max-w-7xl, generous spacing, subtle borders, rounded-xl cards — Linear/Vercel vibe.
- Each route sets its own `head()` with title + description.

## Mock Data Shapes

Mirrors WINSpeed SQL columns exactly so a future SQL adapter is a drop-in:
```ts
type EMCust = { CustID: string; CustName: string };
type EMGood = { GoodID: string; GoodName1: string; GoodPrice1: number };
type SOStatus = 'Draft' | 'Confirmed' | 'Picking' | 'Shipped';
type SOHD = { SOID: string; CustID: string; DocuDate: string; Status: SOStatus };
type SODT = { SOID: string; ListNo: number; GoodID: string; GoodQty1: number; GoodPrice1: number };
type POHD = { POID: string; VendorID: string; Status: 'Pending Receipt' | 'Received' };
type UnlockRequest = { id: string; SOID: string; createdAt: string; resolved: boolean };
```

## Build Order

1. Add zustand, define types, build `services/api.ts` with seed data.
2. Build `AppShell` + sidebar + notification bell wired to unlock requests.
3. Sales route: table, status badge, create-SO dialog, details sheet, request-unlock flow.
4. Store layout + tabs; Outbound queue with Start Picking / Confirm Dispatch; Inbound queue with Receive Goods dialog.
5. Wire `syncToWINSpeed` toasts; verify state transitions and lock rules end-to-end in preview.

## Out of Scope

- Real SQL Server connection (left as the `api.ts` seam).
- Auth / per-user roles (Sales vs Store assumed by which portal you're on).
- Persistence across reloads (in-memory only; trivial to add localStorage later).
