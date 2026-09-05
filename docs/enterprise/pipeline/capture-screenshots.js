'use strict';
// เก็บภาพหน้าจอจริงของทุก portal เพื่อใช้เป็นวัตถุดิบเอกสาร training/ISO
//
// อยู่ใน pipeline/ ไม่ใช่ e2e/ โดยตั้งใจ: e2e/ เป็น source set ที่ผูกกับหลักฐาน E2E
// การเพิ่มไฟล์ที่นั่นจะทำให้หลักฐานเป็นโมฆะและต้องรัน E2E ใหม่ทุกครั้งที่แตะสคริปต์นี้
//
//   node capture-screenshots.js                  # ใช้เซิร์ฟเวอร์ dev (5173/3000)
//   WF_SHOT_BASE_URL=http://localhost:5174 node capture-screenshots.js
//   WF_SHOT_ROLES=admin,sales node capture-screenshots.js
//
// อ่านรายการ portal จาก WSSale-App/src/App.tsx โดยตรง จึงไม่ต้องแก้สคริปต์เมื่อเพิ่มเมนู

const fs = require('fs');
const path = require('path');

const PIPELINE_ROOT = __dirname;
const ENTERPRISE_ROOT = path.resolve(PIPELINE_ROOT, '..');
const REPO_ROOT = path.resolve(PIPELINE_ROOT, '..', '..', '..');
const OUT_DIR = path.join(ENTERPRISE_ROOT, '05-UI-SCREENSHOTS', 'generated');
const APP_TSX = path.join(REPO_ROOT, 'WSSale-App', 'src', 'App.tsx');

const BASE_URL = process.env.WF_SHOT_BASE_URL || 'http://localhost:5173';
const PASSWORD = process.env.WF_SHOT_PASSWORD || process.env.E2E_PASSWORD || 'W0rldF3rt';
const VIEWPORT = { width: 1440, height: 900 };

// บัญชีที่ run-e2e.ps1 คงไว้เพื่อ audit traceability — ใช้ซ้ำได้โดยไม่ต้องสร้างผู้ใช้ใหม่
// ต้องครบทั้ง 8 บทบาทตาม RBAC ในโค้ด ไม่งั้นบทบาทที่ขาดจะไม่มีภาพหน้าจอในคู่มือ
// และทดสอบสิทธิ์ (ทั้งเห็นและไม่เห็น) ไม่ได้ — ต้อง seed ด้วย db-init/e2e-seed.sql ก่อน
const ACCOUNTS = [
  { key: 'admin', username: 'e2e_admin', displayName: 'E2E Admin', role: 'ADMIN' },
  { key: 'sales', username: 'e2e_sales', displayName: 'E2E Sales', role: 'SALES' },
  { key: 'counter', username: 'e2e_counter', displayName: 'E2E Counter', role: 'COUNTER_SALES' },
  { key: 'warehouse', username: 'e2e_warehouse', displayName: 'E2E Warehouse', role: 'WAREHOUSE' },
  { key: 'manager', username: 'e2e_manager', displayName: 'E2E Manager', role: 'MANAGER' },
  { key: 'approver', username: 'e2e_approver', displayName: 'E2E Approver', role: 'APPROVER' },
  { key: 'accounting', username: 'e2e_accounting', displayName: 'E2E Accounting', role: 'ACCOUNTING' },
  { key: 'weighbridge', username: 'e2e_weighbridge', displayName: 'E2E Weighbridge', role: 'WEIGHBRIDGE' },
  { key: 'clevel', username: 'e2e_clevel', displayName: 'E2E C-Level', role: 'C_LEVEL' },
];

