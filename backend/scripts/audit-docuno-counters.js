/**
 * audit-docuno-counters.js — ตรวจว่าตัวนับเลขที่เอกสารของ WINSpeed ตรงกับเอกสารจริงหรือไม่
 *
 * ทำไมต้องมี
 *   WINSpeed เก็บ "เลขล่าสุดที่ออกไป" ไว้ที่ dbo.EMRunBrch.LastNo แล้วออกเลขถัดไปจากค่านั้น
 *   ถ้าค่านั้นล้าหลังเอกสารจริง โปรแกรมจะออกเลขที่ถูกใช้ไปแล้ว → บันทึกไม่ผ่านเพราะชนคีย์
 *   และ **ไม่มีอะไรในระบบตรวจจับเรื่องนี้เลย** จนกว่าผู้ใช้จะกดบันทึกแล้วเจอ error
 *
 *   เจอจริง 19/08/2569 ตอนออกใบแจ้งหนี้จากใบส่งของ K69-01852
 *     creditsale_docuno = J69-02805  แต่ J69-02806 มีอยู่แล้ว      → ชนคีย์ทันที
 *     creditsale_invno  = N55-00000  ค้างจากปี 2555 ทั้งที่ชุด N69 ใช้ไป 1,960 ใบ
 *                                     → โปรแกรมนับใหม่จาก N69-00001 บันทึกไม่ผ่านเลยสักครั้ง
 *
 *   ตัวนับของแอปเราเองมี advanceDocuNoCounter คุมชุด I/K อยู่แล้ว (services/winspeed-counter.js)
 *   สคริปต์นี้ตรวจ "ทุกชุดในสายขาย" รวมชุดที่แอปไม่ได้ออกเลขเอง เพื่อให้เห็นก่อนถึงมือผู้ใช้
 *
 * USAGE
 *   node scripts/audit-docuno-counters.js                  # ตรวจอย่างเดียว
 *   node scripts/audit-docuno-counters.js --fix            # เดินตัวนับที่ล้าหลังให้ตรงเอกสารจริง
 *   DB_MODE=remote_b node scripts/audit-docuno-counters.js # เลือกปลายทาง
 *
 * ตรวจสองอาการที่คนละเรื่องกัน
 *   **ล้าหลัง** — ตัวนับต่ำกว่าเอกสารจริง → ออกเลขซ้ำ → บันทึกไม่ผ่าน (ผู้ใช้เห็นทันที)
 *   **ล้ำหน้า** — ตัวนับสูงกว่าเอกสารจริง → เลขถัดไปข้าม → ช่องว่างถาวรในลำดับ
 *                 ไม่ทำให้บันทึกพลาดจึงไม่มีใครสังเกต แต่ร้ายแรงกว่าสำหรับใบกำกับภาษี
 *                 ที่กฎหมายกำหนดให้เรียงต่อเนื่อง
 *
 *   เจอจริง 24/08/2569: creditsale_invno = N69-01961 แต่เอกสารล่าสุดคือ N69-01960
 *   WINSpeed เตือนเองตอนบันทึกว่า "เลขที่ใบกำกับข้ามเลขที่ N69-01961"
 *   สคริปต์รุ่นก่อนหน้ารายงานชุดนี้ว่า "ตรง" เพราะตรวจแค่ทิศล้าหลัง
 *
 * EXIT: 0 = ตัวนับตรงหมด · 1 = พบล้าหลังหรือล้ำหน้า (หรือแก้ไม่สำเร็จ)
 *
 * ⚠ --fix เขียน dbo.EMRunBrch.LastNo เท่านั้น ซึ่งอยู่ในรายการ dbo write ที่ได้รับอนุมัติ
 *   และเดินไปข้างหน้าอย่างเดียว ไม่มีทางถอยเลขกลับ
 *   **จึงแก้ได้เฉพาะกรณีล้าหลัง** — กรณีล้ำหน้าต้องถอยเลข ซึ่งเป็นการตัดสินใจทางบัญชี
 *   สคริปต์จะรายงานอย่างเดียว ไม่แตะให้
 *
 * ⚠ แก้ตารางแล้วยังไม่พอ — โปรแกรม WINSpeed จำเลขที่ออกไว้ตั้งแต่ตอนเปิดหน้าจอ
 *   ผู้ใช้ต้องปิดแล้วเปิดหน้าจอนั้นใหม่ ตัวนับที่แก้จึงจะมีผล
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), quiet: true });
const { sql, pools, DEFAULT_TARGET } = require('../db');

const FIX = process.argv.includes('--fix');
const C = { red: s => `\x1b[31m${s}\x1b[0m`, grn: s => `\x1b[32m${s}\x1b[0m`,
            yel: s => `\x1b[33m${s}\x1b[0m`, cyn: s => `\x1b[36m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m` };

/**
 * ชุดเลขในสายขายที่เอกสารของเราเดินผ่าน
 *
 * ขอบเขตจงใจแคบ — WINSpeed มีชุดเลขกว่า 60 ชุด (ผลิต คลัง ซ่อมบำรุง ฯลฯ) ที่ระบบนี้ไม่แตะ
 * การไปตรวจชุดที่ไม่มีใครใช้จะได้แต่ false positive เพราะตัวนับค้างมาตั้งแต่ติดตั้ง
 */
