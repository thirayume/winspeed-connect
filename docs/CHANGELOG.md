# Changelog

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
























