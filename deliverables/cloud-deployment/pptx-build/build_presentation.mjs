import fs from "node:fs/promises";
import path from "node:path";
import {
  Presentation,
  PresentationFile,
  layers,
  shape,
  text,
} from "@oai/artifact-tool";

const OUT_DIR = "C:\\MyWork\\WorldFert\\winspeed-frontend\\deliverables\\cloud-deployment";
const PREVIEW_DIR = path.join(OUT_DIR, "rendered-presentation");
const OUT_PPTX = path.join(OUT_DIR, "WorldFert_Cloud_Proposal_C-Level_TH.pptx");

const W = 1280;
const H = 720;
const C = {
  ink: "#17212B",
  muted: "#5F6F7F",
  line: "#D9E2EA",
  blue: "#2E74B5",
  navy: "#173F67",
  pale: "#EAF2F8",
  mint: "#DDEFE5",
  mintStrong: "#77B994",
  amber: "#FFF0C2",
  red: "#F7DDDD",
  white: "#FFFFFF",
  gray: "#F6F8FA",
  black: "#000000",
};

const presentation = Presentation.create({ slideSize: { width: W, height: H } });

function t(value, left, top, width, height, size = 22, options = {}) {
  return text([String(value)], {
    name: options.name,
    position: { left, top },
    width,
    height,
    style: {
      fontSize: `${size}px`,
      typeface: "Noto Sans Thai",
      color: options.color || C.ink,
      bold: Boolean(options.bold),
      alignment: options.align || "left",
      verticalAlignment: options.valign || "top",
      autoFit: options.autoFit || "shrinkText",
      wrap: "square",
      insets: options.insets || { top: 0, right: 0, bottom: 0, left: 0 },
    },
  });
}

function box(left, top, width, height, fill, options = {}) {
  return shape({
    name: options.name,
    geometry: options.geometry || "rect",
    fill,
    line: {
      style: "solid",
      width: options.lineWidth ?? 0,
      fill: options.lineFill || fill,
    },
    position: { left, top },
    width,
    height,
  });
}

function line(left, top, width, height = 0, color = C.line, lineWidth = 1) {
  return shape({
    geometry: "straightConnector1",
    fill: "none",
    line: { style: "solid", width: lineWidth, fill: color },
    position: { left, top },
    width: width === 0 ? 0.03 : width,
    height: height === 0 ? 0.03 : height,
  });
}

function compose(slide, nodes) {
  slide.background.fill = C.white;
  slide.compose(
    layers({ name: "worldfert-codex-grid", width: "fill", height: "fill" }, nodes),
    { frame: { left: 0, top: 0, width: W, height: H }, baseUnit: 1 },
  );
}

function slideChrome(title, page, kicker = "WORLDFERT / CLOUD MIGRATION") {
  return [
    t(kicker, 48, 30, 500, 24, 13, { color: C.blue, bold: true }),
    box(48, 78, 8, 54, C.blue),
    t(title, 76, 76, 1110, 60, 34, { bold: true, autoFit: "none" }),
    line(48, 670, 1184, 0, C.line, 1),
    t("C‑LEVEL DECISION BRIEF", 48, 682, 350, 18, 11, { color: C.muted }),
    t(String(page).padStart(2, "0"), 1170, 680, 62, 20, 12, { color: C.muted, align: "right" }),
  ];
}

function nativeText(slide, value, left, top, width, height, fontSize, options = {}) {
  const item = slide.shapes.add({
    geometry: "textbox",
    position: { left, top, width, height },
    fill: "none",
    line: { style: "solid", width: 0, fill: "none" },
  });
  item.text = String(value);
  item.text.style = {
    fontSize,
    typeface: "Noto Sans Thai",
    color: options.color || C.ink,
    bold: Boolean(options.bold),
    alignment: options.align || "left",
    verticalAlignment: options.valign || "top",
  };
  return item;
}

function addNativeChrome(slide, title, page, kicker = "WORLDFERT / CLOUD MIGRATION") {
  return;
}

function addNotes(slide, body, sources) {
  const sourceText = sources.map((s) => `- ${s}`).join("\n");
  slide.speakerNotes.textFrame.setText(`${body}\n\n[Sources]\n${sourceText}`);
  slide.speakerNotes.setVisible(true);
}

