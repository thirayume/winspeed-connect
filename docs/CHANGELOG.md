# Changelog

## [v5.0.0] - 2026-07-14

### Added
- Added SO requested/notification date-time and transport flags: own truck, no truck required, and P-Sling.
- Added 5-level sales price color display compared with Set Price.
- Added role-based rebate amount visibility in backend/frontend paths.
- Added dashboard search by customer, truck plate, and date/time.
- Added customer filters by salesperson, area, customer group, and employee.
- Added per-item giveaway checkbox and manager/admin approval gate before SO confirm.
- Added status timeline timestamps, including shipping/weigh-out time.
- Added Paper Trail print changes: customer/security copies hide price; security copy uses green styling.
- Added Rebate Plan Ref Doc fields.
- Added app-owned new customer request flow through Sale Admin/Master Data without auto-writing `dbo.EMCust`.
- Added LINE Login OAuth with first-time self-link by existing username/password, plus Admin support override for `wf.AppUser.LineUserId`.
- Added read-only WF Rebate Trail from WINSpeed (`SOHD` 103/104 -> `WFCoupon` -> `WFRedemtion` -> `SOInv` -> receipt/GL trail).
- Added Post Invoice readiness indicators for shipped SOs and invoice/GL reconciliation visibility.
- Added WINSpeed invoice posted/locked badge to SO detail.
- Added WINSpeed SO Data Entry lab script and migration `038` to preserve transport display, header check-all, header totals, line descriptions, and Master/Child quantities.
- Added migration `039` and SO form/API mapping for explicit transporter (`TranspID`) selection, credit days, header remarks, and per-line Master/Child quantities across draft create/edit and WINSpeed confirm flow.
- Added migration `044` and WINSpeed Quotation lab script after validating native documents `QU6907-00001`, `QU6907-00002`, and `QC69-00002`.
- Added repeatable automated QA scripts: `smoke:queries`, `smoke:api`, and `smoke:api:local`.
- Added automated QA documentation and manual retest checklist in `docs/09-AUTOMATED-QA-v5.0.0.md`.

### Changed
- Aligned backend/frontend metadata and visible UI badge to v5.0.0.
- Updated documentation to reflect the actual stack: React 19 + Vite + Express.
- Clarified database architecture: SQL Server is the primary WINSpeed/App database; MySQL is used as the TruckScale bridge only.
- Re-aligned the old CN Rebate screen/report into WF Rebate Trail; legacy `cn-rebate` keys remain only for compatibility.
- Locked SO edit/unlock/cancel paths after a WINSpeed invoice is detected, preserving WINSpeed as the owner of invoice/AR/GL posting.
- Clarified and restricted approved dbo master-data write routes for customers, goods, and price lists.
- Aligned app-confirmed SO creation with the observed WINSpeed WF flow: app confirm now writes `SOHD/SODT` as `DocuType=103`; WINSpeed WF menus own the `103 -> 104` transition and invoice/accounting posting.
- Tightened app-created `DocuType=103` rows to match WINSpeed SO Data Entry after local validation with `I69-KORAT-1`: `SOHD.TranspID`, `SOHD.CheckAll`, `SODT.CheckFlag`, `SODT.MasterQty`, and `SODT.ChildQty` are now part of the mapped contract.
- Re-aligned app quotation integration to native WINSpeed Sale Quotation: `SOHD/SODT DocuType=102` for `QU...` and `DocuType=113` for confirmed `QC...`; `SCEstimate*` is no longer the active mapping for this flow.
- Aligned customer salesperson filtering and SALES visibility to `dbo.EMCustMultiEmp` instead of assuming salesperson fields exist on `dbo.EMCust`.
- Fixed API audit path capture so Access As API calls are reliably written to `wf.ApiAuditLog`.
- Improved `/api/so` list performance by splitting total-count and page queries while preserving the same response shape.
- Adjusted frontend lint policy to keep React/data-loading advisory rules as warnings while still failing on real lint errors.
- Added `07-SOURCE-ALIGNMENT-v5.0.0.md` to highlight source/document alignment, WINSpeed WF custom-build boundaries, and Meeting Minutes 02072026 backlog.

