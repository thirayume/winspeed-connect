'use strict';
/**
 * verify-rebate-single-source.js — พิสูจน์ว่ารีเบทใช้ "แหล่งข้อมูลเดียว" จริง
 *
 * สิ่งที่ต้องเป็นจริงหลัง migration 076/077:
 *   1. ยอดสะสมที่แอปเห็น = ยอดใน WINSpeed เป๊ะ ๆ (ไม่มีสำเนา ไม่มีการ sync)
 *   2. ใบขอเคลียร์ตัดสิทธิ์แบบ FIFO จากใบส่งของที่เก่าที่สุดก่อน
 *   3. ทุกบรรทัดชี้กลับไปยังบรรทัดใบส่งของต้นทางได้ (SourceSOID/SourceListNo)
 *   4. ขอเกินยอดขนจริง → ถูกปฏิเสธ พร้อมบอกว่าขาดเท่าไร
 *   5. ใบที่ถูกปฏิเสธ คืนตันกลับเข้ายอดคงเหลือทันที
 *
 *   node backend/scripts/verify-rebate-single-source.js
 *   node backend/scripts/verify-rebate-single-source.js --cleanup
 */

require('dotenv').config({ quiet: true });
const { sql, wfQuery } = require('../db');

const API = process.env.WF_API || 'http://localhost:3000';
const PASSWORD = process.env.E2E_PASSWORD || '***REMOVED-PASSWORD***';
const TAG = 'VERIFY-SINGLE-SOURCE';

let failed = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { console.log('  FAIL ' + m); failed++; };
const near = (a, b, tol = 0.001) => Math.abs(Number(a) - Number(b)) <= tol;
const n3 = (v) => Math.round(Number(v) * 1000) / 1000;

async function login(u) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`เข้าระบบเป็น ${u} ไม่สำเร็จ (${r.status})`);
  const d = await r.json();
  const t = d.token || d.accessToken || d?.data?.token;
  if (!t) throw new Error(`ไม่พบ token ของ ${u}`);
  return t;
}
const call = (t, m, p, b) => fetch(API + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
  body: b === undefined ? undefined : JSON.stringify(b),
});
const body = async (r) => { try { return await r.json(); } catch { return {}; } };

async function cleanup(quiet) {
  const claims = (await wfQuery(
    `SELECT Id FROM wf.RebateClaim WHERE Note LIKE @t`,
    { t: { type: sql.NVarChar(200), value: `%${TAG}%` } })).recordset || [];
  for (const c of claims) {
    const p = { id: { type: sql.Int, value: c.Id } };
    await wfQuery(`DELETE FROM wf.RebateClaimApproval WHERE ClaimId = @id`, p).catch(() => {});
    await wfQuery(`DELETE FROM wf.RebateClaimInvoice  WHERE ClaimId = @id`, p).catch(() => {});
    await wfQuery(`DELETE FROM wf.RebateClaimLine     WHERE ClaimId = @id`, p).catch(() => {});
    await wfQuery(`DELETE FROM wf.RebateClaim         WHERE Id = @id`, p).catch(() => {});
  }
  if (!quiet) console.log(`  ล้างใบทดสอบ ${claims.length} ใบ`);
  return claims.length;
}

