---
documentId: "WF-DATA-013"
title: "12 — ระบบ Rebate / Coupon (คูปอง–รีเบท)"
version: "v1.0"
status: Released
owner: "Data Architect"
normative: true
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-DATA-013` · Version: v1.0 · Date: 21 กรกฎาคม 2569 (21 July 2026) · Status: Released
> Classification: Confidential — Client / Authorized Partner Use Only
> Source of truth: operational build v1.0 · verified against `dbwins_worldfert9`

---
# 12 — ระบบ Rebate / Coupon (คูปอง–รีเบท)

> WS-Sale-App · เอกสาร v1.0 · ปรับปรุง 21 ก.ค. 2569
> Reverse-engineered จากฐานข้อมูลจริง `dbwins_worldfert9` + source code `backend/routes/rebate.js`, `so.js`
> ผู้ใช้หลัก: IT, BA, ACCOUNTING, ผู้ตรวจสอบ

เอกสารนี้อธิบายว่า "rebate/คูปอง" ในระบบทำงานอย่างไร ตั้งแต่ต้น (ได้มาจากออเดอร์ไหน) จนจบ (ถูกใช้กับออเดอร์ไหน คงเหลือจนเป็น 0) ครอบคลุมทั้งกลไก **WINSpeed native (dbo)** และ **App engine (wf)**

---

## 0. กติกา schema (สำคัญ)

| Schema | คืออะไร | ใช้เมื่อ |
|--------|---------|----------|
| `dbo` | **WINSpeed native** (ERP เดิม) — READ-ONLY | เมื่อพูดถึง **WINSpeed** ใช้ `dbo` เท่านั้น |
| `wf`  | **App schema** (สร้างใหม่โดยทีมพัฒนา) | เมื่อพูดถึง **App** ใช้ `dbo` + `wf` |

> SQL Server instance นี้ compatibility level < 110 — **ห้ามใช้** `TRY_CONVERT`, `TRY_CAST`, `IIF`, `CONCAT`, `FORMAT`
> การ join `dbo.SOHD.SOID` (int) กับคอลัมน์ varchar ให้ใช้ `CAST(SOID AS VARCHAR(50))`

---

## 1. ภาพรวม — มี 4 กลไกที่ต้องแยกให้ชัด

| # | กลไก | ที่อยู่ | หน่วย | ผูกออเดอร์? | ปริมาณ | สถานะการใช้งาน |
|---|------|--------|-------|-------------|--------|----------------|
| 1 | **WFCoupon → WFRedemtion** | `dbo` | **ตัน** (มีมิติบาทผ่าน GoodPrice) | ✅ ครบ (order→coupon→invoice) | ~111,000 คูปอง | **หลัก / ใช้จริง** |
| 2 | **RBT credit note** | `dbo.SOInvHD` type 106 | บาท | ❌ ไม่ผูก (พิมพ์มือ) | 953 ใบ | รอง / manual |
| 3 | **CN rebate** | `dbo.SOInvHD` type 109 | บาท | ✅ ผูก invoice ต้นทาง (RefSOID) | 87 ใบ | legacy (2013–14) |
| 4 | **App wf engine** | `wf.Rebate*` | บาท | ✅ ครบ (SoId↔AppliedSOID) | test data | ใหม่ / ยังไม่ต่อ dbo |

**สรุปสั้น:** กลไก rebate ที่ WINSpeed ใช้จริงคือ **คูปอง (WFCoupon)** วัดเป็น**ตัน** ส่วน RBT/CN เป็นการทำ credit note คืนเงิน (บาท) แยกต่างหาก และ App มี engine ของตัวเอง (`wf`) ที่ยังไม่ผูกกับ dbo

---

## 2. กลไกหลัก — WFCoupon → WFRedemtion (dbo)

### 2.1 ตารางและ key

| ตาราง | บทบาท | key |
|-------|-------|-----|
| `dbo.SOHD` (DocuType **104**) | ออเดอร์ต้นทางที่ทำให้เกิดคูปอง | `SOID` |
| `dbo.WFCoupon` | **คูปองที่ได้** (ต่อบรรทัดสินค้า, เป็นตัน) | `CouponID`, `DocuID`→SOHD.SOID, `RemaQty` |
| `dbo.WFRedemtionHD` / `WFRedemtionDT` | **การตัดใช้คูปอง** | `RedemtionID`, `CouponID`, `SOInvID` |
| `dbo.SOInvHD` (DocuType **107**) | ใบกำกับที่นำคูปองไปใช้ | `SOInvID`, `SONo` |

**คอลัมน์สำคัญของ `WFCoupon`:** `GoodQty` (จำนวนตันของคูปอง), `RemaQty` (คงเหลือ), `GoodPrice` (บาท/หน่วย), `GoodID`, `CouponNo`, `SONo`

### 2.2 เส้นทางเอกสาร (document pathway)

```
SOHD 103 (ใบจอง/booking)
   │  AppvDocuNo = RefNo
   ▼
