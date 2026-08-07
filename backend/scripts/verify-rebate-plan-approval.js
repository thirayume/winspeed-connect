'use strict';
/**
 * verify-rebate-plan-approval.js — สายอนุมัติของแบบขออนุมัติรายการส่งเสริมการขาย
 *
 * ตรวจว่าเดินครบ 4 ชั้น ตีกลับได้ และชั้นที่ 3 เป็น "ผู้จัดการฝ่ายขาย"
 * ซึ่งต่างจากใบขอเคลียร์ที่ชั้น 3 เป็นผู้จัดการฝ่ายตลาด
 *
 *   node backend/scripts/verify-rebate-plan-approval.js
 *   node backend/scripts/verify-rebate-plan-approval.js --cleanup
 */
require('dotenv').config({ quiet: true });
const { sql, wfQuery } = require('../db');

const API = process.env.WF_API || 'http://localhost:3000';
const PASSWORD = process.env.E2E_PASSWORD;
if (!PASSWORD) {
  // ไม่ใส่ค่าปริยายเป็นรหัสจริง — ที่เก็บซอร์สนี้เป็นสาธารณะ
  console.error('ต้องตั้ง E2E_PASSWORD ก่อนรัน (ใส่ใน backend/.env ซึ่งไม่ถูก commit)');
  process.exit(1);
}
const TAG = 'UATPLAN';

let failed = 0;
const ok = m => console.log('  ok   ' + m);
const bad = m => { console.log('  FAIL ' + m); failed++; };

async function login(u) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: PASSWORD }) });
  if (!r.ok) throw new Error(`เข้าระบบเป็น ${u} ไม่สำเร็จ (${r.status})`);
  const d = await r.json();
  return d.token || d.accessToken || d?.data?.token;
}
const call = (t, m, p, b) => fetch(API + p, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
  body: b === undefined ? undefined : JSON.stringify(b) });
const body = async r => { try { return await r.json(); } catch { return {}; } };

async function cleanup(quiet) {
  const plans = (await wfQuery(`SELECT PlanId FROM wf.RebatePlan WHERE Note LIKE @t OR Title LIKE @t`,
    { t: { type: sql.NVarChar(300), value: `%${TAG}%` } })).recordset;
  for (const p of plans) {
    const id = { id: { type: sql.Int, value: p.PlanId } };
    await wfQuery(`DELETE FROM wf.RebatePlanApproval WHERE PlanId=@id`, id);
    await wfQuery(`DELETE FROM wf.RebatePlan WHERE PlanId=@id`, id).catch(() => {});
  }
  if (!quiet) console.log(`  ลบโปรโมชั่นทดสอบ ${plans.length} รายการ`);

  // ถอดการผูกภาคชั่วคราวของผู้ใช้ทดสอบ — ไม่แตะการแต่งตั้งจริงของพนักงาน
  await wfQuery(`
    DELETE FROM wf.UserSaleArea
    WHERE UserId IN (SELECT Id FROM wf.AppUser WHERE Username LIKE 'e2e[_]%')`).catch(() => {});
}

/**
 * ผู้อนุมัติชั้น 2 ของภาค 05
 *
 * ใช้ของจริงถ้าผู้ดูแลตั้งไว้แล้ว ไม่งั้นผูกผู้ใช้ทดสอบให้ชั่วคราว
 * การผูกชื่อพนักงานไว้ตายตัวทำให้เทสต์ล้มทันทีที่ผู้ดูแลย้ายผู้จัดการภาคจากหน้าจอ
 * ซึ่งเป็นสิ่งที่ระบบตั้งใจให้ทำได้
 */
async function regionApprover() {
  const found = (await wfQuery(`
    SELECT TOP 1 u.Username FROM wf.UserSaleArea a JOIN wf.AppUser u ON u.Id = a.UserId
    WHERE a.RegionCode = '05' AND u.IsActive = 1
    ORDER BY a.IsPrimary DESC, a.UserId`)).recordset[0];
  if (found) return found.Username;
  await wfQuery(`
    INSERT INTO wf.UserSaleArea (UserId, RegionCode, IsPrimary)
    SELECT Id, '05', 1 FROM wf.AppUser WHERE Username = 'e2e_approver'`);
  return 'e2e_approver';
}