const SERIES = [
  { runCode: '103',                table: 'dbo.SOHD',           column: 'DocuNo',      where: "DocuType = '103'",  label: 'ใบสั่งจอง' },
  { runCode: '104',                table: 'dbo.SOHD',           column: 'DocuNo',      where: "DocuType = '104'",  label: 'ใบสั่งขาย/ใบส่งของ' },
  { runCode: '119',                table: 'dbo.SOHD',           column: 'AppvDocuNo',  where: null,                label: 'อนุมัติใบสั่งจอง' },
  { runCode: 'couponno',           table: 'dbo.WFCoupon',       column: 'CouponNo',    where: null,                label: 'ตั๋วปุ๋ย' },
  { runCode: 'creditsale_docuno',  table: 'dbo.SOInvHD',        column: 'DocuNo',      where: "Docutype = '107'",  label: 'ขายเชื่อ' },
  { runCode: 'creditsale_invno',   table: 'dbo.SOInvHD',        column: 'InvNo',       where: "Docutype = '107'",  label: 'ขายเชื่อ (เลขใบกำกับภาษี)' },
  { runCode: '106',                table: 'dbo.SOInvHD',        column: 'DocuNo',      where: "Docutype = '106'",  label: 'รับเงินมัดจำ / RB' },
  { runCode: '109',                table: 'dbo.SOInvHD',        column: 'DocuNo',      where: "Docutype = '109'",  label: 'รับคืน/ลดหนี้' },
  // ใบรับชำระหนี้หนึ่งใบกินเลขสองชุด — DocuNo (RVyy) และ RecpNo (REyy) เดินคนละตัวนับ
  // ถ้าตรวจแต่ 206 จะพลาด 209 ไปเงียบ ๆ แล้วไปตายตอนบันทึกเหมือนกัน
  { runCode: '206',                table: 'dbo.ARReceHD',       column: 'DocuNo',      where: null,                label: 'รับชำระหนี้' },
  { runCode: '209',                table: 'dbo.ARReceHD',       column: 'RecpNo',      where: null,                label: 'รับชำระหนี้ (เลขที่ใบเสร็จ)' },
  { runCode: 'redemption',         table: 'dbo.WFRedemtionHD',  column: 'DocuNo',      where: null,                label: 'ตัดตั๋วปุ๋ย' },
];

/** ตัวอักษรนำหน้าของเลขที่เอกสาร เช่น I69-02432 → "I" · AI69-04544 → "AI" · 69061150 → "" */
function alphaPrefix(no) {
  const m = String(no || '').match(/^[A-Za-z]+/);
  return m ? m[0] : '';
}

/**
 * ตรวจทุกชุดเลข คืน { rows, behind } โดยไม่พิมพ์อะไรและไม่แก้อะไร
 * แยกออกมาเพื่อให้ preflight-check.js เรียกใช้ตัวตรวจเดียวกันได้ ไม่ต้องมีสองชุดให้เพี้ยนกัน
 */
