/**
 * e2e-sale-trip-flow.js — ทดสอบ Document Flow ทั้งเส้น (เฟส 6)
 *
 * ทำไมต้องเป็นสคริปต์ ไม่ใช่ตรวจมือ
 *   เส้นทางนี้พาดผ่าน 3 ระบบ (แอป · WINSpeed · เครื่องชั่ง) และ 5 สถานะ
 *   ตรวจมือครั้งเดียวพิสูจน์ได้แค่ว่า "วันนั้นมันเดินได้" ไม่ได้กันการถอยหลัง
 *   สคริปต์นี้รันซ้ำได้ทุกครั้งก่อน deploy และบอกชัดว่าขั้นไหนพัง
 *
 * ทดสอบอะไร
 *   1. เที่ยวว่าง                         → กระดานขึ้น "ยังไม่เข้าชั่ง"
 *   2. WGHD สถานะ 1                       → "รถลงทะเบียนแล้ว" · stage = REGISTERED
 *   3. ขอแก้ไขด้วยเหตุผลที่ต้อง Hold      → กระดานขึ้น Hold · บันทึกเจตนาไว้
 *   4. อนุมัติ                            → Hold หลุด · SalesOrderExt.IsUnlocked = 1
 *   5. WGHD สถานะ 2                       → "กำลังโหลดสินค้า" · ผังการจัดของเรียงตามลำดับ
 *   6. WGHD สถานะ 3                       → "ชั่งออกครบทุกใบ" · ปิดการขอแก้ไข (409)
 *   7. ล้างข้อมูลทดสอบคืนสภาพเดิม
 *
 * ⚠ รันบน local เท่านั้น — เขียน dbo.WGHD และ wf หลายตาราง
 *   ใช้ prefix E2E-FLOW ทุกที่ เพื่อไม่ให้ปนกับชุด SEED-TEST ที่มีอยู่แล้ว
 *
 * ใช้:  DB_MODE=local node scripts/e2e-sale-trip-flow.js
 *      DB_MODE=local node scripts/e2e-sale-trip-flow.js --keep   (ไม่ล้างท้าย)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { sql, query, wfQuery, dboWrite } = require('../db');

const API = process.env.E2E_API || 'http://localhost:3000/api';

// สคริปต์เซ็น JWT เองแทนการล็อกอิน จึงต้องใช้ secret ตัวเดียวกับ backend ที่จะคุยด้วย
// ยิงข้ามเครื่อง (เช่น เขียนฐาน PROD-B แล้วเรียก api.thirayu.online) ต้องตั้ง
// E2E_JWT_SECRET ให้ตรงกับของปลายทาง ไม่งั้น token จะโดนปฏิเสธ 401 ทุกครั้ง
// และอาการจะดูเหมือน "API มองไม่เห็นข้อมูล" ทั้งที่จริงคือยืนยันตัวตนไม่ผ่าน
//   PROD-B: ค่าอยู่ใน deploy/cloud-vps/.env บรรทัด JWT_SECRET
const SIGNING_SECRET = process.env.E2E_JWT_SECRET || process.env.JWT_SECRET;
const KEEP = process.argv.includes('--keep');
const PLATE = 'E2E-FLOW/0001';
const TRIP_CODE = 'E2E-FLOW-TRIP';

let pass = 0, fail = 0;
const results = [];

function check(step, ok, detail) {
  results.push({ step, ok, detail });
  if (ok) pass++; else fail++;
  console.log(`   ${ok ? 'ผ่าน' : 'ไม่ผ่าน'}  ${step}${detail ? '  — ' + detail : ''}`);
}

async function api(path, opts = {}, token) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json; charset=utf-8',
               Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* ว่างได้ */ }
  return { status: res.status, body };
}

