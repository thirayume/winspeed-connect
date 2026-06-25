---
name: empty-tables
description: Tables confirmed empty (0 rows) or unused in WINSpeed — skip these in analysis
metadata: 
  node_type: memory
  type: project
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

Tables verified to have 0 rows / not used by World Fert:

- `SOPickingHD` / `SOPickingDT`
- `ICStock` (no stock movement tracked in WINSpeed)
- `ICPriceHD` / `ICPriceHD` (price not managed here — see [[pricing]])
- `ICOptionPrice`
- `EMCreditTerm`
- `WHPickingHD` / `WHPickingDT`
- `BTCar`
- `TMTruck`

**Why matters:** Don't waste time analyzing these tables. Don't JOIN to them expecting data.
