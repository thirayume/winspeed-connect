---
name: pricing
description: "Verified price sources — what's used, what's empty, key fields"
metadata: 
  node_type: memory
  type: project
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

| Source | Status | Use |
|---|---|---|
| `ICPriceHD/DT` | **Empty (0 rows)** | Not used |
| **`EMSetPriceDT.GoodPriceNet`** | **4,054 rows (2022–2025)** | **Current NET prices** |
| `SOInvDT.GoodPrice2` | All transactions | Actual price on invoice |
| `EMGood.StandardSalePrce` | NULL on all rows | Not used |

## Key Fields
**EMSetPriceHD:** `CustID`, `GoodID`, `BeginDate`, `EndDate`  
**EMSetPriceDT:** `ListID` (=GoodID), `GoodPriceNet`, `startgoodqty`, `endgoodqty`

**How to apply:** When looking up the current NET price for a customer+product, query `EMSetPriceDT` joined to `EMSetPriceHD` filtering by date range and quantity tier.
