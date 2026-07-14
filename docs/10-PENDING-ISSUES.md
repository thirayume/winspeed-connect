# 10. Pending Issues & Backlog

This document tracks unresolved business logic disconnects, pending architectural decisions, and backlog items that require further investigation by the business or operations team.

---

## 1. Legacy Rebate Integration vs Clean Slate System (Pending Investigation)

**Date Logged:** 2026-07-15
**Module:** Rebate App (Rebate Pool & Claims)

### The Current Implementation (How it works right now)
The new Web App's Rebate System (`wf.RebatePool`, `wf.RebateLedger`) is currently designed and implemented as a **Clean Slate** system. 
*   **Trigger:** Rebate money is only accrued (added to the pool) when a Sales Order is created **via the Web App**, has a defined `RebateDiscountAmt`, and its status is successfully moved to **`SHIPPED`** (after truck scale-out). This triggers the backend function `bookRebateAccrual`.
*   **Unit of Measure:** The new system tracks rebate wallets in **Currency/Baht** (`DECIMAL` fields for `AllocatedAmt`, `ClaimedAmt`).

### The Disconnect (The Problem)
Users expected legacy test documents (e.g., `I69-TEST`) and historical outstanding rebate balances to automatically appear in the new "Rebate App" dashboard. However, they do not appear because:
1.  **Direct WINSpeed Creation:** Documents created directly in WINSpeed bypass the Web App's state machine. They do not trigger the `bookRebateAccrual` function and lack the required Web App user linking (`SalesUserId`).
2.  **Unit Mismatch:** The legacy WINSpeed system (`dbo.WFCoupon`) tracks outstanding rebates in **"Tons"** (`RemaQty`), not in Baht. The new system expects a monetary value. There is currently no mathematical rule in the system to automatically convert "8,000 Tons" of legacy coupons into a "Baht" value for the new digital wallet.

### Current Workarounds / Existing UI
*   The legacy balances (Tons) are still fully visible in the **"CN Rebate"** (WF Trail Summary) read-only dashboard for tracking purposes.
*   The new **"Rebate App"** is currently empty because no *new* Web App orders have completed the full lifecycle to `SHIPPED` yet.

### Next Steps for Consideration (To be decided later)
The Management/Operations team needs to investigate and decide on one of the following approaches:
*   **Option A (Data Migration):** If legacy balances *must* be moved into the new App, the team must define a **Conversion Rate** (How many Baht is 1 Coupon Ton worth?) so a one-time migration script can be run to seed the wallets.
*   **Option B (Parallel Run / Phased Transition):** Keep the systems separate. Sales will clear their old coupon balances (Tons) through the traditional WINSpeed accounting process, while all *new* sales promos accumulate cash in the new Web App. 

*(This item is paused pending business investigation).*