async function main() {
  if (process.argv.includes('--cleanup')) { await cleanup(false); return; }
  await cleanup(true);

  console.log('\n1) ยอดสะสมที่แอปเห็น ต้องเท่ากับ WINSpeed เป๊ะ ๆ');
  const [src] = (await wfQuery(`
    SELECT COUNT(*) AS Lots, SUM(c.GoodQty) AS Ton
    FROM dbo.WFCoupon c JOIN dbo.SOHD h ON h.SOID = c.DocuID
    WHERE h.DocuType = 104`)).recordset;
  const [view] = (await wfQuery(`SELECT COUNT(*) AS Lots, SUM(QtyTon) AS Ton FROM wf.v_RebateAccrualLot`)).recordset;
  if (Number(src.Lots) === Number(view.Lots)) ok(`จำนวนล็อตตรงกัน (${Number(view.Lots).toLocaleString()} ล็อต)`);
  else bad(`จำนวนล็อตไม่ตรง — WINSpeed ${src.Lots} · แอปเห็น ${view.Lots}`);
  if (near(src.Ton, view.Ton, 0.01)) ok(`ยอดตันตรงกัน (${Number(view.Ton).toLocaleString()} ตัน)`);
  else bad(`ยอดตันไม่ตรง — WINSpeed ${src.Ton} · แอปเห็น ${view.Ton}`);

  const [mirror] = (await wfQuery(`SELECT COUNT(*) AS c FROM wf.CouponMirror`)).recordset;
  if (Number(mirror.c) === 0) ok('ไม่มีการใช้สำเนา wf.CouponMirror (0 แถว)');
  else bad(`ยังมีสำเนาค้างใน wf.CouponMirror ${mirror.c} แถว — เสี่ยงอ่านคนละยอดกับ WINSpeed`);

  console.log('\n2) เลือกลูกค้าที่มียอดขนจริงคงเหลือ แล้วดึงล็อตแบบ FIFO');
  const [pick] = (await wfQuery(`
    SELECT TOP 1 CustId, GoodCode, COUNT(*) AS Lots, SUM(RemainingTonRebate) AS Ton
    FROM wf.v_RebateAccrualRemaining
    WHERE RemainingTonRebate >= 2
    GROUP BY CustId, GoodCode
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC`)).recordset;
  if (!pick) { bad('หาลูกค้าที่มีอย่างน้อย 2 ล็อตของสูตรเดียวกันไม่ได้ — ข้ามการทดสอบ FIFO'); return finish(); }
  ok(`ลูกค้า ${pick.CustId} สูตร ${pick.GoodCode} — ${pick.Lots} ล็อต รวม ${n3(pick.Ton)} ตัน`);

  const token = await login('e2e_admin');
  const lotsRes = await call(token, 'GET', `/api/rebate/accrual/${encodeURIComponent(pick.CustId)}?goodCode=${encodeURIComponent(pick.GoodCode)}`);
  const lots = await body(lotsRes);
  if (!Array.isArray(lots) || !lots.length) { bad('เรียก /api/rebate/accrual/:custId ไม่ได้ล็อตกลับมา'); return finish(); }

  const sorted = [...lots].every((l, i, a) => i === 0 || String(a[i - 1].SourceDocuDate) <= String(l.SourceDocuDate));
  if (sorted) ok('ล็อตเรียงจากเก่าไปใหม่ (ลำดับเดียวกับที่เซิร์ฟเวอร์ตัด FIFO)');
  else bad('ล็อตไม่ได้เรียงตามวันที่ — ผู้ใช้จะเห็นคนละลำดับกับที่ถูกตัดจริง');

  console.log('\n3) ยื่นใบขอเคลียร์ที่ต้องกินข้ามล็อต — ต้องตัดใบเก่าก่อน');
  // ขอมากกว่าล็อตแรก 1 ตัน เพื่อบังคับให้ต้องข้ามไปล็อตที่สอง
  const first = lots[0];
  const second = lots[1];
  const want = n3(Number(first.RemainingTon) + Math.min(1, Number(second?.RemainingTon || 0)));
  if (!second || want <= Number(first.RemainingTon)) { bad('ไม่มีล็อตที่สองให้ทดสอบการข้ามล็อต'); return finish(); }

  const createRes = await call(token, 'POST', '/api/rebate/claims', {
    custId: String(pick.CustId),
    note: `${TAG} — ทดสอบตัด FIFO ข้ามล็อต`,
    lines: [{
      lineType: 'REBATE', goodCode: pick.GoodCode, qtyTon: want,
      pricePerTon: Number(first.ListPricePerTon) || 10000,
      netPricePerTon: (Number(first.ListPricePerTon) || 10000) - 500,
    }],
  });
  const claim = await body(createRes);
  if (!createRes.ok) { bad(`ยื่นใบขอเคลียร์ไม่สำเร็จ (${createRes.status}) ${JSON.stringify(claim).slice(0, 200)}`); return finish(); }
  ok(`ยื่นใบขอเคลียร์สำเร็จ #${claim.Id} · ${want} ตัน`);

  const claimLines = (await wfQuery(
    `SELECT [LineNo], QtyTon, SourceSOID, SourceListNo, SourceDocuNo, SourceDocuDate, SourceCouponNo
     FROM wf.RebateClaimLine WHERE ClaimId = @id ORDER BY [LineNo]`,
    { id: { type: sql.Int, value: claim.Id } })).recordset || [];

  if (claimLines.length >= 2) ok(`หนึ่งบรรทัดบนฟอร์มถูกกระจายเป็น ${claimLines.length} ล็อต`);
  else bad(`ควรถูกกระจายอย่างน้อย 2 ล็อต แต่ได้ ${claimLines.length}`);

  if (claimLines.every(l => l.SourceSOID && l.SourceListNo)) ok('ทุกบรรทัดชี้กลับไปยังบรรทัดใบส่งของต้นทางได้');
  else bad('มีบรรทัดที่ไม่มี SourceSOID/SourceListNo — ตรวจย้อนกลับตาม ISO ไม่ได้');

  if (String(claimLines[0]?.SourceDocuNo) === String(first.SourceDocuNo)) ok(`ตัดใบเก่าที่สุดก่อน (${first.SourceDocuNo})`);
  else bad(`ตัดผิดลำดับ — ควรเริ่มที่ ${first.SourceDocuNo} แต่ได้ ${claimLines[0]?.SourceDocuNo}`);

  if (near(claimLines[0]?.QtyTon, first.RemainingTon)) ok(`ล็อตแรกถูกใช้จนหมด (${n3(first.RemainingTon)} ตัน)`);
  else bad(`ล็อตแรกควรถูกใช้ ${n3(first.RemainingTon)} ตัน แต่ใช้ ${n3(claimLines[0]?.QtyTon)}`);

  const totalCut = claimLines.reduce((s, l) => s + Number(l.QtyTon), 0);
  if (near(totalCut, want)) ok(`ตันที่ตัดรวมเท่ากับที่ขอพอดี (${n3(totalCut)} ตัน)`);
  else bad(`ตันที่ตัดรวม ${n3(totalCut)} ไม่เท่ากับที่ขอ ${want}`);

  console.log('\n4) ยอดคงเหลือต้องลดลงทันทีโดยไม่ต้อง sync อะไร');
  const [afterFirst] = (await wfQuery(`
    SELECT RemainingTonRebate FROM wf.v_RebateAccrualRemaining
    WHERE SourceSOID = @s AND SourceListNo = @l`,
    { s: { type: sql.Int, value: first.SourceSOID }, l: { type: sql.Int, value: first.SourceListNo } })).recordset;
  if (near(afterFirst?.RemainingTonRebate, 0)) ok('ล็อตแรกเหลือ 0 ตัน');
  else bad(`ล็อตแรกควรเหลือ 0 แต่เหลือ ${afterFirst?.RemainingTonRebate}`);

  console.log('\n5) ขอเกินยอดขนจริง — ต้องถูกปฏิเสธพร้อมบอกว่าขาดเท่าไร');
  const [poolLeft] = (await wfQuery(`
    SELECT SUM(RemainingTonRebate) AS Ton FROM wf.v_RebateAccrualRemaining
    WHERE CustId = @c AND GoodCode = @g`,
    { c: { type: sql.NVarChar(20), value: String(pick.CustId) }, g: { type: sql.NVarChar(50), value: pick.GoodCode } })).recordset;
  const overRes = await call(token, 'POST', '/api/rebate/claims', {
    custId: String(pick.CustId),
    note: `${TAG} — ทดสอบขอเกิน`,
    lines: [{ lineType: 'REBATE', goodCode: pick.GoodCode, qtyTon: n3(Number(poolLeft.Ton) + 5), pricePerTon: 10000, netPricePerTon: 9500 }],
  });
  const overBody = await body(overRes);
  if (overRes.status === 400 && /ขนจริง/.test(JSON.stringify(overBody))) ok('ขอเกินถูกปฏิเสธ พร้อมเหตุผลที่อ่านออก');
  else bad(`ขอเกินควรถูกปฏิเสธด้วย 400 แต่ได้ ${overRes.status} ${JSON.stringify(overBody).slice(0, 160)}`);

  console.log('\n6) ใบที่ถูกปฏิเสธ ต้องคืนตันกลับทันที');
  await wfQuery(`UPDATE wf.RebateClaim SET Status = 'REJECTED' WHERE Id = @id`, { id: { type: sql.Int, value: claim.Id } });
  const [restored] = (await wfQuery(`
    SELECT RemainingTonRebate FROM wf.v_RebateAccrualRemaining
    WHERE SourceSOID = @s AND SourceListNo = @l`,
    { s: { type: sql.Int, value: first.SourceSOID }, l: { type: sql.Int, value: first.SourceListNo } })).recordset;
  if (near(restored?.RemainingTonRebate, first.RemainingTon)) ok(`ตันกลับคืนครบ (${n3(first.RemainingTon)} ตัน)`);
  else bad(`ตันควรกลับคืนเป็น ${n3(first.RemainingTon)} แต่ได้ ${restored?.RemainingTonRebate}`);

  console.log('\n7) เส้นทางเก่าที่ทำให้ข้อมูลแยกกัน ต้องถูกปิดแล้ว');
  const gone = await call(token, 'POST', '/api/rebate/migrate-legacy', { rate: 100 });
  if (gone.status === 404) ok('POST /api/rebate/migrate-legacy ถูกถอดออกแล้ว');
  else bad(`POST /api/rebate/migrate-legacy ยังตอบ ${gone.status} — ยังย้ายข้อมูลซ้ำได้อยู่`);
  const sync = await call(token, 'POST', '/api/rebate/sync-mirror', {});
  if (sync.status === 410) ok('POST /api/rebate/sync-mirror ตอบ 410 พร้อมบอกทางแทน');
  else bad(`POST /api/rebate/sync-mirror ควรตอบ 410 แต่ได้ ${sync.status}`);

  console.log('\n8) เอกสารคืนรีเบทของ WINSpeed (RB) — รหัสผู้ขอและการกระทบยอด');

  // อักษรในเลขที่เอกสารเป็นร่องรอยเดียวที่บอกว่าใครขอ เพราะ WINSpeed ไม่บันทึก EmpID
  const [empty] = (await wfQuery(`
    SELECT COUNT(*) AS Docs, SUM(CASE WHEN EmpID IS NULL THEN 1 ELSE 0 END) AS NoEmp
    FROM dbo.SOInvHD WHERE DocuNo LIKE 'RB%' AND Docutype = 106`)).recordset;
  if (Number(empty.Docs) > 0 && Number(empty.NoEmp) === Number(empty.Docs)) {
    ok(`ยืนยันว่า WINSpeed ไม่บันทึกผู้ขอบนใบ RB (${Number(empty.Docs).toLocaleString()} ใบ · EmpID ว่างทุกใบ)`);
  } else if (Number(empty.Docs) === 0) {
    bad('ไม่พบเอกสาร RB ในฐานนี้ — ตรวจว่าฐานที่ต่ออยู่มีข้อมูลครบหรือไม่');
  } else {
    ok(`ใบ RB ${Number(empty.Docs).toLocaleString()} ใบ · มี EmpID ${Number(empty.Docs) - Number(empty.NoEmp)} ใบ`);
  }

  const ev = (await wfQuery(`SELECT TOP 1 SeriesCode, EmpName, DocCount FROM wf.v_RebateDocCodeEvidence ORDER BY DocCount DESC`)).recordset?.[0];
  if (ev) ok(`view หลักฐานรหัสผู้ขอทำงาน (${ev.SeriesCode} → ${ev.EmpName} ${Number(ev.DocCount).toLocaleString()} ใบ)`);
  else bad('wf.v_RebateDocCodeEvidence ไม่คืนข้อมูล — ผู้ดูแลจะตั้งรหัสโดยไม่มีหลักฐานประกอบ');

  // รหัสซ้ำกันไม่ได้ — เลขที่เอกสารสองคนจะชนกันและตรวจย้อนกลับไม่ได้ว่าใครขอ
  const me = (await wfQuery(`SELECT TOP 1 Id FROM wf.AppUser WHERE Username = 'e2e_sales'`)).recordset?.[0];
  const other = (await wfQuery(`SELECT TOP 1 Id FROM wf.AppUser WHERE Username = 'e2e_manager'`)).recordset?.[0];
  if (me && other) {
    const a = await call(token, 'PATCH', `/api/rebate/doc-codes/${me.Id}`, { code: 'ZZ' });
    const b = await call(token, 'PATCH', `/api/rebate/doc-codes/${other.Id}`, { code: 'ZZ' });
    a.ok ? ok('ตั้งรหัสผู้ขอให้ผู้ใช้ได้') : bad(`ตั้งรหัสไม่สำเร็จ (${a.status})`);
    b.status === 409 ? ok('รหัสซ้ำถูกปฏิเสธ (409)') : bad(`รหัสซ้ำควรได้ 409 แต่ได้ ${b.status}`);

    const nx = await body(await call(token, 'GET', `/api/rebate/next-rb-no?userId=${me.Id}`));
    /^RBZZ\d{2}-\d{3}$/.test(String(nx.suggested || ''))
      ? ok(`เสนอเลขที่ถัดไปถูกรูปแบบ: ${nx.suggested}`)
      : bad(`รูปแบบเลขที่ที่เสนอผิด: ${JSON.stringify(nx).slice(0, 120)}`);

    // คืนค่าเดิม ไม่ทิ้งรหัสทดสอบไว้ในระบบ
    await call(token, 'PATCH', `/api/rebate/doc-codes/${me.Id}`, { code: null });
  }

  const rec = await body(await call(token, 'GET', '/api/rebate/rb-reconciliation?onlyProblems=true'));
  Array.isArray(rec.rows)
    ? ok(`รายงานกระทบยอดทำงาน (${Object.entries(rec.summary || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'ไม่มีรายการ'})`)
    : bad('รายงานกระทบยอดไม่คืนข้อมูล');

  await cleanup(true);
  return finish();
}

function finish() {
  console.log(failed ? `\n✗ ไม่ผ่าน ${failed} ข้อ` : '\n✓ ผ่านทุกข้อ');
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n✗ ' + e.message);
  await cleanup(true).catch(() => {});
  process.exit(1);
});
