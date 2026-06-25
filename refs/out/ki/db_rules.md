---
name: db-rules
description: Iron rules for interacting with the WorldFert DB — must never be violated
metadata: 
  node_type: memory
  type: feedback
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

Non-negotiable rules for all DB work on this project:

1. **`dbo` schema = READ-ONLY.** Never run CREATE/ALTER/DROP/INSERT/UPDATE/DELETE on any `dbo` object.
2. **Write only in `wf` schema** (our own) or the documentation DB `WorldFert_ERD`.
3. **Use the correct login:** `wf_reader` for exploration; `wf_owner` for creating objects in `wf`.
4. **Confirm before any non-SELECT query** — always ask the user before running DML/DDL.

**Why:** WINSpeed `dbo` tables are live production data. Any accidental write could corrupt the ERP system.

**How to apply:** Before generating any SQL that isn't a plain SELECT, pause and ask for confirmation. Flag the login required.
