# -*- coding: utf-8 -*-
import os
D = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "diagrams"))
os.makedirs(D, exist_ok=True)

diagrams = {
"01-architecture": """flowchart TB
  subgraph APP["WS-Sale-App  (React 19 + Vite + Express)"]
    UI["Tablet-first UI · 22 portal keys · RBAC 8 roles"]
  end
  subgraph WF["wf schema  (writable)"]
    W1["SalesOrder (draft)"]
    W2["Rebate engine<br/>Pool · Ledger · Usage · Claim"]
    W3["Audit · Users · Quotation"]
  end
  subgraph DBO["WINSpeed dbo  (controlled write boundary)"]
    D1["SOHD / SODT · SOInvHD"]
    D2["WFCoupon / WFRedemtion"]
    D3["AR · GL · Price"]
  end
  subgraph TS["TruckScale  (MySQL, read + pre-weigh write)"]
    T1["Weigh tickets"]
  end
  UI --> W1
  UI --> W2
  UI --> W3
  W1 -->|sp_ConfirmSalesOrder| D1
  W2 -. reads .-> D2
  T1 -->|bridge| W2
  D1 --> D3
""",

"02-so-lifecycle": """stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> CONFIRMED: confirm (sp_ConfirmSalesOrder)
  CONFIRMED --> PICKING: PkgStatus = Y
  PICKING --> LOADED: IsLoaded = 1
  LOADED --> SHIPPED: weigh-out - bookRebateAccrual
  SHIPPED --> CLOSED: post invoice (DocuType 107)
  DRAFT --> CANCELLED
  CONFIRMED --> CANCELLED
  CLOSED --> [*]
  CANCELLED --> [*]
""",

"03-rebate-coupon-flow": """flowchart LR
  A["SOHD 104<br/>source order"] -->|creates| B["WFCoupon<br/>GET · RemaQty (tons)"]
  B -->|redeem| C["WFRedemtionDT<br/>USE"]
  C -->|SOInvID| E["SOInvHD 107<br/>invoice"]
  E --> F["ARReceHD - GL / VAT"]
  C -. RemaQty to 0 .-> G["fully used"]
""",

"04-rebate-sequence": """sequenceDiagram
  actor Sales
  participant App as WS-Sale-App
  participant WS as WINSpeed dbo
  participant Scale as TruckScale
  Sales->>App: Confirm Sales Order
  App->>WS: sp_ConfirmSalesOrder
  Scale-->>App: weigh-out ticket (bridge)
  App->>App: status to SHIPPED
  App->>App: bookRebateAccrual
  Note over App: RebateLedger += (Price - Net) x Qty
  Sales->>App: use rebate on next order
  App->>App: consumeRebateAccrual (FIFO) - RebateUsage
""",

"05-erd": """erDiagram
  SOHD ||--o{ SODT : "SOID"
  SOHD ||--o{ WFCoupon : "DocuID"
  WFCoupon ||--o{ WFRedemtionDT : "CouponID"
  WFRedemtionDT }o--|| SOInvHD : "SOInvID"
  SalesOrder ||--o{ RebateLedger : "SoId"
  RebatePool ||--o{ RebateLedger : "PoolId"
  RebateLedger ||--o{ RebateUsage : "LedgerId"
  RebatePool ||--o{ RebateClaim : "PoolId"
  WFCoupon {
    int CouponID
    int DocuID
    money GoodQty
    money RemaQty
    money GoodPrice
  }
  RebatePool {
    int SalesUserId
    int PeriodYear
    decimal AccruedAmt
    decimal ClaimedAmt
  }
  RebateLedger {
    int SoId
    string CustId
    decimal RebateAmount
    decimal RemainingAmt
    string Status
  }
""",

"06-rbac": """flowchart TB
  subgraph ROLES["RBAC · 8 Roles"]
    R1[SALES]
    R2[COUNTER_SALES]
    R3[WAREHOUSE]
    R4[WEIGHBRIDGE]
    R5[APPROVER]
    R6[ACCOUNTING]
    R7[ADMIN]
    R8[MANAGER]
  end
  R1 --> P1["Create/Convert SO · Quotation"]
  R2 --> P1
  R3 --> P2["Picking · Loading"]
  R4 --> P3["Weigh-out · Weigh Inbox"]
  R5 --> P4["Approve price/giveaway"]
  R6 --> P5["Rebate amounts · Recon · CN"]
  R7 --> P6["All + Master · Users · Policy"]
  R8 --> P7["Management · Approval · Reports"]
""",

"07-swimlane-order-to-cash": """flowchart TB
  subgraph SALES["Lane: Sales"]
    S1[Create SO] --> S2[Confirm]
  end
  subgraph WH["Lane: Warehouse"]
    W1[Pick] --> W2[Load]
  end
  subgraph WB["Lane: Weighbridge"]
    B1[Weigh-out] --> B2[WeighTicket]
  end
  subgraph ACC["Lane: Accounting"]
    A1[Post Invoice 107] --> A2[AR / Rebate / CN]
  end
  S2 --> W1
  W2 --> B1
  B2 --> A1
  B1 -. trigger .-> RB[Rebate accrual]
""",

"08-uml-rebate-domain": """classDiagram
  class RebatePool {
    +int SalesUserId
    +int PeriodYear
    +int PeriodMonth
    +decimal AccruedAmt
    +decimal ClaimedAmt
  }
  class RebateLedger {
    +string SoId
    +string CustId
    +decimal RebateAmount
    +decimal RemainingAmt
    +string Status
  }
  class RebateUsage {
    +int LedgerId
    +string AppliedSOID
    +decimal DeductedAmt
  }
  class RebateClaim {
    +string CnDocuNo
    +decimal ClaimAmt
  }
  RebatePool "1" --> "*" RebateLedger
  RebateLedger "1" --> "*" RebateUsage
  RebatePool "1" --> "*" RebateClaim
""",
}

for name, content in diagrams.items():
    with open(os.path.join(D, name + ".mmd"), "w", encoding="utf-8") as f:
        f.write(content)
print("wrote", len(diagrams), "diagrams to", D)
for n in diagrams: print(" -", n)