/** สร้าง token ให้บัญชีทดสอบของเราเอง — ไม่แตะบัญชีพนักงาน */
async function tokenFor(username, role) {
  let u = (await wfQuery(`SELECT Id, Username, Role, DisplayName FROM wf.AppUser WHERE Username=@u`,
    { u: { type: sql.NVarChar(50), value: username } })).recordset[0];
  if (!u) {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(require('crypto').randomBytes(24).toString('base64url'), 12);
    await wfQuery(`INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, IsActive)
                   VALUES (@u,@h,@n,@r,1)`, {
      u: { type: sql.NVarChar(50), value: username },
      h: { type: sql.NVarChar(200), value: hash },
      n: { type: sql.NVarChar(100), value: 'E2E ' + role },
      r: { type: sql.NVarChar(30), value: role },
    });
    u = (await wfQuery(`SELECT Id, Username, Role, DisplayName FROM wf.AppUser WHERE Username=@u`,
      { u: { type: sql.NVarChar(50), value: username } })).recordset[0];
  }
  const id = Number(u.Id);
  return jwt.sign({ sub: id, id, username: u.Username, role: u.Role, displayName: u.DisplayName,
    actorSub: id, actorId: id, actorUsername: u.Username, actorRole: u.Role,
    impersonating: false, mustChangePassword: false }, SIGNING_SECRET, { expiresIn: '1h' });
}