// ดึง { key, label, roles } จาก nav literal ใน App.tsx — key/label เปลี่ยนที่เดียวคือโค้ด
function readNavConfig() {
  // ตัดบรรทัดที่ถูก comment ปิดไว้ออกก่อน
  //
  // ⚠ App.tsx เก็บเมนูที่ยังไม่เปิดใช้ไว้เป็นคอมเมนต์ (cn-rebate · governance ·
  //   incentive-report · budget-report) โดยเขียน roles เป็น placeholder `[...]`
  //   ถ้าไม่ตัดออก ตัวแยกจะนับเป็นเมนูจริง แล้วดัชนีภาพหน้าจอจะโฆษณาฟีเจอร์ที่ปิดอยู่
  //   ว่า "มีเมนูนี้แต่ยังไม่มีภาพ" ซึ่งไม่จริง — พบ 5 ก.ย. 2569
  const text = fs.readFileSync(APP_TSX, 'utf8').replace(/^[ \t]*\/\/.*$/gm, '');
  const entries = [];
  // ตำแหน่งของ groupLabel แต่ละอันบอกว่า entry ที่ตามมาอยู่กลุ่มไหน — ต้องรู้กลุ่ม
  // เพราะกลุ่มที่พับอยู่ทำให้ปุ่มภายในอยู่ใน DOM แต่คลิกไม่ได้
  const groups = [...text.matchAll(/groupLabel:\s*'([^']+)'/g)].map(match => ({ label: match[1], at: match.index }));
  const groupAt = index => {
    let current = null;
    for (const group of groups) { if (group.at < index) current = group.label; else break; }
    return current;
  };
  // จับทั้ง entry ก่อน แล้วค่อยแยกฟิลด์ — roles: อยู่หลัง icon: จึงจับด้วย regex เดียวไม่ได้
  const entryExpression = /\{\s*key:\s*'([a-z-]+)'[^{}]*\}/g;
  for (const match of text.matchAll(entryExpression)) {
    const [entryText, key] = match;
    if (entries.some(entry => entry.key === key)) continue;
    const label = /label:\s*'([^']*)'/.exec(entryText);
    if (!label) continue;
    const roleList = /roles:\s*\[([^\]]*)\]/.exec(entryText);
    const roles = roleList
      ? roleList[1].split(',').map(value => value.replace(/['\s]/g, '')).filter(Boolean)
      : null; // null = ทุก role เห็นได้
    entries.push({ key, label: label[1], roles, group: groupAt(match.index) });
  }
  return entries;
}

function visibleTo(portal, role) {
  return !portal.roles || portal.roles.includes(role);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ตัวบ่งชี้ว่าหน้ายังโหลดข้อมูลอยู่ — ถ้ายังเห็นตัวใดตัวหนึ่ง ห้ามถ่ายภาพ
const LOADING_MARKS = [
  '[data-testid="global-loader"]',
  '[role="status"][aria-label="กำลังโหลดข้อมูล"]',
];

async function isLoading(page) {
  for (const selector of LOADING_MARKS) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    if (visible) return true;
  }
  // ข้อความ "กำลังโหลด..." ที่ component ย่อยแสดงเอง
  //
  // ⚠ ตรวจด้วย page.evaluate ไม่ใช่ selector `text=/.../` ของ Playwright
  //   text engine ของ Playwright ไม่ได้เทียบ regex กับ "ข้อความของ element นั้นเอง"
  //   อย่างที่คาด — 5 ก.ย. 2569 มันคืนทั้ง <span> ตัวนับ
  //   "3 เที่ยว · 125 ตัน · กำลังโหลด 1 · ชั่งออกแล้ว 1" และ <span>กำลังโหลดสินค้า</span>
  //   ว่าตรงกับ regex ที่ไม่ควรตรง ทำให้หน้า trip-board ถูกมองว่าโหลดไม่จบตลอดกาล
  //
  // ⚠ "กำลังโหลด" เป็นคำศัพท์ของงานด้วย ไม่ใช่แค่ spinner
  //   ป้ายสถานะรถ "กำลังโหลดสินค้า" (WGHD.Status = 2) · ตัวนับในกระดานเที่ยวรถ
  //   spinner จริงทุกตัวลงท้ายด้วย ... / … หรือมีคำว่า ข้อมูล/หน้า/ตั้งค่า ตามหลัง
  //   จึงตรวจเฉพาะ element ที่เป็นใบ (ไม่มีลูก) และมองเห็นจริงเท่านั้น
  const text = await page.evaluate(() => {
    const re = /กำลังโหลด(\.\.\.|…|ข้อมูล|หน้า|ตั้งค่า)/;
    const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return [...document.querySelectorAll('*')]
      .some(el => el.children.length === 0 && re.test(el.textContent || '') && visible(el));
  }).catch(() => false);
  return text;
}

/**
 * รอจนหน้านิ่งจริงก่อนถ่ายภาพ
 *
 * ของเดิมรอ global-loader ให้ "hidden" ทันทีหลังคลิก ซึ่งผ่านทันทีเพราะ loader
 * ยังไม่ทันปรากฏ แล้วไปถ่ายตอน loader โผล่พอดี ทำให้ได้ภาพหน้าจอโหลดค้าง
 * จึงต้องรอให้ไม่พบตัวบ่งชี้การโหลดติดต่อกันหลายครั้ง ไม่ใช่ครั้งเดียว
 */
async function waitForIdle(page, timeoutMs = 30_000) {
  // networkidle ใช้กับ dev server ของ Vite ไม่ได้ — HMR เปิด websocket ค้างไว้ตลอด
  // เครือข่ายจึงไม่มีวัน "ว่าง" และคำสั่งนี้จะรอจนหมดเวลาเสมอ
  // รอบวันที่ 5 ก.ย. 2569 เสียเวลาไปหน้าละ ~60 วินาทีเพราะเรื่องนี้ (2 ครั้ง x 30 วินาที)
  // รอสั้น ๆ พอเป็นมารยาทแล้วไปเชื่อตัวชี้วัดการโหลดจริงด้านล่างแทน
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
  const deadline = Date.now() + timeoutMs;
  let calmStreak = 0;
  while (Date.now() < deadline) {
    if (await isLoading(page)) {
      calmStreak = 0;
    } else if (++calmStreak >= 3) {
      break;   // ไม่พบการโหลด 3 ครั้งติดกัน = นิ่งแล้ว
    }
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(900); // ให้ chart/ตารางวาดเสร็จ
  return !(await isLoading(page));
}

async function login(page, account) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="text"]').first().fill(account.username);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  // รอ "เมนูข้างโผล่ + ช่องรหัสผ่านหายไป" แทนการรอชื่อที่แสดง
  //
  // ⚠ ของเดิมรอ getByText(account.displayName) ซึ่งผูกกับ DisplayName ในฐานข้อมูล
  //   บัญชีที่ถูกสร้างไว้ก่อนหน้าด้วยชื่ออื่น (e2e_admin = "E2E Testing Admin",
  //   e2e_approver = "E2E ผู้อนุมัติ") จึงหมดเวลา 20 วินาทีแล้วถูกข้ามทั้งบทบาท
  //   ทั้งที่ล็อกอินสำเร็จ — เกิดขึ้นจริง 5 ก.ย. 2569
  //   สิ่งที่ต้องพิสูจน์คือ "เข้าระบบได้แล้ว" ไม่ใช่ "ชื่อสะกดตรงตามที่คาด"
  await page.locator('aside').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('input[type="password"]').first().waitFor({ state: 'detached', timeout: 10_000 });
  await waitForIdle(page);
}