async function checkCounters(read) {
  const behind = [];
  const ahead  = [];
  const rows = [];

  for (const s of SERIES) {
    const counters = (await read.request()
      .input('rc', sql.VarChar(50), s.runCode)
      .query('SELECT BrchID, RTRIM(LastNo) AS LastNo FROM dbo.EMRunBrch WHERE RunCode = @rc')).recordset;


    if (!counters.length) {
      rows.push({ ชุด: s.runCode, งาน: s.label, ตัวนับ: '(ไม่มีแถว)', เอกสารล่าสุด: '-', สถานะ: 'ข้าม' });
      continue;
    }

    for (const c of counters) {
      const prefix = alphaPrefix(c.LastNo);
      // จำกัดด้วยตัวอักษรนำหน้าเดียวกัน — เอกสารชนิดเดียวกันมีได้หลายชุด
      // เช่น DocuType 103 มีทั้งเลขขึ้นต้น I และ K ซึ่งเดินคนละตัวนับ
      //
      // และต้องตัดเอกสารทดสอบที่ลงท้ายด้วยตัวอักษรออก (I69-TEST, AI69-TEST, RBT69-TEST)
      // เพราะ MAX() เป็นการเทียบข้อความ 'I69-TEST' จึงมากกว่า 'I69-02432' ทั้งที่ไม่ใช่เลขในชุด
      const tailNotAlpha = `SUBSTRING(RTRIM(${s.column}), ${prefix.length + 1}, 100) NOT LIKE '%[A-Za-z]%'`;
      const prefixFilter = prefix
        ? `RTRIM(${s.column}) LIKE '${prefix}%' AND ${tailNotAlpha}`
        : `RTRIM(${s.column}) NOT LIKE '%[A-Za-z]%'`;
      const conds = [
        `${s.column} IS NOT NULL`,
        `RTRIM(${s.column}) <> ''`,
        prefixFilter,
        s.where,
      ].filter(Boolean).join(' AND ');

      let actual = null;
      try {
        // นับเอกสารที่ "อยู่เหนือตัวนับ" ตรง ๆ แทนการเอาเลขมาลบกัน
        // รูปแบบเลขแต่ละชุดไม่เหมือนกัน (บางชุดมีเดือนหรือรหัสชุดคั่นกลาง) การลบจึงไร้ความหมาย
        const r = await read.request()
          .input('last', sql.VarChar(50), String(c.LastNo).trim())
          .query(`SELECT MAX(RTRIM(${s.column})) AS MaxNo,
                         SUM(CASE WHEN RTRIM(${s.column}) > @last THEN 1 ELSE 0 END) AS Above
                  FROM ${s.table} WHERE ${conds}`);
        actual = r.recordset[0];
      } catch (e) {
        rows.push({ ชุด: s.runCode, งาน: s.label, ตัวนับ: c.LastNo, เอกสารล่าสุด: 'อ่านไม่ได้', สถานะ: e.message.slice(0, 40) });
        continue;
      }

      const maxNo = actual?.MaxNo || null;
      if (!maxNo) {
        rows.push({ ชุด: s.runCode, งาน: s.label, ตัวนับ: c.LastNo, เอกสารล่าสุด: '(ยังไม่มีเอกสาร)', สถานะ: 'ว่าง' });
        continue;
      }

      // เทียบแบบข้อความ — รูปแบบเลขกว้างคงที่และปีอยู่ตำแหน่งเดิม การเรียงจึงตรงกับลำดับจริง
      const last = String(c.LastNo).trim();
      const top  = String(maxNo).trim();
      const isBehind = last < top;
      // ตัวนับ "ล้ำหน้า" เอกสารจริง = เลขถูกกินไปโดยไม่มีเอกสารเกิด
      // (มีคนกดบันทึกแล้วยกเลิกกลางคัน) เลขถัดไปจะข้าม ทิ้งช่องว่างถาวรในลำดับ
      // ไม่ทำให้บันทึกพลาดจึงไม่มีใครสังเกต แต่ร้ายแรงกว่าสำหรับชุดใบกำกับภาษี
      const isAhead = last > top;
      const above = Number(actual?.Above || 0);
      const status = isBehind ? C.red(`ล้าหลัง · มีเอกสารเหนือตัวนับ ${above} ใบ`)
                   : isAhead  ? C.yel('ล้ำหน้า · เลขถัดไปจะข้าม')
                   :            C.grn('ตรง');

      rows.push({ ชุด: s.runCode, งาน: s.label, ตัวนับ: c.LastNo, เอกสารล่าสุด: maxNo, สถานะ: status });
      if (isBehind) behind.push({ ...s, brchId: c.BrchID, lastNo: c.LastNo, maxNo, above });
      if (isAhead)  ahead.push({ ...s, brchId: c.BrchID, lastNo: c.LastNo, maxNo });
    }
  }

  return { rows, behind, ahead };
}

