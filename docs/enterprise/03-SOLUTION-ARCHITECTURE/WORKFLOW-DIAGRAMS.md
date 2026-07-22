---
documentId: "WF-ARCH-010"
title: "11 - Workflow and Workprocess Diagrams"
version: "v1.0"
status: Released
owner: "Solution Architect"
normative: true
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-ARCH-010` · Version: v1.0 · Date: 21 กรกฎาคม 2569 (21 July 2026) · Status: Released
> Classification: Confidential — Client / Authorized Partner Use Only
> Source of truth: operational build v1.0 · verified against `dbwins_worldfert9`

---
# 11 - Workflow and Workprocess Diagrams

This document contains structured data in [Mermaid.js](https://mermaid.js.org/) format. 

## How to use with Draw.io

1. Open [draw.io](https://app.diagrams.net/).
2. From the top menu, select **Arrange** > **Insert** > **Advanced** > **Mermaid...**.
3. Copy the Mermaid code blocks below (excluding the ````mermaid```` backticks) and paste them into the text box.
4. Click **Insert** to generate the flowchart instantly.

---

## 1. End-to-End Sales Order Flow

```mermaid
flowchart TD
    Start([Sales Entry - Draft SO]) --> DraftSO
    
    subgraph Draft Phase
    DraftSO(Create SO Draft) --> VerifyCustomer(Select Customer & Terms)
    VerifyCustomer --> AddProducts(Add Products: Master/Child Tonnage)
    AddProducts --> CheckInventory{Stock/Credit OK?}
    CheckInventory -- No --> NotifySale(Update Term/Edit)
    CheckInventory -- Yes --> DraftReady(Draft Ready)
    end
    
    DraftReady --> CounterVerify(Counter-Sales Verification)
    
    subgraph Operations Phase
    CounterVerify --> ConfirmWinSpeed[Confirm to WINSpeed - SOHD/SODT DocuType=103]
    ConfirmWinSpeed --> AllocateSequence[Assign Sequence Loading / Tonnage]
    AllocateSequence --> RealtimeWebsocket((Push Realtime WebSocket Event))
    RealtimeWebsocket --> UIRefresh(Update UI: Paper Trail / Dashboard)
    end
    
    subgraph TruckScale Logistics
    UIRefresh --> TruckArrival[Truck Arrives at Scale]
    TruckArrival --> MatchPlate{Match Truck Plate / TransRegistration}
    MatchPlate -- Exact Match --> WeighIn[Weigh-In / Picking State]
    WeighIn --> LoadGoods(Load Goods)
    LoadGoods --> WeighOut[Weigh-Out / Shipped State]
    end
    
    WeighOut --> HandOff[Post Invoice in WINSpeed]
    HandOff --> End([SO Flow Closed])
```

---

## 2. Quotation Conversion Process

```mermaid
flowchart LR
    SaleTrip(Sales Trip) --> CreateMultiDrafts(Create Multiple Draft SOs)
    
    subgraph Quotation Preparation
    CreateMultiDrafts --> SelectDrafts(Select Drafts for Quotation)
    SelectDrafts --> CompileQuote[Compile into 1 wf.Quotation]
    CompileQuote --> LockDrafts[Lock Source SOs to QUOTATION Status]
    LockDrafts --> SyncNative[Sync to WINSpeed DocuType=102]
    SyncNative --> WaitDecision{Customer Decision}
    end
    
    WaitDecision -- Rejected/Expired --> CancelQuote(Cancel Quote)
    CancelQuote --> UnlockDrafts(Draft SOs unlocked back to DRAFT)
    
    WaitDecision -- Accepted --> ConfirmQuote[Confirm Quote - DocuType=113]
    ConfirmQuote --> RestoreMetadata[Restore Metadata & Split back to Multi-Bills]
    RestoreMetadata --> DeleteOldDrafts[Delete Original Locked Draft SOs]
    DeleteOldDrafts --> SO1(New SO Draft 1)
    DeleteOldDrafts --> SO2(New SO Draft 2)
    
    SO1 --> ConfirmWIN[Confirm to WINSpeed 103]
    SO2 --> ConfirmWIN
```

---

## 3. Giveaway Approval Flow

```mermaid
flowchart TD
    SalesMan(Salesperson) --> RequestGiveaway(Add Giveaway Item to SO)
    
    subgraph Approval Process
    RequestGiveaway --> CheckBudget{Budget Available?}
    CheckBudget -- No --> Deny(Deny Request)
    CheckBudget -- Yes --> SubmitReq[Submit Line for Approval]
    SubmitReq --> PendingStatus(Status: PENDING)
    
    PendingStatus --> ManagerReview{Manager / Admin Review}
    ManagerReview -- Reject --> RejectLine(Mark Line as Rejected)
    ManagerReview -- Approve --> ApproveLine(Mark Line as Approved)
    end
    
    ApproveLine --> Withdraw[Write to wf.GiveawayWithdrawal]
    Withdraw --> LinkSO[Attach to Confirmed SO]
    LinkSO --> Dispatch(Ready for Dispatch)
```