function dataTableNodes({ x, y, widths, header, rows, rowHeight = 58, fontSize = 15 }) {
  const nodes = [];
  const total = widths.reduce((a, b) => a + b, 0);
  nodes.push(box(x, y, total, 42, C.navy));
  let cursor = x;
  for (let i = 0; i < header.length; i += 1) {
    nodes.push(t(header[i], cursor + 8, y + 8, widths[i] - 16, 28, 14, { color: C.white, bold: true, align: i === 0 ? "left" : "center" }));
    cursor += widths[i];
  }
  rows.forEach((row, ridx) => {
    const top = y + 42 + ridx * rowHeight;
    nodes.push(box(x, top, total, rowHeight, ridx % 2 === 0 ? C.white : C.gray, { lineWidth: 1, lineFill: C.line }));
    let cx = x;
    row.forEach((cell, cidx) => {
      nodes.push(t(cell, cx + 8, top + 8, widths[cidx] - 16, rowHeight - 16, fontSize, {
        bold: cidx === 0 || (ridx === 0 && cidx === 1),
        align: cidx === 0 ? "center" : "left",
        valign: "middle",
      }));
      if (cidx > 0) nodes.push(line(cx, top, 0, rowHeight, C.line, 1));
      cx += widths[cidx];
    });
  });
  return nodes;
}

// 1 — Cover
{
  const slide = presentation.slides.add();
  compose(slide, [
    t("WORLDFERT", 56, 42, 300, 28, 16, { color: C.blue, bold: true }),
    box(56, 142, 10, 310, C.blue),
    t("Cloud Migration\nDecision Brief", 92, 132, 900, 210, 68, { bold: true }),
    t("Docker Compose • Public IP/Domain • Direct SFTP • No Coolify • No Tunnel", 94, 370, 1080, 46, 24, { color: C.blue }),
    box(94, 482, 1080, 104, C.pale),
    t("ข้อเสนอ", 118, 502, 150, 28, 15, { color: C.muted, bold: true }),
    t("รวม Frontend, Backend, MSSQL และ MySQL บน Cloud VPS เดียว", 118, 538, 650, 34, 25, { bold: true }),
    t("CUTOVER", 840, 501, 120, 24, 13, { color: C.muted, bold: true }),
    t("≤ 4 ชั่วโมง", 840, 535, 270, 42, 30, { color: C.navy, bold: true }),
    t("26 สิงหาคม 2026", 56, 668, 220, 20, 12, { color: C.muted }),
  ]);
  addNotes(slide, "เปิดด้วยผลลัพธ์ทางธุรกิจ: ลดจุดบริหารระบบให้เหลือ Cloud VPS เดียว โดยยังคงการเชื่อมต่อฐานข้อมูลและรับส่ง backup ผ่าน Public IP ได้ตามข้อกำหนด.", [
    "Internal: WorldFert repository, backup inventory, and user requirements (26 Aug 2026)",
  ]);
}

// 2 — Recommendation
{
  const slide = presentation.slides.add();
  const nodes = [...slideChrome("ข้อเสนอที่แนะนำ", 2)];
  nodes.push(
    t("Hostinger KVM 4", 72, 174, 580, 62, 44, { bold: true, color: C.navy }),
    t("Singapore • 4 vCPU • RAM 16 GB • NVMe 200 GB", 74, 246, 620, 36, 21, { color: C.muted }),
    box(72, 316, 337, 160, C.mint),
    t("งบฐานต่อเดือน", 96, 338, 220, 26, 15, { color: C.muted, bold: true }),
    t("≈ ฿957", 96, 377, 260, 58, 45, { bold: true, color: C.navy }),
    t("คิดจาก Renewal $28.99", 96, 442, 260, 24, 14, { color: C.muted }),
    box(431, 316, 337, 160, C.pale),
    t("รูปแบบปฏิบัติการ", 455, 338, 240, 26, 15, { color: C.muted, bold: true }),
    t("1 VPS", 455, 376, 250, 56, 45, { bold: true, color: C.navy }),
    t("Docker Compose / ไม่มี Coolify", 455, 442, 286, 24, 14, { color: C.muted }),
    box(790, 316, 418, 160, C.amber),
    t("เงื่อนไขอนุมัติ", 814, 338, 250, 26, 15, { color: C.muted, bold: true }),
    t("Pilot 7 วัน", 814, 376, 320, 52, 37, { bold: true, color: C.navy }),
    t("วัด IOPS • latency • backup • support", 814, 442, 350, 24, 14, { color: C.muted }),
    box(72, 518, 1136, 104, C.gray),
    t("ทางสำรอง", 96, 540, 150, 24, 15, { color: C.blue, bold: true }),
    t("Vultr หรือ DigitalOcean หากผล Pilot ไม่ผ่านเกณฑ์ก่อน Go‑Live", 96, 573, 1030, 32, 23, { bold: true }),
  );
  compose(slide, nodes);
  addNativeChrome(slide, "ข้อเสนอที่แนะนำ", 2);
  addNotes(slide, "เสนออนุมัติ Hostinger โดยใช้งบราคา renewal ไม่ใช่ราคาโปรโมชั่น และกำหนด Pilot 7 วันก่อนย้ายจริง.", [
    "https://www.hostinger.com/vps-hosting?lang=en",
    "https://support.hostinger.com/en/articles/1583267-where-are-hostinger-servers-located",
    "https://support.hostinger.com/en/articles/1583232-how-to-back-up-or-restore-a-vps",
    "https://www.bot.or.th/en/statistics/exchange-rate.html",
  ]);
}

