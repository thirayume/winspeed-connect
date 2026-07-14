# เน€เธญเธเธชเธฒเธฃเธฃเธฐเธเธ WS-Sale-App (เธเธธเธ”เธเธเธดเธเธฑเธ•เธดเธเธฒเธฃ)

> World Fert Co., Ltd. ยท build v5.0.0 ยท เธเธฃเธฑเธเธเธฃเธธเธ 8 เธ.เธ. 2569
> เธเธธเธ”เน€เธญเธเธชเธฒเธฃเธเธตเนเธเธฑเธ”เธ—เธณเน€เธเธทเนเธญเธเธฒเธฃเธ—เธ”เธชเธญเธ, เนเธเนเธเธฒเธ, เนเธฅเธฐเธขเธทเนเธเธฃเธฑเธเธฃเธญเธ **ISO 9001**

## เธ”เธฑเธเธเธตเน€เธญเธเธชเธฒเธฃ (Document Index)
| # | เน€เธญเธเธชเธฒเธฃ | เน€เธเธทเนเธญเธซเธฒ | เธเธนเนเนเธเนเธซเธฅเธฑเธ |
|---|--------|---------|-----------|
| 00 | [DATABASE-OVERVIEW](00-DATABASE-OVERVIEW.md) | เธเธฒเธเธเนเธญเธกเธนเธฅ 3 เนเธซเธฅเนเธ ยท เธเธฒเธฃ mapping WINSpeedโ”Appโ”TruckScale ยท diagram ยท **Data Dictionary** | IT, BA |
| 01 | [PAGES-SQL-MAP](01-PAGES-SQL-MAP.md) | เธ—เธธเธเธซเธเนเธฒ โ’ API โ’ SQL โ’ migration (เธญเธฐเนเธฃเธญเธขเธนเน/เนเธกเนเธญเธขเธนเนเนเธ migration) | IT, QA |
| 02 | [TEST-CASES](02-TEST-CASES.md) | เธเธฃเธ“เธตเธ—เธ”เธชเธญเธเธฃเธฒเธขเนเธกเธ”เธนเธฅ (UAT/Regression) | QA, เธเธนเนเธ—เธ”เธชเธญเธ |
| 03 | [USER-GUIDE](03-USER-GUIDE.md) | เธเธนเนเธกเธทเธญเธเธนเนเนเธเน/manual เธฃเธฒเธขเธซเธเนเธฒ + troubleshooting | เธเธนเนเนเธเนเธ—เธธเธ Role |
| 04 | [SOP](04-SOP.md) | เธเธฑเนเธเธ•เธญเธเธเธเธดเธเธฑเธ•เธดเธเธฒเธเธกเธฒเธ•เธฃเธเธฒเธ (SOP-01..08) | เธ—เธธเธเธเนเธฒเธข, เธเธนเนเธ•เธฃเธงเธ ISO |
| 05 | [PRODUCTION-READINESS](05-PRODUCTION-READINESS.md) | เธเธฃเธฐเน€เธกเธดเธเธเธงเธฒเธกเธเธฃเนเธญเธก Production + Go-Live checklist (P0/P1/P2) | เธเธนเนเธเธฃเธดเธซเธฒเธฃ, IT |
| 06 | [FORMS](06-FORMS.md) | เนเธเธเธเธญเธฃเนเธก: Test Log, UAT Sign-off, Change Request, RTM, Training, Release, Doc Register | QA, QMR |
| 07 | [SOURCE-ALIGNMENT-v5.0.0](07-SOURCE-ALIGNMENT-v5.0.0.md) | Highlight เธเธฒเธฃเธเธฃเธฑเธเน€เธญเธเธชเธฒเธฃเนเธซเนเธ•เธฃเธ source code v5.0.0, React+Express, SQL Server primary + MySQL TruckScale bridge, เนเธฅเธฐ backlog เธเธฒเธเธเธฃเธฐเธเธธเธก 02/07/2026 | IT, BA, Dev |
| 08 | [WINSPEED-SO-FLOW](08-WINSPEED-SO-FLOW.md) | Flow Draft -> Confirm -> Picking -> Shipped -> Post Invoice, DocuType mapping, Quotation/Sale Trip integration | IT, BA, Dev, QA |
| 09 | [AUTOMATED-QA-v5.0.0](09-AUTOMATED-QA-v5.0.0.md) | Automated smoke test steps, latest results, and Manual Retest checklist | QA, IT, Key Users |

> **เธเธเธฑเธ Word (.docx):** เธ—เธธเธเน€เธญเธเธชเธฒเธฃเธเนเธฒเธเธ•เนเธเนเธเธฅเธเน€เธเนเธ Word เนเธงเนเธ—เธตเนเนเธเธฅเน€เธ”เธญเธฃเน [`word/`](word/) (เธชเธณเธซเธฃเธฑเธเธขเธทเนเธ ISO เน€เธเนเธเนเธเธฅเนเน€เธญเธเธชเธฒเธฃ) ยท เนเธ”เธญเธฐเนเธเธฃเธกเธญเธขเธนเนเนเธ `refs/WorldFert_Diagrams_v6.drawio` (13 เธซเธเนเธฒ เธฃเธงเธก DB Architecture + 3-Way Mapping)

