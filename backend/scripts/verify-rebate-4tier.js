'use strict';
/**
 * verify-rebate-4tier.js — ทดสอบวงจรใบขอเคลียร์รีเบทตั้งแต่ตั้ง pool จนอนุมัติครบ 4 ชั้น
 *
 * ทดสอบผ่าน API จริงทุกขั้น ไม่ยัดข้อมูลลงฐานตรง ๆ ยกเว้นข้อมูลตั้งต้น (pool, ผู้ใช้)
 * ที่ยังไม่มี endpoint สร้าง
 *
 * ทุกอย่างที่สร้างมี prefix ที่ระบุตัวได้ และมีคำสั่งล้างข้อมูลครบใน --cleanup
 *
 *   node backend/scripts/verify-rebate-4tier.js            # สร้าง + ทดสอบ (ไม่ล้าง)
 *   node backend/scripts/verify-rebate-4tier.js --cleanup  # ล้างข้อมูลทดสอบทั้งหมด
 */

require('dotenv').config({ quiet: true });
const { sql, wfQuery } = require('../db');

const API = process.env.WF_API || 'http://localhost:3000';
const PASSWORD = process.env.E2E_PASSWORD || 'W0rldF3rt';
const TAG = 'UAT4TIER';          // เครื่องหมายระบุข้อมูลทดสอบ ใช้ทั้งตอนค้นและตอนล้าง
const MARKETING_USER = 'e2e_marketing';

const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { console.log('  FAIL ' + m); failed++; };
let failed = 0;

async function login(username) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`เข้าระบบเป็น ${username} ไม่สำเร็จ (${r.status})`);
  const d = await r.json();
  const token = d.token || d.accessToken || d?.data?.token;
  if (!token) throw new Error(`ไม่พบ token ของ ${username}`);
  return token;
}