// กลุ่มที่พับอยู่ห่อปุ่มไว้ใน div สูง 0 + overflow:hidden — ปุ่มยังมี bounding box
// จึงผ่าน isVisible() ของ Playwright แต่คลิกไม่ติดจนหมดเวลา ต้องเช็คว่าจุดกึ่งกลาง
// ของปุ่มชี้กลับมาที่ตัวมันเองจริง ไม่ใช่หัวกลุ่มที่ทับอยู่
async function isReallyClickable(page, label) {
  return page.evaluate(name => {
    const button = document.querySelector(`aside button[title="${name}"]`);
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit) && (hit === button || button.contains(hit));
  }, label);
}

async function openPortal(page, portal) {
  // ⚠ ต้องรอให้หน้าปัจจุบัน "โหลดเสร็จ" ก่อนจะไปกดเมนูถัดไป
  //
  //   บางหน้า (เช่น ขาย/POS) แสดง overlay เต็มจอ `fixed inset-0 z-[9999]`
  //   พร้อมข้อความ "กำลังโหลดข้อมูล..." ซึ่ง **คลุมแถบเมนูด้านซ้ายไปด้วย**
  //   ปุ่มยังอยู่ใน DOM และมี bounding box ปกติ แต่ elementFromPoint คืน overlay
  //   isReallyClickable จึงเป็นเท็จ แล้ว openPortal คืน false = "เมนูไม่ปรากฏ"
  //
  //   ผลจริง 5 ก.ย. 2569: หน้า trip-board และ edit-requests ซึ่งอยู่ถัดจาก "ขาย"
  //   ในลำดับเมนู ถูกข้ามครบทุกบทบาท ทั้งที่ทั้งสองหน้าทำงานปกติดี
  await waitForIdle(page, 20_000);

  // sidebar ย่ออยู่โดยปริยาย ปุ่มจึงมีแต่ attribute title ไม่มี text node
  const button = page.locator(`aside button[title="${portal.label}"]`).first();
  if (!(await button.count())) return false;
  // ต้อง scroll เข้ามาในกรอบ nav ก่อนตรวจเสมอ — elementFromPoint ใช้พิกัด viewport
  // ปุ่มที่อยู่ใต้ขอบ nav จะให้ผลเป็นอย่างอื่นทั้งที่กลุ่มกางอยู่แล้ว
  const settle = async () => {
    try { await button.scrollIntoViewIfNeeded({ timeout: 5_000 }); } catch { /* ปุ่มถูกครอบอยู่ */ }
    await page.waitForTimeout(150);
    return isReallyClickable(page, portal.label);
  };
  if (!(await settle()) && portal.group) {
    const header = page.locator(`aside button[title="${portal.group}"]`).first();
    if (await header.count()) {
      await header.scrollIntoViewIfNeeded();
      await header.click({ timeout: 10_000 });
      await page.waitForTimeout(400);
    }
  }
  if (!(await settle())) return false;
  await button.click({ timeout: 15_000 });
  await waitForIdle(page);
  return true;
}

