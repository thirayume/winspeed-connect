---
name: db-structure
description: "High-level DB structure facts — table count, FK situation, collation, key relationships"
metadata: 
  node_type: memory
  type: project
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

- **669 tables**, 8,987 columns, 642 PKs
- **Only 4 real FK constraints** — all other relationships follow naming convention (`*ID` field → PK of master table)
- DB Collation: `SQL_Latin1_General_CP1_CI_AS`; `EMGoodUnit`/`EMGood` use `Thai_CI_AS` (varchar)
- New `wf` schema fields in Thai → use **NVARCHAR** (not varchar)

**Key relationship facts (verified):**
- `SOInvHD.ARID` = `CustID` on every row → ARID references `EMCust` (AR account = customer)
- `CreditID` → `EMCreditTerm` (table is empty, 0 rows)
- Chart of accounts = `EMAcc` (AccID); Journal = `EMAccJour` (JourID)

**Active modules:** SO(18 tables), AR(17), IC(38), EM-master(150), WH(11), GL(16)

**Data range:** 2555 (2012) — 2025 (current)

**Single-branch, single-warehouse:**
- `EMBrch`: 1 row (BrchID=1)
- `EMInve`/`EMLoca`: 1 row each
