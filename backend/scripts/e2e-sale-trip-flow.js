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
    impersonating: false, mustChangePassword: false }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function cleanup(silent) {
  // ลบลูกก่อนแม่เสมอ
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
  if (String(process.env.DB_MODE || '').toLowerCase() !== 'local') {
    console.error('หยุด: สคริปต์นี้เขียนข้อมูลทดสอบ รันบน local เท่านั้น');
    process.exit(1);
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
  b = await board();
  check('5. WGHD สถานะ 2 → LOADING', b && b.weighing.phase === 'LOADING', b && b.weighing.label);
  const plan = await api(`/trips/${trip}/loading-plan`, {}, admin);
  check('   ผังการจัดของออกได้', plan.status === 200 && plan.body.plan.length > 0,
        plan.body && plan.body.plan ? `${plan.body.plan.length} รายการ` : '');
  check('   เรียงตามลำดับใน SO', plan.body.plan && plan.body.plan[0].step === 1, '');

  // 6 — สถานะ 3 ปิดการแก้ไข
  await setWg(3, ', WeightOut=25000, WeightNet=10000, DateOut=GETDATE()');
  b = await board();
  check('6. WGHD สถานะ 3 → SHIPPED', b && b.weighing.phase === 'SHIPPED', b && b.weighing.label);
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
