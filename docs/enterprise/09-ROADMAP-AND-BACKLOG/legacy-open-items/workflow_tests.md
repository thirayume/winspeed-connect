---
documentId: "WF-LEG-004"
title: "Workflow Test Results — ผลทดสอบจริงทุก Scenario"
version: "v1.0"
status: Archived
owner: "QA Lead"
normative: false
---
# Workflow Test Results — ผลทดสอบจริงทุก Scenario
DB: dbwins_worldfert9 | login: wf_reader (read-only) | ทดสอบ: 2026-06-06
ทุก query รันจริงบน WINSpeed DB — ผลด้านล่างคือ output จริง

---

## สรุปผล (16 เทสต์ — ผ่านทั้งหมด)

| # | Test | ผล | สถานะ |
|---|---|---|---|
| A1–A5 | Happy Path lifecycle (ตั๋วคุม→GL) | chain ครบ, GL 2 บรรทัด, VAT=0 | ✅ |
| B | Flow ลัด 202 (DocuNo=SONo) | DocuNo=SONo ทุกแถว | ✅ |
| C | ยกเลิกใบจอง (DocuStatus=N) | W=126, Y=1,047 | ✅ |
| D | Credit Note 109 | RefSOID→ต้นทาง (2,699/2,702) | ✅ |
| E | Debit Note 110 | **RefNo→ต้นทาง (RefSOID=NULL!)** | ✅ แก้ |
| F | ของแถม (GoodPrice2=0) | 4,254 บรรทัด | ✅ |
| G | Rebate base รายเดือน | คำนวณได้ | ✅ |
| H | Outstanding (ยังไม่วางบิล) | 108,823 ใบ | ✅ |
| I | Credit limit (EMCust) | 0/790 มี limit | ✅ |
| J | รับชำระ (ARReceDT) | 131,816 แถว / 116,300 ใบ | ✅ |
| K | Price NET (EMSetPriceDT) | 4,054 / ICPrice ว่าง | ✅ |
| L | หน่วยตัน (1002) | hex ยืนยัน, no conversion | ✅ |
| M | GL accounts | ชื่อบัญชีจริง | ✅ แก้ |
| N | ตั๋วคุม states | 4 สถานะ | ✅ |
| O | พิสูจน์ wrong-join | FromID=SOInvID ให้ผลผิด | ✅ |
| P | AppvDocuNo prefix | AI=25,639 | ✅ |

> **2 corrections ที่พบจากการทดสอบ** (sync เข้าทุกไฟล์แล้ว):
> 1. **DN 110 link ผ่าน `RefNo` (ข้อความ) ไม่ใช่ `RefSOID`** — RefSOID=NULL ทุกแถว (ต่างจาก CN 109)
> 2. **ชื่อบัญชี GL จริง**: 1037=ลูกหนี้-ค้างส่ง, 1120=ขายสินค้า-เงินเชื่อ, 1129=รายได้อื่น

---

## Scenario A — Happy Path (ตั๋วคุม AI68-03542)

### A2: Lifecycle ทุก stage
```sql
DECLARE @AI VARCHAR(30) = 'AI68-03542';
SELECT stage, DocuNo, dt, Amnt, Status FROM (
  SELECT 1 ord,'1.ใบจอง 103' stage, h.DocuNo, CONVERT(VARCHAR,CONVERT(DATE,h.DocuDate)) dt,
         h.NetAmnt Amnt, h.AppvFlag Status
  FROM dbo.SOHD h WHERE h.AppvDocuNo=@AI AND h.DocuType=103
  UNION ALL
  SELECT 2,'2.ใบสั่งขาย 104', h.DocuNo, CONVERT(VARCHAR,CONVERT(DATE,h.DocuDate)), h.NetAmnt, h.DocuStatus
  FROM dbo.SOHD h WHERE h.RefNo=@AI AND h.DocuType=104
  UNION ALL
  SELECT 3,'3.ใบกำกับ '+CAST(inv.Docutype AS VARCHAR), inv.DocuNo,
         CONVERT(VARCHAR,CONVERT(DATE,inv.DocuDate)), inv.NetAmnt, inv.PostGL
  FROM dbo.SOHD h104 JOIN dbo.SOInvHD inv ON inv.SONo=h104.DocuNo AND inv.Docutype IN (107,202)
  WHERE h104.RefNo=@AI AND h104.DocuType=104
) t ORDER BY ord;
```
**ผล:**
```
stage            | DocuNo     | วันที่      | ยอด        | สถานะ
1.ใบจอง 103      | K68-01316  | 2025-06-10 | 202,500.00 | Y
2.ใบสั่งขาย 104  | K68-01214  | 2025-06-07 | 202,500.00 | Y
3.ใบกำกับ 107    | N68-01455  | 2025-06-07 | 202,500.00 | Y (PostGL)
3.ใบกำกับ 202    | K68-01214  | 2025-06-07 | 202,500.00 | Y (PostGL)
```
→ ตั๋วคุมเดียวออกทั้งใบกำกับ 107 (N68-01455) และ 202 (K68-01214 = SONo). ยอดตรงกันทุก stage