const call = (token, method, path, body) => fetch(API + path, {
  method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ---------- ล้างข้อมูลทดสอบ ----------
async function cleanup(quiet) {
  const say = (m) => { if (!quiet) console.log('  ' + m); };
  // ลบลูกก่อนแม่เสมอ ไม่งั้นติด FK
  const claims = (await wfQuery(
    `SELECT Id FROM wf.RebateClaim WHERE Note LIKE @t OR CustId = @c`,
    { t: { type: sql.NVarChar(200), value: `%${TAG}%` }, c: { type: sql.NVarChar(50), value: TAG } })).recordset;
  for (const c of claims) {
    const p = { id: { type: sql.Int, value: c.Id } };
    await wfQuery(`DELETE FROM wf.RebateClaimApproval WHERE ClaimId=@id`, p);
    await wfQuery(`DELETE FROM wf.RebateClaimLine WHERE ClaimId=@id`, p);
    await wfQuery(`DELETE FROM wf.RebateClaimInvoice WHERE ClaimId=@id`, p);
    await wfQuery(`DELETE FROM wf.RebateClaim WHERE Id=@id`, p);
  }
  say(`ลบใบขอเคลียร์ทดสอบ ${claims.length} ใบ (พร้อมรายการย่อย/การอนุมัติ/ใบกำกับ)`);

  const pools = (await wfQuery(
    `SELECT Id FROM wf.RebatePool WHERE PeriodYear=@y AND PeriodMonth=@m AND SalesUserId IN
       (SELECT Id FROM wf.AppUser WHERE Username LIKE 'e2e[_]%')`,
    { y: { type: sql.Int, value: 2999 }, m: { type: sql.Int, value: 12 } })).recordset;
  for (const p of pools) await wfQuery(`DELETE FROM wf.RebatePool WHERE Id=@id`, { id: { type: sql.Int, value: p.Id } });
  say(`ลบ rebate pool ทดสอบ ${pools.length} รายการ`);

  await wfQuery(`DELETE FROM wf.UserSaleArea WHERE UserId IN (SELECT Id FROM wf.AppUser WHERE Username=@u)`,
    { u: { type: sql.NVarChar(50), value: MARKETING_USER } });
  await wfQuery(`DELETE FROM wf.AppUser WHERE Username=@u`, { u: { type: sql.NVarChar(50), value: MARKETING_USER } });
  say(`ลบผู้ใช้ทดสอบ ${MARKETING_USER}`);
}

// ---------- เตรียมข้อมูลตั้งต้น ----------
async function seed() {
  // ผู้ใช้ MARKETING สำหรับอนุมัติชั้นที่ 3 (ใช้ hash เดียวกับบัญชี e2e อื่น)
  const hash = (await wfQuery(
    `SELECT TOP 1 PasswordHash, EmpId FROM wf.AppUser WHERE Username='e2e_sales'`)).recordset[0];
  if (!hash) throw new Error('ยังไม่ได้ seed บัญชี e2e — สั่ง node _seed.js ก่อน');
  await wfQuery(`
    IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username=@u)
      INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId)
      VALUES (@u, @h, N'E2E Marketing', 'MARKETING', @e)`,
    { u: { type: sql.NVarChar(50), value: MARKETING_USER },
      h: { type: sql.NVarChar(200), value: hash.PasswordHash },
      e: { type: sql.Int, value: hash.EmpId } });

  const sales = (await wfQuery(`SELECT Id FROM wf.AppUser WHERE Username='e2e_sales'`)).recordset[0];
  const mgr = (await wfQuery(`SELECT Id FROM wf.AppUser WHERE Username='emp-00036'`)).recordset[0];

  // pool ของพนักงานขายทดสอบ ใช้ปี 2999 เพื่อไม่ชนกับข้อมูลจริงและค้นหาได้ง่าย
  const pool = (await wfQuery(`
    INSERT INTO wf.RebatePool (SalesUserId, PeriodYear, PeriodMonth, AccruedAmt, ClaimedAmt, AllocatedAmt)
    OUTPUT inserted.Id
    VALUES (@uid, 2999, 12, 100000, 0, 0)`,
    { uid: { type: sql.Int, value: sales.Id } })).recordset[0];

  // ลูกค้าในภาค 05 (ภาคใต้) เพื่อให้ระบบอนุมานภาคได้ — อ่านอย่างเดียว ไม่แก้ข้อมูลลูกค้า
  const cust = (await wfQuery(`
    SELECT TOP 1 c.CustID FROM dbo.EMCust c
    JOIN dbo.EMSaleArea a ON a.SaleAreaID = c.SaleAreaID
    WHERE LEFT(a.SaleAreaCode,2)='05'`)).recordset[0];

  return { poolId: pool.Id, custId: cust ? cust.CustID : null, salesId: sales.Id, mgrId: mgr ? mgr.Id : null };
}

// ---------- ทดสอบ ----------
async function main() {
  if (process.argv.includes('--cleanup')) {
    console.log('ล้างข้อมูลทดสอบ');
    await cleanup(false);
    console.log('เสร็จสิ้น');
    return;
  }

  console.log('เตรียมข้อมูลตั้งต้น');
  await cleanup(true);                 // กันข้อมูลค้างจากรอบก่อน
  const ctx = await seed();
  console.log(`  pool #${ctx.poolId} ยอดตั้งไว้ 100,000 · ลูกค้าภาค 05 = ${ctx.custId || '(ไม่พบ)'}`);

  const tSales = await login('e2e_sales');
  const tMgr = await login('emp-00036');       // คุณมนัส — ผู้จัดการภาค 05
  const tMkt = await login(MARKETING_USER);
  const tCL = await login('e2e_clevel');

  // ตารางเดียวกับใบ RBD68-049 แต่เป็นข้อมูลจำลอง ไม่ใช่ของลูกค้าจริง
  const lines = [
    { goodCode: 'TEST-18-4-5',  qtyTon: 8,  pricePerTon: 12700, netPricePerTon: 12300 },
    { goodCode: 'TEST-15-5-35', qtyTon: 19, pricePerTon: 18200, netPricePerTon: 17000 },
    { goodCode: 'TEST-14-4-9',  qtyTon: 12, pricePerTon: 12700, netPricePerTon: 12300 },
    { goodCode: 'TEST-15-7-18', qtyTon: 14, pricePerTon: 16200, netPricePerTon: 15500 },
    { goodCode: 'TEST-21-0-0',  qtyTon: 8,  pricePerTon: 8200,  netPricePerTon: 7700 },
    { goodCode: 'TEST-0-0-60',  qtyTon: 16, pricePerTon: 13200, netPricePerTon: 12500 },
  ];
  const expectTotal = 55800;

  console.log('\n1. ยื่นใบขอเคลียร์ (SALES)');
  let r = await call(tSales, 'POST', '/api/rebate/claims', {
    poolId: ctx.poolId, custId: ctx.custId, note: `${TAG} ทดสอบวงจร 4 ชั้น`, lines,
  });
  const created = await r.json();
  if (r.status !== 200 && r.status !== 201) return bad(`ยื่นไม่สำเร็จ (${r.status}) ${JSON.stringify(created).slice(0, 160)}`);
  const claimId = created.id || created.Id;
  ok(`สร้างใบ #${claimId} สถานะ ${created.status || created.Status}`);

  const head = (await wfQuery(`SELECT ClaimAmt, Status, CurrentTier, RegionCode FROM wf.RebateClaim WHERE Id=@id`,
    { id: { type: sql.Int, value: claimId } })).recordset[0];
  Number(head.ClaimAmt) === expectTotal ? ok(`ยอดรวมคำนวณถูก ฿${Number(head.ClaimAmt).toLocaleString()}`)
    : bad(`ยอดรวมผิด ได้ ฿${head.ClaimAmt} ควรเป็น ฿${expectTotal}`);
  head.Status === 'TIER2_PENDING' ? ok('สถานะเริ่มต้นเป็น TIER2_PENDING') : bad(`สถานะเริ่มต้นผิด: ${head.Status}`);
  ok(`ภาคที่ระบบอนุมานได้: ${head.RegionCode}`);

  const ln = (await wfQuery(`SELECT [LineNo], RebatePerTon, LineAmount FROM wf.RebateClaimLine WHERE ClaimId=@id ORDER BY [LineNo]`,
    { id: { type: sql.Int, value: claimId } })).recordset;
  ln.length === 6 ? ok('บันทึกรายการย่อยครบ 6 บรรทัด') : bad(`รายการย่อยได้ ${ln.length} บรรทัด`);
  const l2 = ln.find(x => x.LineNo === 2);
  Number(l2?.LineAmount) === 22800 ? ok('LineAmount ที่ฐานข้อมูลคำนวณเองถูกต้อง (19 × 1,200 = 22,800)')
    : bad(`LineAmount บรรทัด 2 ผิด: ${l2?.LineAmount}`);

  console.log('\n2. อนุมัติชั้นที่ 2 — ผู้จัดการภาค (คุณมนัส บทบาท SALES แต่ดูแลภาค 05)');
  r = await call(tMgr, 'POST', `/api/rebate/claims/${claimId}/approve`, { note: `${TAG} ชั้น 2` });
  let d = await r.json();
  r.ok && d.currentTier === 3 ? ok(`ผ่านไปชั้น 3 (${d.status})`) : bad(`ชั้น 2 ล้มเหลว (${r.status}) ${JSON.stringify(d).slice(0, 140)}`);

  console.log('\n3. กันคนเดิมอนุมัติซ้ำชั้น (Segregation of Duties)');
  r = await call(tMgr, 'POST', `/api/rebate/claims/${claimId}/approve`, {});
  r.status === 403 ? ok('ระบบปฏิเสธคนเดิมอนุมัติชั้นถัดไป (403)') : bad(`ควรได้ 403 แต่ได้ ${r.status}`);

  console.log('\n4. อนุมัติชั้นที่ 3 — ผู้จัดการฝ่ายตลาด (MARKETING)');
  r = await call(tMkt, 'POST', `/api/rebate/claims/${claimId}/approve`, { note: `${TAG} ชั้น 3` });
  d = await r.json();
  r.ok && d.currentTier === 4 ? ok(`ผ่านไปชั้น 4 (${d.status})`) : bad(`ชั้น 3 ล้มเหลว (${r.status}) ${JSON.stringify(d).slice(0, 140)}`);

  console.log('\n5. อนุมัติชั้นที่ 4 — กรรมการบริหาร (C_LEVEL) พร้อมเลขใบลดหนี้');
  r = await call(tCL, 'POST', `/api/rebate/claims/${claimId}/approve`, { docuNo: `CN-${TAG}-001`, note: `${TAG} ชั้น 4` });
  d = await r.json();
  r.ok ? ok(`อนุมัติครบทุกชั้น (${d.status})`) : bad(`ชั้น 4 ล้มเหลว (${r.status}) ${JSON.stringify(d).slice(0, 140)}`);

  console.log('\n6. ตรวจผลลัพธ์ปลายทาง');
  const fin = (await wfQuery(`SELECT Status, CurrentTier, CnDocuNo FROM wf.RebateClaim WHERE Id=@id`,
    { id: { type: sql.Int, value: claimId } })).recordset[0];
  ['APPROVED', 'CN_ISSUED'].includes(fin.Status) ? ok(`สถานะสุดท้าย ${fin.Status}`) : bad(`สถานะสุดท้ายผิด: ${fin.Status}`);

  const apps = (await wfQuery(`SELECT Tier, RequiredRole, Decision, DecidedByName FROM wf.RebateClaimApproval WHERE ClaimId=@id ORDER BY Tier`,
    { id: { type: sql.Int, value: claimId } })).recordset;
  apps.length >= 4 ? ok(`บันทึกการอนุมัติครบ ${apps.length} ชั้น`) : bad(`บันทึกการอนุมัติได้แค่ ${apps.length} ชั้น`);
  for (const a of apps) console.log(`       ชั้น ${a.Tier} · ${a.RequiredRole} · ${a.Decision} · โดย ${a.DecidedByName}`);

  const distinct = new Set(apps.map(a => a.DecidedByName)).size;
  distinct >= 3 ? ok(`ผู้อนุมัติต่างคนกัน ${distinct} คน`) : bad(`ผู้อนุมัติซ้ำกันเกินไป (${distinct} คน)`);

  console.log(failed ? `\n${failed} ข้อไม่ผ่าน` : '\nผ่านทุกข้อ');
  console.log(`\nข้อมูลทดสอบยังอยู่ในระบบ — ใบขอเคลียร์ #${claimId}, pool #${ctx.poolId}`);
  console.log('สั่งล้างเมื่อพร้อม:  node backend/scripts/verify-rebate-4tier.js --cleanup');
  process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.error('ผิดพลาด:', e.message); process.exitCode = 1; });