// 3 — Architecture
{
  const slide = presentation.slides.add();
  const nodes = [...slideChrome("สถาปัตยกรรมเป้าหมาย: Cloud เดียว แยกชั้นควบคุม", 3)];
  nodes.push(
    box(66, 176, 180, 126, C.gray),
    t("ผู้ใช้เว็บ", 88, 198, 136, 32, 23, { bold: true, align: "center" }),
    t("HTTPS\n80 / 443", 88, 243, 136, 44, 17, { color: C.muted, align: "center" }),
    box(66, 334, 180, 126, C.pale),
    t("DB Clients", 88, 356, 136, 32, 23, { bold: true, align: "center" }),
    t("1433 / 3306\nIP allowlist", 82, 399, 148, 48, 17, { color: C.muted, align: "center" }),
    box(66, 492, 180, 126, C.mint),
    t("SFTP Operator", 82, 514, 150, 32, 22, { bold: true, align: "center" }),
    t("Port 22\nKey only", 88, 557, 136, 46, 17, { color: C.muted, align: "center" }),
    line(246, 238, 92, 0, C.blue, 3),
    line(246, 397, 92, 0, C.blue, 3),
    line(246, 555, 92, 0, C.blue, 3),
    box(338, 176, 196, 442, C.amber),
    t("Provider Firewall\n+ UFW", 362, 212, 148, 72, 26, { bold: true, align: "center", valign: "middle" }),
    t("Source CIDR\n2 ชั้น", 370, 344, 132, 66, 22, { color: C.navy, bold: true, align: "center" }),
    t("Public endpoint\n≠ open to all", 362, 500, 148, 62, 19, { color: C.muted, align: "center" }),
    line(534, 397, 78, 0, C.blue, 3),
    box(612, 176, 274, 196, C.pale),
    t("Caddy + Application", 638, 201, 224, 36, 25, { bold: true, align: "center" }),
    t("TLS อัตโนมัติ\nFrontend + Backend", 646, 262, 208, 72, 20, { color: C.muted, align: "center" }),
    box(612, 402, 274, 216, C.gray),
    t("Database Containers", 638, 429, 224, 36, 24, { bold: true, align: "center" }),
    t("SQL Server 2022\nMySQL 8.0\nEncrypted connections", 646, 486, 208, 96, 19, { color: C.muted, align: "center" }),
    line(886, 270, 62, 0, C.line, 2),
    line(886, 510, 62, 0, C.line, 2),
    box(948, 176, 260, 442, C.navy),
    t("Persistent Data", 976, 210, 204, 36, 25, { color: C.white, bold: true, align: "center" }),
    t("Docker volumes", 980, 278, 196, 30, 20, { color: C.white, align: "center" }),
    line(982, 332, 190, 0, "#557A9D", 1),
    t("SFTP folders", 980, 365, 196, 30, 20, { color: C.white, align: "center" }),
    t("/incoming\n/outgoing\n/manifests", 994, 414, 168, 100, 20, { color: "#D9EAF7", align: "center" }),
    t("No S3", 1018, 554, 120, 34, 25, { color: "#A9D7BF", bold: true, align: "center" }),
  );
  compose(slide, nodes);
  addNativeChrome(slide, "สถาปัตยกรรมเป้าหมาย: Cloud เดียว แยกชั้นควบคุม", 3);
  addNotes(slide, "ทุกบริการอยู่บน VPS เดียว แต่แยก network path, containers, volumes และบัญชี SFTP ชัดเจน. Backend เชื่อม DB ผ่าน Docker network ภายใน.", [
    "https://learn.microsoft.com/en-us/sql/linux/quickstart-install-connect-docker",
    "https://dev.mysql.com/doc/refman/8.0/en/server-system-variables.html",
  ]);
}

