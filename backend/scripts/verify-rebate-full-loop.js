'use strict';
/**
 * verify-rebate-full-loop.js — วงจรเต็มตั้งแต่สร้างใบสั่งขายจนอนุมัติรีเบทครบ 4 ชั้น
 *
 *   สร้าง SO → ตรวจซ้ำ → ยืนยัน → จัดของ → ขึ้นของ → ชั่งออก
 *   → ตั้งยอดรีเบทค้างรับ → ยื่นใบขอเคลียร์ → อนุมัติ 4 ชั้น
 *
 * ⚠ ขั้นชั่งออกจะเขียนกลับไปยัง MySQL ของเครื่องชั่ง (ฐานสำเนาสำหรับ DEV/UAT)
 *   จึงต้องล้างทั้งสองฝั่ง — ดู --cleanup
 *
 *   node backend/scripts/verify-rebate-full-loop.js
 *   node backend/scripts/verify-rebate-full-loop.js --cleanup
 */

require('dotenv').config({ quiet: true });
const { sql, wfQuery } = require('../db');

const API = process.env.WF_API || 'http://localhost:3000';
const PASSWORD = process.env.E2E_PASSWORD || 'W0rldF3rt';
const TAG = 'UATLOOP';
const PLATE = 'UAT-LOOP-01';
const MARKETING_USER = 'e2e_marketing';

let failed = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { console.log('  FAIL ' + m); failed++; };

async function login(u) {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PASSWORD }) });
  if (!r.ok) throw new Error(`เข้าระบบเป็น ${u} ไม่สำเร็จ (${r.status})`);
  const d = await r.json();
  const t = d.token || d.accessToken || d?.data?.token;
  if (!t) throw new Error(`ไม่พบ token ของ ${u}`);
  return t;
}
const call = (t, m, p, b) => fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b === undefined ? undefined : JSON.stringify(b) });
const body = async r => { try { return await r.json(); } catch { return {}; } };

