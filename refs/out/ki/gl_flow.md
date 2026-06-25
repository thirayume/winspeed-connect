---
name: gl-flow
description: "Verified GL chain from SO through to GL entries, correct and incorrect joins"
metadata: 
  node_type: memory
  type: project
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

## Verified Chain
```
SOHD (103/104) → SOInvHD (107, PostGL='Y') → GLHD → GLDT → EMAcc
```

## Correct Joins (2 methods)

**Method 1 — recommended, join by DocuNo:**
```sql
JOIN dbo.GLHD g ON g.DocuNo = s.DocuNo AND g.FromFlag = 107
```

**Method 2 — join by PostID:**
```sql
JOIN dbo.GLHD g ON g.FromID = s.PostID AND g.FromFlag = 107
-- SOInvHD.PostID = GLHD.FromID  (NOT GLHD.GLID!)
```

## ❌ WRONG Join (never use)
```sql
JOIN dbo.GLHD g ON g.FromID = s.SOInvID  -- numeric coincidence, not a real relationship!
```

## GL Pattern for DocuType 107 Invoices (verified account names)
- **Dr** AccID=1037 (ลูกหนี้-ค้างส่ง / Trade Receivable), 145,038 lines
- **Cr** AccID=1120 (ขายสินค้า - เงินเชื่อ / Credit Sales), 145,014 lines
- AccID=1129 (รายได้อื่น / Other income), 32 lines
- Always exactly 2 lines/invoice — **fertilizer is VAT-exempt** (VATType=3, VATAmnt=0) so no VAT line
- `GLHD.FromFlag` = source DocuType (not GLHD.DocuType which is always 501)

## CN / DN linkage (verified — they differ!)
- **CN 109** (reduce): `cn.RefSOID = orig.SOInvID`
- **DN 110** (increase): `dn.RefNo = orig.DocuNo` — RefSOID is NULL for all 2,420 rows!

## AR Receipt
- `ARReceDT.SOInvID = SOInvHD.SOInvID` (131,816 rows / 116,300 invoices; ARReceHD=69,591)
