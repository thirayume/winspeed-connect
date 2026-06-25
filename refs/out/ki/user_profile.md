---
name: user-profile
description: "Who Thirayu is, his role, goals, and technical context for this project"
metadata: 
  node_type: memory
  type: user
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

Thirayu is a software development consultant hired to build a **sales and rebate management web application** for World Fert (ปุ๋ย/fertilizer trading company).

**Stack (decided):** React + NestJS connecting **directly to the existing WINSpeed SQL Server** — new `wf` schema created INSIDE the same database (`dbwins_worldfert9`) alongside `dbo`. **SQL Server ONLY — no PostgreSQL, no Redis, no message queue.** User explicitly wants it as simple as possible. Because `wf` and `dbo` share one DB, master data is read via direct cross-schema JOINs (no sync/cache layer).

**Current phase:** DB archaeology — studying Prosoft WINSpeed v9.0 schema (SQL Server 2022) to understand data structures before building the new system.

**Domain knowledge:** Comfortable with SQL and database design. Familiar with Thai accounting/ERP conventions.