## เน€เธญเธเธชเธฒเธฃเธญเธญเธเนเธเธ (เธญเนเธฒเธเธญเธดเธ)
- `refs/WorldFert_SRS_v6_0.docx` โ€” Software Requirements Specification v6.2 (เธฃเธงเธก ยง15-18: v6 Release Notes, TruckScale, Implementation Update)
- `refs/WorldFert_Presentation_v6.pptx` โ€” เธชเนเธฅเธ”เนเธเธณเน€เธชเธเธญ v6.2
- `refs/WorldFert_Diagrams_v6.drawio` โ€” เธเธฑเธเธฃเธฐเธเธ v6.2 (Swimlane, TO-BE, ER, DFD, UML, TruckScale, Implemented)

## Highlight เธเธฒเธฃเธเธฃเธฑเธเธเธฃเธธเธ v5.0.0
- เธเธฃเธฑเธเน€เธฅเธ version เนเธเน€เธญเธเธชเธฒเธฃเนเธซเนเธ•เธฃเธเธเธฑเธ source code เธเธฑเธเธเธธเธเธฑเธ
- เธขเธทเธเธขเธฑเธ stack เธเธฃเธดเธ: React 19 + Vite + Express
- เธขเธทเธเธขเธฑเธ database boundary: SQL Server เน€เธเนเธ primary; MySQL เนเธเนเน€เธเธเธฒเธฐ TruckScale bridge
- เน€เธเธดเนเธกเน€เธญเธเธชเธฒเธฃ [SOURCE-ALIGNMENT-v5.0.0](07-SOURCE-ALIGNMENT-v5.0.0.md) เน€เธเธทเนเธญเธฃเธงเธกเธฃเธฒเธขเธเธฒเธฃเธ—เธตเนเนเธเนเนเธเนเธฅเธฐ backlog เธเธฒเธ Meeting Minutes 02072026

## Current Implementation Addendum (8 Jul 2026)
- Low-risk backlog items are now implemented in code: goods dedupe, 5-level price colors, rebate visibility by role, dashboard/date search, customer filters, status timestamps, and Paper Trail copy rules.
- SO workflow fields are implemented with migrations `031-033`: requested date/time, own truck, no truck required, P-Sling, and giveaway line approval.
- Rebate Plan Ref Doc is implemented with migration `032` (`wf.RebatePlan.RefDoc`).
- Sale Admin new customer request flow is implemented with migration `034`; it stores requests in `wf.CustomerRequest` and does not auto-create `dbo.EMCust`.
- LINE Login is implemented with migration `035`; first-time users self-link by entering their existing WS-Sale-App username/password.
- Migrations `031-035` have been applied to the restored local `dbwins_worldfert9` database on 2026-07-08.

## Current QA Addendum (13 Jul 2026)
- Added repeatable automated smoke commands: `npm run smoke:queries`, `npm run smoke:api`, and `npm run smoke:api:local`.
- Local migrations through `045_access_as_audit.sql`, SQL query smoke, API smoke, lint, and production build have passed in the latest local QA round.
- Access As now has audit verification through `wf.AccessAsAudit` and `wf.ApiAuditLog`.
- Detailed test steps and manual retest checklist are maintained in [AUTOMATED-QA-v5.0.0](09-AUTOMATED-QA-v5.0.0.md).

## เน€เธญเธเธชเธฒเธฃเน€เธ—เธเธเธดเธเธญเธทเนเธ
- [CHANGELOG.md](CHANGELOG.md) ยท [DOCKER-DEPLOY.md](DOCKER-DEPLOY.md) ยท [SQL-PERFORMANCE.md](SQL-PERFORMANCE.md) ยท [AUTOMATED-QA-v5.0.0](09-AUTOMATED-QA-v5.0.0.md)

## เธชเธฃเธธเธเธฃเธฐเธเธเนเธ”เธขเธขเนเธญ
- **22 เธซเธเนเธฒ/เนเธกเธ”เธนเธฅ** ยท React 19 + Express + SQL Server primary (WINSpeed dbo + wf) + MySQL bridge (TruckScale)
- **7 เธเธ—เธเธฒเธ—** (RBAC): SALES, COUNTER_SALES, WAREHOUSE, WEIGHBRIDGE, APPROVER, ACCOUNTING, ADMIN
- **schema wf** baseline 18 เธ•เธฒเธฃเธฒเธ + 7 views (migration 001-019) plus current pending feature migrations 031-035
- เธซเธฅเธฑเธเธเธฒเธฃ: dbo = READ-ONLY (เธขเธเน€เธงเนเธ confirm/picking/ship/cancel/prices) ยท GL เธญเธญเธเนเธ”เธข WINSpeed ยท TruckScale = READ-ONLY

