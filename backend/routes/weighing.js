/**
 * routes/weighing.js — สถานะการชั่งรถ อ่านจาก WINSpeed โดยตรง (อ่านอย่างเดียว 100%)
 *
 * ══ กติกาเหล็กของไฟล์นี้ ═══════════════════════════════════════════
 *   ห้ามเขียนลง dbo.WGHD / dbo.WGDT / dbo.WGDTReport เด็ดขาด
 *   เครื่องชั่งเป็นผู้เขียนสามตารางนี้เอง เราอ่านมาแสดงสถานะเท่านั้น
 *   (เจ้าของระบบสั่งไว้ 03/09/2569 — MySQL ของ TruckScale ยกเลิกทั้งหมดแล้ว)
 * ═══════════════════════════════════════════════════════════════════
 *
 * ── พจนานุกรมข้อมูล (เจ้าของระบบให้ไว้ 03/09/2569 · ตรวจกับฐานจริงแล้วทุกข้อ) ──
 *
 *   WGType     ประเภทการชั่ง
 *              `SO` ขายออก  → ผูก `dbo.SOHD` / `dbo.SODT`
 *              `PO` ซื้อเข้า → ผูก `dbo.POHD` / `dbo.PODT`
 *              `MO` เคลื่อนย้ายภายใน (movebill) เช่น ผลิต ↔ คลังสินค้า
 *
 *   SPID       ID ของเอกสารต้นทางในตารางตามชนิด — SO ใช้ `SOHD.SOID` · PO ใช้ `POHD.POID`
 *              ✅ ตรวจแล้ว SO 141/141 = 100% และชี้ที่ **ใบสั่งจอง (DocuType 103)** เสมอ
 *              ⚠ นี่คือจุดเชื่อมที่ถูกต้อง — `WGHD.DocuNo` ตรงกับ SOHD เพียง 117/141
 *                 จึงห้ามใช้ `DocuNo` เป็นตัวเชื่อม
 *
 *   CVID/CVCode/CVName   ลูกค้า (Customer) เมื่อ SO · ผู้ขาย (Vendor) เมื่อ PO
 *              WGHD เก็บ Code กับ Name ไว้ในตัวแล้ว จึงไม่ต้อง join ตารางลูกค้า/ผู้ขาย
 *
 *   CarNo      ทะเบียนรถ          EMDriverId → `dbo.EMDriver.Id` (คนขับ)
 *   MoveBill   running number ปกติขึ้นต้นด้วยปี พ.ศ. สองหลัก (เช่น 69…)
 *   STOCode    รหัสคลัง → `dbo.EMSTOType` (16 คลัง: สายพาน คลัง โกดัง ท่าน้ำ ห้องกระสอบ เทกอง)
 *   CouponNo   เลขตั๋วคุมที่ถูกตัดในเที่ยวนี้ (ถ้ามี)
 *
 *   Status     1 = รถลงทะเบียน รอเข้าชั่ง
 *              2 = ชั่งเข้าแล้ว → มี `WeightIn`
 *              3 = ชั่งออกแล้ว → มี `WeightOut`  ⇒ SO ถือว่าปิด (SHIPPED)
 *
 *   ⚠ ทิศทางน้ำหนักสุทธิ **ขึ้นกับ WGType** — เจ้าของอธิบายฝั่ง SO ไว้ ฝั่ง PO กลับด้าน
 *
 *     SO ขายออก : รถเข้ามาเปล่า ออกไปหนัก  ⇒ Net = WeightOut − WeightIn
 *     PO ซื้อเข้า: รถเข้ามาหนัก ออกไปเปล่า  ⇒ Net = WeightIn − WeightOut
 *
 *     ตรวจจากข้อมูลจริง (15 แถวที่มีครบสามค่า):
 *       SO 10/11 ตรงกับ out−in · PO แถวเดียวที่มีส่วนต่างจริง (Id 64) ตรงกับ in−out
 *     จึง **แสดงค่า `WeightNet` ที่เก็บไว้เสมอ** ไม่คำนวณทับ
 *     แล้วใช้สูตรตามทิศทางเป็นตัวตรวจสอบใน `/anomalies` แทน
 *
 *   หน่วย      น้ำหนักในตารางเป็น **กิโลกรัม** · Ton = ตัน · Kasob = กระสอบ
 *              1 กระสอบ = 50 กก. จึงแปลงกลับไปมาได้เสมอ
 *
 * ── ข้อควรระวังเรื่องข้อมูลวันนี้ ──────────────────────────────────
 *   เจ้าของระบบยืนยันว่าข้อมูลในสามตารางนี้ **ยังเป็นชุดทดสอบ เชื่อถือไม่ได้**
 *   ที่เห็นจริงตอนตรวจ: SO สถานะ 1=124 · 2=6 · 3=11 · PO 1=28 · 3=4 · MO 1=4
 *   บางแถวมี WeightOut < WeightIn ทำให้ WeightNet ติดลบ — โค้ดจึงต้องไม่ถือว่า
 *   ค่าลบเป็นไปไม่ได้ แต่ต้องชี้ให้เห็นว่าผิดปกติ (ดู `/live` และ `/anomalies`)
 */
