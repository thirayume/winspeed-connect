---
name: docutype-reference
description: "All verified DocuType codes, their meaning, tables, and PKs"
metadata: 
  node_type: memory
  type: project
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

| DocuType | Name | Table | PK | Notes |
|---|---|---|---|---|
| 103 | Confirm Order (ใบจอง) | SOHD/SODT | SOID | Flow control ticket |
| 104 | Sale Order (ใบสั่งขาย) | SOHD/SODT | SOID | Created from ใบจอง |
| **107** | **Sale on Credit (ใบกำกับขายเชื่อ)** | **SOInvHD/DT** | **SOInvID** | DocuNo prefix N/J |
| 108 | Cash Sale (ขายสด) | SOInvHD/DT | SOInvID | |
| 109 | Credit Note (ลดหนี้) | SOInvHD/DT | SOInvID | 2,702 rows; link via **RefSOID**→orig.SOInvID |
| 110 | Debit Note (เพิ่มหนี้) | SOInvHD/DT | SOInvID | 2,420 rows; link via **RefNo**→orig.DocuNo (RefSOID=NULL!) |
| 202 | (Unknown name — not in ICDocuTypeHD) | SOInvHD/DT | SOInvID | 113,043 rows, DocuNo=SONo (flow ลัด), prefix K/I, include in revenue |
| **501** | **GL Journal** | **GLHD/GLDT** | **GLID** | DocuType=501 on ALL rows |

**Key insight:** `GLHD.DocuType` is always 501; use `GLHD.FromFlag` to identify the originating document type.

**CN vs DN linkage differs (verified):** CN 109 uses `RefSOID` (numeric), DN 110 uses `RefNo` (text DocuNo) because RefSOID is NULL on all DN rows.
