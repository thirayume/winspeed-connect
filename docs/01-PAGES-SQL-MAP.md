# 01 — แผนที่หน้า → API → SQL → Migration (Pages / SQL / Migration Map)

> ใช้สำหรับ **ทดสอบรายหน้า** · ระบุชัดเจนว่าแต่ละหน้าใช้ endpoint ใด, อ่าน/เขียน SQL อะไร, object อยู่ใน migration ไหน, และส่วนใด **ไม่อยู่ใน migration** (= dbo ของ WINSpeed / MySQL TruckScale / โค้ด)
> build v4.2.26 · 22 หน้า/โมดูล

## คำอธิบายสัญลักษณ์
- 🟢 **wf** = ตาราง/วิวของเรา (อยู่ใน migration `backend/migrations/`)
- 🔵 **dbo** = WINSpeed (READ — ไม่อยู่ใน migration ของเรา; เป็น schema ของ WINSpeed)
- 🟠 **dbo-WRITE** = เราเขียน dbo ตรง (ข้อยกเว้นที่รับไว้)
- 🟣 **MySQL** = TruckScale (แยก DB — ไม่อยู่ใน migration)
- ⚙️ **code** = logic ใน route (ไม่ใช่ schema/migration)

| Migration ใช้บ่อย | สร้าง object |
|---|---|
| 001 | wf.AppUser, SalesOrder, SalesOrderLine, SalesOrderAudit, RebatePool/Ledger/Claim, GoodExtra, v_Customer/v_FertGood/v_CurrentPrice/v_ControlTicket |
| 002 | wf.GiveawayBudget/Item/Withdrawal, Quotation/Line, PaperTrail, v_GiveawayBudgetStatus |
| 003 | wf.SalesOrderExt/LineExt |
| 004/007/009 | v_AllSalesOrders, v_AllSalesOrderLines (+IsLoaded/WeighOut/LoadSequence/control-ticket cols) |
| 008 | SalesOrderLine.RefControlTicketNo/IsControlTicketDrawn |
| 010 | wf.RebateUsage |
| 015 | sp_ConfirmSalesOrder (🟠 เขียน dbo.SOHD/SODT) |
| 016 | wf.PaperCopy, PaperScan |
| 017 | wf.RebatePlan, RebatePlanAllocation (+RebateLedger.PlanId/Region) |
| 018 | wf.SalesOrder.VerifiedBy/At, wf.UnlockRequest |
| 019 | wf.WeighTicket |
| 042 | wf.QuotationSourceSO (ผูกใบเสนอราคาเข้ากับ SO draft หลายใบใน Sale Trip) |
| 043 | Legacy wf.Quotation WinspeedEstimateID/WinspeedEstimateNo columns (superseded for WINSpeed Sale Quotation) |
| 044 | wf.Quotation WinspeedQuoteSOID/WinspeedQuoteNo + WinspeedConfirmSOID/WinspeedConfirmNo link to native WINSpeed `SOHD/SODT` DocuType 102/113 |
| 045 | wf.AccessAsAudit + wf.ApiAuditLog for Access As and API audit trail |

---

## 1. Dashboard (`dashboard`)
- **Component:** `dashboard/DashboardPage.tsx` · **Role:** ทุกคน
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /so/stats` | 🔵 `dbo.SOHD` direct + 🟢 `wf.SalesOrderExt` fast-path status adjustment | 039/code |
| `GET /master/aging` | 🔵 `dbo.SOHD/SODT` direct + 🟢 `wf.SalesOrderExt` for loaded/shipped state | 039/code |
| `GET /rebate/summary` | 🟢 `wf.RebatePool` + AppUser | 001 |

## 2. ขาย / SO (POS) (`sales`)
- **Component:** `sales/SalesPortal.tsx` · **Role:** SALES, COUNTER_SALES, ADMIN
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /master/customers` | 🔵 `dbo.EMCust` (v_Customer) | 001 (view)/dbo |
| `GET /master/goods` | 🔵 `dbo.EMGood` (v_FertGood) | 001/dbo |
| `GET /master/prices` | 🔵 `dbo.EMSetPriceHD/DT` | dbo |
| `GET /master/control-tickets` | 🔵 `dbo.SOHD` 103 + 🟢 wf.SalesOrderLine ref | dbo+008 |
| `GET /master/truck-plates` | 🟢 v_AllSalesOrders | 004 |
| `GET /so/rebate-balance/:cust` | 🟢 `wf.RebateLedger` | 001 |
| `POST /so` | 🟢 `wf.SalesOrder/Line` (DRAFT) | 001 |