const router = require('express').Router();
const { sql, query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireRole('ACCOUNTING', 'MANAGER', 'ADMIN', 'C_LEVEL', 'WAREHOUSE', 'WEIGHBRIDGE'));

const LIMIT = 500;
const KG_PER_SACK = 50;

/** ป้ายสถานะที่ใช้ทั้งฝั่ง SQL และฝั่งหน้าจอ — เก็บที่เดียวกันไว้ */
const STATUS_SQL = `CASE h.Status
    WHEN 1 THEN N'รอเข้าชั่ง'
    WHEN 2 THEN N'ชั่งเข้าแล้ว'
    WHEN 3 THEN N'ชั่งออกแล้ว'
    ELSE N'ไม่ทราบสถานะ' END`;

/** ช่วงวันที่: ไม่ส่งมา = ย้อนหลัง 30 วัน */
function range(req) {
  const today = new Date();
  const back = new Date(today.getTime() - 30 * 86400000);
  const iso = d => d.toISOString().slice(0, 10);
  return { from: String(req.query.from || iso(back)), to: String(req.query.to || iso(today)) };
}

async function run(req, text, extra = {}) {
  const { from, to } = range(req);
  const inputs = { from: { type: sql.Date, value: from }, to: { type: sql.Date, value: to } };
  for (const [k, v] of Object.entries(extra)) inputs[k] = { type: sql.NVarChar(100), value: v };
  return { rows: await query(text, inputs), from, to };
}

const send = (res, r) => res.json({ rows: r.rows, count: r.rows.length, from: r.from, to: r.to });
const guard = fn => (req, res) => fn(req, res).catch(e => res.status(e.status || 500).json({ message: e.message }));

/** WGType ที่ขอมา — ไม่ส่ง = ทุกชนิด · ส่งค่าที่ไม่รู้จัก = ปฏิเสธ ไม่เดาให้ */
function wgTypeFilter(req) {
  const t = String(req.query.type || '').toUpperCase();
  if (!t) return { clause: '', value: null };
  if (!['SO', 'PO', 'MO'].includes(t)) {
    throw Object.assign(new Error('type ต้องเป็น SO, PO หรือ MO'), { status: 400 });
  }
  return { clause: ' AND h.WGType = @wgtype', value: t };
}

