// Headless capture of WS-Sale-App screens -> L:\...\05-UI-SCREENSHOTS
// Auth via user-exported wssale-auth.json (token stays local; script never prints it)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

const OUT = "L:\\My Drive\\World Fert\\docs\\enterprise\\05-UI-SCREENSHOTS";
const APP = "http://localhost:5173";
const AUTH_CANDIDATES = [
  path.join(os.homedir(), "Downloads", "wssale-auth.json"),
  path.join(__dirname, "wssale-auth.json"),
];

// nav grouped by collapsible section header (must expand section before clicking sub-items)
const GROUPS = [
  { section: null, items: [["01-dashboard","Dashboard"],["02-sales-pos","ขาย"],["03-quotation","เสนอราคา"],["04-warehouse","คลัง"],["05-paper-trail","Paper Trail"],["06-aging","ตั๋วคงค้าง"]] },
  { section: "การเงิน", items: [["07-rebate-app","รีเบท (App)"],["08-rebate-plan","Rebate Plan"],["09-cn-rebate","CN Rebate"],["10-giveaway","ของแถม"]] },
  { section: "บัญชี", items: [["11-accounting","บัญชี"],["12-recon","กระทบยอด"],["13-reports","รายงาน"],["14-voucher","ชุดตั๋วคุม"]] },
  { section: "คลัง/ชั่ง", items: [["15-truckscale","TruckScale"],["16-weigh-inbox","Weigh Inbox"]] },
  { section: "ตั้งค่าระบบ", items: [["17-master-data","ข้อมูลหลัก"],["18-approval-policy","นโยบายอนุมัติ"],["19-data-governance","กำกับข้อมูล"],["20-ops-status","สถานะระบบ"],["21-users","ผู้ใช้งาน"]] },
];

(async () => {
  const authPath = AUTH_CANDIDATES.find((p) => fs.existsSync(p));
  if (!authPath) { console.error("AUTH FILE NOT FOUND. Run the export snippet first."); process.exit(2); }
  const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  if (!auth.token || !auth.user) { console.error("auth.json missing token/user"); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, locale: "th-TH" });
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate(([t, u]) => { localStorage.setItem("wssale_token", t); localStorage.setItem("wssale_user", u); }, [auth.token, auth.user]);
  await page.goto(APP, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(3000);

  let ok = 0, fail = [];
  for (const grp of GROUPS) {
    if (grp.section) {
      try { await page.getByRole("button", { name: grp.section, exact: true }).first().click({ timeout: 8000 }); await page.waitForTimeout(900); }
      catch (e) { console.log("(section expand failed:", grp.section, "-", e.message.split("\n")[0], ")"); }
    }
    for (const [name, label] of grp.items) {
      try {
        const btn = page.getByRole("button", { name: label, exact: true }).last();
        await btn.click({ timeout: 8000 });
        await page.waitForTimeout(2800);
        await page.getByText("กำลังโหลดข้อมูล").first().waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
        await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false });
        ok++; console.log("captured", name);
      } catch (e) { fail.push(name); console.log("SKIP", name, "-", e.message.split("\n")[0]); }
    }
  }
  await browser.close();
  console.log(`\nDONE: ${ok}/${SCREENS.length} captured -> ${OUT}`);
  if (fail.length) console.log("failed:", fail.join(", "));
})();
