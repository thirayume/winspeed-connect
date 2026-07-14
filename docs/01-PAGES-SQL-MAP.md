# 01 โ€” เนเธเธเธ—เธตเนเธซเธเนเธฒ โ’ API โ’ SQL โ’ Migration (Pages / SQL / Migration Map)

> เนเธเนเธชเธณเธซเธฃเธฑเธ **เธ—เธ”เธชเธญเธเธฃเธฒเธขเธซเธเนเธฒ** ยท เธฃเธฐเธเธธเธเธฑเธ”เน€เธเธเธงเนเธฒเนเธ•เนเธฅเธฐเธซเธเนเธฒเนเธเน endpoint เนเธ”, เธญเนเธฒเธ/เน€เธเธตเธขเธ SQL เธญเธฐเนเธฃ, object เธญเธขเธนเนเนเธ migration เนเธซเธ, เนเธฅเธฐเธชเนเธงเธเนเธ” **เนเธกเนเธญเธขเธนเนเนเธ migration** (= dbo เธเธญเธ WINSpeed / MySQL TruckScale / เนเธเนเธ”)
> build v5.0.0 ยท 22 เธซเธเนเธฒ/เนเธกเธ”เธนเธฅ

## เธเธณเธญเธเธดเธเธฒเธขเธชเธฑเธเธฅเธฑเธเธฉเธ“เน
- ๐ข **wf** = เธ•เธฒเธฃเธฒเธ/เธงเธดเธงเธเธญเธเน€เธฃเธฒ (เธญเธขเธนเนเนเธ migration `backend/migrations/`)
- ๐”ต **dbo** = WINSpeed (READ โ€” เนเธกเนเธญเธขเธนเนเนเธ migration เธเธญเธเน€เธฃเธฒ; เน€เธเนเธ schema เธเธญเธ WINSpeed)
- ๐  **dbo-WRITE** = เน€เธฃเธฒเน€เธเธตเธขเธ dbo เธ•เธฃเธ (เธเนเธญเธขเธเน€เธงเนเธเธ—เธตเนเธฃเธฑเธเนเธงเน)
- ๐ฃ **MySQL** = TruckScale (เนเธขเธ DB โ€” เนเธกเนเธญเธขเธนเนเนเธ migration)
- โ๏ธ **code** = logic เนเธ route (เนเธกเนเนเธเน schema/migration)

| Migration เนเธเนเธเนเธญเธข | เธชเธฃเนเธฒเธ object |
|---|---|
| 001 | wf.AppUser, SalesOrder, SalesOrderLine, SalesOrderAudit, RebatePool/Ledger/Claim, GoodExtra, v_Customer/v_FertGood/v_CurrentPrice/v_ControlTicket |
| 002 | wf.GiveawayBudget/Item/Withdrawal, Quotation/Line, PaperTrail, v_GiveawayBudgetStatus |
| 003 | wf.SalesOrderExt/LineExt |
| 004/007/009 | v_AllSalesOrders, v_AllSalesOrderLines (+IsLoaded/WeighOut/LoadSequence/control-ticket cols) |
| 008 | SalesOrderLine.RefControlTicketNo/IsControlTicketDrawn |
| 010 | wf.RebateUsage |
| 015 | sp_ConfirmSalesOrder (๐  เน€เธเธตเธขเธ dbo.SOHD/SODT) |
| 016 | wf.PaperCopy, PaperScan |
| 017 | wf.RebatePlan, RebatePlanAllocation (+RebateLedger.PlanId/Region) |
| 018 | wf.SalesOrder.VerifiedBy/At, wf.UnlockRequest |
| 019 | wf.WeighTicket |
| 042 | wf.QuotationSourceSO (เธเธนเธเนเธเน€เธชเธเธญเธฃเธฒเธเธฒเน€เธเนเธฒเธเธฑเธ SO draft เธซเธฅเธฒเธขเนเธเนเธ Sale Trip) |
| 043 | Legacy wf.Quotation WinspeedEstimateID/WinspeedEstimateNo columns (superseded for WINSpeed Sale Quotation) |
| 044 | wf.Quotation WinspeedQuoteSOID/WinspeedQuoteNo + WinspeedConfirmSOID/WinspeedConfirmNo link to native WINSpeed `SOHD/SODT` DocuType 102/113 |
| 045 | wf.AccessAsAudit + wf.ApiAuditLog for Access As and API audit trail |