async function main() {
  const target = DEFAULT_TARGET;
  const entry = pools(target);
  await entry.ready;
  const read = entry.readerPool;
  const owner = entry.ownerPool;

  console.log(C.cyn(`\n=== ตรวจตัวนับเลขที่เอกสาร · ปลายทาง ${target} ===`));
  if (FIX) console.log(C.yel('โหมด --fix : ตัวนับที่ล้าหลังจะถูกเดินให้ตรงเอกสารจริง'));

  const { rows, behind, ahead } = await checkCounters(read);
  console.table(rows);

  // รายงานตัวนับล้ำหน้าเสมอ — คนละอาการ คนละความเสียหายกับตัวล้าหลัง
  if (ahead.length) {
    console.log(C.yel(`
! พบตัวนับล้ำหน้าเอกสารจริง ${ahead.length} ชุด — เลขที่ออกครั้งถัดไปจะข้าม`));
    for (const a of ahead) {
      const taxy = /inv/i.test(a.runCode) || /ใบกำกับ|ใบเสร็จ/.test(a.label || '');
      console.log(`    ${a.runCode} (${a.label}) : ตัวนับ ${a.lastNo} · เอกสารล่าสุด ${a.maxNo}`
        + (taxy ? C.red('   ← ชุดนี้ต้องเรียงต่อเนื่องตามกฎหมาย') : ''));
    }
    console.log(C.dim('  เลขถูกกินไปโดยไม่มีเอกสารเกิด (กดบันทึกแล้วยกเลิกกลางคัน)'));
    console.log(C.dim('  --fix ไม่แตะกรณีนี้ — การถอยเลขเป็นการตัดสินใจทางบัญชี'));
    console.log(C.dim('  ถ้าจะปิดช่องว่าง ให้ออกเอกสารถัดไปโดยระบุเลขที่ค้างนั้นเอง'));
  }

  if (!behind.length) {
    if (!ahead.length) {
      console.log(C.grn('\n✓ ตัวนับตรงกับเอกสารจริงทุกชุด'));
      return 0;
    }
    return 1;   // ล้ำหน้าอย่างเดียวก็ยังต้องมีคนดู
  }

  console.log(C.red(`\n✗ พบตัวนับล้าหลัง ${behind.length} ชุด — เอกสารชุดนี้จะบันทึกไม่ผ่านเพราะออกเลขซ้ำ`));
  for (const b of behind) console.log(`    ${b.runCode} (${b.label}) : ${b.lastNo} → ควรเป็น ${b.maxNo}`);

  if (!FIX) {
    console.log(C.dim('\n  รันซ้ำด้วย --fix เพื่อเดินตัวนับให้ตรง'));
    return 1;
  }

  console.log(C.yel('\nกำลังเดินตัวนับ...'));
  let failed = 0;
  for (const b of behind) {
    try {
      // เงื่อนไข LastNo < @max กันไม่ให้ถอยเลขกลับ ถ้ามีใครแก้ไปแล้วระหว่างนี้
      const r = await owner.request()
        .input('rc', sql.VarChar(50), b.runCode)
        .input('br', sql.VarChar(10), b.brchId)
        .input('max', sql.VarChar(50), b.maxNo)
        .query(`UPDATE dbo.EMRunBrch SET LastNo = @max
                WHERE RunCode = @rc AND BrchID = @br AND RTRIM(LastNo) < @max`);
      const n = r.rowsAffected?.[0] || 0;
      if (n) console.log(`  ${C.grn('✓')} ${b.runCode} → ${b.maxNo}`);
      else { failed++; console.log(`  ${C.yel('!')} ${b.runCode} ไม่มีแถวถูกแก้ (อาจมีคนแก้ไปแล้ว)`); }
    } catch (e) {
      failed++;
      console.log(`  ${C.red('✗')} ${b.runCode} : ${e.message}`);
    }
  }

  console.log(C.dim('\n  ⚠ ผู้ใช้ที่เปิดหน้าจอนั้นค้างไว้ ต้องปิดแล้วเปิดใหม่ ตัวนับจึงจะมีผล'));
  return failed ? 1 : 0;
}

module.exports = { SERIES, checkCounters };

// รันเป็นสคริปต์เท่านั้น — ถ้าถูก require เข้ามา (preflight-check) ให้ export อย่างเดียว
if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(e => { console.error(C.red(e.message)); process.exit(1); });
}