async function cleanup(quiet) {
  const say = m => { if (!quiet) console.log('  ' + m); };

  // ใบที่ยืนยันแล้วย้ายไปอยู่ dbo.SOHD — ห้ามลบตรง ๆ เพราะจะทำให้ SOID high-water mark
  // ถอยหลังแล้วชน primary key ในการสร้างใบถัดไป จึงยกเลิกผ่านกระบวนการปกติแทน
  try {
    const token = await login('e2e_admin');
    const live = (await wfQuery(
      `SELECT Id FROM wf.v_AllSalesOrders WHERE TruckPlate = @p AND Status NOT IN ('CANCELLED','SHIPPED')`,
      { p: { type: sql.NVarChar(50), value: PLATE } })).recordset;
    for (const s of live) {
      await call(token, 'PATCH', `/api/so/${s.Id}/cancel`, { reason: `${TAG} ล้างข้อมูลทดสอบ` }).catch(() => {});
    }
    if (live.length) say(`ยกเลิกใบสั่งขายที่ยืนยันแล้ว ${live.length} ใบ (ไม่ลบ dbo.SOHD)`);
  } catch (e) { say('ข้ามการยกเลิกใบที่ยืนยันแล้ว: ' + e.message.slice(0, 60)); }

  const sos = (await wfQuery(`SELECT Id FROM wf.SalesOrder WHERE TruckPlate = @p OR Remark LIKE @t`,
    { p: { type: sql.NVarChar(50), value: PLATE }, t: { type: sql.NVarChar(200), value: `%${TAG}%` } })).recordset;
  for (const s of sos) {
    const p = { id: { type: sql.Int, value: s.Id } };
    for (const t of ['wf.RebateUsage', 'wf.RebateLedger']) {
      await wfQuery(`DELETE FROM ${t} WHERE SoId = @id`, p).catch(() => {});
    }
    for (const t of ['wf.WeighTicket', 'wf.SalesOrderAudit', 'wf.SalesOrderLine', 'wf.SalesOrderExt', 'wf.UnlockRequest', 'wf.PaperCopy']) {
      await wfQuery(`DELETE FROM ${t} WHERE SoId = @id`, p).catch(() => {});
    }
    await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @id`, p).catch(() => {});
  }
  say(`ลบใบสั่งขายทดสอบ ${sos.length} ใบ (พร้อมรายการ/ใบชั่ง/audit/ledger)`);

  const claims = (await wfQuery(`SELECT Id FROM wf.RebateClaim WHERE Note LIKE @t`,
    { t: { type: sql.NVarChar(200), value: `%${TAG}%` } })).recordset;
  for (const c of claims) {
    const p = { id: { type: sql.Int, value: c.Id } };
    await wfQuery(`DELETE FROM wf.RebateClaimApproval WHERE ClaimId=@id`, p);
    await wfQuery(`DELETE FROM wf.RebateClaimLine WHERE ClaimId=@id`, p);
    await wfQuery(`DELETE FROM wf.RebateClaimInvoice WHERE ClaimId=@id`, p);
    await wfQuery(`DELETE FROM wf.RebateClaim WHERE Id=@id`, p);
  }
  say(`ลบใบขอเคลียร์ทดสอบ ${claims.length} ใบ`);

  // ลบเฉพาะ pool ที่ไม่มีใบขอเคลียร์อ้างถึงแล้ว ไม่งั้นชน foreign key
  await wfQuery(`DELETE FROM wf.RebatePool WHERE PeriodYear = 2999
    AND Id NOT IN (SELECT PoolId FROM wf.RebateClaim WHERE PoolId IS NOT NULL)`);
  await wfQuery(`DELETE FROM wf.UserSaleArea WHERE UserId IN (SELECT Id FROM wf.AppUser WHERE Username=@u)`, { u: { type: sql.NVarChar(50), value: MARKETING_USER } });
  // ลบผู้ใช้ทดสอบเฉพาะเมื่อไม่มีร่องรอยการอนุมัติอ้างถึงแล้ว
  // (ข้อมูลทดสอบชุดก่อนที่เจ้าของระบบขอให้คงไว้ ยังอ้างถึงผู้ใช้คนนี้อยู่)
  await wfQuery(`DELETE FROM wf.AppUser WHERE Username=@u
    AND Id NOT IN (SELECT DecidedBy FROM wf.RebateClaimApproval WHERE DecidedBy IS NOT NULL)`,
    { u: { type: sql.NVarChar(50), value: MARKETING_USER } });
  say('ลบ pool ทดสอบและผู้ใช้ e2e_marketing');

  try {
    const { tsQuery } = require('../services/truckscale-db');
    // จำกัดที่ทะเบียนทดสอบเท่านั้น — เดิมมี OR sequence LIKE 'WF%' ซึ่งสแกนทั้งตาราง
    // 400,000 แถวผ่านเน็ต ทำให้ค้างนานมาก และเสี่ยงล็อกตารางของโรงงาน
    // ลบรายการย่อยก่อน แล้วค่อยลบใบชั่ง เพราะรายการย่อยผูกด้วย one_num ของใบนั้น
    const nums = await tsQuery(`SELECT one_num FROM tblscale WHERE one_car_regis = ?`, [PLATE]);
    for (const row of nums) {
      if (row.one_num) await tsQuery(`DELETE FROM tblproduct_detail WHERE one_num = ?`, [row.one_num]);
    }
    const r = await tsQuery(`DELETE FROM tblscale WHERE one_car_regis = ?`, [PLATE]);
    say(`ลบใบชั่งฝั่ง MySQL ${r?.affectedRows ?? 0} แถว`);
  } catch (e) { say('ข้ามการล้างฝั่ง MySQL: ' + e.message.slice(0, 60)); }
}

async function main() {
  if (process.argv.includes('--cleanup')) { console.log('ล้างข้อมูลทดสอบ'); await cleanup(false); console.log('เสร็จสิ้น'); return; }

  console.log('เตรียมข้อมูล');
  await cleanup(true);

  const hash = (await wfQuery(`SELECT TOP 1 PasswordHash, EmpId FROM wf.AppUser WHERE Username='e2e_sales'`)).recordset[0];
  await wfQuery(`IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username=@u)
    INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId) VALUES (@u,@h,N'E2E Marketing','MARKETING',@e)`,
    { u: { type: sql.NVarChar(50), value: MARKETING_USER }, h: { type: sql.NVarChar(200), value: hash.PasswordHash }, e: { type: sql.Int, value: hash.EmpId } });

  // ลูกค้าภาคใต้ + สินค้าจริง 1 รายการ (อ้างอิงอย่างเดียว ไม่แก้ข้อมูลหลัก)
  const cust = (await wfQuery(`SELECT TOP 1 c.CustID, c.CustName FROM dbo.EMCust c
    JOIN dbo.EMSaleArea a ON a.SaleAreaID=c.SaleAreaID WHERE LEFT(a.SaleAreaCode,2)='05'`)).recordset[0];
  const goods = (await wfQuery(`SELECT TOP 3 GoodID, GoodCode, GoodName1 FROM dbo.EMGood WHERE StockFlag='Y'`)).recordset;
  const good = goods[0];
  if (!cust || !good) return bad('ไม่พบลูกค้าหรือสินค้าสำหรับทดสอบ');
  console.log(`  ลูกค้า ${cust.CustID} (ภาค 05) · สินค้า ${good.GoodCode}`);

  const tSales = await login('e2e_sales'), tMgr = await login('e2e_manager');
  const tWh = await login('e2e_warehouse'), tWb = await login('e2e_weighbridge');
  const tRegion = await login('emp-00036'), tMkt = await login(MARKETING_USER), tCL = await login('e2e_clevel');

  const QTY = 19, PRICE = 18200, NET = 17000;   // คืนรีเบท 1,200/ตัน → 22,800 บาท

  console.log('\n1. สร้างใบสั่งขาย (SALES)');
  let r = await call(tSales, 'POST', '/api/so', {
    soPrefix: 'I', custId: cust.CustID, custName: cust.CustName, truckPlate: PLATE,
    remark: `${TAG} ทดสอบวงจรเต็ม`, deliveryDate: new Date().toISOString().slice(0, 10),
    lines: goods.map((g, i) => ({ goodId: String(g.GoodID), goodCode: g.GoodCode, goodName: g.GoodName1, qtyTon: [10, 6, 3][i], qtyBag: [200, 120, 60][i], pricePerTon: PRICE, netPricePerTon: NET })),
  });
  let d = await body(r);
  if (!r.ok) return bad(`สร้าง SO ไม่สำเร็จ (${r.status}) ${JSON.stringify(d).slice(0, 200)}`);
  let soId = (d.ids && d.ids[0]) || d.id || d.soId;
  ok(`สร้างใบสั่งขาย #${soId} ${d.refs ? '· ' + d.refs[0] : ''}`);

  const step = async (name, token, method, path, payload) => {
    const res = await call(token, method, path, payload);
    const out = await body(res);
    res.ok ? ok(`${name} สำเร็จ`) : bad(`${name} ล้มเหลว (${res.status}) ${JSON.stringify(out).slice(0, 150)}`);
    return res.ok;
  };

  console.log('\n2. เดินสถานะใบสั่งขาย');
  await step('ตรวจซ้ำ (MANAGER)', tMgr, 'PATCH', `/api/so/${soId}/verify`, {});
  await step('ยืนยัน (SALES)', tSales, 'PATCH', `/api/so/${soId}/confirm`, {});

  // sp_ConfirmSalesOrder ย้ายใบสั่งขายจาก wf.SalesOrder เข้า dbo.SOHD แล้วให้ SOID ใหม่
  // แถวใน wf หายไป รหัสเดิมจึงใช้ต่อไม่ได้ ต้องอ่านรหัสใหม่จาก view รวม
  const moved = (await wfQuery(
    `SELECT TOP 1 Id, WfRef, Status FROM wf.v_AllSalesOrders
     WHERE TruckPlate = @p ORDER BY CreatedAt DESC`,
    { p: { type: sql.NVarChar(50), value: PLATE } })).recordset[0];
  if (!moved) return bad('หลังยืนยันแล้วหาใบสั่งขายไม่พบใน wf.v_AllSalesOrders');
  soId = moved.Id;
  ok(`ยืนยันแล้วได้เลขเอกสาร ${moved.WfRef} · SOID ใหม่ ${soId} · ${moved.Status}`);

  await step('จัดของ (WAREHOUSE)', tWh, 'PATCH', `/api/so/${soId}/picking`, {});
  await step('ขึ้นของ (WAREHOUSE)', tWh, 'PATCH', `/api/so/${soId}/load`, {});

  console.log('\n3. ชั่งออก (WEIGHBRIDGE) — เขียนกลับ TruckScale');
  const gross = 30000, tare = 30000 - QTY * 1000;
  // ชื่อฟิลด์ต้องตรงกับที่ API รับ (weighOutWeight/tareKg) มิฉะนั้นน้ำหนักจะเป็น null
  await step('ชั่งออก/ส่งของ', tWb, 'PATCH', `/api/so/${soId}/ship`, { weighOutWeight: gross, tareKg: tare, scaleNo: 1, movebill: null });

  // ทางลบ: ส่งของโดยไม่มีน้ำหนัก ต้องถูกปฏิเสธ
  const noWeight = await call(tWb, 'PATCH', `/api/so/${soId}/ship`, { scaleNo: 1 });
  noWeight.status === 400 ? ok('ส่งของโดยไม่มีน้ำหนักถูกปฏิเสธ (400)') : bad(`ควรได้ 400 ได้ ${noWeight.status}`);

  const so = (await wfQuery(`SELECT Status FROM wf.v_AllSalesOrders WHERE Id=@id`,
    { id: { type: sql.NVarChar(50), value: String(soId) } })).recordset[0];
  so && so.Status === 'SHIPPED' ? ok(`สถานะใบสั่งขาย = ${so.Status}`) : bad(`สถานะควรเป็น SHIPPED ได้ ${so?.Status}`);

  console.log('\n4. ยอดรีเบทค้างรับที่ระบบตั้งให้อัตโนมัติ');
  const led = (await wfQuery(`SELECT Id, PoolId, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, RebateAmount FROM wf.RebateLedger WHERE SoId=@id`,
    { id: { type: sql.NVarChar(50), value: String(soId) } })).recordset;
  if (!led.length) { bad('ไม่มีการตั้งยอดรีเบทค้างรับหลังชั่งออก'); }
  else {
    const l = led[0];
    ok(`ตั้งยอดค้างรับ ${led.length} บรรทัด (บรรทัดแรก ${l.QtyTon} ตัน × ฿${l.RebatePerTon}/ตัน)`);
    const total = led.reduce((sum, x) => sum + Number(x.RebateAmount), 0);
    total === QTY * (PRICE - NET)
      ? ok(`รวมทุกบรรทัด ฿${total.toLocaleString()} ถูกต้องตามสูตร (ราคาขาย − ราคาสุทธิ) × ตัน`)
      : bad(`ยอดรวมผิด ได้ ${total} ควรเป็น ${QTY * (PRICE - NET)}`);
  }
  const poolId = led[0]?.PoolId;

  if (!poolId) { console.log('\nหยุดที่นี่ — ไม่มี pool ให้ยื่นเคลม'); console.log(failed ? `\n${failed} ข้อไม่ผ่าน` : ''); process.exitCode = 1; return; }

  // R6-05 — ขอเคลียร์เกินยอดขนจริงต้องถูกบล็อก ไม่ใช่ตัดยอดให้เงียบ ๆ
  // ทดสอบก่อนยื่นจริง เพราะถ้า pool ถูกใช้หมดแล้ว ด่าน 'ยอดเกิน' จะตัดหน้าด่านกระทบยอด
  console.log('\n4.1 กระทบยอดกับการขนจริง (R6-05)');
  // ยอดขนจริงสะสมข้ามรอบทดสอบได้ จึงต้องอ่านค่าจริงมาแล้วบวกเกินไปเล็กน้อย
  // ถ้า hardcode ไว้ เทสจะผ่านหรือไม่ผ่านตามจำนวนครั้งที่เคยรัน ไม่ใช่ตามความถูกต้อง
  // ต้องอ่านจากแหล่งเดียวกับที่ endpoint ใช้ (dbo ของ WINSpeed) ไม่ใช่ ledger ของแอป
  // ไม่งั้นเทสจะเทียบกับตัวเลขคนละชุดแล้วผ่าน/ไม่ผ่านโดยไม่เกี่ยวกับความถูกต้อง
  const shipped = (await wfQuery(
    `SELECT SUM(d.GoodQty2) AS n
     FROM dbo.SOHD h JOIN dbo.SODT d ON d.SOID=h.SOID JOIN dbo.EMGood g ON g.GoodID=d.GoodID
     WHERE h.CustID=@c AND h.clearflag='Y' AND d.GoodQty2>0 AND g.GoodCode=@g`,
    { c: { type: sql.NVarChar(20), value: String(cust.CustID) }, g: { type: sql.NVarChar(50), value: goods[0].GoodCode } }
  )).recordset[0].n || 0;
  const overTon = Number(shipped) + 5;
  const over = await call(tSales, 'POST', '/api/rebate/claims', {
    poolId, custId: cust.CustID, note: TAG + ' ทดสอบขอเกินยอดขน',
    // ใช้ส่วนต่างราคา 1 บาท/ตัน เพื่อให้ด่าน 'ยอดเกิน' ไม่บังหน้าด่านกระทบยอด
    lines: [{ goodCode: goods[0].GoodCode, qtyTon: overTon, pricePerTon: 1, netPricePerTon: 0 }],
  });
  const od = await body(over);
  over.status === 400 && /ขนจริง/.test(JSON.stringify(od))
    ? ok('ขอเคลียร์เกินยอดขนถูกปฏิเสธ: ' + (od.reconciliation || [od.message])[0])
    : bad('ควรได้ 400 พร้อมเหตุผลกระทบยอด ได้ ' + over.status + ' ' + JSON.stringify(od).slice(0, 140));

  console.log('\n5. ยื่นใบขอเคลียร์จากยอดที่ตั้งไว้ (SALES)');
  r = await call(tSales, 'POST', '/api/rebate/claims', {
    poolId, custId: cust.CustID, note: `${TAG} เคลียร์จาก SO #${soId}`,
    invoices: [`INV-${TAG}-01`, `INV-${TAG}-02`],
    lines: [{ goodCode: good.GoodCode, goodName: good.GoodName1, qtyTon: QTY, pricePerTon: PRICE, netPricePerTon: NET }],
  });
  d = await body(r);
  if (!r.ok) return bad(`ยื่นเคลมไม่สำเร็จ (${r.status}) ${JSON.stringify(d).slice(0, 200)}`);
  const claimId = d.id || d.Id;

  // R6-04 — ใบกำกับที่ตัดเคลียร์ร่วมต้องถูกบันทึกครบ
  const inv = (await wfQuery(`SELECT DocuNo FROM wf.RebateClaimInvoice WHERE ClaimId=@id ORDER BY Id`,
    { id: { type: sql.Int, value: claimId } })).recordset;
  inv.length === 2 ? ok(`ผูกใบกำกับ ${inv.length} ใบ: ${inv.map(x => x.DocuNo).join(', ')}`)
    : bad(`ผูกใบกำกับได้ ${inv.length} ใบ ควรเป็น 2`);
  ok(`ใบขอเคลียร์ #${claimId} · ${d.status || d.Status}`);

  console.log('\n6. อนุมัติ 4 ชั้น');
  await step('ชั้น 2 ผู้จัดการภาค (คุณมนัส)', tRegion, 'POST', `/api/rebate/claims/${claimId}/approve`, { note: `${TAG} ชั้น 2` });
  const dup = await call(tRegion, 'POST', `/api/rebate/claims/${claimId}/approve`, {});
  dup.status === 403 ? ok('กันคนเดิมอนุมัติซ้ำชั้น (403)') : bad(`ควรได้ 403 ได้ ${dup.status}`);
  await step('ชั้น 3 ผู้จัดการฝ่ายตลาด', tMkt, 'POST', `/api/rebate/claims/${claimId}/approve`, { note: `${TAG} ชั้น 3` });
  await step('ชั้น 4 กรรมการบริหาร', tCL, 'POST', `/api/rebate/claims/${claimId}/approve`, { docuNo: `CN-${TAG}-001`, note: `${TAG} ชั้น 4` });

  const fin = (await wfQuery(`SELECT Status, CnDocuNo FROM wf.RebateClaim WHERE Id=@id`, { id: { type: sql.Int, value: claimId } })).recordset[0];
  ['APPROVED', 'CN_ISSUED'].includes(fin.Status) ? ok(`สถานะสุดท้าย ${fin.Status} · CN ${fin.CnDocuNo}`) : bad(`สถานะสุดท้าย ${fin.Status}`);

  const apps = (await wfQuery(`SELECT Tier, RequiredRole, DecidedByName FROM wf.RebateClaimApproval WHERE ClaimId=@id ORDER BY Tier`, { id: { type: sql.Int, value: claimId } })).recordset;
  for (const a of apps) console.log(`       ชั้น ${a.Tier} · ${a.RequiredRole} · โดย ${a.DecidedByName}`);
  apps.length >= 4 ? ok(`บันทึกครบ ${apps.length} ชั้น`) : bad(`บันทึกได้ ${apps.length} ชั้น`);

  console.log(failed ? `\n${failed} ข้อไม่ผ่าน` : '\nผ่านทุกข้อ');
  console.log(`\nข้อมูลทดสอบยังอยู่ในระบบ — SO #${soId} · ใบขอเคลียร์ #${claimId} · ทะเบียน ${PLATE}`);
  console.log('สั่งล้าง:  node backend/scripts/verify-rebate-full-loop.js --cleanup');
  process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.error('ผิดพลาด:', e.message); process.exitCode = 1; });