---

## 1. Dashboard (`dashboard`)
- **Component:** `dashboard/DashboardPage.tsx` ยท **Role:** เธ—เธธเธเธเธ
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /so/stats` | ๐”ต `dbo.SOHD` direct + ๐ข `wf.SalesOrderExt` fast-path status adjustment | 039/code |
| `GET /master/aging` | ๐”ต `dbo.SOHD/SODT` direct + ๐ข `wf.SalesOrderExt` for loaded/shipped state | 039/code |
| `GET /rebate/summary` | ๐ข `wf.RebatePool` + AppUser | 001 |

## 2. เธเธฒเธข / SO (POS) (`sales`)
- **Component:** `sales/SalesPortal.tsx` ยท **Role:** SALES, COUNTER_SALES, ADMIN
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /master/customers` | ๐”ต `dbo.EMCust` (v_Customer) | 001 (view)/dbo |
| `GET /master/goods` | ๐”ต `dbo.EMGood` (v_FertGood) | 001/dbo |
| `GET /master/prices` | ๐”ต `dbo.EMSetPriceHD/DT` | dbo |
| `GET /master/control-tickets` | ๐”ต `dbo.SOHD` 103 + ๐ข wf.SalesOrderLine ref | dbo+008 |
| `GET /master/truck-plates` | ๐ข v_AllSalesOrders | 004 |
| `GET /so/rebate-balance/:cust` | ๐ข `wf.RebateLedger` | 001 |
| `POST /so` | ๐ข `wf.SalesOrder/Line` (DRAFT) | 001 |

## 3. เน€เธชเธเธญเธฃเธฒเธเธฒ / Quotation (`quotation`)
- **Component:** `quotation/QuotationPage.tsx` ยท **Role:** เธ—เธธเธเธเธ
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET/POST /quotation` ยท `/:id` | ๐ข `wf.Quotation/QuotationLine` + ๐  native WINSpeed `dbo.SOHD/SODT` DocuType `102` (`QU...`) | 002 + 044 + dbo |
| `PATCH /quotation/:id/status` | ๐ข wf.Quotation; `ACCEPTED` creates/links native `QC...` as `dbo.SOHD/SODT` DocuType `113`; cancel marks linked QU/QC cancelled | 002 + 044 + dbo |
| `POST /quotation/from-so-trip` | ๐ข เธฃเธงเธก SO draft เธซเธฅเธฒเธขเนเธเน€เธเนเธ Quotation เนเธเน€เธ”เธตเธขเธง, เธเธนเธเธเนเธฒเธ `wf.QuotationSourceSO`, เนเธฅเธฐเน€เธเธตเธขเธ native `QU...` | 042 + 044 + dbo |
| `PATCH /quotation/:id/valid-until` | ๐ข เธ•เนเธญเธญเธฒเธขเธธเธขเธทเธเธฃเธฒเธเธฒ +7/+15/+20/+30/+45 เธงเธฑเธ เนเธฅเธฐเธญเธฑเธเน€เธ”เธ• `SOHD.ExpireDate/ValidDays` เธเธญเธ QU/QC | 002 + 044 + dbo |
| `POST /quotation/:id/convert` | ๐ข โ’ wf.SalesOrder (DRAFT); blocked until native QU is approved and QC exists | 002/001/044 |

## 4. เธเธฅเธฑเธ / Store (`store`)
- **Component:** `store/StorePortal.tsx`, `PickingQueue.tsx`, `VisualTruckLoader.tsx` ยท **Role:** WAREHOUSE, WEIGHBRIDGE, ADMIN
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `PATCH /so/:id/picking` | ๐  `UPDATE dbo.SOHD PkgStatus` + ๐ข wf.Ext | 015-flow/dbo |
| `PATCH /so/:id/load` | ๐ข wf.SalesOrderLineExt.LoadSequence | 007 |
| `PATCH /so/:id/ship` | ๐  `UPDATE dbo.SOHD clearflag` + ๐ข `wf.WeighTicket` | dbo+019 |
| `POST /so/:id/unlock-request` | ๐ข `wf.UnlockRequest` | 018 |
| `GET /truckscale/for-so/:id` | ๐ฃ MySQL `tblscale` + ๐ข v_AllSalesOrders | MySQL/004 |

## 5. Paper Trail (`papertrail`)
- **Component:** `papertrail/PaperTrailPage.tsx`, `PaperDocModal.tsx`, `ScanModal.tsx` ยท **Role:** เธ—เธธเธเธเธ (เธญเธเธธเธกเธฑเธ•เธด unlock = APPROVER/ADMIN/MANAGER)
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /papertrail/board` | ๐ข v_AllSalesOrders + PaperCopy count | 004/016 |
| `GET /papertrail/document/:so` | ๐ข v_AllSalesOrders + Lines | 004 |
| `POST /papertrail/:so/print` | ๐ข `wf.PaperCopy` (4 เธชเธต + QR) | 016 |
| `POST /papertrail/scan` | ๐ข `wf.PaperCopy` + `wf.PaperScan` | 016 |
| `GET /papertrail/lost` | ๐ข wf.PaperCopy (>3 เธงเธฑเธ/LOST) | 016 |
| `GET /so/unlock-requests` ยท `/resolve` | ๐ข `wf.UnlockRequest` + reverse RebateLedger | 018/001 |