## 3. เสนอราคา / Quotation (`quotation`)
- **Component:** `quotation/QuotationPage.tsx` · **Role:** ทุกคน
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET/POST /quotation` · `/:id` | 🟢 `wf.Quotation/QuotationLine` + 🟠 native WINSpeed `dbo.SOHD/SODT` DocuType `102` (`QU...`) | 002 + 044 + dbo |
| `PATCH /quotation/:id/status` | 🟢 wf.Quotation; `ACCEPTED` creates/links native `QC...` as `dbo.SOHD/SODT` DocuType `113`; cancel marks linked QU/QC cancelled | 002 + 044 + dbo |
| `POST /quotation/from-so-trip` | 🟢 รวม SO draft หลายใบเป็น Quotation ใบเดียว, ผูกผ่าน `wf.QuotationSourceSO`, และเขียน native `QU...` | 042 + 044 + dbo |
| `PATCH /quotation/:id/valid-until` | 🟢 ต่ออายุยืนราคา +7/+15/+20/+30/+45 วัน และอัปเดต `SOHD.ExpireDate/ValidDays` ของ QU/QC | 002 + 044 + dbo |
| `POST /quotation/:id/convert` | 🟢 → wf.SalesOrder (DRAFT); blocked until native QU is approved and QC exists | 002/001/044 |

## 4. คลัง / Store (`store`)
- **Component:** `store/StorePortal.tsx`, `PickingQueue.tsx`, `VisualTruckLoader.tsx` · **Role:** WAREHOUSE, WEIGHBRIDGE, ADMIN
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `PATCH /so/:id/picking` | 🟠 `UPDATE dbo.SOHD PkgStatus` + 🟢 wf.Ext | 015-flow/dbo |
| `PATCH /so/:id/load` | 🟢 wf.SalesOrderLineExt.LoadSequence | 007 |
| `PATCH /so/:id/ship` | 🟠 `UPDATE dbo.SOHD clearflag` + 🟢 `wf.WeighTicket` | dbo+019 |
| `POST /so/:id/unlock-request` | 🟢 `wf.UnlockRequest` | 018 |
| `GET /truckscale/for-so/:id` | 🟣 MySQL `tblscale` + 🟢 v_AllSalesOrders | MySQL/004 |

## 5. Paper Trail (`papertrail`)
- **Component:** `papertrail/PaperTrailPage.tsx`, `PaperDocModal.tsx`, `ScanModal.tsx` · **Role:** ทุกคน (อนุมัติ unlock = APPROVER/ADMIN/MANAGER)
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /papertrail/board` | 🟢 v_AllSalesOrders + PaperCopy count | 004/016 |
| `GET /papertrail/document/:so` | 🟢 v_AllSalesOrders + Lines | 004 |
| `POST /papertrail/:so/print` | 🟢 `wf.PaperCopy` (4 สี + QR) | 016 |
| `POST /papertrail/scan` | 🟢 `wf.PaperCopy` + `wf.PaperScan` | 016 |
| `GET /papertrail/lost` | 🟢 wf.PaperCopy (>3 วัน/LOST) | 016 |
| `GET /so/unlock-requests` · `/resolve` | 🟢 `wf.UnlockRequest` + reverse RebateLedger | 018/001 |

## 6. รีเบท (App) (`rebate`)
- **Component:** `rebate/RebatePage.tsx` · **Role:** ทุกคน (เคลม = SALES/ACCOUNTING/ADMIN)
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /rebate/pools` · `/ledger` | 🟢 wf.RebatePool / RebateLedger | 001 |
| `GET/POST /rebate/claims` | 🟢 wf.RebateClaim (FIFO ตัด ledger) | 001 |
| `PATCH /rebate/claims/:id/approve` | 🟢 wf.RebateClaim (`CnDocuNo` retained as legacy column; stores WINSpeed reference document number) | 001 |
| *accrual ตอน confirm* | ⚙️ `bookRebateAccrual` → wf.RebateLedger (+match RebatePlan) | code/001/017 |

## 7. Rebate Plan (`rebate-plan`)
- **Component:** `rebate/RebatePlanPage.tsx` · **Role:** ADMIN, MANAGER, APPROVER, ACCOUNTING
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET/POST/PATCH /rebate/plans` | 🟢 `wf.RebatePlan` | 017 |
| `POST /rebate/plans/:id/allocate` | 🟢 wf.RebatePool.AllocatedAmt + RebatePlanAllocation | 017 |