### A3: GL chain (join ด้วย DocuNo)
```sql
SELECT g.GLID, g.FromFlag, g.DocuType GLType, dt.ListNo, dt.AccID, dt.DrAmnt, dt.CrAmnt
FROM dbo.SOInvHD inv
JOIN dbo.GLHD g ON g.DocuNo=inv.DocuNo AND g.FromFlag=107
JOIN dbo.GLDT dt ON dt.GLID=g.GLID
WHERE inv.DocuNo='N68-01455' ORDER BY dt.ListNo;
```
**ผล:**
```
GLID   | FromFlag | GLType | ListNo | AccID | DrAmnt     | CrAmnt
441006 | 107      | 501    | 1      | 1037  | 202,500.00 | 0
441006 | 107      | 501    | 2      | 1120  | 0          | 202,500.00
```
→ GL 2 บรรทัด: Dr 1037 (ลูกหนี้-ค้างส่ง) / Cr 1120 (ขายสินค้า-เงินเชื่อ), DocuType=501, FromFlag=107

### A4: VAT (ยืนยันยกเว้น)
```sql
SELECT DocuNo, VATType, VATRate, VATAmnt, SumGoodAmnt, NetAmnt FROM dbo.SOInvHD WHERE DocuNo='N68-01455';
```
**ผล:** `N68-01455 | VATType=3 | VATRate=0 | VATAmnt=0 | SumGoodAmnt=202,500 | NetAmnt=202,500`
→ ปุ๋ยยกเว้น VAT → GL ไม่มี VAT line

### A5: รายการสินค้า
```sql
SELECT d.ListNo, d.GoodName, d.GoodQty2, d.GoodPrice2, d.GoodAmnt,
  CASE WHEN d.GoodID IS NULL THEN 'misc' WHEN d.GoodPrice2=0 THEN 'ของแถม' ELSE 'ขาย' END AS ชนิด
FROM dbo.SOInvHD inv JOIN dbo.SOInvDT d ON d.SOInvID=inv.SOInvID
WHERE inv.DocuNo='N68-01455' ORDER BY d.ListNo;
```
**ผล:** `1 | 16-8-8 เชิงผสม ตรารถเกษตร | 15.0000 ตัน | 13,500/ตัน | 202,500 | ขาย`

---

## Scenario B — Flow ลัด (DocuType 202)
```sql
SELECT TOP 3 inv.DocuNo, inv.SONo,
  CASE WHEN inv.DocuNo=inv.SONo THEN 'YES' ELSE 'NO' END AS DocuNo_eq_SONo, inv.PostGL
FROM dbo.SOInvHD inv WHERE inv.Docutype=202 ORDER BY inv.SOInvID DESC;
```
**ผล:**
```
DocuNo     | SONo       | DocuNo=SONo | PostGL
I68-02060  | I68-02060  | YES         | N
I68-02059  | I68-02059  | YES         | Y
I68-02058  | I68-02058  | YES         | Y
```
→ 202 = ใบกำกับที่ DocuNo = SONo (ไม่สร้างเลขใหม่) 113,043 ใบ

---

## Scenario C — ยกเลิกใบจอง
```sql
SELECT AppvFlag, COUNT(*) cnt FROM dbo.SOHD WHERE DocuType=103 AND DocuStatus='N' GROUP BY AppvFlag;
```
**ผล:** `W (ยกก่อนชั่ง)=126 | Y (ยกหลังชั่ง)=1,047`

---