### Database Migration Status
- Applied schema migrations `001-035` to the restored local `dbwins_worldfert9` database on 2026-07-08.
- `000_logins.sql` is treated as a manual security setup file and is skipped by the default Node migration runner.
- Latest local QA checked 49 migration files through `045_access_as_audit.sql`; all were applied or unchanged.

### QA Status
- Migration smoke, SQL query smoke, API smoke, frontend lint, and production build passed in the latest local QA round.
- `/api/so?page=1&limit=5` improved from about 3.2 seconds to about 1.9 seconds in local API smoke; continue tuning only if concurrent UAT needs sub-second list response.

### Meeting Minutes Migration Batch
- `031_so_requested_transport_flags.sql`
- `032_rebate_plan_ref_doc.sql`
- `033_giveaway_line_approval.sql`
- `034_customer_request_flow.sql`
- `035_line_login_app_user.sql`
- `036_align_winspeed_so_flow.sql`
- `037_so_credit_days_and_remarks.sql`
- `038_winspeed_so_data_entry_mapping.sql`
- `039_so_transp_id.sql`
- `040_deduplicate_winspeed_so.sql`
- `041_app_user_profile.sql`
- `042_so_trip_quotation.sql`
- `043_winspeed_estimate_link.sql` (legacy/superseded for active WINSpeed Sale Quotation)
- `044_winspeed_native_quotation_link.sql`
- `045_access_as_audit.sql`

## [v4.2.0] - 2026-06-26

### Added
- **FIFO Rebate System**: Implemented a new rebate withdrawal system utilizing a First-In-First-Out (FIFO) strategy.
- **Rebate Ledger Integration**: Created the `/api/so/rebate-balance/:custId` endpoint to dynamically fetch the available rebate balance.
- **Order Processing Logic**: Updated the `/api/so/:id/confirm` endpoint and the `wf.sp_ConfirmSalesOrder` stored procedure to process the RebateDiscountAmt and accurately subtract it from the final bill's NetAmnt.
- **UI Interaction**: Added an 'Apply Rebate' input field in `CreateSODialog` that automatically validates against the available balance and the total bill amount, recalculating the totals in real-time.

### Changed
- **Backend Setup**: Added `nodemon` for auto-restarting the Node.js backend server during development.

## [v4.1.0] - 2026-06-25

### Changed
- **Paper Trail Performance**: Optimized the `/api/papertrail/board` query in `backend/routes/papertrail.js` to fix severe timeouts and memory issues. The query now limits the maximum number of items returned for each status column to 100 using `ROW_NUMBER() OVER(PARTITION BY ...)`. This mitigates UI freezing caused by rendering massive amounts of legacy `CONFIRMED` orders.
- **Paper Trail Kanban UI**: Expanded the Kanban columns to stretch and fill the available screen width (Full Frame) using `flex-1 min-w-[280px]` instead of a fixed width of `288px`.
- **Cancelled Orders View**: Refactored the Cancelled Orders feature from a popup modal (`CancelledOrdersModal`) into a full-page view (`CancelledOrdersView`). This provides a better user experience for browsing large amounts of data. Users can navigate back to the main board using the new back button.
- **Sales Portal Layout**: Adjusted the split-pane layout in `SalesPortal.tsx` to stop the left panel from resizing unexpectedly when an order is selected. The left panel is now fixed at `480px` (`540px` on XL screens) on desktop. The right detail pane now always displays a placeholder state when no order is selected instead of being invisible and occupying 50% of the screen.

### Fixed
- Fixed an `X is not defined` ReferenceError in `PaperTrailPage.tsx` caused by a missing import from `lucide-react`.
- Fixed a syntax parsing error `Unterminated regular expression` in `PaperTrailPage.tsx` caused by a mismatched closing `</div>` tag.



