## 6. เธฃเธตเน€เธเธ— (App) (`rebate`)
- **Component:** `rebate/RebatePage.tsx` ยท **Role:** เธ—เธธเธเธเธ (เน€เธเธฅเธก = SALES/ACCOUNTING/ADMIN)
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /rebate/pools` ยท `/ledger` | ๐ข wf.RebatePool / RebateLedger | 001 |
| `GET/POST /rebate/claims` | ๐ข wf.RebateClaim (FIFO เธ•เธฑเธ” ledger) | 001 |
| `PATCH /rebate/claims/:id/approve` | ๐ข wf.RebateClaim (`CnDocuNo` retained as legacy column; stores WINSpeed reference document number) | 001 |
| *accrual เธ•เธญเธ confirm* | โ๏ธ `bookRebateAccrual` โ’ wf.RebateLedger (+match RebatePlan) | code/001/017 |

## 7. Rebate Plan (`rebate-plan`)
- **Component:** `rebate/RebatePlanPage.tsx` ยท **Role:** ADMIN, MANAGER, APPROVER, ACCOUNTING
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET/POST/PATCH /rebate/plans` | ๐ข `wf.RebatePlan` | 017 |
| `POST /rebate/plans/:id/allocate` | ๐ข wf.RebatePool.AllocatedAmt + RebatePlanAllocation | 017 |

## 8. WF Rebate Trail (`cn-rebate` legacy key)
- **Component:** `rebate/CnRebatePage.tsx` (legacy file name; user-facing page is WF Rebate Trail) ยท **Role:** ACCOUNTING, ADMIN, MANAGER
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /rebate/wf-trail-summary` ยท `/wf-trail-list` ยท `/wf-trail-detail/:soId` | ๐”ต `dbo.SOHD` 103/104 โ’ `dbo.WFCoupon` โ’ `dbo.WFRedemtionHD/DT` โ’ `dbo.SOInvHD/DT` 107/202 โ’ `dbo.ARReceHD/DT` โ’ `dbo.GLHD/DT`/`VTVAT` | **dbo (เนเธกเนเธญเธขเธนเนเนเธ migration)** |

## 9. Voucher (`voucher`)
- **Component:** `voucher/VoucherPage.tsx` ยท **Role:** เธ—เธธเธเธเธ
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /rebate/voucher-summary` ยท `/coupons` ยท `/coupons/:cust` | ๐”ต `dbo.WFCoupon` + SOHD + EMEmp | **dbo (เนเธกเนเธญเธขเธนเนเนเธ migration)** |