// ── สถานะสด — หัวใจของหน้าจอ ────────────────────────────────────
/**
 * GET /api/weighing/live
 *
 * คิวรถ ณ ตอนนี้ พร้อมสถานะของใบสั่งขายที่ผูกอยู่ — หน้าจอเรียกซ้ำทุกนาที
 *
 * ทำไมค่า default ถึงเป็น "ยังไม่ปิด" ไม่ใช่ "วันนี้"
 *   รถที่ลงทะเบียนเมื่อวานแล้วยังชั่งไม่จบ ต้องยังอยู่ในคิววันนี้
 *   ถ้ากรองด้วยวันที่ รถกลุ่มนี้จะหายไปเงียบ ๆ ซึ่งอันตรายกว่าการแสดงเกิน
 *   จึงคืน "ทุกคันที่ยังไม่ถึงสถานะ 3" เสมอ บวกกับที่ชั่งออกแล้วในช่วง `sinceHours`
 */
router.get('/live', guard(async (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.sinceHours) || 24, 1), 720);
  const { clause, value } = wgTypeFilter(req);
  const inputs = { hours: { type: sql.Int, value: hours } };
  if (value) inputs.wgtype = { type: sql.VarChar(10), value };

  const rows = await query(`
    SELECT TOP ${LIMIT}
           h.Id, h.WGType, h.Status,
           ${STATUS_SQL} AS StatusText,
           h.MoveBill, h.CarNo AS Plate, RTRIM(dr.FullName) AS DriverName,
           h.CVCode, RTRIM(h.CVName) AS PartyName,
           CONVERT(varchar(16), h.DateReg, 120) AS DateReg,
           CONVERT(varchar(16), h.DateIn,  120) AS DateIn,
           CONVERT(varchar(16), h.DateOut, 120) AS DateOut,
           h.WeightIn, h.WeightOut, h.WeightNet,
           h.TotalTon, h.TotalKasob,
           h.SPID,
           so.DocuNo AS SODocuNo, so.DocuType AS SODocuType,
           CONVERT(varchar(10), so.DocuDate, 120) AS SODate,
           so.AppvDocuNo, so.CouponFlag, so.clearflag,
           /* สถานะของใบสั่งขายที่เราอนุมานจากการชั่ง — ไม่ได้เขียนกลับไปไหน */
           CASE WHEN h.WGType <> 'SO' THEN NULL
                WHEN h.Status = 3 THEN 'SHIPPED'
                WHEN h.Status = 2 THEN 'LOADING'
                ELSE 'WAITING' END AS SoStage,
           (SELECT COUNT(*) FROM dbo.WGDT d WHERE d.WGHDId = h.Id) AS Lines,
           (SELECT COUNT(*) FROM dbo.WGDT d
             WHERE d.WGHDId = h.Id AND NULLIF(RTRIM(d.CouponNo), '') IS NOT NULL) AS CouponLines
      FROM dbo.WGHD h
      LEFT JOIN dbo.EMDriver dr ON dr.Id = h.EMDriverId
      LEFT JOIN dbo.SOHD    so ON so.SOID = h.SPID AND h.WGType = 'SO'
     WHERE (h.Status < 3 OR h.DateOut >= DATEADD(hour, -@hours, GETDATE()))${clause}
     ORDER BY h.Status, h.DateReg DESC, h.Id DESC`, inputs);

  // นับแยกตามสถานะ ให้หน้าจอทำแถบสรุปได้โดยไม่ต้องยิงซ้ำ
  // ⚠ WGHD.Status กลับมาเป็น "สตริง" จาก driver (คอลัมน์เป็น char) ห้ามเทียบด้วย ===
  //   เคยพลาดมาแล้ว: ตัวนับขึ้น unknown ทั้ง 166 แถวทั้งที่ข้อมูลถูกต้อง
  const tally = { waiting: 0, weighedIn: 0, weighedOut: 0, unknown: 0 };
  for (const r of rows) {
    switch (Number(r.Status)) {
      case 1: tally.waiting++; break;
      case 2: tally.weighedIn++; break;
      case 3: tally.weighedOut++; break;
      default: tally.unknown++;
    }
  }
  res.json({ rows, count: rows.length, tally, sinceHours: hours, serverTime: new Date().toISOString() });
}));

/**
 * GET /api/weighing/anomalies
 * แถวที่ตัวเลขขัดกันเอง — ต้องเห็นก่อนเอาไปใช้ตัดสินใจ
 */