// 4 — Security and backup operating model
{
  const slide = presentation.slides.add();
  const nodes = [...slideChrome("Public IP: ใช้ง่าย โดยคุมสิทธิ์อย่างชัดเจน", 4)];
  nodes.push(
    t("PORT POLICY", 72, 170, 260, 24, 14, { color: C.blue, bold: true }),
    box(72, 208, 526, 316, C.gray),
    t("80 / 443", 98, 232, 150, 32, 27, { bold: true }),
    t("เปิดสู่ Internet สำหรับ Web/API", 266, 237, 300, 28, 18, { color: C.muted }),
    line(98, 282, 472, 0, C.line),
    t("22", 98, 305, 150, 32, 27, { bold: true }),
    t("เฉพาะ IP ผู้ดูแล • Key only • Chroot", 266, 310, 300, 48, 18, { color: C.muted }),
    line(98, 374, 472, 0, C.line),
    t("1433 / 3306", 98, 397, 150, 40, 25, { bold: true }),
    t("เฉพาะ Client IP ที่อนุมัติ • TLS", 266, 402, 300, 42, 18, { color: C.muted }),
    line(98, 463, 472, 0, C.line),
    t("Default", 98, 482, 150, 28, 20, { bold: true, color: C.navy }),
    t("Deny พอร์ตอื่นทั้งหมด", 266, 484, 300, 28, 18, { color: C.muted }),
    t("WEEKLY BACKUP", 650, 170, 300, 24, 14, { color: C.blue, bold: true }),
    box(650, 208, 558, 316, C.pale),
    t("อาทิตย์ 02:00", 678, 232, 210, 34, 27, { bold: true }),
    t("Asia/Bangkok", 936, 237, 230, 28, 17, { color: C.muted, align: "right" }),
    t("1", 682, 305, 38, 38, 23, { bold: true, color: C.blue, align: "center" }),
    t("สร้าง MSSQL + MySQL backup", 742, 308, 410, 30, 19, { bold: true }),
    t("2", 682, 363, 38, 38, 23, { bold: true, color: C.blue, align: "center" }),
    t("VERIFY / gzip test / SHA‑256", 742, 366, 410, 30, 19, { bold: true }),
    t("3", 682, 421, 38, 38, 23, { bold: true, color: C.blue, align: "center" }),
    t("เก็บ 70 วัน และวางใน /outgoing", 742, 424, 410, 30, 19, { bold: true }),
    t("4", 682, 479, 38, 38, 23, { bold: true, color: C.blue, align: "center" }),
    t("ดาวน์โหลดผ่าน SFTP ไปบริษัท/NAS", 742, 482, 410, 30, 19, { bold: true }),
    box(72, 560, 1136, 72, C.amber),
    t("หลักการ: Public endpoint ช่วยให้เชื่อมต่อง่าย — แต่ไม่เปิด 0.0.0.0/0 ให้ฐานข้อมูลเป็นค่าเริ่มต้น", 96, 580, 1088, 34, 22, { bold: true, color: C.navy, align: "center" }),
  );
  compose(slide, nodes);
  addNativeChrome(slide, "Public IP และ Firewall Policy", 4);
  addNotes(slide, "ใช้ Provider Firewall และ UFW เป็น source-IP allowlist สองชั้น. Backup ที่ผู้ให้บริการมีไว้เสริม แต่ฐานข้อมูลต้องมี verified backup และสำเนานอก VPS.", [
    "https://support.hostinger.com/en/articles/8172641-how-to-use-a-managed-vps-firewall",
    "https://support.hostinger.com/en/articles/8868611-how-to-connect-to-vps-using-sftp",
    "https://learn.microsoft.com/en-us/sql/linux/quickstart-install-connect-docker",
    "https://dev.mysql.com/doc/refman/8.0/en/server-system-variables.html",
  ]);
}