## Scenario D — Credit Note 109 (ลดยอด)
```sql
SELECT TOP 3 cn.DocuNo AS CN, orig.DocuNo AS ต้นทาง, orig.Docutype, cn.NetAmnt AS ยอดลด
FROM dbo.SOInvHD cn JOIN dbo.SOInvHD orig ON orig.SOInvID=cn.RefSOID
WHERE cn.Docutype=109 ORDER BY cn.SOInvID DESC;
```
**ผล:**
```
CN         | ต้นทาง     | ต้นType | ยอดลด
CNK68-010  | N65-02269  | 107     | 22,000
CNK68-009  | N65-02196  | 107     | 1,600
CNK68-008  | K66-00137  | 202     | 9,600
```
→ CN 109 link ต้นทางด้วย `RefSOID` (มีค่า 2,699/2,702 = 99.9%)

---

## Scenario E — Debit Note 110 (เพิ่มยอด) ⚠ CORRECTION
DN 110 **RefSOID = NULL ทุกแถว (2,420)** → ต้อง link ด้วย **RefNo** (ข้อความ = DocuNo ต้นทาง)
```sql
-- ❌ ผิด: JOIN ... ON orig.SOInvID = dn.RefSOID  → 0 แถว
-- ✅ ถูก:
SELECT TOP 3 dn.DocuNo AS DN, dn.RefNo AS อ้างถึง, orig.DocuNo AS ต้นทาง, orig.Docutype, dn.NetAmnt
FROM dbo.SOInvHD dn JOIN dbo.SOInvHD orig ON orig.DocuNo=dn.RefNo
WHERE dn.Docutype=110 ORDER BY dn.SOInvID DESC;
```
**ผล:**
```
DN         | อ้างถึง    | ต้นทาง     | ต้นType | ยอดเพิ่ม
DNK67-003  | K67-03131  | K67-03131  | 202     | 6,000
DNK67-002  | K67-02883  | K67-02883  | 202     | 1,225
DNI67-004  | I67-02228  | I67-02228  | 202     | 14,000
```
**สรุป link:** CN 109 → `RefSOID` (ID) | DN 110 → `RefNo` (DocuNo ข้อความ)

---

## Scenario F — ของแถม (GoodPrice2=0)
```sql
SELECT COUNT(*) FROM dbo.SOInvDT d JOIN dbo.SOInvHD inv ON inv.SOInvID=d.SOInvID
WHERE inv.Docutype=107 AND d.GoodPrice2=0 AND d.GoodID IS NOT NULL;
```
**ผล:** `4,254 บรรทัด` (ตัวอย่าง: 20-5-3 ปุ๋ยเทพ 0.1 ตัน ราคา 0)

---

## Scenario G — Rebate Base (ยอดขายราย Cust/เดือน)
```sql
SELECT TOP 3 c.CustName, YEAR(inv.DocuDate), MONTH(inv.DocuDate),
  SUM(d.GoodQty2) AS ตันรวม, SUM(d.GoodAmnt) AS ยอดขาย
FROM dbo.SOInvHD inv JOIN dbo.SOInvDT d ON d.SOInvID=inv.SOInvID JOIN dbo.EMCust c ON c.CustID=inv.CustID
WHERE inv.Docutype IN (107,202) AND d.GoodID IS NOT NULL AND d.GoodPrice2>0 AND YEAR(inv.DocuDate)=2025
GROUP BY c.CustName, YEAR(inv.DocuDate), MONTH(inv.DocuDate) ORDER BY ยอดขาย DESC;
```
**ผล:**
```
CustName                   | ปี/เดือน | ตันรวม   | ยอดขาย
อุตสาหกรรมโคราช จำกัด        | 2025/4   | 6,444.00 | 94,212,625
อุตสาหกรรมโคราช จำกัด        | 2025/3   | 5,659.75 | 82,372,000
น้ำตาลสุรินทร์ จำกัด        | 2025/4   | 3,278.40 | 65,536,450
```
→ ฐานคำนวณ rebate ต่อ Cust×เดือน ทำได้จริง (ใช้ใน wf.RebateLedger)

---

## Scenario H — Outstanding (PostGL=Y ยังไม่วางบิล)
```sql
SELECT COUNT(*) FROM dbo.SOInvHD inv
WHERE inv.Docutype IN (107,202) AND inv.DocuStatus='Y' AND inv.PostGL='Y'
  AND NOT EXISTS (SELECT 1 FROM dbo.ARBillDT dt WHERE dt.SOInvID=inv.SOInvID);
```
**ผล:** `108,823 ใบ` (ARBill ใช้น้อยมาก — มีแค่ 885 ใบวางบิล, ส่วนใหญ่ track ผ่าน ARReceDT รับชำระตรง)

---