router.get('/anomalies', guard(async (req, res) => {
  const rows = await query(`
    SELECT TOP ${LIMIT}
           h.Id, h.WGType, h.Status, h.MoveBill, h.CarNo AS Plate,
           CONVERT(varchar(16), h.DateReg, 120) AS DateReg,
           h.WeightIn, h.WeightOut, h.WeightNet, h.TotalTon, h.TotalKasob,
           CASE
             WHEN h.Status = 3 AND h.WeightNet IS NULL      THEN N'ชั่งออกแล้วแต่ไม่มีน้ำหนักสุทธิ'
             WHEN h.WeightNet < 0                            THEN N'น้ำหนักสุทธิติดลบ'
             WHEN h.Status = 3 AND h.WeightNet = 0           THEN N'ชั่งออกแล้วแต่น้ำหนักสุทธิเป็นศูนย์'
             WHEN h.Status = 2 AND h.WeightIn  IS NULL       THEN N'สถานะชั่งเข้าแต่ไม่มีน้ำหนักรถเปล่า'
             WHEN h.WeightNet IS NOT NULL AND h.WeightOut IS NOT NULL AND h.WeightIn IS NOT NULL
                  AND h.WeightNet <> CASE WHEN h.WGType = 'PO' THEN h.WeightIn - h.WeightOut
                                                               ELSE h.WeightOut - h.WeightIn END
                  THEN N'สุทธิไม่ตรงกับสูตรตามทิศทาง (SO: ออก−เข้า · PO: เข้า−ออก)'
             WHEN h.WGType = 'SO' AND h.SPID IS NOT NULL AND so.SOID IS NULL THEN N'SPID ไม่พบใบสั่งขาย'
             ELSE NULL END AS Issue
      FROM dbo.WGHD h
      LEFT JOIN dbo.SOHD so ON so.SOID = h.SPID AND h.WGType = 'SO'
     WHERE h.WeightNet < 0
        OR (h.Status = 3 AND (h.WeightNet IS NULL OR h.WeightNet = 0))
        OR (h.Status = 2 AND h.WeightIn IS NULL)
        OR (h.WeightNet IS NOT NULL AND h.WeightOut IS NOT NULL AND h.WeightIn IS NOT NULL
            AND h.WeightNet <> CASE WHEN h.WGType = 'PO' THEN h.WeightIn - h.WeightOut
                                                         ELSE h.WeightOut - h.WeightIn END)
        OR (h.WGType = 'SO' AND h.SPID IS NOT NULL AND so.SOID IS NULL)
     ORDER BY h.DateReg DESC, h.Id DESC`);
  res.json({ rows, count: rows.length });
}));

/** ความครบถ้วนของข้อมูล — หน้าจอเอาไปเตือนผู้ใช้ว่าเชื่อได้แค่ไหน */
router.get('/coverage', guard(async (req, res) => {
  const r = (await query(`
    SELECT COUNT(*) AS Registered,
           SUM(CASE WHEN Status = 1 THEN 1 ELSE 0 END) AS Waiting,
           SUM(CASE WHEN Status = 2 THEN 1 ELSE 0 END) AS WeighedIn,
           SUM(CASE WHEN Status = 3 THEN 1 ELSE 0 END) AS WeighedOut,
           SUM(CASE WHEN WGType = 'SO' THEN 1 ELSE 0 END) AS TypeSO,
           SUM(CASE WHEN WGType = 'PO' THEN 1 ELSE 0 END) AS TypePO,
           SUM(CASE WHEN WGType = 'MO' THEN 1 ELSE 0 END) AS TypeMO,
           SUM(CASE WHEN WeightNet IS NOT NULL AND WeightNet > 0 THEN 1 ELSE 0 END) AS WithNetWeight,
           CONVERT(varchar(16), MIN(DateReg), 120) AS FirstDate,
           CONVERT(varchar(16), MAX(DateReg), 120) AS LastDate,
           CONVERT(varchar(16), MAX(DateOut), 120) AS LastWeighOut,
           (SELECT COUNT(*) FROM dbo.WGDT) AS DetailRows,
           (SELECT COUNT(*) FROM dbo.WGDT WHERE NULLIF(RTRIM(CouponNo),'') IS NOT NULL) AS WithCoupon
      FROM dbo.WGHD`))[0];
  res.json(r);
}));