SOHD 104 (ออเดอร์ต้นทาง)  ──สร้างคูปอง──►  WFCoupon (GET: ได้คูปอง X ตัน, RemaQty=X)
                                                │  ตัดใช้ (WFRedemtionDT.CouponID = WFCoupon.CouponID)
                                                ▼
                                         WFRedemtionHD/DT (USE)
                                                │  WFRedemtionDT.SOInvID = SOInvHD.SOInvID
                                                ▼
                                         SOInvHD 107 (ใบกำกับที่ใช้คูปอง)  ──►  ARReceHD/DT ──► GL/VAT
                                                │
                                                ▼
                                    ทุกครั้งที่ตัด → RemaQty ลดลง → จนเหลือ 0 = ใช้หมด
```

**DocuType ที่เกี่ยวข้อง:** `103`=ใบจอง · `104`=ออเดอร์ต้นทาง(สร้างคูปอง) · `107`=ใบกำกับที่ใช้คูปอง · `116`=เอกสาร redemption · `106`=RBT credit note · `109`=CN rebate · `202`=cash flow

### 2.3 หลักการคงเหลือ

- **Redeemed (ใช้ไป)** = `GoodQty − RemaQty`
- **Remaining (คงเหลือ)** = `RemaQty`
- คูปอง 1 ใบถูกทยอยตัดได้หลายครั้ง (พบสูงสุด CouponID 124832 ถูก redeem 349 ครั้ง รวม 3,343.8 ตัน) จน `RemaQty = 0`
- มูลค่าบาทของคูปอง ≈ `GoodQty × GoodPrice`
- ปัจจุบัน ~111,182 จาก 111,192 คูปอง มี `RemaQty = 0` (ใช้หมดแล้ว)

### 2.4 ตัวอย่างจริง (test: I69-TEST)

| ขั้น | เอกสาร | รายละเอียด |
|------|--------|-----------|
| 1. GET (ออเดอร์ต้นทาง) | **I69-TEST** (SOHD SOID 213994, type 104) | ลูกค้า เงินสด (3000), EmpID 8009, 2026-07-02 |
| 2. คูปองที่ได้ | **C69-TEST** (9 ตัน × 99฿ = 891฿), **C69-TEST1** (19 ตัน × 799฿ = 15,181฿) | WFCoupon.DocuID = 213994 |
| 3. USE (ตัดคูปอง) | RedemtionID 180000, ตัด 9 ตัน | WFRedemtionDT.CouponID = 240000 → SOInvID 331001 |
| 4. ใบที่ใช้ | **J69-02806** (SOInvHD 331001, type 107), SONo = I69-TEST | |
| 5. คงเหลือ | `RemaQty = 0` (ใช้ครบ 9/9 ตัน) | จบกระบวนการ |

---

## 3. RBT credit note (dbo.SOInvHD type 106)

- **ระบุด้วย:** `DocuNo LIKE 'RBT%'` และ `Docutype = 106`
- เป็น credit note คืนเงิน (บาท) แบบ **พิมพ์มือ ไม่ผูกออเดอร์**: บรรทัด `SOInvDT.GoodID` เป็น null, ไม่มี `RefeNo`/`RefID`/`RefSOID`/`SONo`
- คำอธิบายอยู่ใน `SOInvDT.GoodRemark` เป็นข้อความอิสระ เช่น "ขออนุมัติเคลียร์รายการส่งเสริมการขาย เดือน กุมภาพันธ์ 2569"
- ออก RBT → สร้าง `ARReceHD` (DocuNo เดียวกัน) ที่ลดยอด AR ลูกค้าผ่านช่อง `OthrPayAmnt` (ไม่ผูก invoice ราย ๆ, `ARReceDT` ว่าง)
- **953 ใบ, รวม 22.85M฿ (2015–2026)**; ปี 2026 = 54 ใบ / 2,078,395฿

> RBT ไม่มี "pathway" ระดับออเดอร์ — เป็นการปรับ AR ก้อนเดียว ดูรายละเอียดการวิเคราะห์ได้ในภาคผนวก B

---

## 4. CN rebate (dbo.SOInvHD type 109)

- **ระบุด้วย:** `Docutype = 109` และ `CNRemarkTypeID IN (6001, 1001)`
  - `6001` = "ฝ่ายขายแจ้งให้ทำลดหนี้(ให้ส่วนลดแก่ลูกค้า)"
  - `1001` = "ให้ส่วนลดพิเศษแก่ลูกค้า"
- เป็น credit note คืนเงิน (บาท) ที่ **ผูก invoice ต้นทาง** ผ่าน `RefSOID` → `SOInvHD.SOInvID` (ครบ 87/87 ใบ)
- คอลัมน์: `NetAmnt` = ยอด rebate, `RemaAmnt` = คงเหลือ, `SONo` = เลข invoice เดิม
- **87 ใบ, ส่วนใหญ่ปี 2013–2014** (ปัจจุบันแทบไม่ใช้)

```sql
SELECT cn.DocuNo AS CNNo, CAST(cn.DocuDate AS DATE) AS CNDate,
       cn.CustID, cn.CustName, cn.NetAmnt AS RebateAmt, cn.RemaAmnt,
       orig.DocuNo AS SourceInvoice, t.CNRemarkTypeName AS Reason