## 8. WF Rebate Trail (`cn-rebate` legacy key)
- **Component:** `rebate/CnRebatePage.tsx` (legacy file name; user-facing page is WF Rebate Trail) · **Role:** ACCOUNTING, ADMIN, MANAGER
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /rebate/wf-trail-summary` · `/wf-trail-list` · `/wf-trail-detail/:soId` | 🔵 `dbo.SOHD` 103/104 → `dbo.WFCoupon` → `dbo.WFRedemtionHD/DT` → `dbo.SOInvHD/DT` 107/202 → `dbo.ARReceHD/DT` → `dbo.GLHD/DT`/`VTVAT` | **dbo (ไม่อยู่ใน migration)** |

## 9. Voucher (`voucher`)
- **Component:** `voucher/VoucherPage.tsx` · **Role:** ทุกคน
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /rebate/voucher-summary` · `/coupons` · `/coupons/:cust` | 🔵 `dbo.WFCoupon` + SOHD + EMEmp | **dbo (ไม่อยู่ใน migration)** |

## 10. บัญชี / Accounting (`accounting`)
- **Component:** `accounting/AccountingPage.tsx` · **Role:** ACCOUNTING, ADMIN, MANAGER
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /so/shipped-today` | 🔵 `dbo.SOHD/SODT` (DocuType 103, วันที่) | dbo |
| `GET /rebate/claims?PENDING` · approve | 🟢 wf.RebateClaim | 001 |

## 10.1 Post Invoice / Reconciliation (`recon`)
- **Component:** `recon/ReconciliationPage.tsx` · **Role:** ACCOUNTING, ADMIN, MANAGER
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /recon/summary` · `/cases` | 🔵 Shipped SO จาก `wf.v_AllSalesOrders` + `dbo.SOInvHD/DT` 107/202 + 🟣 TruckScale | dbo/MySQL/wf |
| `POST /recon/:soId/resolve` | 🟢 `wf.ReconResolution` | 030 |
| SO edit/unlock/cancel guard | 🔵 อ่าน `dbo.SOInvHD/DT`; ถ้าพบ invoice แล้ว block การแก้ SO | code |

## 11. ของแถม / Giveaway (`giveaway`)
- **Component:** `giveaway/GiveawayPage.tsx` · **Role:** ทุกคน
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /giveaway/regions` · `/budget-lines` · `/withdrawals` · `/items` | 🟢 wf.Giveaway* + v_GiveawayBudgetStatus | 002 |
| `POST /giveaway/withdrawals` · `/budgets` | 🟢 wf.GiveawayWithdrawal / Budget | 002 |

## 12. รายงาน / Reports (`reports`)
- **Component:** `reports/ReportsPage.tsx` · **Role:** ADMIN, MANAGER, ACCOUNTING, APPROVER
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /reports/types` · `/:type` | ⚙️ `reports.js` (so-status🟢 · rebate-pools🟢 · giveaway🟢 · paper-status🟢 · cn-rebate🔵 = WF Rebate Trail) | code/หลาย |
| `GET /reports/:type/export` | ⚙️ xlsx (ไฟล์ Excel) | code |

## 13. SO ค้างจัดส่ง / Aging (`aging`)
- **Component:** `aging/AgingPage.tsx` · **Role:** ทุกคน
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /master/aging` · `/aging/search` | 🔵 dbo.SOHD/SODT direct (SO aging 30/45 วัน; not AR aging/control-ticket list) | 039/code |

## 14. ชุดตั๋วคุม / Control Ticket (`control-ticket`)
- **Component:** `master/ControlTicketPage.tsx` · **Role:** ทุกคน
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /master/control-tickets` | 🔵 dbo.SOHD 103 + 🟢 wf.SalesOrderLine.RefControlTicketNo (Total−Drawn) | dbo+008 |
| `GET /master/control-tickets/:no` · `/draws` | 🔵 dbo.SOHD/SODT 104 | dbo |

## 15. TruckScale (`truckscale`)
- **Component:** `truckscale/TruckScalePage.tsx` · **Role:** WAREHOUSE, WEIGHBRIDGE, COUNTER_SALES, ADMIN, MANAGER
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET /truckscale/ping` · `/weigh` · `/scale/:seq` · `/for-so/:id` | 🟣 MySQL `tblscale`, `tblproduct_detail` | **MySQL (ไม่อยู่ใน migration — แยก DB)** |

## 16. ผู้ใช้งาน / Admin (`admin`)
- **Component:** `admin/AdminUsersPage.tsx` · **Role:** ADMIN
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET/POST/PATCH/DELETE /auth/users` | 🟢 `wf.AppUser` (+ EMEmp map) | 001 |