/** รายการใบชั่งตามช่วงวัน */
router.get('/tickets', guard(async (req, res) => {
  const { clause, value } = wgTypeFilter(req);
  const extra = value ? { wgtype: value } : {};
  send(res, await run(req, `
    SELECT TOP ${LIMIT}
           h.Id, CONVERT(varchar(16), h.DateReg, 120) AS DateReg,
           h.WGType, h.Status, ${STATUS_SQL} AS StatusText,
           h.CarNo AS Plate, RTRIM(dr.FullName) AS DriverName,
           h.MoveBill, h.SPID, so.DocuNo AS SODocuNo, so.DocuType AS SODocuType,
           h.CVCode, RTRIM(h.CVName) AS PartyName,
           CONVERT(varchar(16), h.DateIn, 120)  AS DateIn,  h.WeightIn,
           CONVERT(varchar(16), h.DateOut, 120) AS DateOut, h.WeightOut,
           h.WeightNet, h.TotalTon, h.TotalKasob,
           (SELECT COUNT(*) FROM dbo.WGDT d WHERE d.WGHDId = h.Id) AS Lines
      FROM dbo.WGHD h
      LEFT JOIN dbo.EMDriver dr ON dr.Id = h.EMDriverId
      LEFT JOIN dbo.SOHD    so ON so.SOID = h.SPID AND h.WGType = 'SO'
     WHERE CAST(h.DateReg AS date) BETWEEN @from AND @to${clause}
     ORDER BY h.DateReg DESC, h.Id DESC`, extra));
}));

/**
 * ใบชั่งของใบสั่งขายใบเดียว — ใช้ตอนคลังกดชั่งออกเพื่อดึงน้ำหนักมาเติมให้
 *
 * เดิมหน้าจอดึงจาก MySQL ของ TruckScale (`/api/truckscale/for-so/:id`)
 * ซึ่งถูกลบออกถาวรเมื่อ 04/09/2569 — ย้ายมาอ่าน dbo.WGHD ด้วย SPID
 * ซึ่งเป็นกุญแจที่ถูกต้องระหว่างใบชั่งกับใบสั่งขาย (ไม่ใช่ DocuNo)
 *
 * อ่านอย่างเดียว
 */
router.get('/for-so/:soid', guard(async (req, res) => {
  const soid = Number(req.params.soid);
  if (!Number.isInteger(soid)) return res.status(400).json({ message: 'soid ต้องเป็นตัวเลข' });
  const r = await query(`
    SELECT h.Id, h.MoveBill, h.CarNo AS Plate, h.WGType, h.Status, ${STATUS_SQL} AS StatusText,
           h.WeightIn, h.WeightOut, h.WeightNet, h.TotalTon, h.TotalKasob,
           CONVERT(varchar(16), h.DateIn, 120)  AS DateIn,
           CONVERT(varchar(16), h.DateOut, 120) AS DateOut,
           h.LocationName AS ScaleNo
      FROM dbo.WGHD h
     WHERE h.SPID = @soid
     ORDER BY h.Id DESC`, { soid: { type: sql.Int, value: soid } });
  res.json({ soid, candidates: r.recordset || [], count: (r.recordset || []).length });
}));

