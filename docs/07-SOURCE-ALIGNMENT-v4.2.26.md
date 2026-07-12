# Source Alignment v4.2.26 - WS-Sale-App

> Updated: 2026-07-08
> Scope: align documentation with current source code and Meeting Minutes WorldFert 02072026.

## Highlight - What Changed

- **Version aligned to v4.2.26**: root, backend, frontend metadata and UI badge should use the same release version.
- **Actual stack clarified**: current source code is **React 19 + Vite frontend** and **Express backend**. It is not NestJS in the current implementation.
- **Database architecture clarified**: **Microsoft SQL Server is the primary system of record** for WINSpeed `dbo` and app-owned `wf`; **MySQL is used only for TruckScale** and is bridged by WS-Sale-App so weighing data can be matched and sent back into the WINSpeed workflow.
- **WINSpeed custom build boundary documented**: WF-specific WINSpeed functions must be reused where they already exist. WS-Sale-App should not duplicate accounting or GL posting logic.
- **Meeting Minutes 02072026 converted into implementation backlog** with priority and impact notes.

## Current Runtime Version

| Area | Current value |
|---|---|
| Root package | `4.2.26` |
| Backend package | `4.2.26` |
| Frontend package | `4.2.26` |
| UI badge | `v4.2.26` |
| Current branch | `main` / `origin/main` |
| Latest reviewed commit | `d2b9b10 chore: bump version to 4.2.26 and update quotation flow` |

## Actual Application Stack

| Layer | Current implementation |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind, Zustand, Socket.IO client |
| Backend | Node.js + Express, JWT/RBAC, Socket.IO, route modules under `backend/routes` |
| Primary DB | Microsoft SQL Server 2022, database `dbwins_worldfert9` |
| WINSpeed schema | `dbo` - legacy/custom WINSpeed data and accounting documents |
| App schema | `wf` - app-owned workflow, rebate, paper trail, quotation, approval, monitoring data |
| TruckScale DB | MySQL via `mysql2`, read/sync into `wf.WeighInbox` and matching screens |

## Database Boundary

SQL Server remains the primary database. `dbo` is WINSpeed-owned and `wf` is app-owned in the same SQL Server database, so normal reporting and workflow joins can happen directly.

TruckScale is different: it already stores weighbridge data in MySQL. WS-Sale-App connects to that MySQL database as a bridge, ingests or reads weigh records, matches them to SO/vehicle data, then feeds the operational result back into the WS-Sale-App/WINSpeed process. TruckScale MySQL is not a replacement for SQL Server and should stay read-only from this app unless World Fert explicitly approves otherwise.

## Sales Ownership Source

`dbo.EMCust` does not directly identify the salesperson responsible for a customer. It stores the customer master and sale area (`SaleAreaID`). Salesperson ownership and SALES-role visibility must use `dbo.EMCustMultiEmp`, where each `CustID` can be linked to one or more `EmpID` values. `dbo.EMSaleArea` is used for area/region labels, while `wf.AppUser.DisplayName` should be treated as the current app display name mapped to `dbo.EMEmp`, not a guaranteed nickname source after database restore.

## WF Rebate Integration Alignment

Actual WINSpeed test data from 2026-07-02 confirms that the active WF rebate flow is not the old CN Rebate assumption. The integration should read the WINSpeed-owned trail:

`SOHD` 103/104 -> `WFCoupon` -> `WFRedemtionHD/DT` -> `SOInvHD/DT` 107/202 -> `ARReceHD/DT` -> `VTVAT`/`GLHD`/`GLDT`/bank tables.

WS-Sale-App should therefore show this as **WF Rebate Trail** and treat old `cn-rebate` route keys, component names, and `CnDocuNo` columns as compatibility names only. Official invoice/accounting posting and rebate redemption remain owned by WINSpeed WF functions.

## Post Invoice Boundary

The agreed operating model is: users do not key SO data entry directly in WINSpeed. WS-Sale-App creates and manages the SO workflow, then writes the approved SO into `dbo.SOHD/SODT` as WINSpeed WF `DocuType=103` so the document is visible through SO Data Entry / WF custom menus. WINSpeed Confirm/Approve Order (WF) remains responsible for the `103 -> 104` WF transition where applicable. After the order is **SHIPPED**, accounting continues in WINSpeed using **Post Invoice (WF)**, with WINSpeed owning official invoice, AR, VAT and GL posting.

The app now treats shipped orders without an invoice as **Ready for WINSpeed Post Invoice** in the Reconciliation/Post Invoice screen. Once `dbo.SOInvHD/SOInvDT` is detected for the SO, the app blocks SO edit/unlock/cancel paths to prevent app data from diverging from posted accounting documents.

Local validation against the restored 2026-07-02 TEST data showed that `DocuType=112` is not part of the active WF SO flow. Migration `036_align_winspeed_so_flow.sql` supersedes earlier confirm-procedure definitions and aligns app-confirmed SO creation to `DocuType=103` with WINSpeed WF-compatible remaining quantities and VAT type.

Follow-up validation with `I69-KORAT-1` in WINSpeed SO Data Entry confirmed additional required display/update fields. Migrations `038_winspeed_so_data_entry_mapping.sql` and `039_so_transp_id.sql` keep app-created booking rows closer to native WINSpeed rows by filling `SOHD.TranspID` for "ขนส่งโดย", `SOHD.CheckAll`, header totals/defaults, line `SODTRemark`, and line `MasterQty` / `ChildQty`. The repeatable local test utility is `backend/scripts/winspeed_so_lab.js`.

For the full working flow, status model, SQL mapping, and local lab commands, see `docs/08-WINSPEED-SO-FLOW.md`.