FROM        dbo.SOInvHD cn   WITH (NOLOCK)
LEFT JOIN   dbo.SOInvHD orig WITH (NOLOCK) ON orig.SOInvID = cn.RefSOID
LEFT JOIN   dbo.EMcnremarkType t WITH (NOLOCK) ON t.CNRemarkTypeID = cn.CNRemarkTypeID
WHERE  cn.Docutype = 109 AND cn.CNRemarkTypeID IN (6001, 1001)
  AND  ISNULL(cn.DocuStatus,'') <> 'C'
ORDER BY cn.DocuDate DESC;
```

รายการสินค้าใน CN (rebate ต่อบรรทัด): `dbo.SOInvDT` — `GoodQty2` (ตัน), `GoodPrice2` (rebate/ตัน), `GoodAmnt` (บาท)

---

## 5. App engine (wf) — earn / use / claim

App สร้าง engine rebate แยกจาก dbo เป็น**บาท** มี 4 ตาราง:

| ตาราง | บทบาท |
|-------|-------|
| `wf.RebatePool` | ยอดสะสมต่อพนักงานขายต่อเดือน (`AccruedAmt`, `ClaimedAmt`) |
| `wf.RebateLedger` | บรรทัด rebate ที่ได้ (`SoId`=ออเดอร์ต้นทาง, `RemainingAmt`, `Status`) |
| `wf.RebateUsage` | การใช้ rebate เป็นส่วนลด (`LedgerId`→`AppliedSOID`) |
| `wf.RebateClaim` | การเคลมเป็นเงิน/CN (`CnDocuNo`) |

**EARN** — ตอน SO SHIPPED (ชั่งออก): `bookRebateAccrual` ([so.js](../../../backend/routes/so.js))
- `RebatePerTon = PricePerTon − NetPricePerTon`; `RebateAmount = RebatePerTon × QtyTon`
- INSERT `wf.RebateLedger` (RemainingAmt = RebateAmount, Status='PENDING') + `RebatePool.AccruedAmt += ...`

**USE (เป็นส่วนลดออเดอร์ถัดไป)** — ตอน CONFIRM SO ที่มี `RebateDiscountAmt > 0`: `consumeRebateAccrual`
- FIFO ตัด `RebateLedger.RemainingAmt` (เก่าสุดก่อน) + INSERT `wf.RebateUsage(LedgerId, AppliedSOID, DeductedAmt)`
- เส้นทาง: `RebateLedger.SoId` (ได้) → `RebateUsage.AppliedSOID` (ใช้)

**CLAIM (เป็นเงิน/CN)** — `rebate.js POST /claims`: FIFO ตัด RemainingAmt, Status→'CLAIMED', `RebatePool.ClaimedAmt += ...`, เก็บเลข CN ที่ `RebateClaim.CnDocuNo`

> Dashboard "รีเบท (฿)" = `RebatePool.AccruedAmt − ClaimedAmt` — เป็นข้อมูล **App เท่านั้น** ยังไม่ได้ sync จาก dbo (ดูภาค 7)

---

## 6. (ข) Query/View สำเร็จรูป — สรุปคูปองคงเหลือ (dbo)

> หมายเหตุ: `dbo` เป็น READ-ONLY — สร้าง view จริงให้สร้างใน schema `wf` (อ่าน dbo) หรือใช้เป็น query ตรง ๆ

### 6.1 คงเหลือต่อลูกค้า

```sql
SELECT  hd.CustID, hd.CustName,
        COUNT(c.CouponID)            AS OpenCoupons,
        SUM(c.RemaQty)               AS RemainingTon,
        SUM(c.RemaQty * c.GoodPrice) AS RemainingBaht