/** ใบเดียวพร้อมบรรทัดสินค้า — ใช้กับหน้าพิมพ์ */
router.get('/tickets/:id', guard(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id ต้องเป็นตัวเลข' });
  const idIn = { id: { type: sql.Int, value: id } };

  const head = (await query(`
    SELECT h.Id, h.WGType, h.Status, ${STATUS_SQL} AS StatusText,
           h.MoveBill, h.CarNo, RTRIM(dr.FullName) AS DriverName,
           h.CVCode, RTRIM(h.CVName) AS CVName, h.SPID, h.DocuNo,
           CONVERT(varchar(16), h.DateReg, 120) AS DateReg,
           CONVERT(varchar(16), h.DateIn,  120) AS DateInText,
           CONVERT(varchar(16), h.DateOut, 120) AS DateOutText,
           h.WeightIn, h.WeightOut, h.WeightNet, h.TotalTon, h.TotalKasob,
           so.DocuNo AS SODocuNo, so.DocuType AS SODocuType,
           CONVERT(varchar(10), so.DocuDate, 120) AS SODate,
           so.AppvDocuNo, so.CouponFlag, RTRIM(so.TransRegistration) AS SOPlate
      FROM dbo.WGHD h
      LEFT JOIN dbo.EMDriver dr ON dr.Id = h.EMDriverId
      LEFT JOIN dbo.SOHD    so ON so.SOID = h.SPID AND h.WGType = 'SO'
     WHERE h.Id = @id`, idIn))[0];
  if (!head) return res.status(404).json({ message: 'ไม่พบใบชั่ง' });

  const items = await query(`
    SELECT d.Id, d.ListNo, d.GoodID, RTRIM(d.GoodName) AS GoodName,
           d.GoodQty2, d.GoodTon, d.GoodKasob, d.GoodKG,
           RTRIM(d.STOCode) AS StoreCode, RTRIM(s.STOName) AS StoreName,
           RTRIM(d.STOCode2) AS StoreCode2, RTRIM(s2.STOName) AS StoreName2,
           NULLIF(RTRIM(d.CouponNo), '') AS CouponNo, d.RefNo
      FROM dbo.WGDT d
      LEFT JOIN dbo.EMSTOType s  ON RTRIM(s.STOCode)  = RTRIM(d.STOCode)
      LEFT JOIN dbo.EMSTOType s2 ON RTRIM(s2.STOCode) = RTRIM(d.STOCode2)
     WHERE d.WGHDId = @id ORDER BY d.ListNo`, idIn);

  const ton = items.reduce((s, i) => s + Number(i.GoodTon || 0), 0);
  const kasob = items.reduce((s, i) => s + Number(i.GoodKasob || 0), 0);
  res.json({
    ...head, items,
    totals: { ton, kasob, kgFromSacks: kasob * KG_PER_SACK },
  });
}));

/** สรุปตามวัน */
router.get('/by-date', guard(async (req, res) => send(res, await run(req, `
  SELECT TOP ${LIMIT}
         CONVERT(varchar(10), h.DateReg, 120) AS DateReg,
         COUNT(*) AS Registered,
         SUM(CASE WHEN h.Status = 3 THEN 1 ELSE 0 END) AS WeighedOut,
         SUM(CASE WHEN h.WeightNet > 0 THEN h.WeightNet ELSE 0 END) AS NetKg,
         SUM(ISNULL(h.TotalTon, 0))   AS Tons,
         SUM(ISNULL(h.TotalKasob, 0)) AS Kasob
    FROM dbo.WGHD h
   WHERE CAST(h.DateReg AS date) BETWEEN @from AND @to
   GROUP BY CONVERT(varchar(10), h.DateReg, 120)
   ORDER BY DateReg DESC`))));

/** สรุปตามสินค้า */
router.get('/by-product', guard(async (req, res) => send(res, await run(req, `
  SELECT TOP ${LIMIT}
         d.GoodID, RTRIM(d.GoodName) AS GoodName,
         COUNT(DISTINCT h.Id) AS Trips,
         SUM(ISNULL(d.GoodTon, 0))   AS Tons,
         SUM(ISNULL(d.GoodKasob, 0)) AS Kasob
    FROM dbo.WGDT d
    JOIN dbo.WGHD h ON h.Id = d.WGHDId
   WHERE CAST(h.DateReg AS date) BETWEEN @from AND @to
   GROUP BY d.GoodID, RTRIM(d.GoodName)
   ORDER BY Tons DESC`))));