async function cleanup(silent) {
  // ลบลูกก่อนแม่เสมอ — WGDTReport → WGDT → WGHD
  // ทุกคำสั่งผูกกับ CarNo ของรถทดสอบเท่านั้น จะไม่แตะใบชั่งจริงของโรงงาน
  await dboWrite(`DELETE FROM dbo.WGDTReport WHERE WGHDId IN (SELECT Id FROM dbo.WGHD WHERE CarNo=@p)`,
    { p: { type: sql.VarChar(50), value: PLATE } });
  await dboWrite(`DELETE FROM dbo.WGDT WHERE WGHDId IN (SELECT Id FROM dbo.WGHD WHERE CarNo=@p)`,
    { p: { type: sql.VarChar(50), value: PLATE } });
  await dboWrite(`DELETE FROM dbo.WGHD WHERE CarNo=@p`, { p: { type: sql.VarChar(50), value: PLATE } });

  const t = (await wfQuery(`SELECT TripId FROM wf.SalesTrip WHERE TripCode=@c`,
    { c: { type: sql.VarChar(50), value: TRIP_CODE } })).recordset[0];
  if (t) {
    const tripId = Number(t.TripId);
    // ⚠ ลบ TruckHoldLog ก่อน EditRequest เสมอ
    //   FK_TruckHoldLog_EditRequest ชี้จาก log มาที่คำขอ ลบสลับลำดับจะติด constraint
    //   (FK นี้ถูกต้องแล้ว — ประวัติการแตะ dbo.SOHD ไม่ควรหายไปพร้อมคำขอในระบบจริง)
    await wfQuery(`DELETE FROM wf.TruckHoldLog WHERE EditRequestId IN
                     (SELECT Id FROM wf.EditRequest WHERE TripId=${tripId})`);
    await wfQuery(`DELETE FROM wf.EditRequest WHERE TripId=${tripId}`);
    await wfQuery(`DELETE FROM wf.SalesOrderLineExt WHERE SOID IN
                     (SELECT SOID FROM wf.SalesOrderExt WHERE TripId=${tripId}
                        AND TruckRemark=N'E2E-FLOW')`);
    await wfQuery(`DELETE FROM wf.SalesOrderExt WHERE TripId=${tripId} AND TruckRemark=N'E2E-FLOW'`);
    await wfQuery(`UPDATE wf.SalesOrderExt SET TripId=NULL WHERE TripId=${tripId}`);
    await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId=${tripId}`);
  }
  if (!silent) console.log('   ล้างข้อมูลทดสอบแล้ว');
}

(async () => {
  const env = (await wfQuery('SELECT DB_NAME() d, @@SERVERNAME s')).recordset[0];
  const mode = String(process.env.DB_MODE || '').toLowerCase();

  // สคริปต์นี้เขียนข้อมูลลง dbo.WGHD / WGDT / WGDTReport ของจริง
  // ค่าเริ่มต้นจึงยังเป็น local เท่านั้น การรันบนฐาน production ต้องตั้งใจสองชั้น:
  // ตั้ง DB_MODE ให้ตรงปลายทาง **และ** ส่ง --yes-write-production มาด้วย
  // (เจ้าของระบบอนุญาตให้ทดสอบบน production เหมือน UAT เมื่อ 5 ก.ย. 2569)
  if (mode !== 'local' && !process.argv.includes('--yes-write-production')) {
    console.error(`หยุด: DB_MODE=${mode || '(ไม่ได้ตั้ง)'} ไม่ใช่ local`);
    console.error(`      ฐานที่จะถูกเขียนคือ ${env.d} @ ${env.s}`);
    console.error('      ถ้าตั้งใจจริง ให้เพิ่ม --yes-write-production');
    process.exit(1);
  }
  if (mode !== 'local') {
    console.log(`⚠  กำลังเขียนข้อมูลทดสอบลงฐาน ${mode.toUpperCase()} — ${env.d} @ ${env.s}`);
    console.log(`   ทุกแถวถูกกำกับด้วย CarNo='${PLATE}' และ UpdateBy='E2E-FLOW' เพื่อให้ล้างคืนได้ครบ\n`);
  }
  console.log(`ฐาน: ${env.d} @ ${env.s}\nAPI : ${API}\n`);

  await cleanup(true);   // เผื่อรอบก่อนค้าง

  const sales = await tokenFor('e2e_flow_sales', 'SALES');
  const admin = await tokenFor('e2e_flow_admin', 'ADMIN');

  // ── เตรียม: หา SO จริงที่ยังไม่ถูกใช้ในเที่ยวอื่น ────────────
  const so = (await wfQuery(`
    SELECT TOP 1 s.SOID, RTRIM(s.DocuNo) AS DocuNo, s.CustID
    FROM dbo.SOHD s
    WHERE s.DocuType=103 AND s.SOID NOT IN (SELECT ISNULL(TRY_CAST(SOID AS INT),0) FROM wf.SalesOrderExt)
      AND EXISTS (SELECT 1 FROM dbo.SODT d WHERE d.SOID=s.SOID AND d.DocuType=103)
    ORDER BY s.SOID DESC`)).recordset[0];
  if (!so) { console.error('ไม่พบใบสั่งขายที่ว่างสำหรับทดสอบ'); process.exit(1); }
  const SOID = Number(so.SOID);
  console.log(`ใช้ใบสั่งขาย SOID=${SOID} (${so.DocuNo})\n`);

  const adminId = jwt.decode(admin).sub;

  // สร้างเที่ยว + ผูกใบจอง
  const trip = (await wfQuery(`
    INSERT INTO wf.SalesTrip (TripCode, TransRegistration, DriverName, TruckCapacityTon,
                              TolerancePct, PreSlingRequired, TripRemark, Status, CreatedBy)
    OUTPUT inserted.TripId
    VALUES (@c, @p, N'E2E คนขับ', 50, 5, 0, N'เที่ยวทดสอบ E2E', 'PLANNED', @by)`, {
      c: { type: sql.VarChar(50), value: TRIP_CODE },
      p: { type: sql.VarChar(50), value: PLATE },
      by: { type: sql.Int, value: Number(adminId) },
    })).recordset[0].TripId;

  await wfQuery(`INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix, TripId, SalesUserId, EnteredByUserId, TruckRemark)
                 VALUES (@s, @r, @pf, @t, @by, @by, N'E2E-FLOW')`, {
    s: { type: sql.VarChar(50), value: String(SOID) },
    r: { type: sql.NVarChar(60), value: so.DocuNo },
    pf: { type: sql.NVarChar(10), value: String(so.DocuNo).charAt(0) || 'I' },
    t: { type: sql.Int, value: Number(trip) },
    by: { type: sql.Int, value: Number(adminId) },
  });
  // ลำดับขึ้นของบรรทัดแรก เพื่อให้ผังการจัดของมีอะไรให้เรียง
  await wfQuery(`INSERT INTO wf.SalesOrderLineExt (SOID, ListNo, LoadSequence)
                 SELECT TOP 1 @s, ListNo, 1 FROM dbo.SODT WHERE SOID=@i AND DocuType=103 ORDER BY ListNo`, {
    s: { type: sql.VarChar(50), value: String(SOID) },
    i: { type: sql.Int, value: SOID },
  });

  // ── ใบชั่งรายรายการ ────────────────────────────────────────────
  // ทิศทางน้ำหนักของการ "ขายออก": รถเข้ามาเปล่า ออกไปหนัก
  //   WeightIn  = รถเปล่า            15,000 กก.
  //   WeightOut = รถ + สินค้า        25,000 กก.
  //   WeightNet = ออก - เข้า         10,000 กก. = 10 ตัน = 200 กระสอบ (1 กระสอบ 50 กก.)
  // ถ้าเป็นการซื้อเข้า (PO) ทิศทางกลับกัน — สคริปต์นี้จำลองเฉพาะขาขาย
  const NET_KG = 10000, SACK_KG = 50;

  const wghdId = async () => (await query(
    `SELECT TOP 1 Id FROM dbo.WGHD WHERE CarNo=@p ORDER BY Id DESC`,
    { p: { type: sql.VarChar(50), value: PLATE } }))[0].Id;

  // รายการสินค้าบนรถ — คัดมาจากบรรทัดจริงของใบสั่งขาย
  const fillWgdt = async () => {
    const id = await wghdId();
    const has = (await query(`SELECT COUNT(*) n FROM dbo.WGDT WHERE WGHDId=@i`,
      { i: { type: sql.Int, value: Number(id) } }))[0].n;
    if (Number(has) > 0) return id;
    await dboWrite(`
      INSERT INTO dbo.WGDT (WGHDId, SPID, ListNo, GoodID, GoodName, GoodQty2,
                            GoodTon, GoodKasob, GoodKG, RefNo)
      SELECT TOP 1 @i, @s, d.ListNo, d.GoodID,
             (SELECT TOP 1 GoodName1 FROM dbo.EMGood g WHERE g.GoodID=d.GoodID),
             d.GoodQty2, @ton, @sack, @kg, @ref
      FROM dbo.SODT d WHERE d.SOID=@s AND d.DocuType=103 ORDER BY d.ListNo`, {
        i: { type: sql.Int, value: Number(id) },
        s: { type: sql.Int, value: SOID },
        ton: { type: sql.Decimal(18, 4), value: NET_KG / 1000 },
        sack: { type: sql.Decimal(18, 4), value: NET_KG / SACK_KG },
        kg: { type: sql.Decimal(18, 4), value: NET_KG },
        ref: { type: sql.NVarChar(50), value: 'E2E-FLOW' },
      });
    return id;
  };

  // สรุปสำหรับรายงาน — WINSpeed อ่านตารางนี้ ไม่ได้ join WGHD/WGDT เอง
  const fillWgdtReport = async () => {
    const id = await wghdId();
    const has = (await query(`SELECT COUNT(*) n FROM dbo.WGDTReport WHERE WGHDId=@i`,
      { i: { type: sql.Int, value: Number(id) } }))[0].n;
    if (Number(has) > 0) return;
    await dboWrite(`
      INSERT INTO dbo.WGDTReport (WGDTId, WGHDId, DateReg, CarNo, MoveBill, CVCode, CVName,
                                  DocuNo, WGType, DateIn, DateOut, GoodID, GoodName,
                                  GoodWeight, GoodKasobNet, GoodTonNet, CouponNo)
      SELECT t.Id, h.Id, h.DateReg, h.CarNo, h.MoveBill, h.CVCode, h.CVName,
             h.DocuNo, h.WGType, h.DateIn, h.DateOut, t.GoodID, t.GoodName,
             t.GoodKG, t.GoodKasob, t.GoodTon, t.CouponNo
      FROM dbo.WGDT t JOIN dbo.WGHD h ON h.Id = t.WGHDId
      WHERE t.WGHDId = @i`, { i: { type: sql.Int, value: Number(id) } });
  };

  const board = async () => {
    const r = await api('/trips/board', {}, admin);
    return (r.body.data || []).find(t => t.tripCode === TRIP_CODE);
  };
  const setWg = async (status, extra = '') => {
    const n = (await query(`SELECT COUNT(*) n FROM dbo.WGHD WHERE CarNo=@p`,
      { p: { type: sql.VarChar(50), value: PLATE } }))[0].n;
    if (Number(n) === 0) {
      await dboWrite(`INSERT INTO dbo.WGHD (DateReg,CarNo,TotalTon,TotalKasob,SPID,WGType,isMulti,
                        MoveBill,Status,QStatus,UpdateDate,UpdateBy,isNOQ)
                      VALUES (GETDATE(),@p,10,200,@s,'SO',0,'E2EFLOW1',@st,0,GETDATE(),'E2E-FLOW',0)`, {
        p: { type: sql.VarChar(50), value: PLATE },
        s: { type: sql.Int, value: SOID },
        st: { type: sql.Int, value: status },
      });
    } else {
      await dboWrite(`UPDATE dbo.WGHD SET Status=@st ${extra} WHERE CarNo=@p`, {
        st: { type: sql.Int, value: status },
        p: { type: sql.VarChar(50), value: PLATE },
      });
    }
  };

  // ── ด่านกัน "เขียนฐานหนึ่ง แต่ถาม API อีกฐานหนึ่ง" ──────────────
  //
  // สคริปต์เลือกฐานด้วย DB_MODE ส่วน API อยู่คนละตัวแปร (E2E_API)
  // ตั้งพลาดข้างใดข้างหนึ่งแล้วจะเขียนลงฐาน A แต่ไปถาม backend ที่ต่อฐาน B
  // ผลคือ assertion ระดับฐานผ่านหมด แต่ระดับ API ล้มหมด และ **เขียนข้อมูล
  // ทดสอบทิ้งไว้ในฐาน production ไปแล้ว** ก่อนจะรู้ตัว
  // เกิดขึ้นจริง 5 ก.ย. 2569 (ตั้ง API_BASE แทน E2E_API)
  //
  // เที่ยวเพิ่งถูกสร้างในฐานที่สคริปต์ต่ออยู่ ถ้า API มองไม่เห็น แปลว่าคนละฐาน
  // หยุดทันทีตรงนี้ ก่อนแตะ dbo.WGHD
  {
    const probe = await api('/trips/board', {}, admin);
    const seen = (probe.body.data || []).find(t => t.tripCode === TRIP_CODE);
    if (!seen) {
      console.error('\nหยุด: API ไม่คืนเที่ยวที่เพิ่งสร้าง — ยังไม่แตะ dbo.WGHD');
      console.error(`   สคริปต์เขียนที่ : ${env.d} @ ${env.s}  (DB_MODE=${mode || 'local'})`);
      console.error(`   ถาม API ที่     : ${API}`);
      console.error(`   API ตอบ         : HTTP ${probe.status}`);
      if (probe.status === 401 || probe.status === 403) {
        // สองอาการนี้หน้าตาเหมือนกันมาก ต้องแยกให้ชัด ไม่งั้นไล่ผิดทางเป็นชั่วโมง
        console.error('   → ยืนยันตัวตนไม่ผ่าน ไม่ใช่เรื่องฐานข้อมูล');
        console.error('     token ถูกเซ็นด้วย secret คนละตัวกับ backend ปลายทาง');
        console.error('     ตั้ง E2E_JWT_SECRET ให้ตรงกับ JWT_SECRET ของ backend นั้น');
        console.error('     (PROD-B อยู่ใน deploy/cloud-vps/.env)');
      } else {
        console.error('   → ยืนยันตัวตนผ่านแล้วแต่ไม่เจอข้อมูล = คนละฐานข้อมูล');
        console.error('     ตั้ง E2E_API ให้ชี้ backend ที่ต่อฐานเดียวกับ DB_MODE');
      }
      await cleanup(true);
      process.exit(1);
    }
  }

  console.log('ผลการทดสอบ:');

  // 1 — เที่ยวว่าง
  let b = await board();
  check('1. เที่ยวที่ยังไม่มีใบชั่ง → PLANNED', b && b.weighing.phase === 'PLANNED',
        b ? b.weighing.label : 'ไม่พบเที่ยว');
  check('   สมาชิกในเที่ยวถูกนับ', b && b.orderCount === 1, b ? `${b.orderCount} ใบ` : '');

  // 2 — สถานะ 1
  await setWg(1);
  b = await board();
  check('2. WGHD สถานะ 1 → REGISTERED', b && b.weighing.phase === 'REGISTERED', b && b.weighing.label);
  let st = await api(`/edit-requests/stage/${SOID}`, {}, sales);
  check('   stage endpoint ตรงกัน', st.body.stage === 'REGISTERED', st.body.stage);

  // 3 — ขอแก้ไขด้วยเหตุผลที่ต้อง Hold
  const req = await api('/edit-requests', { method: 'POST', body: JSON.stringify({
    soid: String(SOID), reasonCode: 'STOCK_SHORT', reasonDetail: 'ทดสอบทั้งเส้น E2E' }) }, sales);
  check('3. ยื่นคำขอที่ต้อง Hold ได้', req.status === 200 && req.body.holdTruck === true,
        req.body && req.body.message);
  b = await board();
  check('   กระดานขึ้น Hold', b && b.hold && b.hold.held === true,
        b && b.hold ? `คำขอค้าง ${b.hold.pendingCount}` : '');
  const holdLog = (await wfQuery(`SELECT TOP 1 Applied, SkipReason FROM wf.TruckHoldLog
                                   WHERE SOID=@s ORDER BY Id DESC`,
    { s: { type: sql.VarChar(50), value: String(SOID) } })).recordset[0];
  check('   บันทึกเจตนา Hold ไว้แม้สวิตช์ปิด', !!holdLog,
        holdLog ? `applied=${holdLog.Applied}` : 'ไม่มีบันทึก');

  // 4 — อนุมัติ
  const ap = await api(`/edit-requests/${req.body.id}/approve`,
    { method: 'PATCH', body: JSON.stringify({ note: 'อนุมัติจากเทส E2E' }) }, admin);
  check('4. อนุมัติคำขอได้', ap.status === 200, ap.body && ap.body.message);
  b = await board();
  check('   Hold หลุดหลังอนุมัติ', b && b.hold && b.hold.held === false, '');
  const unlocked = (await wfQuery(`SELECT IsUnlocked FROM wf.SalesOrderExt WHERE SOID=@s`,
    { s: { type: sql.VarChar(50), value: String(SOID) } })).recordset[0];
  check('   ใบสั่งขายถูกปลดล็อกให้แก้ไข', unlocked && !!unlocked.IsUnlocked, '');

  // 5 — สถานะ 2 + ผังการจัดของ
  await setWg(2, ', WeightIn=15000, DateIn=GETDATE()');
  await fillWgdt();
  b = await board();
  check('5. WGHD สถานะ 2 → LOADING', b && b.weighing.phase === 'LOADING', b && b.weighing.label);
  const dt = (await query(`SELECT GoodID, GoodTon, GoodKasob, GoodKG FROM dbo.WGDT
                            WHERE WGHDId=(SELECT TOP 1 Id FROM dbo.WGHD WHERE CarNo=@p ORDER BY Id DESC)`,
    { p: { type: sql.VarChar(50), value: PLATE } }));
  check('   ใบชั่งรายรายการลง dbo.WGDT', dt.length > 0,
        dt.length ? `${dt.length} รายการ · ${Number(dt[0].GoodTon)} ตัน · ${Number(dt[0].GoodKasob)} กระสอบ` : 'ไม่มีแถว');
  const plan = await api(`/trips/${trip}/loading-plan`, {}, admin);
  check('   ผังการจัดของออกได้', plan.status === 200 && plan.body.plan.length > 0,
        plan.body && plan.body.plan ? `${plan.body.plan.length} รายการ` : '');
  check('   เรียงตามลำดับใน SO', plan.body.plan && plan.body.plan[0].step === 1, '');

  // 6 — สถานะ 3 ปิดการแก้ไข
  await setWg(3, `, WeightOut=25000, WeightNet=${NET_KG}, TONNet=${NET_KG / 1000}, `
              + `KGNet=${NET_KG}, KasobNet=${NET_KG / SACK_KG}, DateOut=GETDATE()`);
  await fillWgdtReport();
  b = await board();
  check('6. WGHD สถานะ 3 → SHIPPED', b && b.weighing.phase === 'SHIPPED', b && b.weighing.label);
  const wh = (await query(`SELECT WeightIn, WeightOut, WeightNet, TONNet, KasobNet
                            FROM dbo.WGHD WHERE CarNo=@p`,
    { p: { type: sql.VarChar(50), value: PLATE } }))[0];
  // ขายออก: สุทธิ = ชั่งออก - ชั่งเข้า  (ซื้อเข้าจะกลับทิศ)
  check('   น้ำหนักสุทธิ = ชั่งออก - ชั่งเข้า',
        Number(wh.WeightOut) - Number(wh.WeightIn) === Number(wh.WeightNet),
        `${Number(wh.WeightOut)} - ${Number(wh.WeightIn)} = ${Number(wh.WeightNet)} กก.`);
  check('   แปลงเป็นตัน/กระสอบถูกต้อง',
        Number(wh.TONNet) === NET_KG / 1000 && Number(wh.KasobNet) === NET_KG / SACK_KG,
        `${Number(wh.TONNet)} ตัน · ${Number(wh.KasobNet)} กระสอบ`);
  const rep = (await query(`SELECT GoodTonNet, GoodKasobNet, DateOut FROM dbo.WGDTReport
                             WHERE WGHDId=(SELECT TOP 1 Id FROM dbo.WGHD WHERE CarNo=@p ORDER BY Id DESC)`,
    { p: { type: sql.VarChar(50), value: PLATE } }));
  check('   สรุปลง dbo.WGDTReport พร้อมเวลาชั่งออก',
        rep.length > 0 && !!rep[0].DateOut,
        rep.length ? `${rep.length} แถว · ${Number(rep[0].GoodTonNet)} ตัน` : 'ไม่มีแถว');
  const late = await api('/edit-requests', { method: 'POST', body: JSON.stringify({
    soid: String(SOID), reasonCode: 'DATA_ERROR', reasonDetail: 'ควรถูกปฏิเสธ' }) }, sales);
  check('   ชั่งออกแล้วขอแก้ไขไม่ได้ (409)', late.status === 409, late.body && late.body.message);

  // 7 — ล้าง
  if (!KEEP) { console.log(); await cleanup(); }
  else console.log('\n   --keep: ไม่ล้างข้อมูลทดสอบ');

  console.log(`\nสรุป: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  if (fail) {
    console.log('\nขั้นที่ไม่ผ่าน:');
    results.filter(r => !r.ok).forEach(r => console.log(`   - ${r.step}  ${r.detail || ''}`));
  }
  process.exit(fail ? 1 : 0);
})().catch(async e => {
  console.error('\nล้มเหลว:', e.message);
  try { await cleanup(true); } catch { /* พยายามล้างให้ */ }
  process.exit(1);
});