## 10. เธเธฑเธเธเธต / Accounting (`accounting`)
- **Component:** `accounting/AccountingPage.tsx` ยท **Role:** ACCOUNTING, ADMIN, MANAGER
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /so/shipped-today` | ๐”ต `dbo.SOHD/SODT` (DocuType 103, เธงเธฑเธเธ—เธตเน) | dbo |
| `GET /rebate/claims?PENDING` ยท approve | ๐ข wf.RebateClaim | 001 |

## 10.1 Post Invoice / Reconciliation (`recon`)
- **Component:** `recon/ReconciliationPage.tsx` ยท **Role:** ACCOUNTING, ADMIN, MANAGER
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /recon/summary` ยท `/cases` | ๐”ต Shipped SO เธเธฒเธ `wf.v_AllSalesOrders` + `dbo.SOInvHD/DT` 107/202 + ๐ฃ TruckScale | dbo/MySQL/wf |
| `POST /recon/:soId/resolve` | ๐ข `wf.ReconResolution` | 030 |
| SO edit/unlock/cancel guard | ๐”ต เธญเนเธฒเธ `dbo.SOInvHD/DT`; เธ–เนเธฒเธเธ invoice เนเธฅเนเธง block เธเธฒเธฃเนเธเน SO | code |

## 11. เธเธญเธเนเธ–เธก / Giveaway (`giveaway`)
- **Component:** `giveaway/GiveawayPage.tsx` ยท **Role:** เธ—เธธเธเธเธ
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /giveaway/regions` ยท `/budget-lines` ยท `/withdrawals` ยท `/items` | ๐ข wf.Giveaway* + v_GiveawayBudgetStatus | 002 |
| `POST /giveaway/withdrawals` ยท `/budgets` | ๐ข wf.GiveawayWithdrawal / Budget | 002 |

## 12. เธฃเธฒเธขเธเธฒเธ / Reports (`reports`)
- **Component:** `reports/ReportsPage.tsx` ยท **Role:** ADMIN, MANAGER, ACCOUNTING, APPROVER
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /reports/types` ยท `/:type` | โ๏ธ `reports.js` (so-status๐ข ยท rebate-pools๐ข ยท giveaway๐ข ยท paper-status๐ข ยท cn-rebate๐”ต = WF Rebate Trail) | code/เธซเธฅเธฒเธข |
| `GET /reports/:type/export` | โ๏ธ xlsx (เนเธเธฅเน Excel) | code |

## 13. SO เธเนเธฒเธเธเธฑเธ”เธชเนเธ / Aging (`aging`)
- **Component:** `aging/AgingPage.tsx` ยท **Role:** เธ—เธธเธเธเธ
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /master/aging` ยท `/aging/search` | ๐”ต dbo.SOHD/SODT direct (SO aging 30/45 เธงเธฑเธ; not AR aging/control-ticket list) | 039/code |

## 14. เธเธธเธ”เธ•เธฑเนเธงเธเธธเธก / Control Ticket (`control-ticket`)
- **Component:** `master/ControlTicketPage.tsx` ยท **Role:** เธ—เธธเธเธเธ
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /master/control-tickets` | ๐”ต dbo.SOHD 103 + ๐ข wf.SalesOrderLine.RefControlTicketNo (Totalโ’Drawn) | dbo+008 |
| `GET /master/control-tickets/:no` ยท `/draws` | ๐”ต dbo.SOHD/SODT 104 | dbo |

## 15. TruckScale (`truckscale`)
- **Component:** `truckscale/TruckScalePage.tsx` ยท **Role:** WAREHOUSE, WEIGHBRIDGE, COUNTER_SALES, ADMIN, MANAGER
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET /truckscale/ping` ยท `/weigh` ยท `/scale/:seq` ยท `/for-so/:id` | ๐ฃ MySQL `tblscale`, `tblproduct_detail` | **MySQL (เนเธกเนเธญเธขเธนเนเนเธ migration โ€” เนเธขเธ DB)** |

## 16. เธเธนเนเนเธเนเธเธฒเธ / Admin (`admin`)
- **Component:** `admin/AdminUsersPage.tsx` ยท **Role:** ADMIN
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET/POST/PATCH/DELETE /auth/users` | ๐ข `wf.AppUser` (+ EMEmp map) | 001 |

