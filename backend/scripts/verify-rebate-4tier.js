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
const PASSWORD = process.env.E2E_PASSWORD || '***REMOVED-PASSWORD***';
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

  // ถอดการผูกภาคชั่วคราวของผู้ใช้ทดสอบ — ไม่แตะการแต่งตั้งจริงของพนักงาน
  const areas = await wfQuery(`
    DELETE FROM wf.UserSaleArea
    WHERE UserId IN (SELECT Id FROM wf.AppUser WHERE Username LIKE 'e2e[_]%')`);
  say(`ถอดการผูกภาคของผู้ใช้ทดสอบ ${areas.rowsAffected?.[0] ?? 0} รายการ`);

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

  // ลูกค้าในภาค 05 (ภาคใต้) ที่มียอดขนจริงคงเหลืออย่างน้อย 6 สูตร สูตรละ 19 ตันขึ้นไป
  //
  // ต้องเป็นลูกค้าที่ขนจริง เพราะตั้งแต่ v1.6.1 ใบขอเคลียร์ตัดสิทธิ์จากใบส่งของใน WINSpeed
  // โดยตรง (แหล่งข้อมูลเดียว) รหัสสินค้าสมมติจะถูกปฏิเสธที่ขั้นกระทบยอด ซึ่งถูกต้องแล้ว
  // — อ่านอย่างเดียว ไม่แก้ข้อมูลลูกค้าและไม่แตะข้อมูลใน dbo
  const cust = (await wfQuery(`
    SELECT TOP 1 CustId FROM (
      SELECT CustId, GoodCode, SUM(RemainingTonRebate) AS Ton
      FROM wf.v_RebateAccrualRemaining
      WHERE RegionCode = '05'
      GROUP BY CustId, GoodCode
      HAVING SUM(RemainingTonRebate) >= 19
    ) t
    GROUP BY CustId
    HAVING COUNT(*) >= 6
    ORDER BY COUNT(*) DESC`)).recordset[0];

  // 6 สูตรแรกของลูกค้ารายนั้น ใช้แทนชื่อสูตรบนใบ RBD68-049
  const goods = cust ? (await wfQuery(`
    SELECT TOP 6 GoodCode
    FROM wf.v_RebateAccrualRemaining
    WHERE CustId = @c AND RegionCode = '05'
    GROUP BY GoodCode
    HAVING SUM(RemainingTonRebate) >= 19
    ORDER BY GoodCode`, { c: { type: sql.NVarChar(20), value: String(cust.CustId) } })).recordset : [];

  // ผู้อนุมัติชั้น 2 ของภาค 05
  //
  // ถ้าระบบจริงตั้งไว้แล้ว ใช้ของจริง (เทสต์จะได้ทดสอบสิ่งที่ผู้ใช้เห็นจริง)
  // ถ้ายังไม่ตั้ง ผูกผู้ใช้ทดสอบให้ชั่วคราวแล้วถอดออกตอนล้าง — เทสต์ต้องรันได้บนฐานเปล่า
  let approver = (await wfQuery(`
    SELECT TOP 1 u.Username
    FROM wf.UserSaleArea a JOIN wf.AppUser u ON u.Id = a.UserId
    WHERE a.RegionCode = '05' AND u.IsActive = 1
    ORDER BY a.IsPrimary DESC, a.UserId`)).recordset[0];

  if (!approver) {
    await wfQuery(`
      INSERT INTO wf.UserSaleArea (UserId, RegionCode, IsPrimary)
      SELECT Id, '05', 1 FROM wf.AppUser WHERE Username = 'e2e_manager'`);
    approver = (await wfQuery(`SELECT Username FROM wf.AppUser WHERE Username = 'e2e_manager'`)).recordset[0];
  }

  return {
    poolId: pool.Id,
    regionApprover: approver ? approver.Username : null,
    custId: cust ? cust.CustId : null,
    goodCodes: goods.map(g => g.GoodCode),
    salesId: sales.Id,
    mgrId: mgr ? mgr.Id : null,
  };
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
  console.log(`  pool #${ctx.poolId} ยอดตั้งไว้ 100,000 · ลูกค้าภาค 05 = ${ctx.custId || '(ไม่พบ)'}`
    + ` · ผู้อนุมัติภาค 05 = ${ctx.regionApprover || '(ยังไม่ตั้ง)'}`);

  const tSales = await login('e2e_sales');
  // ผู้อนุมัติชั้น 2 ต้องอ่านจากข้อมูลจริง ไม่ผูกชื่อไว้ในเทสต์
  // การผูก emp-00036 ไว้ตายตัวทำให้เทสต์ล้มทันทีที่ผู้ดูแลย้ายผู้จัดการภาคจากหน้าจอ
  // ซึ่งเป็นสิ่งที่ระบบตั้งใจให้ทำได้ (หน้าจอ ข้อมูลหลัก → ผู้อนุมัติรายภาค)
  if (!ctx.regionApprover) return bad('ยังไม่มีผู้อนุมัติชั้นที่ 2 ของภาค 05 — ตั้งค่าที่ ข้อมูลหลัก → ผู้อนุมัติรายภาค ก่อน');
  const tMgr = await login(ctx.regionApprover);
  const tMkt = await login(MARKETING_USER);
  const tCL = await login('e2e_clevel');

  // ตัน/ราคา ตรงกับใบ RBD68-049 ทุกบรรทัด (ยอดรวมต้องได้ 55,800 บาท)
  // ต่างจากเดิมตรงที่สูตรปุ๋ยเป็นสูตรจริงที่ลูกค้ารายนี้ขนไปแล้ว ไม่ใช่รหัสสมมติ
  // ราคาขาย/ราคาสุทธิยังกรอกตามกระดาษ เพราะกระดาษคือเอกสารต้นทางของตัวเลขสองช่องนี้
  if (ctx.goodCodes.length < 6) return bad('หาลูกค้าภาค 05 ที่มียอดขนจริงครบ 6 สูตรไม่ได้');
  const paper = [
    { qtyTon: 8,  pricePerTon: 12700, netPricePerTon: 12300 },
    { qtyTon: 19, pricePerTon: 18200, netPricePerTon: 17000 },
    { qtyTon: 12, pricePerTon: 12700, netPricePerTon: 12300 },
    { qtyTon: 14, pricePerTon: 16200, netPricePerTon: 15500 },
    { qtyTon: 8,  pricePerTon: 8200,  netPricePerTon: 7700 },
    { qtyTon: 16, pricePerTon: 13200, netPricePerTon: 12500 },
  ];
  const lines = paper.map((row, i) => ({ goodCode: ctx.goodCodes[i], ...row }));
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

  // หนึ่งบรรทัดบนกระดาษถูกกระจายลงหลายล็อตตามการตัด FIFO จึงนับเป็น "กลุ่มสูตร"
  // ไม่ใช่จำนวนแถว · ยอดรวมต่อสูตรต้องเท่ากับกระดาษเป๊ะ ๆ
  const ln = (await wfQuery(`
    SELECT GoodCode, SUM(QtyTon) AS QtyTon, SUM(LineAmount) AS LineAmount,
           COUNT(*) AS Lots, SUM(CASE WHEN SourceSOID IS NULL THEN 1 ELSE 0 END) AS Unbound
    FROM wf.RebateClaimLine WHERE ClaimId=@id GROUP BY GoodCode`,
    { id: { type: sql.Int, value: claimId } })).recordset;
  ln.length === 6 ? ok(`บันทึกครบ 6 สูตร (กระจายเป็น ${ln.reduce((a, x) => a + Number(x.Lots), 0)} ล็อตตาม FIFO)`)
    : bad(`ควรได้ 6 สูตร แต่ได้ ${ln.length}`);
  ln.every(x => Number(x.Unbound) === 0) ? ok('ทุกล็อตชี้กลับไปยังบรรทัดใบส่งของต้นทางได้')
    : bad('มีล็อตที่ไม่มี SourceSOID — ตรวจย้อนกลับตาม ISO ไม่ได้');
  const g2 = ln.find(x => x.GoodCode === ctx.goodCodes[1]);
  Number(g2?.LineAmount) === 22800 ? ok('ยอดต่อสูตรที่ฐานข้อมูลคำนวณเองถูกต้อง (19 × 1,200 = 22,800)')
    : bad(`ยอดสูตรที่ 2 ผิด: ${g2?.LineAmount} (ตัน ${g2?.QtyTon})`);

  console.log('\n2. อนุมัติชั้นที่ 2 — ผู้อนุมัติที่ผูกกับภาค 05 (สิทธิ์มาจากการผูกภาค ไม่ใช่จากบทบาท)');
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
