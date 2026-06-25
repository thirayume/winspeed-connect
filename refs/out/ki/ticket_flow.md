---
name: ticket-flow
description: "ตั๋วคุม (control ticket) flow, AppvFlag states, truck registration fields, and WINSpeed gaps"
metadata: 
  node_type: memory
  type: project
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

## Flow (verified from real data)
```
SOHD DocuType=103 (AppvFlag='W')     ← ใบจอง "รอชั่ง"
    TransRegistration = truck plate (e.g. "70-1087/88" = head/tail)
    SOHDRemark.Remark ListNo=1 = truck plate (backup, 129,951 rows)
    Desc1/Desc2 = product/formula details
         ↓ approved (enters weigh station)
SOHD.AppvFlag → 'Y'
SOHD.AppvDocuNo → 'AI68-XXXXX'      ← control ticket number (AI + BE year + seq)
SOHD.AppvDate → approval date
         ↓ create Sale Order
SOHD DocuType=104 (AppvFlag='W')     ← ใบสั่งขาย
    RefNo = 'AI68-XXXXX'             ← references control ticket
    SODT.Refno = 'AI68-XXXXX'
         ↓ invoice
SOInvHD DocuType=107                 ← ใบกำกับขาย
```

## AppvFlag Values
- `W` = รอ (waiting/pending)
- `Y` = ผ่านแล้ว (approved)

## Where Data Lives
| Data | Table.Column |
|---|---|
| Truck registration | `SOHD.TransRegistration` |
| Truck registration (backup) | `SOHDRemark.Remark` ListNo=1 |
| Status | `SOHD.AppvFlag` |
| Control ticket number | `SOHD.AppvDocuNo` prefix 'AI' |
| Reference in SO | `SOHD.RefNo` (DocuType=104) |

## ❗ Gaps in WINSpeed (must build in new system)
- **No separate table** for control tickets — AI prefix is just an approval number field in SOHD
- **No Gross/Tare/Net weight** — only `SODT.GoodQty2` (agreed sale qty in tons)
- **No weigh-in/out timestamps** — weighing is external or manual
- **Must create `wf.WeighTicket`** to store Gross/Tare/Net + timestamps