## 17. เธเนเธญเธกเธนเธฅเธซเธฅเธฑเธ / Master (`master`)
- **Component:** `master/MasterDataPortal.tsx`, `PricesManager.tsx`, `TrucksManager.tsx` ยท **Role:** ADMIN
| Endpoint | SQL/เนเธซเธฅเนเธ | Migration |
|---|---|---|
| `GET/PATCH /master/customers` | ๐”ต/๐  dbo.EMCust (PATCH เน€เธเธตเธขเธ dbo) | dbo |
| `GET/PATCH /master/goods` | ๐”ต/๐  dbo.EMGood | dbo |
| `GET/PATCH/POST /master/prices` ยท `/bulk-extend` | ๐  **เน€เธเธตเธขเธ `dbo.EMSetPriceHD/DT` เธ•เธฃเธ** (Price Book) | **dbo-WRITE (เนเธกเนเธญเธขเธนเนเนเธ migration)** |
| `GET /master/trucks-stats` ยท `/trucks/:plate/history` | ๐ข v_AllSalesOrders | 004 |

---

## เธชเธฃเธธเธเธชเธดเนเธเธ—เธตเน "เนเธกเนเธญเธขเธนเนเนเธ migration"
1. **เธญเนเธฒเธ dbo (WINSpeed):** WF Rebate Trail, Voucher, Accounting (shipped-today), Aging, Control Ticket, master customers/goods/prices โ€” เน€เธเนเธ schema เธเธญเธ WINSpeed
2. **เน€เธเธตเธขเธ dbo เธ•เธฃเธ (๐ ):** `sp_ConfirmSalesOrder` (mig 015 เนเธ•เน INSERT dbo), picking/ship/cancel (UPDATE dbo.SOHD), master data เธ—เธตเนเนเธ”เนเธฃเธฑเธเธญเธเธธเธกเธฑเธ•เธด (`dbo.EMCust`, `dbo.EMGood`, `dbo.EMSetPriceHD/DT`) โ€” **เธเนเธญเธขเธเน€เธงเนเธเธ—เธตเนเธฃเธฑเธเนเธงเนเน€เธเธทเนเธญเนเธซเนเน€เธเธฅเธตเนเธขเธเธเนเธฒเธเธฃเธฐเธเธเธชเธฐเธ”เธงเธ (Invoice/AR/GL เธขเธฑเธเนเธซเน WINSpeed post)**
3. **เธซเธฅเธฑเธ WINSpeed เธกเธต Invoice เนเธฅเนเธง:** app เธ•เนเธญเธเธ–เธทเธญเธงเนเธฒ SO เธ–เธนเธ lock; เธซเนเธฒเธกเนเธเน SOHD/SODT เธเนเธฒเธ app เธขเธเน€เธงเนเธเน€เธเนเธ process correction เธ—เธตเนเธญเธเธธเธกเธฑเธ•เธดเนเธขเธเธ•เนเธฒเธเธซเธฒเธ
3. **MySQL TruckScale:** เธ—เธธเธ endpoint `/truckscale/*` โ€” เนเธขเธ DB เนเธกเนเธกเธต migration เนเธ repo เธเธตเน
4. **Logic เนเธ code (เนเธกเนเนเธเน schema):** reports.js (เธชเธฃเนเธฒเธเธฃเธฒเธขเธเธฒเธ+xlsx), bookRebateAccrual, winspeed-import.service

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

Automated QA note: root scripts `smoke:queries` and `smoke:api:local` validate the current SQL/API map against the restored local database. See [09-AUTOMATED-QA-v5.0.0.md](09-AUTOMATED-QA-v5.0.0.md).