/** สรุปตามคลัง — ชื่อคลังจาก EMSTOType (16 คลัง) */
router.get('/by-godown', guard(async (req, res) => send(res, await run(req, `
  SELECT TOP ${LIMIT}
         RTRIM(d.STOCode) AS StoreCode,
         RTRIM(ISNULL(s.STOName, d.STOCode)) AS StoreName,
         COUNT(DISTINCT h.Id) AS Trips,
         SUM(ISNULL(d.GoodTon, 0))   AS Tons,
         SUM(ISNULL(d.GoodKasob, 0)) AS Kasob
    FROM dbo.WGDT d
    JOIN dbo.WGHD h ON h.Id = d.WGHDId
    LEFT JOIN dbo.EMSTOType s ON RTRIM(s.STOCode) = RTRIM(d.STOCode)
   WHERE CAST(h.DateReg AS date) BETWEEN @from AND @to
   GROUP BY RTRIM(d.STOCode), RTRIM(ISNULL(s.STOName, d.STOCode))
   ORDER BY Tons DESC`))));

/** สรุปตามลูกค้า/ผู้ขาย */
router.get('/by-customer', guard(async (req, res) => send(res, await run(req, `
  SELECT TOP ${LIMIT}
         h.WGType, h.CVCode, RTRIM(h.CVName) AS PartyName,
         COUNT(*) AS Trips,
         SUM(CASE WHEN h.Status = 3 THEN 1 ELSE 0 END) AS WeighedOut,
         SUM(ISNULL(h.TotalTon, 0)) AS Tons
    FROM dbo.WGHD h
   WHERE CAST(h.DateReg AS date) BETWEEN @from AND @to
   GROUP BY h.WGType, h.CVCode, RTRIM(h.CVName)
   ORDER BY Tons DESC`))));

/**
 * ใบชั่งที่ผูกกับใบสั่งขาย — เชื่อมด้วย `SPID` เท่านั้น
 *
 * `SPID` ชี้ที่ **ใบสั่งจอง (DocuType 103)** เสมอ (141/141 ในข้อมูลที่ตรวจ)
 * ใบส่งขาย (104) ใช้เลขที่เดียวกับใบสั่งจอง จึงดึงต่อได้ด้วย `DocuNo` + `DocuType = 104`
 * ทำเป็น subquery แยก ไม่ join ตรง เพราะ `DocuNo` ไม่ unique ข้าม `DocuType`
 */
router.get('/by-so', guard(async (req, res) => send(res, await run(req, `
  SELECT TOP ${LIMIT}
         h.Id AS WeighId, CONVERT(varchar(16), h.DateReg, 120) AS DateReg,
         h.Status, ${STATUS_SQL} AS StatusText,
         h.MoveBill, h.CarNo AS Plate, RTRIM(h.CVName) AS CustName,
         h.WeightIn, h.WeightOut, h.WeightNet, h.TotalTon, h.TotalKasob,
         h.SPID,
         bk.DocuNo AS BookingNo, CONVERT(varchar(10), bk.DocuDate, 120) AS BookingDate,
         bk.AppvDocuNo, bk.CouponFlag,
         (SELECT TOP 1 dn.DocuNo FROM dbo.SOHD dn
           WHERE dn.DocuType = 104 AND dn.DocuNo = bk.DocuNo) AS DeliveryNoteNo
    FROM dbo.WGHD h
    LEFT JOIN dbo.SOHD bk ON bk.SOID = h.SPID AND bk.DocuType = 103
   WHERE h.WGType = 'SO' AND CAST(h.DateReg AS date) BETWEEN @from AND @to
   ORDER BY h.DateReg DESC, h.Id DESC`))));

module.exports = router;
