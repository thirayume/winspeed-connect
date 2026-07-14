# 00 โ€” เธ เธฒเธเธฃเธงเธกเธเธฒเธเธเนเธญเธกเธนเธฅ & เธเธฒเธฃ Mapping (Database Overview & Mapping)

> WS-Sale-App ยท World Fert Co., Ltd. ยท เน€เธญเธเธชเธฒเธฃเธเธงเธเธเธธเธกเธชเธณเธซเธฃเธฑเธ ISO 9001
> เธญเนเธฒเธเธญเธดเธ build v5.0.0 / SRS v6.2 ยท เธเธฃเธฑเธเธเธฃเธธเธ 8 เธ.เธ. 2569

## เธชเธฒเธฃเธเธฑเธ
1. [เธฃเธฐเธเธเธเธฒเธเธเนเธญเธกเธนเธฅ 3 เนเธซเธฅเนเธ](#1-เธฃเธฐเธเธเธเธฒเธเธเนเธญเธกเธนเธฅ-3-เนเธซเธฅเนเธ)
2. [เธชเธ–เธฒเธเธฑเธ•เธขเธเธฃเธฃเธกเธเธฒเธฃเน€เธเธทเนเธญเธกเธ•เนเธญ](#2-เธชเธ–เธฒเธเธฑเธ•เธขเธเธฃเธฃเธกเธเธฒเธฃเน€เธเธทเนเธญเธกเธ•เนเธญ)
3. [เธเธฒเธฃ Mapping: WINSpeed โ” App โ” TruckScale](#3-เธเธฒเธฃ-mapping-winspeed--app--truckscale)
4. [Data Dictionary โ€” schema wf](#4-data-dictionary--schema-wf-read-write)
5. [Data Dictionary โ€” dbo (WINSpeed, READ-ONLY)](#5-data-dictionary--dbo-winspeed-read-only)
6. [Data Dictionary โ€” TruckScale (MySQL, READ-ONLY)](#6-data-dictionary--truckscale-mysql-read-only)
7. [เธซเธฅเธฑเธเธเธฒเธฃเธชเธณเธเธฑเธ (Iron Rules)](#7-เธซเธฅเธฑเธเธเธฒเธฃเธชเธณเธเธฑเธ-iron-rules)

---

## 1. เธฃเธฐเธเธเธเธฒเธเธเนเธญเธกเธนเธฅ 3 เนเธซเธฅเนเธ

| # | เธฃเธฐเธเธ | Engine | เธ—เธตเนเธญเธขเธนเน | เธชเธดเธ—เธเธดเนเธเธฒเธ App | เนเธเนเธ—เธณเธญเธฐเนเธฃ |
|---|------|--------|---------|---------------|-----------|
| 1 | **WINSpeed (dbo)** | SQL Server 2022 | `dbwins_worldfert9` (20.255.185.14 remote / SQLEXPRESS local) | **READ** (+เน€เธเธตเธขเธ SOHD/SODT เธ•เธฃเธเธ•เธญเธ confirm/ship โ€” เธ”เธน ยง7) | ERP เธซเธฅเธฑเธ: master, เนเธเธชเธฑเนเธเธเธฒเธข, เนเธเธเธณเธเธฑเธ, GL, WF Rebate Trail, เธเธนเธเธญเธ |
| 2 | **App (wf schema)** | SQL Server 2022 (DB เน€เธ”เธตเธขเธงเธเธฑเธ dbo) | schema `wf` เนเธ `dbwins_worldfert9` | **READ-WRITE** | เธเนเธญเธกเธนเธฅเธ—เธตเน WINSpeed เนเธกเนเธกเธต: SO state, Rebate Plan/Pool/Ledger, Giveaway, Paper Trail, WeighTicket, Quotation, Unlock |
| 3 | **TruckScale** | MySQL 5.7 | `db_truckscale` (Railway cloud: `reseau.proxy.rlwy.net:42508`) | **READ** | เน€เธเธฃเธทเนเธญเธเธเธฑเนเธเธเนเธณเธซเธเธฑเธเธฃเธ–: เธเนเธณเธซเธเธฑเธเน€เธเนเธฒ/เธญเธญเธ/เธชเธธเธ—เธเธด (403,908 เนเธเธเธฑเนเธ) |

**เธเนเธญเธชเธฑเธเน€เธเธ•:**
- `wf` เธเธฑเธ `dbo` เธญเธขเธนเนเนเธ **SQL Server เธเธฒเธเน€เธ”เธตเธขเธงเธเธฑเธ** โ’ JOIN เธเนเธฒเธก schema เนเธ”เนเธ•เธฃเธ เนเธกเนเธ•เนเธญเธ sync/cache
- `TruckScale` เน€เธเนเธ **MySQL เนเธขเธเธฃเธฐเธเธ** โ’ เน€เธเธทเนเธญเธกเธเนเธฒเธ connection pool เธ—เธตเน 2 (`mysql2`) เนเธกเนเน€เธเธตเนเธขเธงเธเธฑเธ `DB_MODE`
- `DB_MODE` (.env) = `local` | `remote` เธเธธเธกเน€เธเธเธฒเธฐ SQL Server (WINSpeed+wf) ยท **เธซเนเธฒเธกเธ•เธฑเนเธ `DB_MODE=mysql`**

---

## 2. เธชเธ–เธฒเธเธฑเธ•เธขเธเธฃเธฃเธกเธเธฒเธฃเน€เธเธทเนเธญเธกเธ•เนเธญ

```mermaid
flowchart LR
  subgraph FE[Frontend - React 19 / Vite / Vercel]
    UI[22 เธซเธเนเธฒ/เนเธกเธ”เธนเธฅ]
  end
  subgraph API[Backend - Express / Railway]
    R1[routes: so, master, rebate, giveaway,\nquotation, papertrail, reports, truckscale, auth]
    P1[(SQL Server pool\nlocal/remote เธชเธฅเธฑเธเธ”เนเธงเธข X-DB-Target)]
    P2[(MySQL pool\nmysql2)]
  end
  subgraph SQL[SQL Server - dbwins_worldfert9]
    DBO[(dbo = WINSpeed\nREAD + เน€เธเธตเธขเธ SOHD/SODT)]
    WF[(wf = App\nREAD-WRITE)]
  end
  subgraph MY[MySQL - db_truckscale Railway]
    TS[(tblscale, tblproduct_detail, ...)]
  end
  UI -->|JWT + X-DB-Target| R1
  R1 --> P1 --> WF
  P1 --> DBO
  WF -. JOIN เธเนเธฒเธก schema .- DBO
  R1 --> P2 --> TS
```

**Pool เธเธฑเนเธ SQL Server:** `backend/db.js` โ€” dual pool (local = Windows Auth/msnodesqlv8, remote = SQL Auth/ODBC 17) เน€เธฅเธทเธญเธเธ•เนเธญ request เธเนเธฒเธ header `X-DB-Target` (AsyncLocalStorage) ยท helper: `query()` (reader), `wfQuery()` (owner โ€” เนเธเนเน€เธเธทเธญเธเธ—เธธเธ endpoint เน€เธเธทเนเธญเนเธซเนเธ•เธฒเธกเธเธธเนเธกเธชเธฅเธฑเธ DB)

**Pool เธเธฑเนเธ MySQL:** `backend/services/truckscale-db.js` โ€” `mysql2/promise` pool ยท helper `tsQuery()`

---

## 3. เธเธฒเธฃ Mapping: WINSpeed โ” App โ” TruckScale

```mermaid
flowchart TD
  Q[wf.Quotation] -->|sync native quotation| QU[dbo.SOHD/SODT 102 QU]
  Q -->|accept/approve| QC[dbo.SOHD/SODT 113 QC]
  QC -->|RefNo| QU
  Q -->|convert| SO
  SO[wf.SalesOrder DRAFT] -->|confirm: sp_ConfirmSalesOrder| SOHD103[dbo.SOHD/SODT 103]
  SO --> EXT[wf.SalesOrderExt / LineExt]
  SOHD103 -->|SOID เน€เธ”เธตเธขเธงเธเธฑเธ| EXT
  SOHD103 -->|WINSpeed Confirm/Approve Order WF| SOHD104[dbo.SOHD/SODT 104]
  SOHD104 -->|Post Invoice WF| INV[dbo.SOInvHD/DT 107/202]
  INV --> GL[dbo.GLHD/GLDT 501]
  SOHD104 -->|DocuID| CPN[dbo.WFCoupon]
  CPN -->|CouponID| RDT[dbo.WFRedemtionDT]
  RDT --> RHD[dbo.WFRedemtionHD]
  RDT -->|SOInvID| INV
  SOHD103 -->|เธ—เธฐเน€เธเธตเธขเธเธฃเธ– TransRegistration| TS[(tblscale MySQL)]
  EXT -->|ship: Movebill| WT[wf.WeighTicket]
  WT -->|Movebill| TS
  SOHD103 -->|DocuType 103 AppvDocuNo AI| CT[wf.v_ControlTicket = เธ•เธฑเนเธงเธเธธเธก]
```

### 3.1 App โ” WINSpeed (dbo)

| เธเธงเธฒเธกเธชเธฑเธกเธเธฑเธเธเน | App (wf) | WINSpeed (dbo) | Key |
|--------------|----------|----------------|-----|
| Master เธฅเธนเธเธเนเธฒ | `v_Customer` | `EMCust` | CustID |
| Master เธชเธดเธเธเนเธฒ | `v_FertGood` | `EMGood` | GoodID |
| Native เนเธเน€เธชเธเธญเธฃเธฒเธเธฒ | `wf.Quotation` | `SOHD/SODT` DocuType `102` (QU) เนเธฅเธฐ `113` (QC) | WinspeedQuoteSOID / WinspeedConfirmSOID |
| เธฃเธฒเธเธฒ NET | `v_CurrentPrice` | `EMSetPriceHD/DT` | GoodID + เน€เธ”เธทเธญเธ |
| เธเธเธฑเธเธเธฒเธเธเธฒเธข | `AppUser.EmpId` | `EMEmp.EmpID` | EmpID |
| เธฅเธนเธเธเนเธฒ โ” เธเธเธฑเธเธเธฒเธเธเธฒเธขเธ—เธตเนเธ”เธนเนเธฅ | customer RBAC / filters | `EMCustMultiEmp.CustID` โ” `EMCustMultiEmp.EmpID` | CustID+EmpID |
| SO เธ—เธตเน confirm เนเธฅเนเธง | `SalesOrderExt.SOID` | `SOHD.SOID` (DocuType 103; WINSpeed WF menu เธญเธฒเธเธชเธฃเนเธฒเธ/เนเธขเธ DocuType 104 เธ เธฒเธขเธซเธฅเธฑเธ) | **SOID** |
| เธเธฃเธฃเธ—เธฑเธ”เธชเธดเธเธเนเธฒ | `SalesOrderLineExt.(SOID,ListNo)` | `SODT.(SOID,ListNo)` | SOID+ListNo |
| เธ•เธฑเนเธงเธเธธเธก | `v_ControlTicket` / `SalesOrderLine.RefControlTicketNo` | `SOHD.AppvDocuNo` (AI..., DocuType 103) | AppvDocuNo |
| WF Rebate Trail (เธเธฃเธฐเธงเธฑเธ•เธด) | `CnRebatePage` / `WF Rebate Trail` (เธญเนเธฒเธเธ•เธฃเธ) | `SOHD` 103/104 โ’ `WFCoupon` โ’ `WFRedemtionHD/DT` โ’ `SOInvHD/DT` 107/202 | SOID/CouponID/RedemtionID/SOInvID |
| เธเธนเธเธญเธ (Voucher) | `VoucherPage` (เธญเนเธฒเธเธ•เธฃเธ) | `WFCoupon` โ’ `SOHD.SOID` โ’ `EMEmp` | DocuID=SOID |

### 3.2 App โ” TruckScale (MySQL)

| เธเธงเธฒเธกเธชเธฑเธกเธเธฑเธเธเน | App (wf) | TruckScale | Key |
|--------------|----------|-----------|-----|
| เนเธเธเธฑเนเธ โ” SO | `WeighTicket.Movebill` | `tblscale.movebill` | Movebill |
| เธเธฑเธเธเธนเนเธซเธฒเธเนเธณเธซเธเธฑเธ | `SalesOrder.TruckPlate` | `tblscale.one_car_regis` | **เธ—เธฐเน€เธเธตเธขเธเธฃเธ– (key เธซเธฅเธฑเธ)** |
| เธเนเธณเธซเธเธฑเธ | `WeighTicket.Gross/Tare/NetKg` | `tblscale.weight_out/in/net` | โ€” |
| เน€เธเธฃเธทเนเธญเธเธเธฑเนเธ | `WeighTicket.ScaleNo` | `tblscale.Computer_w` | โ€” |

### 3.3 WINSpeed โ” TruckScale (เธ•เธฃเธ)

| WINSpeed | TruckScale | เธชเธ–เธฒเธเธฐ |
|----------|-----------|-------|
| `SOHD.TransRegistration` | `tblscale.one_car_regis` | โ… เนเธเนเนเธ”เน (เธ—เธฐเน€เธเธตเธขเธเธฃเธ– โ€” key เธซเธฅเธฑเธ) |
| `SOHD.DocuNo` | `tblproduct_detail.pd_pro_invoid` | โ ๏ธ **เนเธกเนเธเนเธฒเน€เธเธทเนเธญเธ–เธทเธญ** (เธเนเธญเธกเธนเธฅเธชเธเธเธฃเธ: "เธเธฒเธข", "เนเธกเนเธฃเธฐเธเธธ") โ€” เนเธกเนเนเธเน |

---

## 4. Data Dictionary โ€” schema wf (READ-WRITE)

> 18 เธ•เธฒเธฃเธฒเธ + 7 views ยท เธชเธฃเนเธฒเธ/เนเธเนเธเนเธฒเธ migration (`backend/migrations/`) เน€เธ—เนเธฒเธเธฑเนเธ

### 4.1 เธเธฅเธธเนเธก Sales Order
| เธ•เธฒเธฃเธฒเธ | เธเธญเธฅเธฑเธกเธเนเธซเธฅเธฑเธ | migration |
|-------|-------------|-----------|
| `SalesOrder` | Id(PK), WfRef, SoPrefix, CustId, CustName, TruckPlate, ControlTicketNo, DeliveryDate, Status, SalesUserId, RebateDiscountAmt, **VerifiedBy, VerifiedAt**, CreatedAt | 001 (+018 verify) |
| `SalesOrderLine` | SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway, RebateBooked, **RefControlTicketNo, IsControlTicketDrawn** | 001 (+008) |
| `SalesOrderExt` | SOID(PK=dbo.SOHD.SOID), WfRef, SoPrefix, SalesUserId, ControlTicketNo, ImportedDocuNo, **IsLoaded, WeighOutWeight** | 003 (+007) |
| `SalesOrderLineExt` | SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, **LoadSequence, RefControlTicketNo, IsControlTicketDrawn** | 003 (+007,009) |
| `SalesOrderAudit` | Id, SoId, UserId, Action, FromStatus, ToStatus, Note, IpAddress, CreatedAt | 001 |
| `AccessAsAudit` | ActorUserId, EffectiveUserId, Action, IpAddress, UserAgent, CreatedAt; records Access As START/STOP | 045 |
| `ApiAuditLog` | ActorUserId, EffectiveUserId, Method, Path, StatusCode, DurationMs, IpAddress, UserAgent, CreatedAt; records mutating/error API calls | 045 |

### 4.2 เธเธฅเธธเนเธก Rebate (เธฟ)
| เธ•เธฒเธฃเธฒเธ | เธเธญเธฅเธฑเธกเธเนเธซเธฅเธฑเธ | migration |
|-------|-------------|-----------|
| `RebatePool` | Id, SalesUserId, PeriodYear, PeriodMonth, AccruedAmt, ClaimedAmt, AllocatedAmt | 001 |
| `RebateLedger` | Id, PoolId, SoId, SoLineId, CustId, GoodCode, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, RebateAmount, RemainingAmt, Status, ReversedFlag, **PlanId, Region** | 001 (+017) |
| `RebateClaim` | Id, PoolId, SalesUserId, CustId, ClaimAmt, RemainingAmt, Status, CnDocuNo, ApprovedAt, ApprovedBy | 001 |
| `RebateUsage` | Id, LedgerId, ... (เธฃเธตเน€เธเธ—เธ—เธตเนเธ–เธนเธเนเธเนเน€เธเนเธเธชเนเธงเธเธฅเธ” FIFO) | 010 |
| `RebatePlan` | PlanId, PlanNo, Title, GoodCodePattern, Region, ReturnType, NetPrice, ValidFrom, ValidTo, AllocatedAmount, Priority, Status | 017 |
| `RebatePlanAllocation` | Id, PlanId, PoolId, SalesUserId, Amount, CreatedBy | 017 |

### 4.3 เธเธฅเธธเนเธก Giveaway
| เธ•เธฒเธฃเธฒเธ | เธเธญเธฅเธฑเธกเธเนเธซเธฅเธฑเธ | migration |
|-------|-------------|-----------|
| `GiveawayBudget` | Id, SalesUserId, EmpId, Region, PeriodYear, Brand, ItemName, BudgetQty | 002 |
| `GiveawayItem` | Id, Brand, ItemName, ItemType | 002 |
| `GiveawayWithdrawal` | Id, SalesUserId, Region, PeriodYear, IssueMonth, Brand, ItemName, Qty, CustId, SoId, Source | 002 |
| `GiveawayIssue` | (legacy โ€” issue เธเธนเธ SO; เธเธฑเธเธเธธเธเธฑเธเนเธเน Withdrawal) | 001 |

### 4.4 เธเธฅเธธเนเธก Paper Trail
| เธ•เธฒเธฃเธฒเธ | เธเธญเธฅเธฑเธกเธเนเธซเธฅเธฑเธ | migration |
|-------|-------------|-----------|
| `PaperCopy` | Id, SoId, WfRef, DocType, CopyColor, CopyLabel, QrNonce(unique), Status(PRINTEDโ’IN_TRANSITโ’SIGNEDโ’FILEDโ’LOST), HolderUserId | 016 |
| `PaperScan` | Id, PaperCopyId, Action, FromStatus, ToStatus, ScannerUserId, Location, ScannedAt | 016 |
| `PaperTrail` | (legacy v1 โ€” board เธญเนเธฒเธ v_AllSalesOrders เนเธ—เธ) | 002 |

### 4.5 เธเธฅเธธเนเธกเธญเธทเนเธ
| เธ•เธฒเธฃเธฒเธ | เธเธญเธฅเธฑเธกเธเนเธซเธฅเธฑเธ | migration |
|-------|-------------|-----------|
| `WeighTicket` | Id, SoId, WfRef, TruckPlate, GrossKg, TareKg, NetKg, ScaleNo, WeighInAt, WeighOutAt, Status, **Movebill** | 019 |
| `UnlockRequest` | Id, SoId, WfRef, Reason, Status(PENDING/APPROVED/REJECTED), RequesterId, ApproverId, RespondedAt | 018 |
| `Quotation` | Id, QuoteNo, CustId, CustName, ValidUntil, Status, ConvertedSoId, WinspeedQuoteSOID, WinspeedQuoteNo, WinspeedConfirmSOID, WinspeedConfirmNo | 002 + 044 |
| `QuotationLine` | QuotationId, LineNum, GoodId, QtyTon, PricePerTon, NetPricePerTon | 002 |
| `QuotationSourceSO` | QuoteId, SoId, SourceWfRef; เธเธนเธ Quotation เธเธฅเธฑเธเนเธเธขเธฑเธ SO draft เนเธ Sale Trip | 042 |
| `dbo.SOHD/SODT` DocuType `102/113` | Native WINSpeed Quotation (`QU...`) เนเธฅเธฐ Confirm Quotation (`QC...`); written by `/api/quotation` after structure validation | dbo + 044 link |
| `AppUser` | Id, Username, PasswordHash, DisplayName, Role(7), EmpId, IsActive | 001 |
| `GoodExtra` | GoodId, BagPerTon(20), WeightKgPerBag(50) | 001 |

### 4.6 Views (READ เธเธ dbo)
| View | เธญเนเธฒเธเธเธฒเธ | เนเธเนเธ—เธตเน |
|------|---------|--------|
| `v_AllSalesOrders` | UNION wf.SalesOrder (DRAFT) + dbo.SOHD (CONFIRMEDโ’SHIPPED) | Dashboard, Paper Trail, SO list, Aging |
| `v_AllSalesOrderLines` | UNION wf.SalesOrderLine + dbo.SODT | SO detail, document |
| `v_Customer` | dbo.EMCust | เน€เธฅเธทเธญเธเธฅเธนเธเธเนเธฒ |
| `v_FertGood` | dbo.EMGood (FG StockFlag='Y') | เน€เธฅเธทเธญเธเธชเธดเธเธเนเธฒ |
| `v_CurrentPrice` | dbo.EMSetPriceDT | เธฃเธฒเธเธฒ NET (เธเธฒเธเธฃเธตเน€เธเธ—) |
| `v_ControlTicket` | dbo.SOHD (DocuType=103, 'Y') | เธ•เธฑเนเธงเธเธธเธก |
| `v_GiveawayBudgetStatus` | wf.GiveawayBudget โ’ Withdrawal | เธเธญเธเนเธ–เธก |

---

## 5. Data Dictionary โ€” dbo (WINSpeed, READ-ONLY)

| เธ•เธฒเธฃเธฒเธ | เธชเธฒเธฃเธฐ | DocuType / เธซเธกเธฒเธขเน€เธซเธ•เธธ |
|-------|------|---------------------|
| `EMCust` (790) | เธฅเธนเธเธเนเธฒ | CustID |
| `EMCustMultiEmp` | เธ•เธฒเธฃเธฒเธเน€เธเธทเนเธญเธกเธฅเธนเธเธเนเธฒ โ” เธเธเธฑเธเธเธฒเธเธเธฒเธข | CustID+EmpID; เนเธเนเธเธณเธเธฑเธ”เธชเธดเธ—เธเธดเน SALES เนเธฅเธฐ filter salesperson |
| `EMGood` (417) | เธชเธดเธเธเนเธฒ | FG = StockFlag='Y' (193) |
| `EMEmp` | เธเธเธฑเธเธเธฒเธ | EmpID โ” AppUser.EmpId |
| `EMSetPriceHD/DT` (4,054) | เธฃเธฒเธเธฒ NET เธฃเธฒเธขเน€เธ”เธทเธญเธ | GoodPriceNet |
| `SOHD/SODT` | เนเธเธเธญเธ/เนเธเธชเธฑเนเธเธเธฒเธข | 103=SO Data Entry/booking เธ—เธตเน WINSpeed WF เน€เธซเนเธเนเธ”เน ยท 104=เน€เธญเธเธชเธฒเธฃเธเธฒเธ Confirm/Approve Order (WF) |
| `SOInvHD/SOInvDT` | เนเธเธเธณเธเธฑเธ/CN/DN | 107=เธเธฒเธขเน€เธเธทเนเธญ ยท 109=CN legacy ยท 110=DN ยท 202=flow เธฅเธฑเธ” |
| `WFCoupon` (94,540) | เธเธนเธเธญเธ/เธชเธดเธ—เธเธดเน WF Rebate เธ—เธตเนเธเธนเธเธเธฑเธ SO | DocuID=SOHD.SOID |
| `WFRedemtionHD/DT` | เธเธฒเธฃเนเธเนเธชเธดเธ—เธเธดเน/เธ•เธฑเธ”เธเธนเธเธญเธ WF Rebate | RedemtionID/CouponID/SOInvID |
| `EMcnremarkType` | เน€เธซเธ•เธธเธเธฅ CN | 6001=เธฅเธ”เธซเธเธตเน/เธชเนเธงเธเธฅเธ” ยท 1001=เธชเนเธงเธเธฅเธ”เธเธดเน€เธจเธฉ (=เธฃเธตเน€เธเธ—) |
| `GLHD/GLDT` | เธเธฑเธเธเธตเนเธขเธเธเธฃเธฐเน€เธ เธ— | 501 ยท FromFlag=107 |

---

## 6. Data Dictionary โ€” TruckScale (MySQL, READ-ONLY)

| เธ•เธฒเธฃเธฒเธ | เธเธญเธฅเธฑเธกเธเนเธซเธฅเธฑเธ | เธชเธฒเธฃเธฐ |
|-------|-------------|------|
| `tblscale` (403,908) | sequence, **movebill**, **one_car_regis**(เธ—เธฐเน€เธเธตเธขเธ), one_cus_name, weight_in/out/net, Date_In/Out, one_w_type, Computer_w(เน€เธเธฃเธทเนเธญเธเธเธฑเนเธ), one_num | เธฃเธฒเธขเธเธฒเธฃเธเธฑเนเธ (เธซเธฅเธฑเธ) |
| `tblproduct_detail` (550,161) | pd_pro_name, pd_pro_wantWeight, pd_Destination, one_num, pd_pro_invoidโ ๏ธ | เธชเธดเธเธเนเธฒเธ•เนเธญเนเธเธเธฑเนเธ |

---

## Current Addendum - 2026-07-08

Schema changes `031-035` are implemented in source code and were applied to the restored local `dbwins_worldfert9` database on 2026-07-08.

| Object | Current columns / purpose | Migration |
|---|---|---|
| `wf.SalesOrder`, `wf.SalesOrderExt` | `RequestedAt`, `IsOwnTruck`, `NoTruckRequired`, `PSling` | 031 |
| `wf.RebatePlan` | `RefDoc` | 032 |
| `wf.SalesOrderLine`, `wf.SalesOrderLineExt` | `GiveawayApprovalStatus`, `GiveawayApprovedBy`, `GiveawayApprovedAt`, `GiveawayApprovalNote` | 033 |
| `wf.CustomerRequest` | app-owned new customer request flow via Sale Admin; no automatic write to `dbo.EMCust` | 034 |
| `wf.AppUser` | `LineUserId`, `LineDisplayName`, `LinePictureUrl`, `LineLinkedAt` for LINE Login binding | 035 |
| `wf.AccessAsAudit` | Access As START/STOP audit trail with real actor and selected effective user | 045 |
| `wf.ApiAuditLog` | API audit trail for POST/PUT/PATCH/DELETE and error responses, preserving actor/effective user | 045 |

Operational note: after migration/config changes, restart the backend so schema checks and LINE Login env values are refreshed.

## Current Addendum - 2026-07-13

Access As uses the same `wf.AppUser` identity table but preserves two identities:

- `ActorUserId`: the real logged-in user.
- `EffectiveUserId`: the selected user being accessed as.

The backend token carries both identities. Business permission checks use the effective role/user, while audit tables keep both values for traceability.
| `tbl_keyone` (407,973) | one_cus_id/name, one_car_regis, one_type | เธเนเธญเธกเธนเธฅเธเนเธญเธเธเธฑเนเธ |
| `tblorder` (5,890) | O_numId, O_num, O_numBalance | เธขเธญเธ”เธชเธฑเนเธ/เธเธเน€เธซเธฅเธทเธญ |
| `tblproduct / tblcustomer / tblstore / tblweighttype` | โ€” | master |

**เธซเธเนเธงเธข:** TruckScale = **เธเธดเนเธฅเธเธฃเธฑเธก** (kg) ยท App เนเธเธฅเธเน€เธเนเธเธ•เธฑเธ (รท1000) เน€เธกเธทเนเธญเนเธชเธ”เธ ยท เธเธงเธฒเธกเธเธธเน€เธเธฃเธทเนเธญเธเธเธฑเนเธ 80,000 kg/เน€เธเธฃเธทเนเธญเธ (2 เน€เธเธฃเธทเนเธญเธ)

---

## 7. เธซเธฅเธฑเธเธเธฒเธฃเธชเธณเธเธฑเธ (Iron Rules)

1. **schema wf = เนเธเนเธเนเธฒเธ migration เน€เธ—เนเธฒเธเธฑเนเธ** (`backend/migrations/0xx.sql`) โ€” เธฃเธฑเธ `npm run migrate:local` + `migrate:remote`
2. **TruckScale (MySQL) = READ-ONLY** เธเธฒเธ App โ€” เนเธกเนเน€เธเธตเธขเธเธเธฅเธฑเธ
3. **dbo = เธญเนเธฒเธเธเนเธฒเธ view เน€เธเนเธเธซเธฅเธฑเธ** ยท เธเนเธญเธขเธเน€เธงเนเธเธ—เธตเนเธ•เธฑเธ”เธชเธดเธเนเธเธฃเธฑเธ (v6.1 ยง17.3): confirm/picking/ship/cancel **เน€เธเธตเธขเธ `dbo.SOHD/SODT` เธ•เธฃเธ** (`sp_ConfirmSalesOrder` + UPDATE PkgStatus/clearflag/DocuStatus) โ€” เนเธ•เน **GL เธขเธฑเธเนเธซเน WINSpeed post เน€เธญเธ** (WINSpeed = เน€เธเนเธฒเธเธญเธเธเธฑเธเธเธต)
4. **เธฃเธฐเธเธเธฃเธตเน€เธเธ—/เธชเนเธงเธเธฅเธ”เนเธขเธเธเธฑเธเธเธฑเธ”เน€เธเธ:** App Rebate Plan/Pool (wf) ยท WF Rebate Trail เธเธญเธ WINSpeed (`WFCoupon`/`WFRedemtion`/`SOInv`, dbo) ยท Voucher/WFCoupon (เธ•เธฑเธ, dbo) ยท เธ•เธฑเนเธงเธเธธเธก (AI, dbo)
5. **Realtime:** Socket.IO (event `so_updated`, `paper_updated`) + polling fallback

---
*เน€เธญเธเธชเธฒเธฃเธ–เธฑเธ”เนเธ: [01-PAGES-SQL-MAP.md](01-PAGES-SQL-MAP.md) ยท [02-TEST-CASES.md](02-TEST-CASES.md) ยท [03-USER-GUIDE.md](03-USER-GUIDE.md) ยท [04-SOP.md](04-SOP.md)*