// 5 — Global shortlist
{
  const slide = presentation.slides.add();
  const nodes = [...slideChrome("Cloud ต่างประเทศ 5 ราย — เรียงตามความคุ้มค่า", 5)];
  nodes.push(t("เกณฑ์เดียวกัน: x86‑64, Public IPv4, Singapore/SEA, 4 vCPU, RAM ≥8 GB, Disk ≥160 GB", 72, 152, 1136, 30, 18, { color: C.muted }));
  nodes.push(...dataTableNodes({
    x: 72,
    y: 198,
    widths: [62, 210, 260, 165, 180, 259],
    header: ["#", "Provider", "Spec", "Base / เดือน", "Backup", "มุมมอง"],
    rows: [
      ["1", "Hostinger KVM 4", "4 / 16 GB / 200 GB", "$28.99 ≈ ฿957", "Weekly รวม", "Best value • Pilot 7 วัน"],
      ["2", "Vultr VC2", "4 / 8 GB / 160 GB", "$40 ≈ ฿1,320", "+20% → ฿1,584", "ทางสำรองที่ยืดหยุ่น"],
      ["3", "DigitalOcean Basic", "4 / 8 GiB / 160 GiB", "$48 ≈ ฿1,584", "+20% → ฿1,901", "ใช้ง่าย / เอกสารดี"],
      ["4", "Hetzner CPX32", "4 / 8 GB / 160 GB", "≈ ฿1,933 + IPv4", "+20% → ฿2,316", "Controls ดี • SG traffic ต่ำ"],
      ["5", "AWS Lightsail CO", "4 / 8 GB / 320 GB", "$84 ≈ ฿2,772", "$0.05/GB‑mo", "Ecosystem ดี • ต้นทุนสูง"],
    ],
    rowHeight: 70,
    fontSize: 14,
  }));
  nodes.push(t("อัตราแผน 33 บาท/USD • ไม่รวม VAT/ภาษี/โดเมน/egress เกินโควตา • ราคา ณ 26 ส.ค. 2026", 72, 610, 1136, 32, 14, { color: C.muted }));
  compose(slide, nodes);
  addNativeChrome(slide, "Cloud ต่างประเทศ 5 ราย — เรียงตามความคุ้มค่า", 5);
  addNotes(slide, "ตารางใช้ราคา renewal/on-demand เพื่อไม่ให้ผู้บริหารตัดสินใจจากราคาโปรโมชัน. Provider backup แสดงแยกจาก DB backup ผ่าน SFTP.", [
    "https://www.hostinger.com/vps-hosting?lang=en",
    "https://api.vultr.com/v2/plans?type=vc2&per_page=100",
    "https://docs.vultr.com/support/platform/billing/how-much-does-it-cost-to-enable-automatic-backups",
    "https://www.digitalocean.com/pricing/droplets",
    "https://docs.digitalocean.com/products/backups/details/pricing/",
    "https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/",
    "https://docs.hetzner.com/cloud/servers/primary-ips/overview/",
    "https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html",
    "https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-snapshots.html",
    "https://www.bot.or.th/en/statistics/exchange-rate.html",
  ]);
}

// 6 — Cost chart
{
  const slide = presentation.slides.add();
  const nodes = [...slideChrome("งบรายเดือน: ส่วนต่างที่เห็นได้ทันที", 6)];
  nodes.push(
    t("บาท / เดือน (ค่าเครื่องฐาน)", 78, 155, 360, 28, 16, { color: C.muted }),
    box(842, 190, 360, 122, C.mint),
    t("Hostinger", 868, 214, 300, 26, 17, { color: C.muted, bold: true }),
    t("ประหยัด ≈ 65%", 868, 250, 300, 42, 31, { color: C.navy, bold: true }),
    box(842, 338, 360, 122, C.pale),
    t("Budget baseline", 868, 362, 300, 26, 17, { color: C.muted, bold: true }),
    t("ใช้ Renewal", 868, 398, 300, 42, 31, { color: C.navy, bold: true }),
    box(842, 486, 360, 122, C.amber),
    t("หมายเหตุ", 868, 510, 300, 24, 17, { color: C.muted, bold: true }),
    t("Snapshot ≠ DB backup", 868, 546, 300, 36, 25, { color: C.navy, bold: true }),
  );
  compose(slide, nodes);
  slide.charts.add("bar", {
    position: { left: 78, top: 190, width: 700, height: 430 },
    categories: ["Hostinger", "Vultr", "DigitalOcean", "Hetzner", "AWS Lightsail"],
    series: [{
      name: "Base THB/month",
      categories: ["Hostinger", "Vultr", "DigitalOcean", "Hetzner", "AWS Lightsail"],
      values: [957, 1320, 1584, 1933, 2772],
      fill: C.blue,
    }],
    hasLegend: false,
    dataLabels: { showValue: true, position: "outEnd" },
    chartFill: C.white,
    chartLine: { style: "solid", width: 0, fill: C.white },
    plotAreaFill: { type: "none" },
    plotAreaLine: { style: "solid", width: 0, fill: C.white },
    xAxis: {
      visible: true,
      deleted: false,
      max: 3000,
      majorUnit: 500,
      majorGridlines: { style: "solid", width: 1, fill: C.line },
      line: { style: "solid", width: 1, fill: C.line },
      textStyle: { typeface: "Noto Sans Thai", fontSize: "13px", color: C.muted },
    },
    yAxis: {
      visible: true,
      deleted: false,
      line: { style: "solid", width: 0, fill: C.white },
      textStyle: { typeface: "Noto Sans Thai", fontSize: "14px", color: C.ink },
    },
    barOptions: { direction: "bar", grouping: "clustered", gapWidth: 65 },
  });
  addNativeChrome(slide, "งบรายเดือน: ส่วนต่างที่เห็นได้ทันที", 6);
  addNotes(slide, "ต้นทุนฐาน Hostinger ต่ำสุดใน shortlist นี้. ค่าที่แสดงไม่รวม VAT, ภาษี, โดเมน และ snapshot เพิ่มเติมของบางราย.", [
    "https://www.hostinger.com/vps-hosting?lang=en",
    "https://www.digitalocean.com/pricing/droplets",
    "https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html",
    "https://www.bot.or.th/en/statistics/exchange-rate.html",
  ]);
}