## Master Data Facts

### I — Credit Limit (EMCust)
```sql
SELECT COUNT(*) total, SUM(CASE WHEN CreditAmnt>0 THEN 1 ELSE 0 END) has_limit FROM dbo.EMCust;
```
**ผล:** `total=790 | has_limit=0` → **ไม่มีลูกค้ารายใดตั้งวงเงินเครดิต** → Credit Hold ต้องออกแบบใน wf

### J — รับชำระ (ARReceDT)
```sql
SELECT COUNT(*) total_recv, COUNT(DISTINCT SOInvID) distinct_inv FROM dbo.ARReceDT WHERE SOInvID IS NOT NULL;
```
**ผล:** `131,816 แถว / 116,300 ใบกำกับ` (ARReceHD header = 69,591) → รับชำระ link ใบกำกับด้วย ARReceDT.SOInvID

### K — ราคา NET (EMSetPriceDT)
```sql
SELECT (SELECT COUNT(*) FROM dbo.ICPriceHD) ICPriceHD, (SELECT COUNT(*) FROM dbo.ICPriceDT) ICPriceDT,
       (SELECT COUNT(*) FROM dbo.EMSetPriceDT) EMSetPriceDT;
```
**ผล:** `ICPriceHD=0 | ICPriceDT=0 | EMSetPriceDT=4,054` → ราคา NET อยู่ที่ EMSetPriceDT.GoodPriceNet เท่านั้น

### L — หน่วยตัน
```sql
SELECT GoodUnitID, CONVERT(VARBINARY(10),GoodUnitName) hex, RateQty FROM dbo.EMGoodUnit WHERE GoodUnitID IN (1001,1002);
```
**ผล:** `1001=0xE3BA (ใบ) RateQty=1.0 | 1002=0xB5D1B9 (ตัน) RateQty=1.0`
EMGood ปุ๋ย: MainGoodUnitID=1002 (152 สูตร), SaleGoodUnitID=NULL → ไม่มี conversion ตัน↔กระสอบ

### M — GL Accounts (ชื่อจริง) ⚠ CORRECTION
```sql
SELECT dt.AccID, a.AccName, COUNT(*) cnt
FROM dbo.GLHD g JOIN dbo.GLDT dt ON dt.GLID=g.GLID JOIN dbo.EMAcc a ON a.AccID=dt.AccID
WHERE g.FromFlag=107 GROUP BY dt.AccID, a.AccName ORDER BY cnt DESC;
```
**ผล:**
```
AccID | AccName              | cnt
1037  | ลูกหนี้-ค้างส่ง        | 145,038
1120  | ขายสินค้า - เงินเชื่อ  | 145,014
1129  | รายได้อื่น           | 32
```
→ ชื่อจริง (เดิมเขียน "ลูกหนี้การค้า/รายได้ขาย" เป็นการประมาณ)

### N — ตั๋วคุม States
```sql
SELECT AppvFlag, DocuStatus, COUNT(*) cnt FROM dbo.SOHD WHERE DocuType=103 GROUP BY AppvFlag, DocuStatus;
```
**ผล:** `W,Y=28,290 (รอชั่ง) | Y,Y=24,632 (ผ่านแล้ว) | W,N=126 | Y,N=1,047 (ยกเลิก)`

### O — พิสูจน์ Wrong-Join
```sql
-- ✅ ถูก (DocuNo): N68-01455 → GLID 441006, GL_DocuNo=N68-01455 (ตรง)
-- ❌ ผิด (FromID=SOInvID): N68-01455 (SOInvID=304013) → 0 แถว (หา GL ไม่เจอ)
SELECT g.GLID FROM dbo.SOInvHD inv JOIN dbo.GLHD g ON g.FromID=inv.SOInvID AND g.FromFlag=107
WHERE inv.DocuNo='N68-01455';   -- คืน 0 แถว = ผิด
```
→ ยืนยันต้อง join ด้วย `DocuNo` หรือ `PostID` เท่านั้น

### P — AppvDocuNo Prefix
```sql
SELECT LEFT(AppvDocuNo,2) prefix, COUNT(*) cnt FROM dbo.SOHD
WHERE DocuType=103 AND AppvFlag='Y' AND AppvDocuNo IS NOT NULL GROUP BY LEFT(AppvDocuNo,2);
```
**ผล:** `AI=25,639 | I6=25 | K6=15` → ตั๋วคุมใช้ prefix 'AI' (99.8%)
