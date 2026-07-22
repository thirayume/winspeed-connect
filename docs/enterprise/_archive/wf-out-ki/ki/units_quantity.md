---
name: units-quantity
description: "Verified unit IDs, quantity fields, and bag conversion facts for fertilizer"
metadata: 
  node_type: memory
  type: project
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

## Unit IDs (EMGoodUnit)
- `GoodUnitID = 1002` = **ตัน** (hex CP874: 0xB5D1B9)
- `GoodUnitID = 1001` = **ใบ** (hex: 0xE3BA)

## Fertilizer Unit Setup
- All fertilizer goods: `EMGood.MainGoodUnitID = 1002` (ตัน), `SaleGoodUnitID = NULL`, `MultiUnitFlag = 3`
- **No ton↔bag conversion exists in DB** — RateQty=1.0 for all units

## Bag Conversion (must implement in app)
- 1 ตัน = 20 กระสอบ (50 kg/bag)
- Store in `wf.GoodExtra.BagPerTon`

## Transaction Quantity Fields
- `SOInvDT.GoodQty2` = quantity in **ตัน**
- `SOInvDT.GoodPrice2` = price in **บาท/ตัน**
