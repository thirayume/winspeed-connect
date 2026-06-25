---
name: db-connection
description: "SQL Server connection details, credentials, and sqlcmd snippet for WorldFert DB"
metadata: 
  node_type: memory
  type: reference
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

- **Server:** `.\SQLEXPRESS`
- **Database:** `dbwins_worldfert9`
- **Engine:** SQL Server 2022 Developer Edition

**Read-only login (exploration):**
- User: `wf_reader` / Pass: `ChangeMe_Strong#2026`
- Role: `db_datareader` on entire DB

**Write login (wf schema only):**
- User: `wf_owner` (full access on schema `wf` only — not yet created as of study start)

**sqlcmd one-liner:**
```
sqlcmd -S .\SQLEXPRESS -U wf_reader -P ChangeMe_Strong#2026 -d dbwins_worldfert9 -C -W -s , -h -1
```