async function main() {
  if (process.argv.includes('--cleanup')) { console.log('ล้างข้อมูลทดสอบ'); await cleanup(false); return; }
  await cleanup(true);

  const tSales = await login('e2e_sales');
  const tRegion = await login(await regionApprover());   // ผู้ที่ถูกผูกกับภาค 05
  const tMgr = await login('e2e_manager');     // ผู้จัดการฝ่ายขาย
  const tCL = await login('e2e_clevel');

  console.log('1. สร้างและยื่นแบบขออนุมัติโปรโมชั่น');
  let r = await call(tMgr, 'POST', '/api/rebate/plans', {
    title: `${TAG} โปรฯ ภาคใต้ สูตร 18-4-5`, region: '05', goodCodePattern: 'TEST-18-4-5',
    netPrice: 12300, validFrom: '2026-07-01', validTo: '2026-07-31',
    allocatedAmount: 100000, note: `${TAG} ทดสอบสายอนุมัติ`,
  });
  let d = await body(r);
  if (!r.ok) return bad(`สร้างไม่สำเร็จ (${r.status}) ${JSON.stringify(d).slice(0, 150)}`);
  const planId = d.id || d.PlanId || d.planId;
  ok(`สร้างโปรโมชั่น #${planId} ${d.planNo || d.PlanNo || ''}`);

  r = await call(tSales, 'POST', `/api/rebate/plans/${planId}/submit`, {});
  d = await body(r);
  r.ok && d.currentTier === 2 ? ok(`ยื่นแล้ว รอชั้น 2 (${d.status})`) : bad(`ยื่นล้มเหลว (${r.status}) ${JSON.stringify(d).slice(0, 140)}`);

  console.log('\n2. ตีกลับจากชั้นที่ 2 แล้วยื่นใหม่');
  r = await call(tMgr, 'POST', `/api/rebate/plans/${planId}/reject`, {});
  r.status === 400 ? ok('ตีกลับโดยไม่ระบุเหตุผลถูกปฏิเสธ (400)') : bad(`ควรได้ 400 ได้ ${r.status}`);

  r = await call(tMgr, 'POST', `/api/rebate/plans/${planId}/reject`, { reason: `${TAG} ราคาสุทธิต่ำเกินไป` });
  d = await body(r);
  r.ok && d.status === 'REJECTED' ? ok('ตีกลับพร้อมเหตุผลสำเร็จ') : bad(`ตีกลับล้มเหลว (${r.status})`);

  r = await call(tSales, 'POST', `/api/rebate/plans/${planId}/submit`, {});
  d = await body(r);
  r.ok ? ok('ยื่นใหม่หลังถูกตีกลับได้') : bad(`ยื่นใหม่ล้มเหลว (${r.status}) ${JSON.stringify(d).slice(0, 140)}`);

  const afterResubmit = (await wfQuery(`SELECT COUNT(*) n FROM wf.RebatePlanApproval WHERE PlanId=@id`,
    { id: { type: sql.Int, value: planId } })).recordset[0].n;
  Number(afterResubmit) === 1
    ? ok('ยื่นใหม่ล้างลายเซ็นเดิมทิ้ง เหลือเฉพาะการยื่นครั้งล่าสุด')
    : bad(`ยังเหลือร่องรอยเก่า ${afterResubmit} แถว ควรเหลือ 1`);

  console.log('\n3. เดินครบ 4 ชั้น');
  r = await call(tRegion, 'POST', `/api/rebate/plans/${planId}/approve`, {});
  d = await body(r);
  r.ok && d.currentTier === 3 ? ok('ชั้น 2 ผู้จัดการภาค (ผู้ดูแลภาคที่บทบาทเป็น SALES)') : bad(`ชั้น 2 ล้มเหลว (${r.status}) ${JSON.stringify(d).slice(0, 140)}`);

  r = await call(tRegion, 'POST', `/api/rebate/plans/${planId}/approve`, {});
  r.status === 403 ? ok('คนเดิมอนุมัติชั้นถัดไปถูกปฏิเสธ (403)') : bad(`ควรได้ 403 ได้ ${r.status}`);

  r = await call(tSales, 'POST', `/api/rebate/plans/${planId}/approve`, {});
  r.status === 403 ? ok('บทบาท SALES ทั่วไปอนุมัติชั้น 3 ไม่ได้') : bad(`ควรได้ 403 ได้ ${r.status}`);

  r = await call(tMgr, 'POST', `/api/rebate/plans/${planId}/approve`, {});
  d = await body(r);
  r.ok && d.currentTier === 4 ? ok('ชั้น 3 ผู้จัดการฝ่ายขาย') : bad(`ชั้น 3 ล้มเหลว (${r.status}) ${JSON.stringify(d).slice(0, 140)}`);

  r = await call(tMgr, 'POST', `/api/rebate/plans/${planId}/approve`, {});
  r.status === 403 ? ok('ชั้น 4 ต้องเป็นกรรมการบริหารเท่านั้น') : bad(`ควรได้ 403 ได้ ${r.status}`);

  r = await call(tCL, 'POST', `/api/rebate/plans/${planId}/approve`, {});
  d = await body(r);
  r.ok && d.status === 'APPROVED' ? ok('ชั้น 4 กรรมการบริหาร — อนุมัติครบ') : bad(`ชั้น 4 ล้มเหลว (${r.status}) ${JSON.stringify(d).slice(0, 140)}`);

  console.log('\n4. ร่องรอยการอนุมัติ');
  const trail = (await wfQuery(
    `SELECT Tier, RequiredRole, Decision, DecidedByName FROM wf.RebatePlanApproval WHERE PlanId=@id ORDER BY Tier`,
    { id: { type: sql.Int, value: planId } })).recordset;
  for (const a of trail) console.log(`       ชั้น ${a.Tier} · ${a.RequiredRole} · ${a.Decision} · โดย ${a.DecidedByName}`);
  trail.length === 4 ? ok('บันทึกครบ 4 ชั้น') : bad(`บันทึกได้ ${trail.length} ชั้น`);
  trail.find(a => a.Tier === 3)?.RequiredRole === 'SALES_MGR'
    ? ok('ชั้นที่ 3 เป็นผู้จัดการฝ่ายขาย ต่างจากใบขอเคลียร์ที่เป็นฝ่ายตลาด')
    : bad('ชั้นที่ 3 ไม่ใช่ SALES_MGR');
  new Set(trail.map(a => a.DecidedByName)).size >= 3
    ? ok(`ผู้อนุมัติต่างคนกัน ${new Set(trail.map(a => a.DecidedByName)).size} คน`)
    : bad('ผู้อนุมัติซ้ำกันเกินไป');

  console.log(failed ? `\n${failed} ข้อไม่ผ่าน` : '\nผ่านทุกข้อ');
  console.log(`\nข้อมูลทดสอบยังอยู่ในระบบ — โปรโมชั่น #${planId}`);
  console.log('สั่งล้าง:  node backend/scripts/verify-rebate-plan-approval.js --cleanup');
  process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.error('ผิดพลาด:', e.message); process.exitCode = 1; });
