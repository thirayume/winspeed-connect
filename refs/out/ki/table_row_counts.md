---
name: table-row-counts
description: Verified row counts for all key WINSpeed tables as of DB study
metadata: 
  node_type: memory
  type: project
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

| Table | Rows | Notes |
|---|---|---|
| SOHD | 107,018 | DocuType 103=54,095 / 104=52,923 |
| SODT | 190,931 | |
| SOInvHD | 282,087 | DocuType 107=146,276 / 202=113,043 / other |
| SOInvDT | 471,641 | GoodID=NULL on 224,571 rows (misc/service lines) |
| SOPickingHD/DT | **0** | Unused |
| ARBillHD | 885 | |
| ARBillDT | 2,180 | |
| ICStock | **0** | Unused — no stock movement in WINSpeed |
| ICPriceHD/DT | **0** | Unused |
| GLHD | 384,400 | DocuType=501 on all rows |
| GLDT | 813,085 | |
| EMGood | 417 | Fertilizer formulas + other goods |
| EMCust | 790 | |
| EMBrch | 1 | Single branch BrchID=1 |
| EMInve/EMLoca | 1/1 | Single warehouse |
| EMCreditTerm | **0** | Empty |
| EMGoodUnit | 16 | |
| EMSetPriceHD | 129 | Price lists 2022–2025 |
| EMSetPriceDT | 4,054 | Actual NET prices |
| SOHD AppvFlag=W (pending) | 28,416 | DocuType=103, waiting to weigh |
| SOHD AppvFlag=Y (approved) | 25,679 | DocuType=103, already approved |
| SOHDRemark | 129,951 | Remark ListNo=1 = truck registration backup |
| SOHD TransRegistration filled | 23,947 | Truck registration field |