// สร้างดัชนีใหม่จากไฟล์ภาพที่มีอยู่ โดยไม่ต้องเปิดเบราว์เซอร์และเซิร์ฟเวอร์ใหม่
function rebuildIndexFromDisk() {
  const portals = readNavConfig();
  const files = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter(name => name.endsWith('.png')) : [];
  const captured = [];
  for (const file of files) {
    const match = /^(.+?)--(.+)\.png$/.exec(file);
    if (!match) continue;
    const portal = portals.find(item => item.key === match[2]);
    captured.push({ file, portal: match[2], label: portal ? portal.label : match[2], role: match[1].toUpperCase().replace(/-/g, '_') });
  }
  writeIndex(portals, captured, []);
  console.log(`Rebuilt index from ${captured.length} screenshot(s) on disk.`);
  return captured.length;
}

async function main() {
  if (process.argv.includes('--index-only')) { rebuildIndexFromDisk(); return; }
  const { chromium } = require('playwright');
  const portals = readNavConfig();
  const onlyRoles = (process.env.WF_SHOT_ROLES || '').split(',').map(value => value.trim()).filter(Boolean);
  const accounts = onlyRoles.length ? ACCOUNTS.filter(item => onlyRoles.includes(item.key)) : ACCOUNTS;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Capturing from ${BASE_URL} · ${portals.length} portals · ${accounts.length} accounts`);

  const browser = await chromium.launch();
  const captured = [];
  const skipped = [];
  try {
    for (const account of accounts) {
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'th-TH' });
      const page = await context.newPage();
      try {
        await login(page, account);
        const loginShot = path.join(OUT_DIR, `00-login.png`);
        if (!fs.existsSync(loginShot)) await page.screenshot({ path: loginShot });
        for (const portal of portals) {
          if (!visibleTo(portal, account.role)) continue;
          const name = `${slug(account.role)}--${portal.key}.png`;
          try {
            if (!(await openPortal(page, portal))) { skipped.push({ ...portal, role: account.role, why: 'เมนูไม่ปรากฏ' }); continue; }
            // ตรวจซ้ำก่อนกดชัตเตอร์ ถ้ายังโหลดอยู่ให้รออีกรอบ — ห้ามได้ภาพหน้าจอโหลดค้าง
            let ready = !(await isLoading(page));
            for (let attempt = 0; attempt < 2 && !ready; attempt++) ready = await waitForIdle(page);
            if (!ready) { skipped.push({ ...portal, role: account.role, why: 'ยังโหลดข้อมูลไม่เสร็จ ไม่ถ่ายภาพ' }); continue; }
            await page.screenshot({ path: path.join(OUT_DIR, name), fullPage: false });
            captured.push({ file: name, portal: portal.key, label: portal.label, role: account.role });
            console.log(`  ${name}`);
          } catch (error) {
            skipped.push({ ...portal, role: account.role, why: error.message.split('\n')[0] });
          }
        }
      } catch (error) {
        console.error(`  ${account.username}: ${error.message.split('\n')[0]}`);
        skipped.push({ key: '(login)', label: account.username, role: account.role, why: error.message.split('\n')[0] });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  writeIndex(portals, captured, skipped);
  console.log(`\nCaptured ${captured.length} screenshot(s); skipped ${skipped.length}.`);
  if (!captured.length) process.exitCode = 1;
}

function writeIndex(portals, captured, skipped) {
  const byPortal = new Map();
  for (const shot of captured) {
    if (!byPortal.has(shot.portal)) byPortal.set(shot.portal, []);
    byPortal.get(shot.portal).push(shot);
  }
  // doc-control สแกนทุก .md ใต้ enterprise root จึงต้องมี front matter ครบ
  // มิฉะนั้นจะได้ MISSING_DOCUMENT_ID / OWNER / STATUS / VERSION
  const lines = [
    '---',
    'documentId: "WF-UI-001"',
    'title: "UI Screenshot Index"',
    'version: "v1.0"',
    'status: Draft',
    'statusDetail: "สร้างอัตโนมัติจากหน้าจอจริง — วัตถุดิบสำหรับคู่มือและแฟ้ม ISO"',
    'owner: "QA Lead"',
    'normative: false',
    '---',
    '# ดัชนีภาพหน้าจอ (generated)', '',
    '> สร้างด้วย `node ../pipeline/capture-screenshots.js` — อย่าแก้ไฟล์นี้ด้วยมือ',
    `> เก็บเมื่อ ${new Date().toISOString()} · ${captured.length} ภาพ`, '',
    '| Portal | เมนู | บทบาทที่เห็น | ไฟล์ภาพ |',
    '|---|---|---|---|',
  ];
  for (const portal of portals) {
    const shots = byPortal.get(portal.key) || [];
    const roles = portal.roles ? portal.roles.join(', ') : 'ทุกบทบาท';
    const files = shots.length ? shots.map(shot => `\`generated/${shot.file}\``).join('<br/>') : '— ยังไม่มีภาพ —';
    lines.push(`| \`${portal.key}\` | ${portal.label} | ${roles} | ${files} |`);
  }
  if (skipped.length) {
    lines.push('', '## ที่ถ่ายไม่ได้', '', '| Portal | บทบาท | เหตุผล |', '|---|---|---|');
    for (const item of skipped) lines.push(`| \`${item.key}\` | ${item.role} | ${item.why} |`);
  }
  lines.push('');
  fs.writeFileSync(path.join(ENTERPRISE_ROOT, '05-UI-SCREENSHOTS', 'INDEX-GENERATED.md'), lines.join('\n'), 'utf8');
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { readNavConfig, visibleTo, slug, rebuildIndexFromDisk };
