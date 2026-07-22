---
documentId: "WF-DATA-012"
title: "WINSpeed SO Flow - Working Notes"
version: "v1.0"
status: Released
owner: "Data Architect"
normative: true
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-DATA-012` · Version: v1.0 · Date: 21 กรกฎาคม 2569 (21 July 2026) · Status: Released
> Classification: Confidential — Client / Authorized Partner Use Only
> Source of truth: operational build v1.0 · verified against `dbwins_worldfert9`

---
# WINSpeed SO Flow - Working Notes

> Updated: 2026-07-19  
> Scope: WS-Sale-App, WINSpeed SO Data Entry, TruckScale realtime bridge, WebSocket events, and accounting handoff.

## 1. Operating Model

SQL Server `dbwins_worldfert9` is the system of record for WINSpeed and WS-Sale-App workflow data.

- WINSpeed schema: `dbo`
- App-owned schema: `wf`
- TruckScale MySQL: weighbridge bridge only

The app should replace day-to-day Sale SO Data Entry work, but WINSpeed remains the owner of official invoice/accounting posting, AR, GL, and WF custom accounting menus.

## 2. Ownership Boundary

| Area | Owner | Rule |
|---|---|---|
| Draft SO creation/editing | WS-Sale-App | Store in `wf.SalesOrder` / `wf.SalesOrderLine` only |
| Confirmed booking visible in WINSpeed | WS-Sale-App writes, WINSpeed displays | Write `dbo.SOHD/SODT` as `DocuType=103` |
| WINSpeed WF confirm/approve menus | WINSpeed | May create/transition related `DocuType=104` rows |
| Truck weigh-in/out | TruckScale + WS-Sale-App bridge | Match plate/SO and update operational state |
| Invoice, AR, VAT, GL | WINSpeed | Use Post Invoice (WF); app must not duplicate posting |

## 3. Status Flow

| Step | App Status | App Behavior | WINSpeed Data Expected |
|---|---|---|---|
| 1 | `DRAFT` | Sale creates/edits freely | No `dbo.SOHD` row yet |
| 2 | Verified draft | Counter-Sales verifies before confirm | Still app-only |
| 3 | Confirmed booking | App creates WINSpeed booking and locks normal Sale edit | `dbo.SOHD.DocuType=103`, matching `dbo.SODT` |
| 4 | Waiting approval / approved booking | Approver/Admin/Sale Admin can control changes based on policy | `SOHD.AppvFlag` / `DocuStatus` reflect WINSpeed WF state |
| 5 | Picking / weigh-in | TruckScale weigh-in or warehouse action increases lock severity | `SOHD.PkgStatus='Y'` when picking starts |
| 6 | Weigh-out / shipped | No normal edit allowed | app marks shipped from weigh-out, `SOHD.clearflag='Y'` where applicable |
| 7 | Ready for Post Invoice | App shows accounting readiness | WINSpeed user runs Post Invoice (WF) |
| 8 | Posted | App permanently locks SO | `SOInvHD/SOInvDT`, AR/GL/VAT exist in WINSpeed |

## 3.1 Quotation From Sale Trip

Sales can create draft SOs first when that is faster operationally. If a customer later needs a quotation, the app can convert every draft SO in the same Sale Trip into one `wf.Quotation`.

Rules:

- Only `DRAFT` SOs can be used for this conversion.
- All selected SOs must belong to the same customer.
- Giveaway lines are excluded from the quotation.
- Product lines from multiple bills are merged by product and price into one quotation document.
- Validity can be set or extended by +7, +15, +20, +30, or +45 days.
- While the quotation is active, the linked source SOs are locked in `QUOTATION` status, preventing them from being confirmed independently.
- Sale Trip cards must show the linked quotation number, remark/context, and a link back to the quotation document while the quotation is waiting for confirmation.
- After the quotation is `ACCEPTED`, the Sales team uses "Convert to SO" to confirm it into active delivery orders.
- During conversion, the app restores all logistics constraints (Credit, Truck, Loading sequence) from the source Draft SOs into the UI for final review.
- Upon successful conversion, the app creates brand new Draft SOs linked to the Quotation and **permanently deletes** the original source Draft SOs to ensure a clean transaction trail.
- If the quotation is `CANCELLED`, the app immediately releases linked SOs back to `DRAFT` status for normal edit flow.

Current implementation stores the app control record in `wf.Quotation` and writes the native WINSpeed Sale Quotation into `dbo.SOHD/SODT`:

- `DocuType=102` for quotation documents (`QU...`).
- `DocuType=113` for confirmed quotation documents (`QC...`) with `QC.RefNo = QU.DocuNo` and `QC.FromFlag = 102`.
- Not approved / not convertible: `AppvFlag='W'`, `DocuStatus='N'`.
- Approved / convertible: quotation `AppvFlag='Y'`, `DocuStatus='Y'`, plus a linked `QC...` document.

The app keeps `wf.Quotation.WinspeedQuoteSOID/WinspeedQuoteNo` and `WinspeedConfirmSOID/WinspeedConfirmNo` as the native links. Native quotation writes are limited to sales quotation/confirmation documents; accounting, invoice, AR, VAT, and GL posting remain WINSpeed-owned.

## 4. WINSpeed Document Types

Observed local WF test data:

| DocuType | Meaning in this project |
|---|---|
| `103` | SO Data Entry / Sale Booking row visible in WINSpeed |
| `104` | WINSpeed WF confirm/approve/delivery related row |
| `102` | WINSpeed Sale Quotation (`QU...`) |
| `113` | WINSpeed Confirm Quotation (`QC...`) |
| `107`, `202` | Invoice/accounting documents used by WINSpeed posting flow |
| `112` | Do not use for the active WF SO flow |

## 4.1 Dashboard Status Meaning

The app and WINSpeed now share the same SQL Server database, so "imported to WS" should not be understood as a file-import milestone for normal operations. WINSpeed-created documents are visible to the app immediately, and app-confirmed documents are visible to WINSpeed immediately after the app writes `dbo.SOHD/SODT`.

Current dashboard status interpretation:

| Dashboard/App Status | Meaning | Primary Signal |
|---|---|---|
| `DRAFT` | App-only draft; editable by Sale | `wf.SalesOrder.Status='DRAFT'` or WINSpeed 103 rows still not progressed |
| `CONFIRMED` | Booking/SO exists and is waiting for warehouse/truck flow | `dbo.SOHD.DocuType=103`, not cancelled, not picking, not shipped |
| `PICKING` | Warehouse/vehicle flow started | `dbo.SOHD.PkgStatus='Y'` or app warehouse action |
| `LOADED` | App loading sequence completed | `wf.SalesOrderExt.IsLoaded=1` |
| `SHIPPED` | TruckScale/weigh-out confirmed by the app bridge | `wf.SalesOrderExt.WeighOutWeight IS NOT NULL` |
| `IMPORTED` | WINSpeed-side downstream SO document exists/closed from booking flow | `dbo.SOHD.DocuType=104` |
| `CANCELLED` | Cancelled document | `dbo.SOHD.DocuStatus='C'` or app status |

For user-facing text, prefer:

- `CONFIRMED` = "รอจัดส่ง"
- `SHIPPED` = "ส่งออกจากตาชั่ง"
- `IMPORTED` = "ปิด SO ใน WINSpeed"

`SHIPPED` can be zero after a fresh restore if TruckScale/app bridge state in `wf.SalesOrderExt` is empty. Older WINSpeed data may still show as `IMPORTED`/DocuType 104 because it already passed WINSpeed's own downstream flow.

## 4.2 Aging vs Control Ticket vs AR

Dashboard "Aging" is **not AR aging** and is **not the control-ticket list**.

| Concept | Meaning | Source |
|---|---|---|
| SO aging / SO ค้างจัดส่ง | SO rows that have remained open too long; used for operations follow-up | `dbo.SOHD/SODT`, `wf.SalesOrderExt` |
| Control ticket / ตั๋วคุม | Booking/control-ticket style SO; detected **strictly** by `SOHD.TransRegistration = N'ตั๋วคุม'` (legacy AI/K prefix rules are removed) | `dbo.SOHD`, app control-ticket fields |
| AR aging / ลูกหนี้คงค้าง | Unpaid invoice/customer receivable exposure | WINSpeed AR/Invoice tables such as `ARRece*`, `SOInv*` |

Dashboard SO aging excludes control-ticket rows (`SOHD.TransRegistration = N'ตั๋วคุม'`) so the operational list does not mix reservations/control tickets with delivery follow-up. It currently shows the first product line for context and the open age in days. The quantity shown is tons (`QtyTon`), not outstanding baht. If C-Level needs financial exposure, add a separate AR Aging KPI/report rather than reusing SO Aging.

## 5. App Confirm Contract

When app confirms a draft SO, it must create WINSpeed-compatible `DocuType=103` rows.

Required header fields confirmed by local `I69-KORAT-1` testing:

| WINSpeed field | Purpose |
|---|---|
| `SOHD.DocuType='103'` | Make document appear as SO Data Entry booking |
| `SOHD.TranspID` | Displays "ขนส่งโดย"; selected in the app when supplied, otherwise derived from customer ship-to/default transport |
| `SOHD.TransRegistration` | Truck plate / control-ticket text |
| `SOHD.CheckAll='Y'` | Represents "ตรวจสอบทั้งใบ" |
| `SOHD.NetAmnt` | Total amount |
| `SOHD.SumGoodAmnt` | Goods total |
| `SOHD.BillAftrDiscAmnt` | After-discount total |
| `SOHD.VatType='3'`, `VatRate=0` | Fertilizer VAT behavior observed in WF flow |
| `SOHD.CreditDays`, `ShipDate`, `ValidDays` | Header fields shown in WINSpeed |

Required line fields:

| WINSpeed field | Purpose |
|---|---|
| `SODT.DocuType='103'` | Match header |
| `SODT.GoodID`, `GoodName` | Product identity and display |
| `SODT.GoodQty2`, `GoodPrice2`, `GoodAmnt` | Quantity, price, line amount |
| `SODT.CheckFlag='Y'` | Per-line checked state |
| `SODT.MasterQty`, `ChildQty` | จำนวนแม่ / จำนวนลูก; independent split fields |
| `SODT.RemaQty`, `POQty`, `RemaQtyPkg` | Remaining/order quantities for WF menus |
| `SODTRemark.Remark` | Line description display |

## 6. Master / Child Quantity Rule

`MasterQty` and `ChildQty` are not the same as `QtyBag`.

Example from WINSpeed test:

| QtyTon | MasterQty | ChildQty |
|---:|---:|---:|
| 5 | 3 | 2 |
| 6 | 3 | 3 |
| 7 | 4 | 3 |

The app UI now supports explicit split input per line. If a line is submitted without explicit split values, backend should default:

- `MasterQty = QtyTon`
- `ChildQty = 0`

When the UI supports split input, send `masterQty` and `childQty` per line.

## 7. Transport Rule

The visible "เธเธเธชเนเธเนเธ”เธข" field in WINSpeed comes from:

- `SOHD.TranspID`
- lookup: `dbo.EMTransp.TranspID`
- app input: `transpId` from the SO form transport selector

The truck plate/control-ticket value comes from:

- `SOHD.TransRegistration`

These are separate fields and must both be handled.

## 8. Lock / Approval Rule

Normal Sale edits:

- Allowed only while app status is `DRAFT`.
- After confirm, Sale must request edit/unlock.

Approval behavior:

- Some reasons can auto-approve.
- Other reasons require approver/admin/sale admin approval.
- Picking/weigh-in edits must be urgent because truck/loading is already in progress.
- After weigh-out/shipped, no ordinary edit should be allowed.
- After WINSpeed invoice exists, app must lock permanently.

## 9. TruckScale Realtime Rule

TruckScale is the signal source for physical vehicle progress.

| TruckScale event | App interpretation |
|---|---|
| Vehicle weigh-in | Truck arrived / picking lock should become stricter |
| Vehicle weigh-out | Shipped / no ordinary edit allowed |

The bridge should match primarily by:

- truck plate / `TransRegistration`
- SO/customer context
- date/time proximity
- movebill where available

> [!NOTE]
> **Real-Time Event Architecture**: The legacy 5-second polling has been replaced with a WebSocket-based event-driven mechanism (`socket.io`). Features like "Sequence Loading" (`loadInOrder`) and Paper Trail updates now push updates instantly to clients, drastically reducing API load and improving frontend responsiveness.

## 10. Rebate / Coupon Flow

The active WF rebate trail is WINSpeed-owned:

`SOHD` 103/104 -> `WFCoupon` -> `WFRedemtionHD/DT` -> `SOInvHD/DT` 107/202 -> `ARReceHD/DT` -> `VTVAT` / `GLHD` / `GLDT`

The old CN Rebate assumption should be treated as legacy/compatibility only.

## 11. Current Implementation Files

| Area | File |
|---|---|
| Main SO API flow | `backend/routes/so.js` |
| Latest SO mapping migration | `backend/migrations/039_so_transp_id.sql` |
| Reusable local SO lab tool | `backend/scripts/winspeed_so_lab.js` |
| Source alignment notes | `docs/07-SOURCE-ALIGNMENT.md` |
| Database overview | `docs/00-DATABASE-OVERVIEW.md` |
| Test cases | `docs/02-TEST-CASES.md` |

## 12. Local Lab Commands

Use these for repeated local testing:

```powershell
node backend\scripts\winspeed_so_lab.js inspect I69-KORAT-1
node backend\scripts\winspeed_so_lab.js compare I69-KORAT-1:103 I69-02418:103
node backend\scripts\winspeed_so_lab.js normalize I69-KORAT-1
node backend\scripts\winspeed_so_lab.js delete I69-KORAT-1
node backend\scripts\winspeed_so_lab.js create I69-KORAT-1
node backend\scripts\winspeed_so_lab.js list-transports
```

## 13. Open Design Items

These are still design/implementation tasks:

- Decide which edit reasons auto-approve and which require approver.
- Add urgent approval handling for picking/weigh-in state.
- Confirm whether all `103 -> 104` transitions must remain WINSpeed-only or whether app should trigger a controlled WF procedure later.
- Analyze WINSpeed PowerBuilder `.pbl` / exported `.srd` report layouts and convert selected SO/Paper Trail reports into app-owned PDF templates. Treat `.pbl` as a reference/template source, not a direct web runtime.

Recently implemented in the SO form/API:

- Explicit UI controls for `masterQty` / `childQty`.
- Explicit transport selector mapped to `TranspID`.
- Draft create/edit payloads carry `creditDays`, `truckRemark`, `billRemark`, `transpId`, `masterQty`, and `childQty`.

## 14. QA Status - 2026-07-13

Automated smoke tests now cover the basic health of this flow:

- migration state through `045_access_as_audit.sql`;
- dashboard/SO status query performance and status distribution;
- master goods and transport queries used by SO entry;
- native WINSpeed quotation links for `QU6907-00001`, `QU6907-00002`, and `QC69-00002`;
- Access As token/audit behavior;
- API reachability for SO stats/list and quotation list.

Manual retest is still required for the full visual/user workflow:

- create/edit SO draft with transport, credit days, descriptions, and master/child quantities;
- verify app-created SO in WINSpeed SO Data Entry;
- convert Sale Trip to Quotation and confirm/cancel quotation behavior;
- warehouse receive/load card view;
- TruckScale weigh-in/weigh-out realtime bridge;
- Post Invoice handoff in WINSpeed.

See `docs/09-AUTOMATED-QA.md` for repeatable commands and step-by-step manual retest checklist.