// 7 — Thai shortlist
{
  const slide = presentation.slides.add();
  const nodes = [...slideChrome("Cloud ไทย 5 ราย", 7)];
  nodes.push(t("2 รายมีราคาสาธารณะ • 3 รายต้อง RFQ/TOR", 72, 152, 1136, 30, 18, { color: C.muted }));
  nodes.push(...dataTableNodes({
    x: 72,
    y: 198,
    widths: [210, 270, 236, 210, 210],
    header: ["Provider", "ตัวอย่างสเปก/บริการ", "งบ/เดือน", "สถานะราคา", "เหมาะกับ"],
    rows: [
      ["ReadyIDC", "4 vCPU / 12 GB / 240 GB", "฿1,070 incl VAT", "Public", "คุ้มค่า / POC ก่อน"],
      ["NIPA Cloud", "4 vCPU / 16 GB / 200 GB", "≈ ฿5,072 incl VAT", "Public • IIG extra", "Thai cloud / governance"],
      ["INET", "VM + Backup + DRaaS", "RFQ • plan 5–15k", "Quote required", "Enterprise / SLA 99.95"],
      ["True IDC", "Cloud+ + Elastic IP", "RFQ • plan 5–15k", "Quote required", "Data residency ไทย"],
      ["Cloud HM", "VMware IaaS + Firewall", "RFQ • plan 7–20k", "Quote required", "Managed infrastructure"],
    ],
    rowHeight: 68,
    fontSize: 14,
  }));
  nodes.push(box(72, 598, 1136, 52, C.amber));
  nodes.push(t("ช่วงงบ RFQ เป็น planning envelope ภายใน — ไม่ใช่ใบเสนอราคาจากผู้ให้บริการ", 94, 612, 1092, 28, 17, { bold: true, color: C.navy, align: "center" }));
  compose(slide, nodes);
  addNativeChrome(slide, "Cloud ไทย 5 ราย", 7);
  addNotes(slide, "ReadyIDC และ NIPA มีราคาสาธารณะที่ใช้ประมาณการได้. INET, True IDC และ Cloud HM ต้องส่ง TOR เพื่อยืนยัน Public IPv4, พอร์ต, Docker/MSSQL Linux, backup, bandwidth และ SLA.", [
    "https://www.readyidc.com/en/products/cloud-server/",
    "https://nipa.cloud/th/pricing/nipa-space/compute-instance",
    "https://nipa.cloud/pricing/nipa-space/block-storage",
    "https://nipa.cloud/pricing/nipa-space/external-ip",
    "https://www.inet.co.th/th/services/cloud-solution",
    "https://www.trueidc.com/en/service/67/True-IDC-Cloud%2B",
    "https://www.cloudhm.co.th/en/secured-infrastructure",
  ]);
}