## 17. ข้อมูลหลัก / Master (`master`)
- **Component:** `master/MasterDataPortal.tsx`, `PricesManager.tsx`, `TrucksManager.tsx` · **Role:** ADMIN
| Endpoint | SQL/แหล่ง | Migration |
|---|---|---|
| `GET/PATCH /master/customers` | 🔵/🟠 dbo.EMCust (PATCH เขียน dbo) | dbo |
| `GET/PATCH /master/goods` | 🔵/🟠 dbo.EMGood | dbo |
| `GET/PATCH/POST /master/prices` · `/bulk-extend` | 🟠 **เขียน `dbo.EMSetPriceHD/DT` ตรง** (Price Book) | **dbo-WRITE (ไม่อยู่ใน migration)** |
| `GET /master/trucks-stats` · `/trucks/:plate/history` | 🟢 v_AllSalesOrders | 004 |

---

## สรุปสิ่งที่ "ไม่อยู่ใน migration"
1. **อ่าน dbo (WINSpeed):** WF Rebate Trail, Voucher, Accounting (shipped-today), Aging, Control Ticket, master customers/goods/prices — เป็น schema ของ WINSpeed
2. **เขียน dbo ตรง (🟠):** `sp_ConfirmSalesOrder` (mig 015 แต่ INSERT dbo), picking/ship/cancel (UPDATE dbo.SOHD), master data ที่ได้รับอนุมัติ (`dbo.EMCust`, `dbo.EMGood`, `dbo.EMSetPriceHD/DT`) — **ข้อยกเว้นที่รับไว้เพื่อให้เปลี่ยนผ่านระบบสะดวก (Invoice/AR/GL ยังให้ WINSpeed post)**
3. **หลัง WINSpeed มี Invoice แล้ว:** app ต้องถือว่า SO ถูก lock; ห้ามแก้ SOHD/SODT ผ่าน app ยกเว้นเป็น process correction ที่อนุมัติแยกต่างหาก
3. **MySQL TruckScale:** ทุก endpoint `/truckscale/*` — แยก DB ไม่มี migration ใน repo นี้
4. **Logic ใน code (ไม่ใช่ schema):** reports.js (สร้างรายงาน+xlsx), bookRebateAccrual, winspeed-import.service

---

## Current Addendum - 2026-07-08

Additional implemented source mappings after Meeting Minutes 02072026:

| Area | Endpoint / UI | SQL / Source | Migration |
|---|---|---|---|
| SO requested/transport flags | `POST/PUT /so`, SO create/edit/detail | `wf.SalesOrder`, `wf.SalesOrderExt` | 031 |
| SO price color | `CreateSODialog` | frontend logic using current Set Price | code |
| Giveaway line approval | `PATCH /so/:id/giveaway-lines/:lineNum/approve`, confirm gate | `wf.SalesOrderLine`, `wf.SalesOrderLineExt` | 033 |
| Rebate Plan Ref Doc | `GET/POST/PATCH /rebate/plans` | `wf.RebatePlan.RefDoc` | 032 |
| Dashboard search | `GET /so?search=&dateFrom=&dateTo=` | `dbo.SOHD/SODT` direct + `wf.SalesOrder` draft rows | code |
| Customer filters | `GET /master/customer-filters`, `/master/customers` | salesperson from `dbo.EMCustMultiEmp`; area from `dbo.EMCust.SaleAreaID`/`dbo.EMSaleArea`; other filters from available `dbo.EMCust` columns | code/dbo |
| Customer request flow | `GET/POST/PATCH /master/customer-requests` | `wf.CustomerRequest` | 034 |
| LINE Login | `GET /auth/line/start`, `/auth/line/callback`, `POST /auth/line/link`, `/auth/line/status` | `wf.AppUser.LineUserId` self-link after username/password verification | 035 |
| Access As | `GET /auth/access-as/candidates`, `POST /auth/access-as`, `POST /auth/access-as/stop` | `wf.AppUser`, `wf.AccessAsAudit`, `wf.ApiAuditLog` | 045 |

Webhook note: LINE Messaging API webhook URL is `/api/line/webhook`; LINE Login uses Callback URL `/api/auth/line/callback`.

Automated QA note: root scripts `smoke:queries` and `smoke:api:local` validate the current SQL/API map against the restored local database. See [09-AUTOMATED-QA-v4.2.26.md](09-AUTOMATED-QA-v4.2.26.md).