FROM        dbo.WFCoupon c  WITH (NOLOCK)
JOIN        dbo.SOHD     hd WITH (NOLOCK) ON hd.SOID = c.DocuID
WHERE  c.RemaQty > 0
GROUP BY hd.CustID, hd.CustName
ORDER BY RemainingTon DESC;
```

### 6.2 คงเหลือต่อพนักงานขาย

```sql
SELECT  hd.EmpID,
        ISNULL(emp.EmpName, CAST(hd.EmpID AS VARCHAR(20))) AS SalesName,
        COUNT(c.CouponID)              AS Coupons,
        SUM(c.GoodQty)                 AS IssuedTon,
        SUM(c.GoodQty - c.RemaQty)     AS RedeemedTon,
        SUM(c.RemaQty)                 AS RemainingTon
FROM        dbo.WFCoupon c  WITH (NOLOCK)
JOIN        dbo.SOHD     hd WITH (NOLOCK) ON hd.SOID = c.DocuID
LEFT JOIN   dbo.EMEmp    emp WITH (NOLOCK) ON emp.EmpID = hd.EmpID
GROUP BY hd.EmpID, emp.EmpName
HAVING SUM(c.RemaQty) > 0
ORDER BY RemainingTon DESC;
```

### 6.3 Trace เต็ม get → use → เหลือ (ต่อคูปอง)

```sql
SELECT  src.DocuNo   AS SourceOrder,           -- GET: ออเดอร์ต้นทาง (104)
        CAST(src.DocuDate AS DATE) AS OrderDate,
        src.CustName,
        c.CouponNo, c.GoodName,
        c.GoodQty                AS CouponTon,
        (c.GoodQty - c.RemaQty)  AS RedeemedTon,
        c.RemaQty                AS RemainingTon,
        (c.GoodQty * c.GoodPrice) AS CouponBaht,
        rh.DocuNo    AS RedemptionNo,           -- USE: เอกสารตัดคูปอง (116)
        inv.DocuNo   AS AppliedInvoice,         -- ใบกำกับที่ใช้ (107)
        rd.GoodQty   AS RedeemedOnThisInvoice
FROM        dbo.WFCoupon      c   WITH (NOLOCK)
JOIN        dbo.SOHD          src WITH (NOLOCK) ON src.SOID = c.DocuID
LEFT JOIN   dbo.WFRedemtionDT rd  WITH (NOLOCK) ON rd.CouponID = c.CouponID
LEFT JOIN   dbo.WFRedemtionHD rh  WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
LEFT JOIN   dbo.SOInvHD       inv WITH (NOLOCK) ON inv.SOInvID = rd.SOInvID
-- WHERE c.DocuID = 213994    -- ระบุออเดอร์ที่ต้องการ; ตัดออกเพื่อดูทั้งหมด
ORDER BY c.CouponID, rd.RedemtionID;
```

### 6.4 View ที่แนะนำให้สร้างใน `wf`

```sql
CREATE VIEW wf.v_CouponBalance AS
SELECT  c.CouponID, c.CouponNo, c.DocuID AS SourceSOID,
        src.DocuNo AS SourceOrder, src.CustID, src.CustName, src.EmpID,
        c.GoodID, c.GoodName, c.GoodQty AS IssuedTon,
        (c.GoodQty - c.RemaQty) AS RedeemedTon, c.RemaQty AS RemainingTon,
        c.GoodPrice, (c.RemaQty * c.GoodPrice) AS RemainingBaht