Quotation alignment has been re-confirmed against native WINSpeed documents created on 2026-07-12. WINSpeed Sale Quotation uses `dbo.SOHD/SODT` with `DocuType=102` for `QU...` and `DocuType=113` for confirmed `QC...` documents (`QC.RefNo = QU.DocuNo`, `QC.FromFlag = 102`). `QU6907-00001` showed the not-approved state (`AppvFlag='W'`, `DocuStatus='N'`), while `QU6907-00002` plus `QC69-00002` showed the approved/convertible state (`AppvFlag='Y'`, `DocuStatus='Y'`). WS-Sale-App now keeps the workflow/control record in `wf.Quotation` and links to native WINSpeed using `WinspeedQuoteSOID/WinspeedQuoteNo` and `WinspeedConfirmSOID/WinspeedConfirmNo` from migration `044_winspeed_native_quotation_link.sql`. Giveaway lines are excluded when SO draft trips are converted into one quotation.

## Master Data Write Boundary

World Fert approved direct master-data writes from WS-Sale-App during the transition period because maintaining these records in the app is operationally easier than doing the same work directly in WINSpeed. The approved dbo master write scope is `dbo.EMCust`, `dbo.EMGood`, and `dbo.EMSetPriceHD/DT`, with route-level role restrictions. This does not change the accounting boundary: official invoice, AR, VAT and GL posting remain WINSpeed-owned.

## WINSpeed WF Custom Build - Do Not Duplicate

Meeting Minutes 02072026 confirms the production WINSpeed is a World Fert custom build. These functions already exist in WINSpeed and should normally remain there:

### Sale Order WF functions

- Sale Booking (WF) / ใบสั่งจอง
- Approve Sale Booking (WF) / อนุมัติใบสั่งจอง
- Sale Order (WF) / ใบสั่งขาย
- Return Ticket / Return Goods (WF)
- Coupon/Fertilizer ticket redemption / ตัดตั๋วปุ๋ย
- Cancel/Clear fertilizer ticket (WF)
- Post Invoice (WF)
- SO Export/Import
- Auto Cancel approval settings

### Accounts Receivable WF functions

- Billing Note (WF) / ใบวางบิล
- Receipt (WF) / รับชำระหนี้
- Debt follow-up / ติดตามหนี้
- BlackList / Cancel Blacklist
- Generate billing note
- Clear outstanding AR/AP
- AR Export/Import

### WF reports already available in WINSpeed

- COUPON OUTSTANDING reports
- DAILY COUPON / DELIVERY ORDER / INVOICE REGISTER
- DAILY COUPON REDEMPTION
- 12 MONTHS PRODUCT DELIVERY
- Pending delivery by sales order / ลูกหนี้ค้างส่งคงเหลือ
- Weighing detail (WF)
- Credit approval report

### Practical rule

WS-Sale-App should focus on workflow assistance, UX, approval status, data visibility, TruckScale bridging, paper trail, rebate planning, and controlled `wf` records. WINSpeed remains the owner of invoice/accounting posting, GL, AR official documents, and WF custom accounting menus.

## Meeting Minutes 02072026 - Backlog

| # | Requirement | Status in v4.2.26 | Suggested implementation path | Risk |
|---|---|---|---|---|
| 1 | Add requested date/time to SO | Implemented in code | Migration `031`, backend SO routes, create/edit/detail UI | Pending DB apply |
| 2 | 5-level price color vs Set Price | Implemented in code | `CreateSODialog` price classifier | Build passed |
| 3 | Checkboxes: own truck / no truck required / P-Sling | Implemented in code | Migration `031`, backend SO routes, create/edit/detail UI | Pending DB apply |
| 4 | Hide rebate numbers by role | Implemented in code | Shared permission helper + backend redaction/access checks | Needs UAT by role |
| 5 | Dashboard search by customer/plate/date-time | Implemented in code | Dashboard/SO query params | Build passed |
| 6 | Customer filters by sales/area/group/employee | Implemented in code | Salesperson from `dbo.EMCustMultiEmp`; area/group/employee from WINSpeed customer/area tables | Needs UAT with real users |
| 7 | Deduplicate goods/category in add bill | Implemented in code | Stable goods merge key, normal + giveaway lists | Build passed |
| 8 | Giveaway as per-item checkbox + manager approval | Implemented in code | Migration `033`, per-line checkbox, manager/admin approve endpoint, confirm gate | Pending DB apply |
| 9 | Show timestamp for every status incl. shipping out | Implemented in code | SO detail status timeline + weigh-out time | Build passed |
| 10 | Customer/security print copies hide price; security copy green | Implemented in code | Paper document template logic | Needs print UAT |
| 11 | New customer flow via Sale Admin | Implemented in code | Migration `034`, `wf.CustomerRequest`, Master Data request/review panel | DB applied |
| 12 | LINE Login | Implemented in code | Migration `035`, LINE OAuth start/callback, first-time self-link by username/password | DB applied; LINE callback/self-link UAT pending |
| 13 | Ref Doc in Rebate Plan | Implemented in code | Migration `032`, backend compatible before migration, Rebate Plan UI fields | DB applied |

## Recommended Delivery Order

1. Database restore completed and migrations `031-035` were applied on 2026-07-08.
2. Restart backend so dynamic schema caches and env values are refreshed.
3. Run smoke tests for SO create/edit/confirm, giveaway approval, Rebate Plan Ref Doc, Customer Request, and LINE Login self-link.
4. Run role-based UAT for rebate visibility and Admin LINE support override.

## Notes For Future Code Changes

- Add new schema changes only through `backend/migrations`.
- Preserve existing `dbo` behavior unless a change is explicitly approved.
- Prefer app-owned `wf` workflow fields over writing new meaning into WINSpeed `dbo` columns.
- For any write that can affect accounting, route the official action through WINSpeed custom WF menus where possible.