// 8 — Timeline
{
  const slide = presentation.slides.add();
  const nodes = [...slideChrome("Cutover 4 ชั่วโมง — เมื่อ Pre‑stage พร้อม", 8)];
  nodes.push(t("T‑24h ถึง T‑2h: เตรียม VPS, DNS TTL 300, Firewall, keys, .env และ empty stack", 72, 156, 1136, 32, 18, { color: C.muted }));
  const segments = [
    { x: 72, w: 250, fill: C.pale, time: "00:00–00:45", title: "Freeze + Upload", body: "Final backup\nSFTP + SHA‑256" },
    { x: 340, w: 250, fill: C.mint, time: "00:45–01:55", title: "Restore DB", body: "MSSQL + DBCC\nMySQL + row checks" },
    { x: 608, w: 250, fill: C.gray, time: "01:55–03:10", title: "Deploy + UAT", body: "Containers/API\nCritical business flows" },
    { x: 876, w: 332, fill: C.amber, time: "03:10–04:00", title: "Go‑Live + Monitor", body: "DNS / clients\nPost‑cutover backup" },
  ];
  segments.forEach((s, i) => {
    nodes.push(box(s.x, 232, s.w, 264, s.fill));
    nodes.push(t(String(i + 1).padStart(2, "0"), s.x + 22, 250, 54, 30, 16, { color: C.blue, bold: true }));
    nodes.push(t(s.time, s.x + 22, 294, s.w - 44, 30, 18, { color: C.muted, bold: true }));
    nodes.push(t(s.title, s.x + 22, 348, s.w - 44, 52, 27, { bold: true }));
    nodes.push(t(s.body, s.x + 22, 420, s.w - 44, 60, 18, { color: C.muted }));
  });
  nodes.push(box(72, 536, 552, 88, C.mint));
  nodes.push(t("GO", 96, 555, 88, 36, 27, { color: C.navy, bold: true }));
  nodes.push(t("DB checks + API + Critical UAT ผ่าน", 188, 557, 412, 34, 19, { bold: true }));
  nodes.push(box(646, 536, 562, 88, C.red));
  nodes.push(t("NO‑GO", 670, 555, 116, 36, 27, { color: "#8B2E2E", bold: true }));
  nodes.push(t("เหลือ <30 นาทีและ Critical UAT ยังไม่ผ่าน", 796, 557, 388, 46, 18, { bold: true }));
  compose(slide, nodes);
  addNativeChrome(slide, "Cutover 4 ชั่วโมง — เมื่อ Pre‑stage พร้อม", 8);
  addNotes(slide, "4 ชั่วโมงเป็น cutover window ไม่รวมการจัดซื้อและเตรียม DNS. หาก uplink ต่ำกว่า 20 Mbps ให้ pre-stage full backup และส่งเฉพาะ backup ล่าสุดใน window.", [
    "Internal: WorldFert cutover plan and current backup inventory (MSSQL ~3.45 GB; MySQL ~466 MB)",
  ]);
}

// 9 — Risk and controls
{
  const slide = presentation.slides.add();
  const nodes = [...slideChrome("4 ความเสี่ยงหลักและมาตรการควบคุม", 9)];
  const cards = [
    { x: 72, y: 172, fill: C.amber, title: "Single VPS", risk: "มี Single Point of Failure", control: "Snapshot เสริม + SFTP copy นอก VPS\nพิจารณาแยก DB/HA ภายใน 90 วัน" },
    { x: 650, y: 172, fill: C.red, title: "Public DB", risk: "เพิ่มพื้นที่โจมตี", control: "Provider Firewall + UFW allowlist\nTLS + login เฉพาะงาน" },
    { x: 72, y: 402, fill: C.pale, title: "SQL Express", risk: "เพดาน 10 GB ต่อฐาน", control: "Alert ที่ 8 GB\nอนุมัติ Edition ก่อนชนเพดาน" },
    { x: 650, y: 402, fill: C.mint, title: "Backup / Recovery", risk: "Weekly RPO สูงสุด 7 วัน", control: "Final backup ก่อน cutover\nRestore Drill เพื่อยืนยัน RTO" },
  ];
  cards.forEach((c) => {
    nodes.push(box(c.x, c.y, 558, 194, c.fill));
    nodes.push(t(c.title, c.x + 24, c.y + 20, 200, 34, 24, { bold: true, color: C.navy }));
    nodes.push(t(c.risk, c.x + 24, c.y + 65, 510, 28, 17, { color: C.muted }));
    nodes.push(line(c.x + 24, c.y + 104, 510, 0, "#CBD8E2", 1));
    nodes.push(t(c.control, c.x + 24, c.y + 120, 510, 58, 18, { bold: true }));
  });
  nodes.push(t("Recovery target: RTO ต้องยืนยันจาก Restore Drill — ไม่ควรตั้งสมมติฐานจากสเปกเพียงอย่างเดียว", 72, 626, 1136, 30, 16, { color: C.muted, align: "center" }));
  compose(slide, nodes);
  addNativeChrome(slide, "4 ความเสี่ยงหลักและมาตรการควบคุม", 9);
  addNotes(slide, "ความเสี่ยงสองจุดที่ต้องมี owner ชัดเจนคือ Public DB และ SQL Express growth. Weekly schedule ให้ RPO สูงสุด 7 วันในภาวะปกติ; cutover ใช้ final backup แยกต่างหาก.", [
    "https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2022",
    "https://support.hostinger.com/en/articles/1583232-how-to-back-up-or-restore-a-vps",
    "Internal: WorldFert backup and recovery operating model",
  ]);
}