FROM        dbo.WFCoupon c
JOIN        dbo.SOHD     src ON src.SOID = c.DocuID;
```

---

## 7. (ค) ออกแบบการเชื่อม dbo coupon ↔ wf engine

### 7.1 สภาพปัจจุบัน (ช่องว่าง)

- WINSpeed มีคูปอง (dbo, **ตัน**) ที่ผูกออเดอร์ครบ — แต่ App ไม่รู้จัก
- App มี `wf.Rebate*` (**บาท**) ที่ earn จาก price − net — แต่ไม่ได้ดึงจากคูปอง dbo
- ผลคือ Dashboard (เช่น 3,060,000฿) เป็น test/seed ของ App ไม่ตรงกับคูปองจริง
- มี code เตรียมไว้แล้ว: `/rebate/wf-trail-*` (อ่าน dbo), `RebateClaim.CnDocuNo` (จุดเชื่อมกลับ), `migrate-legacy` (แปลงตัน→บาท)

### 7.2 หลักการออกแบบ

1. **dbo = source of truth READ-ONLY** — ห้ามเขียน dbo; sync ทางเดียว dbo → wf
2. **หน่วย:** เก็บทั้งตัน (ตาม dbo) และบาท (ตัน × GoodPrice) เพื่อ reconcile ได้
3. **ผูกด้วย key ธรรมชาติ:** `WFCoupon.CouponID` (คงที่), `WFCoupon.DocuID`=ออเดอร์ต้นทาง, `WFRedemtionDT.SOInvID`=ใบที่ใช้

### 7.3 ตาราง mirror ที่เสนอ (ใน wf)

```sql
-- กระจก (mirror) ของคูปอง dbo — sync ทางเดียว
CREATE TABLE wf.CouponMirror (
  CouponID      INT           NOT NULL PRIMARY KEY,   -- = dbo.WFCoupon.CouponID
  CouponNo      NVARCHAR(30)  NULL,
  SourceSOID    INT           NOT NULL,               -- = dbo.WFCoupon.DocuID (SOHD 104)
  SourceDocuNo  NVARCHAR(25)  NULL,
  CustId        NVARCHAR(20)  NULL,
  SalesEmpId    INT           NULL,
  GoodId        INT           NULL,
  IssuedTon     DECIMAL(18,3) NOT NULL,
  RemainingTon  DECIMAL(18,3) NOT NULL,
  GoodPrice     DECIMAL(18,2) NULL,
  LastSyncAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

-- กระจกของการตัดใช้
CREATE TABLE wf.CouponRedemptionMirror (
  RedemtionID   INT           NOT NULL,
  CouponID      INT           NOT NULL,
  AppliedSOInvID INT          NULL,                   -- = dbo.WFRedemtionDT.SOInvID (107)
  AppliedInvoiceNo NVARCHAR(25) NULL,
  RedeemedTon   DECIMAL(18,3) NOT NULL,
  RedeemedAt    DATETIME2     NULL,
  CONSTRAINT PK_CRM PRIMARY KEY (RedemtionID, CouponID)
);
```

### 7.4 Sync job (แนวคิด)

```sql
-- upsert คูปองที่มีการเปลี่ยนแปลง (รันเป็นรอบ เช่น ทุก 15 นาที หรือ event SO_SHIPPED)
MERGE wf.CouponMirror AS tgt
USING (
  SELECT c.CouponID, c.CouponNo, c.DocuID AS SourceSOID, src.DocuNo AS SourceDocuNo,
         src.CustID, src.EmpID AS SalesEmpId, c.GoodID,
         c.GoodQty AS IssuedTon, c.RemaQty AS RemainingTon, c.GoodPrice
  FROM dbo.WFCoupon c WITH (NOLOCK)
  JOIN dbo.SOHD src   WITH (NOLOCK) ON src.SOID = c.DocuID
) AS s ON tgt.CouponID = s.CouponID
WHEN MATCHED AND (tgt.RemainingTon <> s.RemainingTon) THEN
  UPDATE SET tgt.RemainingTon = s.RemainingTon, tgt.LastSyncAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (CouponID, CouponNo, SourceSOID, SourceDocuNo, CustId, SalesEmpId, GoodId, IssuedTon, RemainingTon, GoodPrice)
  VALUES (s.CouponID, s.CouponNo, s.SourceSOID, s.SourceDocuNo, s.CustID, s.SalesEmpId, s.GoodID, s.IssuedTon, s.RemainingTon, s.GoodPrice);
```

### 7.5 การ map พนักงานขาย & reconcile

- `dbo.SOHD.EmpID` (WINSpeed) ↔ `wf.AppUser.EmpId` — ใช้ map เข้าเจ้าของ pool (มีอยู่แล้วใน `migrate-legacy`)
- **Reconcile รายเดือน:** เทียบ `SUM(wf.CouponMirror.RemainingTon × GoodPrice)` กับ `wf.RebatePool` เพื่อจับส่วนต่าง
- ตั้ง **Rebate เป็น read model จาก dbo** (คูปองเป็นความจริง) แล้วให้ App แสดง/แจ้งเตือน แทนการสะสมเองใน `wf.RebatePool` (ลดโอกาสตัวเลขไม่ตรง)

### 7.6 การใช้งานจริง (Implemented in V1.0)

ใน V1.0 เราได้ดำเนินการสร้าง `wf.CouponMirror` และกำหนด Endpoint POST `/api/rebate/sync-mirror` เพื่อให้เกิดการ Sync จาก `dbo` มายัง `wf` เรียบร้อยแล้ว 

เมื่อต้องการดึงยอดสะสมของคูปอง (Dashboard) ระบบจะใช้ข้อมูลจาก `wf.CouponMirror` โดยตรง ซึ่งรับประกันว่าข้อมูลจะถูกต้องตามใบกำกับภาษีใน WINSpeed (Source of Truth) ทุกประการ

> [!NOTE] 
> ส่วนของ `wf.RebatePool` ที่เป็นหน่วยบาท จะถูกใช้เพื่อเป็นตัวอ้างอิงและสอบทานย้อนกลับ (Reconciliation) เท่านั้น

| ทางเลือก | ข้อดี | ข้อเสีย |
|---------|------|---------|
| A. Read-through (query dbo ตรง) | ไม่ต้อง sync, ตรงเสมอ | โหลด dbo ทุกครั้ง, join หนัก |
| B. Mirror + sync job (แนะนำ) | เร็ว, มี history, reconcile ได้ | ต้องมี job + จัดการ lag |
| C. เขียนกลับ dbo | รวมศูนย์ | ❌ ผิดกติกา dbo READ-ONLY |

> **ข้อเสนอ:** ใช้ B (mirror) + แสดง Dashboard จาก mirror; คง `wf.RebatePool` ไว้เฉพาะ flow บาทของ App (price−net) และทำ reconcile report เทียบกับคูปอง dbo

---

## ภาคผนวก A — DocuType อ้างอิง (rebate/coupon ที่เกี่ยวข้อง)

| DocuType | ความหมาย | ตาราง |
|----------|----------|-------|
| 103 | ใบจอง (booking) | SOHD |
| 104 | ออเดอร์ต้นทาง (สร้างคูปอง) | SOHD |
| 107 | ใบกำกับที่ใช้คูปอง | SOInvHD |
| 116 | เอกสาร redemption | WFRedemtionHD |
| 106 | RBT credit note (คืนเงิน, ไม่ผูก) | SOInvHD |
| 109 | CN rebate (คืนเงิน, ผูก RefSOID) | SOInvHD |
| 202 | cash flow | SOInvHD |

## ภาคผนวก B — สรุปข้อค้นพบเชิงปริมาณ (ณ 21 ก.ค. 2569)

- WFCoupon: 111,192 ใบ · WFRedemtionDT: 291,068 แถว · คงเหลือ (RemaQty>0): 10 ใบ
- คูปองคงเหลือรายลูกค้า (ตัวอย่าง): น้ำตาลสุรินทร์ 507 ตัน (~9.08M฿), อุตสาหกรรมโคราช 397.5 ตัน (~6.97M฿)
- คูปองคงเหลือรายเซล (ตัวอย่าง): จักรพงษ์ 904.5 ตัน, ชูชาติ 227.5 ตัน
- RBT (106): 953 ใบ, 22.85M฿ (2015–2026); CN (109): 87 ใบ (2013–2014 เป็นหลัก)
- wf engine: pool test = 3,060,000฿ (SalesUserId 62), RebateUsage ว่าง (ยังไม่ใช้จริง)