// 10 — Decision and next steps
{
  const slide = presentation.slides.add();
  const nodes = [...slideChrome("มติที่ต้องการและขั้นตอนถัดไป", 10)];
  nodes.push(
    box(72, 168, 704, 438, C.navy),
    t("ขออนุมัติ", 104, 198, 300, 34, 20, { color: "#A9D7BF", bold: true }),
    t("Hostinger KVM 4\nProduction Pilot 7 วัน", 104, 254, 610, 116, 42, { color: C.white, bold: true }),
    line(104, 400, 610, 0, "#557A9D", 1),
    t("งบฐาน", 104, 428, 160, 24, 15, { color: "#C9DCEA", bold: true }),
    t("≈ ฿957 / เดือน", 104, 462, 330, 42, 30, { color: C.white, bold: true }),
    t("เงื่อนไขผ่าน Pilot", 104, 532, 200, 24, 15, { color: "#C9DCEA", bold: true }),
    t("IOPS • latency • backup • support", 304, 530, 410, 30, 19, { color: C.white, bold: true, align: "right" }),
    t("NEXT", 824, 168, 150, 24, 14, { color: C.blue, bold: true }),
    t("1", 824, 220, 42, 42, 25, { bold: true, color: C.blue, align: "center" }),
    t("Provision + Firewall + DNS", 888, 224, 320, 34, 21, { bold: true }),
    line(846, 273, 0, 48, C.line, 2),
    t("2", 824, 326, 42, 42, 25, { bold: true, color: C.blue, align: "center" }),
    t("Deploy empty stack + Pre‑stage", 888, 330, 320, 44, 21, { bold: true }),
    line(846, 379, 0, 48, C.line, 2),
    t("3", 824, 432, 42, 42, 25, { bold: true, color: C.blue, align: "center" }),
    t("Restore Drill + UAT rehearsal", 888, 436, 320, 42, 21, { bold: true }),
    line(846, 485, 0, 48, C.line, 2),
    t("4", 824, 538, 42, 42, 25, { bold: true, color: C.blue, align: "center" }),
    t("Go / No‑Go ภายใน 4 ชั่วโมง", 888, 542, 320, 44, 21, { bold: true }),
    box(824, 614, 384, 42, C.amber),
    t("Fallback: Vultr / DigitalOcean", 840, 625, 352, 24, 16, { color: C.navy, bold: true, align: "center" }),
  );
  compose(slide, nodes);
  addNativeChrome(slide, "มติที่ต้องการและขั้นตอนถัดไป", 10);
  addNotes(slide, "มติที่ขอคืออนุมัติ Pilot พร้อมเกณฑ์ผ่าน ไม่ใช่อนุมัติ Go-Live โดยอัตโนมัติ. เอกสาร runbook และ BAT scripts พร้อมใช้สำหรับ remote deploy, restore, backup และ SFTP transfer.", [
    "https://www.hostinger.com/vps-hosting?lang=en",
    "Internal: WorldFert deployment runbook and automation scripts",
  ]);
}

async function writeBlob(filePath, blob) {
  await fs.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

await fs.mkdir(PREVIEW_DIR, { recursive: true });
for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, "0")}`;
  const png = await presentation.export({ slide, format: "png", scale: 1 });
  await writeBlob(path.join(PREVIEW_DIR, `${stem}.png`), png);
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(PREVIEW_DIR, `${stem}.layout.json`), await layout.text());
}

const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
await writeBlob(path.join(PREVIEW_DIR, "deck-montage.webp"), montage);

const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(OUT_PPTX);
console.log(OUT_PPTX);
