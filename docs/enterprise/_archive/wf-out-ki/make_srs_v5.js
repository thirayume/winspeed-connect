// ============================================================
// WorldFert SRS v5.0 — Production (Implemented: Express + msnodesqlv8 + JWT)
// CI: Minimal Navy  |  Font: Prompt
// ============================================================
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak, TabStopType,
  TabStopPosition, ImageRun,
} = require("docx");

// image embed helper (fit to content width 9360 dxa ≈ 6.5in = 624px @96)
const IMGDIR = "L:\\My Drive\\World Fert\\wf\\out\\diagram_png\\";
const IMGSZ = JSON.parse(fs.readFileSync(IMGDIR+"_sizes.json","utf8"));
function img(file, maxW=620, caption){
  const sz = IMGSZ[file] || {w:1200,h:700};
  let w = maxW, h = Math.round(maxW * sz.h / sz.w);
  const maxH = 600; if (h > maxH){ h = maxH; w = Math.round(maxH * sz.w / sz.h); }
  const out = [ new Paragraph({ alignment:AlignmentType.CENTER, spacing:{before:60,after:caption?20:120},
    children:[ new ImageRun({ type:"png", data: fs.readFileSync(IMGDIR+file), transformation:{width:w,height:h},
      altText:{title:caption||file, desc:caption||file, name:file} }) ] }) ];
  if (caption) out.push(new Paragraph({ alignment:AlignmentType.CENTER, spacing:{after:160},
    children:[ new TextRun({ text:caption, font:"Prompt", size:16, italics:true, color:"595959" }) ] }));
  return out;
}

// ─── CI Palette (Minimal Navy) ───────────────────────────────
const NAVY   = "1F3864";   // primary heading + table header
const NAVY2  = "2E5496";   // sub-accent
const ROW    = "EBF0F7";   // alt table row (light blue)
const BLUEBG = "E8EEF5";   // callout blue
const PEACH  = "FBEFE0";   // callout peach
const GREEN  = "E8F0E5";   // callout green
const GRAYTX = "595959";   // muted text
const RED    = "B02418";   // critical
const WHITE  = "FFFFFF";
const FONT   = "Prompt";

const CW = 9360; // content width (US Letter, 1" margins)

// ─── Helpers ─────────────────────────────────────────────────
const tb = (color, sz=1) => ({ style: BorderStyle.SINGLE, size: sz, color });
const cellBorders = (c="C9D3E0") => ({ top: tb(c), bottom: tb(c), left: tb(c), right: tb(c) });

function run(text, opts={}) {
  return new TextRun({ text, font: FONT, size: opts.size || 20, bold: !!opts.bold,
    italics: !!opts.italics, color: opts.color || "000000", break: opts.break });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, font: FONT, size: 30, bold: true, color: NAVY })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, size: 24, bold: true, color: NAVY })],
  });
}
function h3(text) {
  return new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text, font: FONT, size: 21, bold: true, color: NAVY2 })],
  });
}
function body(text, opts={}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, line: 276 },
    alignment: opts.align,
    children: Array.isArray(text) ? text : [run(text, opts)],
  });
}
function bullet(runs, level=0) {
  return new Paragraph({
    numbering: { reference: "wfBullets", level },
    spacing: { after: 60, line: 264 },
    children: Array.isArray(runs) ? runs : [run(runs)],
  });
}
function numItem(runs) {
  return new Paragraph({
    numbering: { reference: "wfNumbers", level: 0 },
    spacing: { after: 60, line: 264 },
    children: Array.isArray(runs) ? runs : [run(runs)],
  });
}

// Callout box (single-cell table with shading + accent left border)
function callout(title, lines, bg=BLUEBG, accent=NAVY) {
  const kids = [];
  if (title) kids.push(new Paragraph({ spacing:{ after: 60 },
    children:[new TextRun({ text:title, font:FONT, size:20, bold:true, color:accent })] }));
  (Array.isArray(lines)?lines:[lines]).forEach((ln,i)=>{
    kids.push(new Paragraph({ spacing:{ after: i===lines.length-1?0:40, line:264 },
      children: Array.isArray(ln)?ln:[new TextRun({ text:ln, font:FONT, size:19, color:"222222" })] }));
  });
  return new Table({
    width:{ size:CW, type:WidthType.DXA }, columnWidths:[CW],
    borders:{ top:tb(accent,4), bottom:tb(accent,4), left:tb(accent,18), right:tb(accent,4) },
    rows:[ new TableRow({ children:[ new TableCell({
      width:{ size:CW, type:WidthType.DXA },
      shading:{ fill:bg, type:ShadingType.CLEAR, color:"auto" },
      margins:{ top:120, bottom:120, left:200, right:160 },
      children: kids }) ] }) ],
  });
}

// Generic table: headers[], rows[][], colWidths[]
function makeTable(headers, rows, colWidths, opts={}) {
  const headerCells = headers.map((htext,i)=> new TableCell({
    width:{ size:colWidths[i], type:WidthType.DXA }, borders:cellBorders(NAVY),
    shading:{ fill:NAVY, type:ShadingType.CLEAR, color:"auto" },
    margins:{ top:70, bottom:70, left:110, right:110 },
    verticalAlign: VerticalAlign.CENTER,
    children:[ new Paragraph({ children:[new TextRun({ text:htext, font:FONT, size:18, bold:true, color:WHITE })] }) ],
  }));
  const bodyRows = rows.map((r,ri)=> new TableRow({ children: r.map((cell,ci)=>{
    const isObj = cell && typeof cell==="object" && !Array.isArray(cell);
    const txt = isObj ? cell.text : cell;
    const cellColor = isObj && cell.color ? cell.color : (ci===0 && opts.boldFirst ? NAVY : "1A1A1A");
    const isBold = isObj ? !!cell.bold : (ci===0 && opts.boldFirst);
    return new TableCell({
      width:{ size:colWidths[ci], type:WidthType.DXA }, borders:cellBorders(),
      shading:{ fill: ri%2===1?ROW:WHITE, type:ShadingType.CLEAR, color:"auto" },
      margins:{ top:60, bottom:60, left:110, right:110 },
      verticalAlign: VerticalAlign.CENTER,
      children:[ new Paragraph({ spacing:{line:252},
        children:[new TextRun({ text:String(txt), font:FONT, size: opts.fontSize||17,
          bold:isBold, color:cellColor })] }) ],
    });
  }) }));
  return new Table({ width:{ size:CW, type:WidthType.DXA }, columnWidths:colWidths,
    rows:[ new TableRow({ tableHeader:true, children:headerCells }), ...bodyRows ] });
}

function spacer(h=80){ return new Paragraph({ spacing:{ after:h }, children:[] }); }

// ═══════════════════════════════════════════════════════════
// BUILD DOCUMENT CONTENT
// ═══════════════════════════════════════════════════════════
const children = [];

// ─── COVER ───────────────────────────────────────────────────
children.push(
  new Paragraph({ spacing:{ before:1400, after:60 }, alignment:AlignmentType.CENTER,
    children:[new TextRun({ text:"SOFTWARE REQUIREMENTS SPECIFICATION", font:FONT, size:22, bold:true, color:GRAYTX, characterSpacing:30 })] }),
  new Paragraph({ spacing:{ after:60 }, alignment:AlignmentType.CENTER,
    children:[new TextRun({ text:"ระบบจัดการสั่งขายปุ๋ยและส่วนลดรีเบท", font:FONT, size:44, bold:true, color:NAVY })] }),
  new Paragraph({ spacing:{ after:120 }, alignment:AlignmentType.CENTER,
    children:[new TextRun({ text:"Sales Order & Rebate Management System", font:FONT, size:24, color:GRAYTX })] }),
  new Paragraph({ spacing:{ after:40 }, alignment:AlignmentType.CENTER,
    children:[new TextRun({ text:"บริษัท เวิลด์ เฟอท จำกัด  /  WORLD FERT CO., LTD.", font:FONT, size:22, bold:true, color:NAVY })] }),
  new Paragraph({ spacing:{ after:340 }, alignment:AlignmentType.CENTER,
    children:[new TextRun({ text:"Tax ID: 0105531024397", font:FONT, size:18, bold:true, color:GRAYTX })] }),
);
children.push(makeTable(
  ["รายการ","รายละเอียด"],
  [
    ["Document Title","Software Requirements Specification (SRS)"],
    ["Document ID","WF-SRS-001"],
    [{text:"Version",bold:true},{text:"5.0 (Production — Implemented & Verified)",bold:true,color:NAVY}],
    ["Date","23 มิถุนายน 2569 (June 23, 2026)"],
    ["Status","Implemented — E2E Verified"],
    ["Classification","Confidential — For Client Use Only"],
    ["Focus","Database Design & Data Flow (อ้างอิงข้อมูลจริงจาก WINSpeed DB)"],
    ["Prepared by","นายธิรายุ มีฤกษ์สม (Solution Architect / BA·SA)"],
  ],
  [2600, 6760], { boldFirst:true }
));
children.push(new Paragraph({ spacing:{ before:300 }, alignment:AlignmentType.CENTER,
  children:[new TextRun({ text:"© 2026 World Fert Co., Ltd. All Rights Reserved.", font:FONT, size:16, color:GRAYTX })] }));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── DOCUMENT CONTROL ────────────────────────────────────────
children.push(h1("Document Control"));
children.push(h2("Revision History"));
children.push(makeTable(
  ["Version","Date","Author","Description of Change"],
  [
    ["0.1","14/05/2569","T. Meeriksom","Initial draft (Phase 1 scope)"],
    ["1.0","23/05/2569","T. Meeriksom","Restructured to IEEE 29148; NFR, risks, acceptance"],
    ["2.0","04/06/2569","T. Meeriksom","Field-evidence update; Rebate FIFO, Price Book, ของแถม, ชุดตั๋วคุม"],
    ["3.0","06/06/2569","T. Meeriksom","Document Flow & State, แก้แหล่งข้อมูล (Price/Stock/Credit), CN/DN, ตัด Budget & MA, ยืนยัน WINSpeed Import (Option B)"],
    ["4.0","10/06/2569","T. Meeriksom","Production Edition: เพิ่มผัง (Swimlane AS-IS/TO-BE, Workflow, Work Process, DFD, ER, UML) + UI/UX ทุกหน้า + Approval Levels + Dashboard + Traceability (req↔FR)"],
    [{text:"5.0",bold:true,color:NAVY},{text:"23/06/2569",bold:true},{text:"T. Meeriksom",bold:true},
     {text:"Implemented (Production build): Express + msnodesqlv8 + JWT (jsonwebtoken/bcrypt) แทน NestJS/Prisma/Passport/WebSocket · schema wf deployed จริง (10 ตาราง + 4 views · wf_owner เขียน dbo ไม่ได้) · SO state machine · Rebate FIFO · WINSpeed SO Import (EmpID map AppUser↔EMEmp) · Admin user mapping — ทดสอบ end-to-end ผ่าน",bold:true,color:NAVY}],
  ],
  [1000, 1400, 1700, 5260], { fontSize:15 }
));
children.push(spacer(120));
children.push(h2("Open Decisions (รอยืนยันจากลูกค้า)"));
children.push(callout("D-01 · ช่องทาง Sales Intake (LINE / Web)",
  ["v3.0 ใช้ Web แบบ tablet-first (iPad) เป็นหลัก; LINE = ช่องทางรับ order + แจ้งเตือน (webhook/notify) เลื่อน LIFF เต็มรูปเป็น Phase 2 — ขอยืนยันทิศทาง (มีผลต่อ FR-016)"], PEACH, "C8862E"));
children.push(spacer(80));
children.push(callout("D-02 · แหล่งข้อมูล Credit Limit",
  [[new TextRun({text:"พบว่า ", font:FONT, size:19}),
    new TextRun({text:"EMCust.CreditAmnt = 0 ทุกราย (790 ราย) และ ARControl ว่าง", font:FONT, size:19, bold:true, color:RED}),
    new TextRun({text:" → WINSpeed ไม่มีข้อมูลวงเงินเครดิตที่ใช้งานได้ ระบบใหม่ต้องออกแบบ Credit Master ใน schema wf เอง หรือยกเลิก Credit Hold — ขอยืนยัน (มีผลต่อ FR-003)", font:FONT, size:19})]], PEACH, "C8862E"));
children.push(spacer(80));
children.push(callout("D-03 · การลงบัญชี (GL Posting) ตอน Shipped — ปิดแล้ว: แนวทาง B",
  [[new TextRun({text:"ยืนยันจากข้อมูลจริง: ", font:FONT, size:19}),
    new TextRun({text:"DB ไม่มี trigger/SP post GL อัตโนมัติ", font:FONT, size:19, bold:true, color:RED}),
    new TextRun({text:" (trigger บน SOInvHD/SOHD/GLHD เป็น RI-check ล้วน) — WINSpeed client app เป็นผู้ลงบัญชีเอง", font:FONT, size:19})],
   [new TextRun({text:"มติ: ", font:FONT, size:19, bold:true}),
    new TextRun({text:"WINSpeed = เจ้าของบัญชี 100% ห้ามผิดพลาด · ระบบใหม่ห้ามเขียนตารางบัญชี dbo · ส่งข้อมูลเข้า WINSpeed ผ่านฟีเจอร์ Import (WINSpeed ออกใบกำกับ/GL เอง) · ดู wf/out/trigger_analysis.md", font:FONT, size:19})]], GREEN, "5E7E45"));

children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── EXECUTIVE SUMMARY ───────────────────────────────────────
children.push(h1("Executive Summary"));
children.push(body("บริษัท เวิลด์ เฟอท จำกัด เป็นผู้ผลิตและจำหน่ายปุ๋ยเคมีภายใต้แบรนด์ “รถเกษตร” และ “ปุ๋ยเทพ” สำนักงานใหญ่ที่เยาวราช โรงงานผลิตที่พระนครศรีอยุธยา ปัจจุบันใช้ Prosoft WINSpeed v9.0 เป็น ERP หลัก ขายปุ๋ยเป็นสูตรต่างๆ บรรจุกระสอบละ 50 กก. และจำหน่ายแบบขายส่งเป็นรถบรรทุก (หน่วยตัน)"));
children.push(body([
  run("เอกสาร v3.0 นี้ "),
  run("ตรวจสอบทุกข้อสมมุติกับข้อมูลจริงในฐานข้อมูล", {bold:true, color:NAVY}),
  run(" (dbwins_worldfert9 — 669 ตาราง, 282,087 ใบกำกับ, ข้อมูลปี 2555–2568) เพื่อให้การออกแบบระบบใหม่บน schema "),
  run("wf", {bold:true}),
  run(" สอดคล้องกับโครงสร้างและการไหลของเอกสารที่ WINSpeed ใช้งานจริง โดยตัดเนื้อหาเชิงพาณิชย์ (งบประมาณ/MA) ออก เพื่อเน้นการออกแบบ"),
]));
children.push(callout("มูลค่าที่นำเสนอ (Value Proposition)",
  ["ลด Manual Effort ของ Accounting ในการตรวจ Rebate ลง ~70%, เพิ่มความถูกต้องของ trail เป็น 100%, ให้ผู้บริหารเห็นยอด Rebate/ของแถม/ชุดตั๋วคุม คงเหลือแบบ Real-time และยังคงลงบัญชีผ่าน WINSpeed ตามเดิมทุกประการ (Non-Invasive)"], BLUEBG, NAVY));
children.push(spacer(120));
children.push(h2("สรุปขอบเขต (Scope Summary)"));
children.push(makeTable(
  ["รายการ","ขอบเขต","สถานะ"],
  [
    ["Phase 1 (Sales & Rebate)","SO State Machine, Rebate Accrual/FIFO, Price Book, ของแถม+สต็อก, ชุดตั๋วคุม, ลำดับแม่-ลูก, Paper Trail+QR, WS Integration","ออกแบบ"],
    ["Phase 2 (Future)","Gate Pass, TruckScale, Multi-trip, LINE LIFF เต็มรูป","แยกเสนอ"],
    ["Phase 3 (Future)","Production Line, MRP, Lot Tracking","แยกเสนอ"],
  ],
  [2500, 5660, 1200], { fontSize:17 }
));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 1. INTRODUCTION ─────────────────────────────────────────
children.push(h1("1. บทนำ (Introduction)"));
children.push(h2("1.1 วัตถุประสงค์ของเอกสาร (Purpose)"));
children.push(body("เอกสาร SRS ฉบับนี้ระบุความต้องการทางธุรกิจ Functional และ Non-Functional Requirements ของระบบจัดการสั่งขายปุ๋ยและส่วนลดรีเบท ที่พัฒนาเชื่อมต่อ Prosoft WINSpeed v9.0 ของบริษัท เวิลด์ เฟอท จำกัด ตามมาตรฐาน IEEE 29148-2018 — v3.0 เพิ่มหมวดการออกแบบที่อ้างอิงโครงสร้างข้อมูลจริง"));
children.push(h2("1.2 ขอบเขตของเอกสาร (Scope)"));
children.push(body("เอกสารนี้ครอบคลุม Phase 1 มุ่งกระบวนการฝั่งขายและบริหารส่วนลด (Rebate) รวมโมดูลใหม่ตามหลักฐานภาคสนาม โดยไม่รวม Gate Pass, TruckScale และสายการผลิต ซึ่งแยกเสนอ Phase ถัดไป"));
children.push(h3("In Scope (อยู่ในขอบเขต)"));
[
  "Sales Order State Machine (Draft → Confirmed → Picking → Shipped) + audit ทุก transition",
  "Rebate Management — Accrual ต่อรายการ (ราคาขาย-ราคา NET/ตัน), Pool ตามสูตร×ภาค×เดือน, ตัด FIFO, Claim 2 ประเภท (คืนรีเบท/คืนส่วนต่าง)",
  "Price Book — ราคา NET รายเดือนต่อสูตร (ฐานคำนวณ Rebate) อ้างอิง EMSetPriceDT",
  "Giveaway / Promotion Item — เลือกของแถม (เสื้อ/กระเป๋า/กระสอบเปล่า) + งบและสต็อกตามภาค→Sales→รายการ",
  "Control Ticket (ชุดตั๋วคุม) — บันทึก/ติดตามยอดคงเหลือ + รายงานเฉพาะชุด",
  "Mother/Baby Load Sequencing — ระบุลำดับโหลดรถพ่วงแม่-ลูกตามที่ลูกค้าแจ้ง",
  "Counter-Sales Verification Gate — ตรวจซ้ำคำสั่งซื้อก่อนส่งโรงงาน",
  "Paper Trail Tracking — เอกสาร 4 สี + QR Code + Kanban dashboard",
  "Unlock Request Flow — แจ้งเตือน real-time ระหว่าง Sales และคลัง",
  "Prosoft WINSpeed Integration — อ่าน master (read-only), เขียน Invoice เมื่อ Shipped",
  "Reporting & Dashboard, Role-Based Access Control",
].forEach(t=>children.push(bullet(t)));
children.push(h3("Out of Scope (อยู่นอกขอบเขต)"));
[
  "Gate Pass & Vehicle Tracking (Phase 2)",
  "TruckScale Integration & Multi-trip Loading รถวน 3 รอบ (Phase 2)",
  "LINE LIFF Mobile App เต็มรูป (Phase 2)",
  "Production Line Management & MRP (Phase 3)",
  "Lot Tracking & Expiry Date (Phase 3)",
  "การปรับแก้ Schema ของ Prosoft WINSpeed (ห้ามแตะ — เขียนเฉพาะ schema wf)",
].forEach(t=>children.push(bullet(t)));
children.push(new Paragraph({ children:[new PageBreak()] }));

// 1.3 Definitions
children.push(h2("1.3 คำนิยาม คำย่อ และคำศัพท์เฉพาะ"));
children.push(makeTable(
  ["คำศัพท์","คำเต็ม","ความหมาย"],
  [
    ["SO","Sales Order","ใบสั่งขาย / ใบสั่งจอง (SOHD/SODT, PK=SOID)"],
    ["ตั๋วคุม","Weigh-Control No.","เลขอนุมัติเข้าชั่ง prefix 'AI' เก็บใน SOHD.AppvDocuNo (ไม่มีตารางแยก)"],
    ["FIFO","First In First Out","การตัดยอดแบบเข้าก่อนออกก่อน"],
    ["Rebate","Sales Rebate","ส่วนลดส่งเสริมการขายที่คืนให้ลูกค้าภายหลัง"],
    ["Accrual","Rebate Accrual","ยอดรีเบทสะสมที่ตั้งขึ้นต่อรายการ = (ราคาขาย − ราคา NET) × จำนวนตัน"],
    ["Price Book","ราคา NET รายเดือน","ตารางราคาสุทธิ/ตันต่อสูตร เปลี่ยนรายเดือน เป็นฐานคำนวณ Rebate (EMSetPriceDT)"],
    ["คืนรีเบท","Rebate Return","การคืนผลต่าง (ราคาขาย − ราคา NET) ตามที่อนุมัติ"],
    ["คืนส่วนต่าง","Price Diff Return","การคืนส่วนต่างราคา (price-list) แยกบล็อกจากคืนรีเบท"],
    ["Pool","Rebate Pool","กองยอดรีเบทสะสม แยกตาม Sales × สูตร × ภาค × เดือน"],
    ["Claim","Rebate Claim","การเบิกเงินรีเบทคืน อ้างหลายอินวอยซ์ ตัด FIFO"],
    ["ตัวแม่/ตัวลูก","Mother/Baby Trailer","รถพ่วงหัวลาก (แม่) และพ่วงท้าย (ลูก) ต้องระบุลำดับโหลด"],
    ["ของแถม","Giveaway Item","เสื้อ/กระเป๋า/กระสอบเปล่า แจกตามภาค/Sales (บันทึกเป็น line GoodPrice2=0)"],
    ["DocuType","Document Type","รหัสชนิดเอกสารใน WINSpeed (103=ใบจอง, 107=ใบกำกับเชื่อ, 501=GL)"],
    ["SONo","Sales Order No.","คอลัมน์ใน SOInvHD ที่อ้างกลับ SOHD.DocuNo (join key)"],
    ["FromFlag","Source DocuType","คอลัมน์ใน GLHD บอก DocuType ต้นทาง (107 = มาจากใบกำกับขาย)"],
    ["WS","WINSpeed","Prosoft WINSpeed v9.0 (ERP ปัจจุบัน)"],
    ["RBAC / JWT","—","การควบคุมสิทธิ์ตามบทบาท / โทเค็น Authentication"],
  ],
  [1500, 2300, 5560], { fontSize:16, boldFirst:true }
));
children.push(new Paragraph({ children:[new PageBreak()] }));

// 1.4 References
children.push(h2("1.4 เอกสารอ้างอิง (References)"));
[
  "IEEE Std 29148-2018; ISO/IEC 25010:2011 (SQuaRE)",
  "Prosoft WINSpeed v9.0 — Database Schema (669 ตาราง, schema dump)",
  "หลักฐานข้อมูลจริง — query บน dbwins_worldfert9 (wf_reader, read-only) มิ.ย. 2569",
  "ใบสั่งจอง World Fert — I69-01539, K69-01448; ใบสั่งสินค้า/Order Form L62452",
  "เอกสารคืนรีเบท — RBD68-019 (รวม 55,800 บาท)",
  "แบบขออนุมัติรายการส่งเสริมการขาย — เลขที่ 12/2568, 14/2568, 15/2568; ราคา NET รายเดือน เม.ย. 2568",
  "สรุปการเบิกเสื้อ-กระเป๋ารายภาค ปี 2569 (เหนือ/กลาง/ตะวันออก/ใต้)",
].forEach(t=>children.push(bullet(t)));
children.push(spacer(120));

// 1.5 Stakeholders
children.push(h2("1.5 ผู้มีส่วนได้ส่วนเสีย (Stakeholders)"));
children.push(makeTable(
  ["Stakeholder","บทบาท / ความสนใจหลัก","อิทธิพล","ความสนใจ"],
  [
    ["กรรมการบริหาร","อนุมัติงบ, ROI","สูง","สูง"],
    ["ผู้จัดการฝ่ายขาย / ตลาด","อนุมัติ Rebate Plan/Claim","สูง","สูง"],
    ["ผู้จัดการภาค","ตรวจ/เสนอ Rebate ตามพื้นที่","สูง","สูง"],
    ["ตัวแทนขาย (Sales)","สร้าง order, เบิก Rebate/ของแถม","กลาง","สูง"],
    ["Counter Sales","คีย์ SO, ตรวจซ้ำ, พิมพ์เอกสาร","กลาง","สูง"],
    ["คลังสินค้า","อนุมัติ Unlock, จัดของ, ชุดตั๋วคุม","กลาง","กลาง"],
    ["ฝ่ายชั่งน้ำหนัก","ยืนยัน Shipped + น้ำหนักรถ","กลาง","กลาง"],
    ["Accounting","ตรวจบัญชี, GL, ตรวจ Rebate","สูง","สูง"],
    ["IT Manager / Admin","โครงสร้างพื้นฐาน, security, sync","สูง","กลาง"],
  ],
  [2700, 4060, 1300, 1300], { fontSize:17, boldFirst:true }
));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 2. OVERALL DESCRIPTION ──────────────────────────────────
children.push(h1("2. ภาพรวมของระบบ (Overall Description)"));
children.push(h2("2.1 มุมมองของผลิตภัณฑ์ (Product Perspective)"));
children.push(body("ระบบเป็น Web Application (tablet-first สำหรับ iPad 768–1024px) ที่ทำงานเป็น “Layer เพิ่มเติม” บน Prosoft WINSpeed v9.0 โดยไม่แตะ Schema ของ WINSpeed — ใช้ฐานข้อมูล SQL Server เดียวกัน (dbwins_worldfert9) โดยสร้าง schema wf สำหรับข้อมูลใหม่ (Rebate Plan/Pool/Ledger, Price Book, Giveaway, Control Ticket, Audit, Paper Trail) อยู่คู่กับ dbo จึง JOIN ข้าม schema ได้โดยตรง ไม่ต้อง sync หรือ cache · เน้นความเรียบง่าย: ไม่ใช้ PostgreSQL/Redis/Queue ใดๆ"));
children.push(callout("หลักการออกแบบ (Design Principle)",
  [[run("Non-Invasive Integration — "),
    run("schema dbo = READ-ONLY", {bold:true, color:RED}),
    run(" ระบบใหม่ต้องไม่กระทบการทำงานเดิมของ WINSpeed หากระบบใหม่มีปัญหา ผู้ใช้ต้องกลับไปคีย์ยืนยัน WINSpeed ได้ตามปกติ เขียนเฉพาะ schema "),
    run("wf", {bold:true}), run(" ที่สร้างเอง")]], BLUEBG, NAVY));
children.push(spacer(120));
children.push(h2("2.2 ฟังก์ชันหลักของระบบ (Product Functions)"));
children.push(makeTable(
  ["#","กลุ่มฟังก์ชัน","รายละเอียดสรุป"],
  [
    ["F1","Sales Order Management","สร้าง/แก้/ลบ SO, State Machine 4 สถานะ, ลำดับโหลดแม่-ลูก, ตรวจซ้ำก่อนส่งโรงงาน, audit"],
    ["F2","Rebate Management","Price Book NET รายเดือน, Accrual ต่อรายการ, Pool ตามสูตร×ภาค×เดือน, ตัด FIFO, Claim 2 ประเภท"],
    ["F3","Giveaway & Control Ticket","เลือกของแถม+งบ/สต็อกตามภาค→Sales, ชุดตั๋วคุม+ยอดคงเหลือ+รายงานเฉพาะชุด"],
    ["F4","Paper Trail Tracking","พิมพ์ 4 สี (QR), scan ติดตาม, Kanban dashboard ใบหาย"],
    ["F5","Unlock Request Flow","ขอปลดล็อก SO + แจ้งเตือนคลัง real-time + reverse accrual"],
    ["F6","WINSpeed Integration","JOIN ตรง dbo (read-only) + ส่งข้อมูลเข้า WINSpeed ผ่านฟีเจอร์ Import (WINSpeed ออกใบกำกับ/GL เอง — เราไม่เขียนตารางบัญชี dbo)"],
    ["F7","Reporting & Dashboard","KPI, Rebate/ของแถม/ชุดตั๋ว balance, Paper status, Sales performance"],
    ["F8","Administration & Security","User management, RBAC, JWT, audit, backup"],
  ],
  [600, 2700, 6060], { fontSize:16, boldFirst:true }
));
children.push(spacer(120));
children.push(h2("2.3 ประเภทผู้ใช้และคุณลักษณะ"));
children.push(makeTable(
  ["บทบาท","จำนวน","ทักษะ IT","อุปกรณ์","หน้าที่หลัก"],
  [
    ["SALES","5-10","พื้นฐาน","แท็บเล็ต / Web","สร้าง order, ขอ unlock, เบิก Rebate/ของแถม"],
    ["COUNTER_SALES","2-3","กลาง","แท็บเล็ต/PC","คีย์ SO, ตรวจซ้ำ, confirm, พิมพ์ 4 สี"],
    ["WAREHOUSE","1","พื้นฐาน","แท็บเล็ต","รับ unlock, จัดของ, ชุดตั๋วคุม, Picking"],
    ["WEIGHBRIDGE","1","พื้นฐาน","PC ที่เครื่องชั่ง","ยืนยันออเดอร์+น้ำหนักรถ, Shipped"],
    ["APPROVER","2-4","กลาง","PC/แท็บเล็ต","อนุมัติ Plan/Unlock/Claim (4 ชั้น)"],
    ["ACCOUNTING","1-2","สูง","PC","ตรวจบัญชี, GL, รายงาน Rebate"],
    ["ADMIN","1","สูง","PC","จัดการ user, sync WS, Price Book, backup"],
  ],
  [2000, 1000, 1300, 1860, 3200], { fontSize:16, boldFirst:true }
));
children.push(new Paragraph({ children:[new PageBreak()] }));

children.push(h2("2.4 ข้อจำกัดในการออกแบบและการพัฒนา"));
children.push(h3("Technical / Business Constraints (สรุปสำคัญ)"));
[
  [run("WINSpeed DB = MS SQL Server (legacy) — "), run("ห้ามแก้ schema และห้ามเขียนตารางบัญชี dbo เด็ดขาด", {bold:true, color:RED}), run("; อ่านผ่าน View, ส่งข้อมูลเข้าผ่าน WINSpeed Import (WINSpeed post บัญชีเอง)")],
  "Server สนญ. เยาวราช ต้องเปิด external access ให้โรงงานอยุธยาเข้าถึง (encrypted/VPN)",
  [run("SO Number แยกตาม Sales/พื้นที่ (เช่น I69-XXXXX, K69-XXXXX) "), run("รันต่อเนื่องห้ามข้าม", {bold:true})],
  "Rebate Pool รวมห้ามเกินงบที่อนุมัติ; Giveaway เบิกเกินงบ “ติดลบได้” แต่ต้องเตือน (ตามพฤติกรรมจริง)",
  [run("Stock: "), run("ICStock ของ WINSpeed ว่าง (0 rows)", {bold:true, color:RED}), run(" — ระบบใหม่ต้องจัด stock ใน schema wf เอง; ก่อนยืนยัน Shipped ต้องยืนยันออเดอร์ที่จ่ายออก + น้ำหนักรถ")],
  "Audit immutable — แก้โดยเพิ่ม reversal entry เท่านั้น; ลงบัญชีตาม chart of account ของ WINSpeed",
  "PDPA: ข้อมูลลูกค้า/พนักงานเข้ารหัส + retention policy",
].forEach(t=>children.push(bullet(t)));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 3. BUSINESS CONTEXT ─────────────────────────────────────
children.push(h1("3. บริบทธุรกิจและความต้องการ (Business Context)"));
children.push(h2("3.1 ข้อความปัญหาทางธุรกิจ"));
children.push(body("บริษัทฯ เผชิญความท้าทายในกระบวนการขายและการบริหารส่วนลด (Rebate) ที่กระทบประสิทธิภาพ ความถูกต้องของบัญชี และความพึงพอใจของลูกค้า การพึ่งกระบวนการ manual และเอกสารกระดาษทำให้เกิดข้อผิดพลาด เอกสารสูญหาย และล่าช้า — โดยเฉพาะ Rebate ที่ตั้งเป็นผลต่างราคา NET ต่อตัน แต่ตัดจ่าย FIFO ระดับก้อนรวม จึงแจกแจงต้นทางรายการไม่ได้"));
children.push(h3("3.2.1 กระบวนการขายปัจจุบัน (As-Is)"));
[
  "Sales ส่ง order ทางไลน์ให้ Counter Sales",
  "Counter Sales พิมพ์ใบสั่งจองใน WINSpeed พร้อมแจ้งเลขทะเบียนรถ ส่งโรงงาน",
  "ยามรับบัตรประชาชน + ออกใบอนุญาตนำรถเข้า-ออก ส่งให้ส่วนจ่ายสินค้า",
  "ส่วนจ่ายสินค้าคีย์ใบสั่งจองลง Truck Scale พิมพ์ตั๋วให้รับของจากสายพาน/คลัง/bulk",
  "คนรถนำรถเบาชั่งน้ำหนัก → รับของตามจุด (หลายชนิดวนหลายรอบ) → ชั่งรถรวมของ",
  "ฝ่ายชั่งพิมพ์ใบจ่ายสินค้า 4 สี (ขาว/ฟ้าเก็บ, ชมพูลูกค้า, เหลือง รปภ.) คนรถเซ็นรับทั้งชุด",
  "ลูกค้ารับสินค้า Sales ตามชำระ และขอเบิก Rebate (Accounting ตรวจทีละบิล)",
].forEach((t,i)=>children.push(numItem(t)));
children.push(new Paragraph({ children:[new PageBreak()] }));

children.push(h3("3.2.2 Pain Points ที่ระบุได้ (10 ข้อ)"));
children.push(makeTable(
  ["#","Pain Point","ผลกระทบ","รุนแรง"],
  [
    ["1","คีย์ order ซ้ำซ้อน (ไลน์→ใบสั่งจอง→WS)","เสีย 5-10 นาที/order, error ~5%",{text:"สูง"}],
    ["2","ใบสั่งจอง 4 สี ติดตามไม่ได้","~10% เอกสารหาย/เดือน",{text:"สูง"}],
    ["3","ไม่มี Unlock mechanism","ต้องลบ-สร้าง SO ใหม่ → audit หาย",{text:"กลาง"}],
    ["4","Rebate ตรวจทีละบิล manual","~2-3 ชม./วัน ของ Accounting",{text:"วิกฤต",color:RED,bold:true}],
    ["5","ตัด Rebate FIFO ระดับก้อนรวม","trace ต้นทางรายการไม่ได้",{text:"วิกฤต",color:RED,bold:true}],
    ["6","โปรโมชั่น/ราคา NET เปลี่ยนบ่อย ไม่ flexible","ตอบสนองช้า เสียโอกาส",{text:"กลาง"}],
    ["7","WINSpeed sync ไม่ทันเวลา","สต็อกแสดงไม่ตรงคลังจริง",{text:"สูง"}],
    ["8","ลำดับโหลดรถพ่วงแม่-ลูก ไม่ระบุได้","โกดังต้องเดาลำดับเอง ผิดพลาด/ช้า",{text:"สูง"}],
    ["9","ของแถม (เสื้อ/กระเป๋า) ไม่เห็นสต็อก/งบ","เบิกเกินงบ (ติดลบ) ไม่รู้ตัว",{text:"กลาง"}],
    ["10","ชุดตั๋วคุม ไม่อยู่ในระบบ + รายงานเฉพาะชุดไม่ได้","เขียนฟอร์ม+สแกนเมล, WS ดูได้แค่ภาพรวม",{text:"สูง"}],
  ],
  [500, 3700, 3760, 1400], { fontSize:16, boldFirst:true }
));
children.push(new Paragraph({ children:[new PageBreak()] }));

children.push(h3("3.2.3 ตัวอย่างผลกระทบจริง — Rebate (RBD68-019)"));
children.push(body("เอกสาร RBD68-019 (รวม 55,800 บาท) เป็นการขออนุมัติเคลียร์รายการส่งเสริมการขาย โดย “คืนรีเบท = ราคาขาย − ราคาสุทธิ (NET)” ต่อตัน อ้างอิงหลายอินวอยซ์ (I68-xxxxx) แล้วตัดจากกองรวม:"));
children.push(makeTable(
  ["สูตร","ตัน","ราคาขาย","ราคา NET","รีเบท/ตัน","รวม (บาท)"],
  [
    ["18-4-5","8","12,700","12,300","400","3,200"],
    ["15-5-35","19","18,200","17,000","1,200","22,800"],
    ["14-4-9","12","12,700","12,300","400","4,800"],
    ["15-7-18","14","16,200","15,500","700","9,800"],
    ["21-0-0","8","8,200","7,700","500","4,000"],
    ["0-0-60","16","13,200","12,500","700","11,200"],
  ],
  [1560, 1000, 1700, 1700, 1700, 1700], { fontSize:17, boldFirst:true }
));
children.push(spacer(100));
children.push(callout("Cost of Pain (ประมาณการ)",
  ["Accounting ใช้เวลาตรวจ RBD68-019 ~45 นาที (ค้นบิลต้นทางจาก WS ทีละ INV) หากต้อง trace เพิ่ม 2-3 ชม. ที่ ~50 ใบ/เดือน × 45 นาที = 37.5 ชม./เดือน ≈ 450 ชม./ปี ≈ 56 วันทำงาน/ปี ของพนักงานหนึ่งคน"], BLUEBG, NAVY));
children.push(spacer(120));
children.push(h2("3.3 สภาพในอนาคต (To-Be)"));
[
  "Sales ส่ง order เข้าระบบ (web/ไลน์) → ระบบสร้าง SO; Counter Sales ตรวจซ้ำแล้ว confirm + พิมพ์ 4 สี พร้อม QR",
  "ระบุลำดับโหลดแม่-ลูก และของแถม (เห็นสต็อก/งบ) ในใบเดียว ไม่ต้องเขียนปนทะเบียนรถ",
  "Rebate ตั้ง accrual อัตโนมัติต่อรายการเมื่อ Confirmed (อิง Price Book NET) — Sales เห็น Pool คงเหลือทันที",
  "เคลียร์/เบิก FIFO ในระบบ พร้อมสายอนุมัติ 4 ชั้น และ trace กลับต้นทางได้ 100%",
  "ก่อน Shipped ยืนยันออเดอร์ที่จ่ายออก + น้ำหนักรถ → สร้างไฟล์ import ส่งเข้า WINSpeed (WINSpeed ออกใบกำกับ/GL เอง ถูกต้อง 100%)",
].forEach(t=>children.push(bullet(t)));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 4. DOCUMENT FLOW & STATE (NEW, FIELD-VERIFIED) ──────────
children.push(h1("4. การไหลของเอกสารและสถานะ (Document Flow & State)"));
children.push(body([
  run("หมวดนี้เป็นเนื้อหาใหม่ใน v3.0 — ", {bold:true, color:NAVY}),
  run("ทุกค่าและ join key ยืนยันจากการ query ข้อมูลจริง", {bold:true}),
  run(" บน dbwins_worldfert9 เพื่อให้การออกแบบ State Machine และการเขียนกลับ WINSpeed ถูกต้องตามที่ระบบใช้งานจริง"),
]));
children.push(h2("4.1 DocuType Reference (ยืนยันจากข้อมูลจริง)"));
children.push(makeTable(
  ["DocuType","ชื่อ","ตาราง","PK","จำนวนแถว / หมายเหตุ"],
  [
    ["103","Confirm Order (ใบจอง)","SOHD/SODT","SOID","54,095 — ตั๋วคุม flow"],
    ["104","Sale Order (ใบสั่งขาย)","SOHD/SODT","SOID","52,923 — สร้างจากตั๋วคุม"],
    [{text:"107",bold:true,color:NAVY},{text:"Sale on Credit (ใบกำกับเชื่อ)",bold:true},"SOInvHD/DT","SOInvID",{text:"146,276 — prefix N/J",bold:true}],
    ["108","Cash Sale (ขายสด)","SOInvHD/DT","SOInvID","83"],
    ["109","Credit Note (ลดหนี้)","SOInvHD/DT","SOInvID","2,702 — RefSOID→ต้นทาง"],
    ["110","Debit Note (เพิ่มหนี้)","SOInvHD/DT","SOInvID","2,420 — RefNo→ต้นทาง (RefSOID=NULL)"],
    ["202","(flow ลัด ไม่อยู่ใน ICDocuTypeHD)","SOInvHD/DT","SOInvID","113,043 — DocuNo=SONo, prefix K/I"],
    [{text:"501",bold:true,color:NAVY},{text:"GL Journal",bold:true},"GLHD/GLDT","GLID",{text:"384,400 — FromFlag=ต้นทาง",bold:true}],
  ],
  [1200, 2700, 1700, 1060, 2700], { fontSize:16, boldFirst:true }
));
children.push(spacer(120));
children.push(h2("4.2 Document Chain & Join Keys"));
children.push(body("ลำดับเอกสารจริง: ใบจอง (103) → เข้าชั่ง/ตั๋วคุม (AppvDocuNo) → ใบสั่งขาย (104) → ใบกำกับ (107/202) → GL (501) / ใบวางบิล (203) → รับชำระ (ARReceHD)"));
children.push(makeTable(
  ["จาก","ไปยัง","Join Key (ยืนยันแล้ว)"],
  [
    ["SOHD 104","SOHD 103","h104.RefNo = h103.AppvDocuNo"],
    ["SOInvHD 107","SOHD 104","inv.SONo = h104.DocuNo"],
    ["SOInvHD 107","GLHD","g.DocuNo = inv.DocuNo AND g.FromFlag=107"],
    ["SOInvHD","GLHD (ทางเลือก)","g.FromID = inv.PostID (PostID = GLHD.FromID ไม่ใช่ GLID)"],
    ["ARBillDT","SOInvHD","dt.SOInvID = inv.SOInvID"],
    ["ARReceDT","SOInvHD","r.SOInvID = inv.SOInvID (รับชำระ)"],
    ["CN 109","SOInvHD 107","cn.RefSOID = orig.SOInvID"],
    ["DN 110","SOInvHD 107","dn.RefNo = orig.DocuNo (RefSOID=NULL)"],
  ],
  [2200, 2200, 4960], { fontSize:16, boldFirst:true }
));
children.push(spacer(80));
children.push(callout("⚠ Join ที่ห้ามใช้ (ผิด)",
  [[run("GLHD.FromID = SOInvHD.SOInvID", {bold:true, color:RED}),
    run("  — ตัวเลขชนกันโดยบังเอิญ (WINSpeed ใช้ ID sequence ร่วมข้ามตาราง) ให้ join ด้วย DocuNo+FromFlag เท่านั้น", {})]], PEACH, "C8862E"));
children.push(new Paragraph({ children:[new PageBreak()] }));

// 4.3 ตั๋วคุม
children.push(h2("4.3 ตั๋วคุม / เข้าชั่ง-ชั่งออก (Weigh-Control Flow)"));
children.push(body([
  run("สำคัญ: ", {bold:true, color:NAVY}),
  run("ไม่มีตารางแยกสำหรับ “ตั๋วคุม” ใน WINSpeed", {bold:true}),
  run(" — เลขตั๋วคุม (prefix 'AI') เป็น approval number เก็บใน SOHD.AppvDocuNo และสถานะคุมด้วย SOHD.AppvFlag"),
]));
children.push(makeTable(
  ["ข้อมูล","ตาราง.คอลัมน์","หมายเหตุ"],
  [
    ["สถานะ รอ/ผ่าน","SOHD.AppvFlag","W = รอชั่ง, Y = ผ่านชั่งแล้ว"],
    ["เลขตั๋วคุม","SOHD.AppvDocuNo","prefix 'AI' + ปี พ.ศ. + running (เช่น AI68-03542)"],
    ["วันที่เข้าชั่ง","SOHD.AppvDate","timestamp อนุมัติ"],
    ["ทะเบียนรถ","SOHD.TransRegistration","23,947 แถวมีข้อมูล (เช่น สท70-4239/40)"],
    ["ทะเบียนรถ (สำรอง)","SOHDRemark.Remark","ListNo=1"],
    ["อ้างตั๋วคุมใน SO","SOHD.RefNo (DocuType=104)","= AppvDocuNo ของใบจอง"],
  ],
  [2300, 3400, 3660], { fontSize:16, boldFirst:true }
));
children.push(spacer(80));
children.push(callout("State ที่พบจริง (DocuType=103)",
  [[run("รอชั่ง (AppvFlag=W, DocuStatus=Y): ", {}), run("28,290 ใบ", {bold:true, color:NAVY}),
    run("   |   ผ่านแล้ว (AppvFlag=Y, DocuStatus=Y): ", {}), run("24,632 ใบ", {bold:true, color:NAVY})],
   [run("ยกเลิก (DocuStatus=N): ", {}), run("W=126, Y=1,047", {bold:true})],
   [run("❗ ไม่มี Gross/Tare/Net weight แยก และไม่มี weigh-in/out timestamp ใน WINSpeed → ต้องเพิ่มตาราง ", {}),
    run("wf.WeighTicket", {bold:true, color:NAVY})]], BLUEBG, NAVY));
children.push(new Paragraph({ children:[new PageBreak()] }));

// 4.4 GL Flow
children.push(h2("4.4 GL Flow (สายบัญชี)"));
children.push(body("ใบกำกับขายเชื่อ (107, PostGL='Y') → GLHD (DocuType=501 ทุกแถว, FromFlag=107) → GLDT → ผังบัญชี EMAcc"));
children.push(makeTable(
  ["AccID","บัญชี","Dr/Cr","จำนวนแถว (107)"],
  [
    ["1037","ลูกหนี้-ค้างส่ง","Debit","145,038"],
    ["1120","ขายสินค้า - เงินเชื่อ","Credit","145,014"],
    ["1129","รายได้อื่น","Credit","32"],
  ],
  [1300, 4000, 1500, 2560], { fontSize:17, boldFirst:true }
));
children.push(spacer(80));
children.push(callout("ข้อค้นพบ GL ที่มีผลต่อการออกแบบ",
  [[run("• ปุ๋ยยกเว้น VAT: ", {bold:true}), run("VATType=3, VATAmnt=0 ทุกใบ (146,276 ใบ)", {}), run(" → GL มีแค่ 2 บรรทัด ไม่มี VAT line", {})],
   [run("• GLHD.DocuType = 501 ทุกแถว", {bold:true}), run(" — ใช้ FromFlag ระบุชนิดต้นทาง (ไม่ใช่ DocuType)", {})],
   [run("• ส่งเข้า WS: ", {bold:true}), run("สร้างไฟล์ import (Header+Detail) → ใช้ฟีเจอร์ Import ของ WINSpeed → WINSpeed post invoice+GL เอง (ยืนยันแล้ว: ไม่มี trigger/SP post GL อัตโนมัติ ในฐานข้อมูล)", {})]], GREEN, "5E7E45"));
children.push(new Paragraph({ children:[new PageBreak()] }));

// 4.5 Scenarios
children.push(h2("4.5 Scenarios การไหลของข้อมูล (8 กรณี)"));
children.push(makeTable(
  ["รหัส","Scenario","กลไก / Join"],
  [
    ["A","Happy Path","103→104→107→ARBill→GL (สถานะปกติ)"],
    ["B","Flow ลัด (202)","SOInvHD.DocuNo = SONo (ไม่เปลี่ยนเลขเอกสาร) 113,043 ใบ"],
    ["C","ยกเลิกใบจอง","SOHD.DocuStatus='N' (W ก่อนชั่ง / Y หลังชั่ง)"],
    ["D","Credit Note (ลดยอด)","SOInvHD 109, RefSOID→ใบกำกับต้นทาง"],
    ["E","Debit Note (เพิ่มยอด)","SOInvHD 110, RefNo→ต้นทาง (RefSOID=NULL)"],
    ["F","ของแถม","SODT/SOInvDT line ที่ GoodPrice2=0 (พบทุกปี 2555–2568)"],
    ["G","Rebate","คำนวณจาก SOInvDT รายเดือน × ลูกค้า → ออก CN (109) / wf.RebateLedger"],
    ["H","Outstanding","PostGL='Y' แต่ยังไม่อยู่ใน ARBillDT (ยังไม่วางบิล)"],
  ],
  [900, 2700, 5760], { fontSize:16, boldFirst:true }
));
children.push(spacer(100));
children.push(callout("ตัวอย่าง Query — Lifecycle ของ 1 ตั๋วคุม (Scenario A)",
  [[new TextRun({ text:"DECLARE @AI VARCHAR(30) = 'AI68-03542';", font:"Consolas", size:17, color:NAVY })],
   [new TextRun({ text:"-- [1] ใบจอง", font:"Consolas", size:16, color:GRAYTX })],
   [new TextRun({ text:"SELECT h.DocuNo, h.AppvFlag FROM dbo.SOHD h", font:"Consolas", size:16 })],
   [new TextRun({ text:"WHERE h.AppvDocuNo=@AI AND h.DocuType=103;", font:"Consolas", size:16 })],
   [new TextRun({ text:"-- [2] ใบสั่งขาย → [3] ใบกำกับ (join ด้วย SONo)", font:"Consolas", size:16, color:GRAYTX })],
   [new TextRun({ text:"SELECT inv.DocuNo, inv.PostGL FROM dbo.SOHD h104", font:"Consolas", size:16 })],
   [new TextRun({ text:"JOIN dbo.SOInvHD inv ON inv.SONo=h104.DocuNo", font:"Consolas", size:16 })],
   [new TextRun({ text:"WHERE h104.RefNo=@AI AND h104.DocuType=104;", font:"Consolas", size:16 })]], "F4F6F9", NAVY));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 5. FUNCTIONAL REQUIREMENTS ──────────────────────────────
children.push(h1("5. ความต้องการเชิงฟังก์ชัน (Functional Requirements)"));
children.push(body([
  run("ใช้รหัส FR-XXX และระดับความสำคัญตาม RFC 2119 (MUST / SHOULD / MAY) — เครื่องหมาย ✦ คือแก้ไข/ตรวจสอบกับข้อมูลจริงใน v3.0"),
]));

// FR helper
function frBlock(code, title, level, rows) {
  const titleCell = new TableCell({
    width:{ size:CW, type:WidthType.DXA }, columnSpan:2, borders:cellBorders(NAVY),
    shading:{ fill:NAVY, type:ShadingType.CLEAR, color:"auto" },
    margins:{ top:60, bottom:60, left:120, right:120 },
    children:[ new Paragraph({ children:[
      new TextRun({ text:code+"  ", font:FONT, size:19, bold:true, color:"9DB8E0" }),
      new TextRun({ text:title+"  ", font:FONT, size:19, bold:true, color:WHITE }),
      new TextRun({ text:"["+level+"]", font:FONT, size:17, bold:true, color:"C5D5EE" }),
    ] }) ],
  });
  const bodyRows = rows.map(([k,v],i)=> new TableRow({ children:[
    new TableCell({ width:{ size:1700, type:WidthType.DXA }, borders:cellBorders(),
      shading:{ fill:ROW, type:ShadingType.CLEAR, color:"auto" }, margins:{top:50,bottom:50,left:110,right:90},
      children:[ new Paragraph({ children:[new TextRun({ text:k, font:FONT, size:17, bold:true, color:NAVY2 })] }) ] }),
    new TableCell({ width:{ size:7660, type:WidthType.DXA }, borders:cellBorders(),
      shading:{ fill:WHITE, type:ShadingType.CLEAR, color:"auto" }, margins:{top:50,bottom:50,left:110,right:110},
      children:[ new Paragraph({ spacing:{line:252}, children:[new TextRun({ text:v, font:FONT, size:17 })] }) ] }),
  ] }));
  return new Table({ width:{ size:CW, type:WidthType.DXA }, columnWidths:[1700,7660],
    rows:[ new TableRow({ children:[titleCell] }), ...bodyRows ] });
}

children.push(h2("5.1 โมดูล Sales Order Management"));
children.push(frBlock("FR-001","Sales Order State Machine","MUST",[
  ["Source","Pain #3"],
  ["Description","รองรับ 4 สถานะ Draft → Confirmed → Picking → Shipped พร้อมเงื่อนไข transition ที่กำหนด"],
  ["Acceptance","Draft แก้ได้ทุก field · Confirmed: จองสต็อก + ตั้ง Rebate accrual, แก้ต้องผ่าน Unlock · Picking ห้ามแก้ · Shipped ล็อกถาวร + สร้าง SOInv ใน WS · ทุก transition บันทึก audit (actor, IP, time, before/after JSON)"],
]));
children.push(spacer(120));
children.push(frBlock("FR-002","การสร้างและคีย์ Sales Order","MUST",[
  ["Source","ใบสั่งจอง I69-01539, K69-01448"],
  ["Description","สร้าง SO ครบ field: วันที่ (auto), ผู้ขาย (Sales), รหัสลูกค้า (search master), สาขา, ที่อยู่จัดส่ง, เลขทะเบียนรถ, รายการสินค้า (รหัส/จำนวน/ราคา), หมายเหตุ, เครดิต"],
  ["Acceptance","คีย์ SO ใหม่ < 2 นาที · auto-complete < 500ms · แสดง Rebate ที่จะได้รับ real-time ขณะคีย์ · validate ทุก field ก่อน save"],
]));
children.push(spacer(120));
children.push(frBlock("FR-019 ✦","Mother/Baby Load Sequencing","MUST",[
  ["Source","Pain #8"],
  ["Description","แต่ละบรรทัดสินค้าต้องระบุได้ว่าอยู่ “ตัวแม่” หรือ “ตัวลูก” และลำดับการโหลด (sequence) ตามที่ลูกค้าแจ้ง โดยพิมพ์ลำดับนี้ลงใบสั่งจอง/ใบจ่ายของ"],
  ["Acceptance","เพิ่ม field จำนวนแม่/จำนวนลูก · ลำดับ ต่อบรรทัด · แสดงคอลัมน์ลำดับบนเอกสารพิมพ์ · รองรับหมายเหตุ “รับพร้อม …”"],
]));
children.push(spacer(120));
children.push(frBlock("FR-022 ✦","Counter-Sales Verification Gate","SHOULD",[
  ["Source","ฝ่ายขายเสนอ"],
  ["Description","เพิ่มขั้นตอนให้ Counter Sales ตรวจสอบคำสั่งซื้ออีกครั้งก่อนส่งต่อไปยังโรงงาน (ก่อนเปลี่ยนเป็น Confirmed/ส่งผลิต)"],
  ["Acceptance","ปุ่ม “ตรวจแล้ว” แยกจาก confirm · บันทึกผู้ตรวจ + เวลา · SO ที่ยังไม่ตรวจห้ามส่งโรงงาน"],
]));
children.push(new Paragraph({ children:[new PageBreak()] }));

children.push(frBlock("FR-003 ✦","ตรวจสอบเครดิตและ Credit Hold","SHOULD",[
  ["Source","ฝ่ายขาย / Accounting"],
  ["Description","ตรวจวงเงินเครดิตคงเหลือก่อน confirm หากเกินบังคับ On Hold + แจ้ง Approver · หมายเหตุ: WINSpeed ไม่มีข้อมูลวงเงิน (EMCust.CreditAmnt=0 ทุกราย, ARControl ว่าง) จึงต้องสร้าง Credit Master ใน schema wf"],
  ["Acceptance","credit check < 1 วินาที · แสดง limit/used/available ก่อน confirm · On Hold บันทึก audit · Approver override พร้อมเหตุผล · (รอยืนยัน D-02)"],
]));
children.push(spacer(120));
children.push(frBlock("FR-004","พิมพ์เอกสารใบสั่งจอง/จ่ายของ 4 สี","MUST",[
  ["Source","Pain #2"],
  ["Description","เมื่อ Confirmed สร้าง PDF 4 สี (จ่ายออก: ขาว/ฟ้าเก็บ, ชมพูลูกค้า, เหลือง รปภ.; ใบรับ: เหลือง/ฟ้าเก็บ, ชมพูร้านค้า, เขียว รปภ.) พร้อม QR unique"],
  ["Acceptance","PDF < 3 วินาที · QR unique (SO+สี+nonce) · รูปแบบเหมือนเอกสารปัจจุบัน · พิมพ์กระดาษคาร์บอน/แยกสีได้"],
]));
children.push(spacer(120));
children.push(h2("5.2 โมดูล Rebate Management (Accrual + FIFO)"));
children.push(frBlock("FR-023 ✦","Price Book — ราคา NET รายเดือน","MUST",[
  ["Source","ราคาขายประจำเดือน เม.ย. 2568; EMSetPriceDT (4,054 แถว, 2565–2568)"],
  ["Description","Admin/Approver บันทึกราคา NET (บาท/ตัน) ต่อสูตร ต่อเดือน เป็นฐานคำนวณ Rebate; ราคา NET จริงอยู่ที่ EMSetPriceDT.GoodPriceNet (ICPriceHD/DT ว่าง ไม่ใช้); รองรับ flag สูตรงดขาย"],
  ["Acceptance","import/clone ราคาจากเดือนก่อน · version ตามเดือน · audit · ราคา NET ใช้คำนวณ accrual อัตโนมัติ"],
]));
children.push(spacer(120));
children.push(frBlock("FR-008 ✦","ตั้ง Rebate Plan","MUST",[
  ["Source","แบบขออนุมัติส่งเสริมการขาย 12/2568, 14/2568, 15/2568"],
  ["Description","สร้าง Plan ระบุ: สูตร, ภาค (ใต้/กลาง/เหนือ/ตะวันออก/ทุกร้าน), ราคา NET ที่คืน, ระยะเวลา, ประเภทการคืน (คืนรีเบท / คืนส่วนต่าง), สถานะ DRAFT→ACTIVE→CLOSED"],
  ["Acceptance","รองรับ overlap (เลือกตาม priority) · clone plan · activate ต้องผ่าน Approver · แก้ไขมี version control + audit"],
]));
children.push(new Paragraph({ children:[new PageBreak()] }));

children.push(frBlock("FR-009","จัดสรร Rebate Pool","MUST",[
  ["Source","Meeting; ข้อมูลจริง: 22 Sales, 65 SaleArea"],
  ["Description","จัดสรร Plan เป็น Pool ต่อ Sales (แยกตัว Sales × สูตร × ภาค × เดือน) มี allocated / used / remaining / frozen"],
  ["Acceptance","Sales เห็น Pool ตนเอง · Admin เห็นทุก Sales + drill-down + bar chart · รวมจัดสรรห้ามเกินงบ Plan"],
]));
children.push(spacer(120));
children.push(frBlock("FR-010 ✦","Apply Rebate Accrual ต่อบรรทัด (FIFO)","MUST",[
  ["Source","Pain #5, RBD68-019"],
  ["Description","เมื่อ Confirmed ตั้ง accrual ต่อบรรทัดที่ match Plan: accrual = (ราคาขาย − ราคา NET) × จำนวนตัน → สร้าง RebateLedger เข้า Pool; เคลียร์/เบิกแบบ FIFO (ก้อนเก่าสุดก่อน) ข้าม Plan ได้เมื่อ Pool ก่อนหน้าหมด; บันทึก fifoSequence"],
  ["Acceptance","apply < 500ms/SO · ทุก ledger link กลับ SOLine + Plan · FIFO sequence ต่อเนื่องระดับ Pool · unlock → reverse (reversedFlag) ไม่ลบ · trace ได้ว่าแต่ละบาทมาจาก SO/Plan ใด"],
]));
children.push(spacer(120));
children.push(frBlock("FR-011 ✦","Rebate Claim — 2 ประเภท","MUST",[
  ["Source","RBD68-019"],
  ["Description","รวม ledger ที่ approved เป็น Claim (เช่น RBD69-001) แยก 2 บล็อก: คืนรีเบท (sell-NET) และคืนส่วนต่าง (price-list); อ้างหลายอินวอยซ์; สถานะ DRAFT→SUBMITTED→APPROVED→PAID"],
  ["Acceptance","เลือก ledger รวมใน Claim · breakdown ตามสูตร + แสดงทั้ง 2 ประเภท · พิมพ์ Claim Form เหมือน RBD68-019 · อนุมัติ 4 ชั้น · หลัง approve ส่งข้อมูลเข้า WINSpeed (Import) เพื่อออก Credit Note (DocuType=109) — WINSpeed ลงบัญชีเอง ไม่เขียน dbo ตรง"],
]));
children.push(new Paragraph({ children:[new PageBreak()] }));

children.push(h2("5.3 โมดูล Giveaway & Control Ticket"));
children.push(frBlock("FR-020 ✦","ของแถม + งบและสต็อก","MUST",[
  ["Source","Pain #9, สรุปเบิกเสื้อ-กระเป๋ารายภาค"],
  ["Description","เลือกของแถม (เสื้อยืด/กระเป๋า/กระสอบเปล่า/แบนเนอร์/สูตรแถม) ผูกกับ SO โดยมีงบ ต่อภาค → ต่อ Sales → ต่อรายการ; บันทึกเป็น line GoodPrice2=0 ใน SOInvDT (พบทุกปี); แสดงสต็อก/งบคงเหลือขณะเลือก"],
  ["Acceptance","แสดงคงเหลือ real-time ขณะเลือก · รองรับเบิกเกินงบ (ค่าติดลบ) แต่ต้องเตือน + บันทึก · รายงานเบิกรายภาค/Sales/รายการ · แยก brand (รถเกษตร/ปุ๋ยเทพ)"],
]));
children.push(spacer(120));
children.push(frBlock("FR-021 ✦","ชุดตั๋วคุม (Control Ticket)","MUST",[
  ["Source","Pain #10"],
  ["Description","บันทึกชุดตั๋วคุม ผูกกับ SO/ลูกค้า แสดงยอดคงเหลือชุดตั๋ว และรองรับกรณีลูกค้ารับเฉพาะชุดตั๋วคุม หรือรับพร้อมใบสั่งจอง"],
  ["Acceptance","แสดงยอดคงเหลือชุดตั๋วทันที · เรียกรายงานแบบเจาะจงต่อชุดตั๋ว (ไม่ใช่ภาพรวมแบบ WS) · บันทึกสถานะ รับเฉพาะชุด / รับพร้อม"],
]));
children.push(spacer(120));
children.push(h2("5.4 โมดูล Unlock / Paper Trail / WINSpeed (สรุป)"));
children.push(makeTable(
  ["FR","ชื่อ","สาระสำคัญ"],
  [
    ["FR-006/007","Unlock Request + Approve","Sales/Counter ขอ unlock (เหตุผล ≥10 ตัว) → แจ้งคลัง real-time (WebSocket ≤1s); approve → SO กลับ Draft, reverse accrual, ปลดสต็อก"],
    ["FR-012/013","Paper Scan + Kanban","scan QR ≤2s แสดง history; dashboard 5 คอลัมน์ Printed→In Transit→Signed→Filed→Lost; alert ใบหาย >3 วัน"],
    ["FR-014 ✦","อ่าน Master จาก dbo","JOIN ตรงข้าม schema (DB เดียวกัน): EMGood/EMCust/EMSetPriceDT/EMAcc ผ่าน View (read-only) — ไม่ต้อง cache/sync · ICStock ว่างไม่ใช้"],
    ["FR-015 ✦","ส่งใบกำกับเข้า WINSpeed เมื่อ Shipped","สร้างไฟล์ import (Header+Detail ตามรูปแบบ WINSpeed) → ใช้ฟีเจอร์ Import ของ WINSpeed → WINSpeed post invoice+GL เอง · **ห้ามเขียน dbo.SOInvHD/GLHD ตรง** (บัญชีต้องถูก 100%) · บันทึก DocuNo ที่ได้กลับมา sync สถานะใน wf"],
    ["FR-016","ช่องทาง LINE (intake)","Phase 1: รับ order/แจ้งเตือนผ่าน LINE (webhook/notify); LIFF app เต็มรูปเลื่อน Phase 2"],
    ["FR-017","Reporting & Dashboard","SO summary, Rebate/ของแถม/ชุดตั๋ว balance, Paper status, Sales performance, audit; export Excel/PDF"],
    ["FR-018","RBAC + Auth","7+ บทบาท, JWT (15 นาที + refresh 7 วัน), permission ตรวจทั้ง FE/BE, audit ทุก auth event"],
  ],
  [1300, 2100, 5960], { fontSize:16, boldFirst:true }
));
children.push(spacer(120));

// 5.5 Field-verified specifics (จากเอกสารทีม WF Sales Comment + ปัญหา/ความต้องการ)
children.push(h2("5.5 กฎอนุมัติเฉพาะ & Dashboard (ยืนยันกับทีมขาย)"));
children.push(body([run("เพิ่มเติมจากเอกสาร field requirements ของทีม (WF Sales Comment, ปัญหา/ความต้องการ) — ", {}), run("ยืนยันแล้วว่า framework FR ครอบคลุม ส่วนนี้คือรายละเอียดเฉพาะที่ต้อง implement", {bold:true})]));
children.push(h3("FR-006/007 ✦ — Approval Levels เฉพาะกรณี"));
children.push(makeTable(
  ["กรณี","ผู้อนุมัติ","flag / กลไก"],
  [
    ["แก้ไขตอนรถกำลังรับสินค้า (Picking)",{text:"คุณสุรชัย คนเดียว",bold:true,color:NAVY},"ApproveFlagPicking"],
    ["ขาย เกิน ราคาตั้ง (set price)",{text:"คุณรุ่งนิรันดร์ (1 คน)",bold:true,color:NAVY},"ApproveFlag SO"],
    ["ขาย ต่ำกว่า ราคาตั้ง ไม่เกิน 500 บาท",{text:"ผจก. 3 ท่าน",bold:true,color:NAVY},"ApproveFlag SO (multi)"],
    ["ราคา/ต้นทุน","ต้นทุน=ผู้รับผิดชอบ, ราคาขาย=ผู้มีอำนาจ, บางรายการกรรมการดูได้เท่านั้น","RBAC field-level"],
  ],
  [4200, 3000, 2160], { fontSize:16, boldFirst:true }
));
children.push(spacer(80));
children.push(h3("FR-017 ✦ — Real-time Dashboard (Sales)"));
[
  [run("ตั๋วคงค้าง + aging: ", {bold:true}), run(">30 วัน = สีเหลือง, >45 วัน = สีแดง (SOHD 103 รอชั่ง)")],
  [run("สถานะรถ 3 สถานะ: ", {bold:true}), run("มาถึง-รอคิว / กำลังรับสินค้า / รถออกจากโรงงาน (timestamp จากเครื่องชั่ง → wf.WeighTicket)")],
  [run("สต๊อก FG (StockFlag='Y', 193 รายการ) + ของแถม (GoodGroupID NULL) + กระสอบ (GoodGroupID=1000) ", {}), run("— real-time", {bold:true})],
  [run("Historical autocomplete: ", {bold:true}), run("พิมพ์ทะเบียน 'ก' → dropdown ทะเบียนที่เคยเข้า; สูตรที่ไม่เคยซื้อ → สีแดง")],
  [run("Rebate คงเหลือ (ดูอย่างเดียว) + เลือกรับสินค้าจาก 'โม่' หรือ 'สต๊อก'", {})],
].forEach(t=>children.push(bullet(t)));
children.push(spacer(60));
children.push(callout("Master Data — การจำแนก (ยืนยัน DB จริง)",
  [[run("ปุ๋ย FG ขายได้ = ", {bold:true}), run("StockFlag='Y' AND MainGoodUnitID=1002 (193 รายการ)", {})],
   [run("ของแถม = ", {bold:true}), run("GoodGroupID IS NULL + หน่วยไม่ใช่ตัน (เช่น P00001 เสื้อยืดรถเกษตร) | กระสอบ = GoodGroupID=1000", {})],
   [run("WF เป็น Trade → ไม่มี real-time stock ใน WS (track ได้แค่ที่ขายไป); stock จริงรอ DB โรงงาน → จัดใน wf", {})],
   [run("cross-check เต็ม: wf/out/requirements_verification.md", {italics:true, color:GRAYTX})]], BLUEBG, NAVY));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 6. EXTERNAL INTERFACE ───────────────────────────────────
children.push(h1("6. External Interface Requirements"));
children.push(h2("6.1 UI/UX"));
[
  "Tablet-First (iPad 768–1024px) เป็นหลัก; touch-friendly ปุ่ม ≥48×48px",
  "Card-based + Modal detail; รองรับภาษาไทยเป็นหลัก (font Prompt)",
  "Status color: Draft=เทา, Confirmed=ทอง, Picking=เทอราคอตต้า, Shipped=เขียวเสจ, Cancelled=แดง",
].forEach(t=>children.push(bullet(t)));
children.push(spacer(120));
children.push(h2("6.2 Software Interfaces — Prosoft WINSpeed v9.0 (แก้ไขตามข้อมูลจริง)"));
children.push(makeTable(
  ["Interface","Direction","Tables/Views","Frequency","Method"],
  [
    ["Master Data","Read","EMGood, EMCust, EMAcc","JOIN ตรง (real-time)","View (read-only)"],
    [{text:"Pricing ✦",bold:true,color:NAVY},"Read",{text:"EMSetPriceHD/DT",bold:true},"JOIN ตรง","View (read-only)"],
    [{text:"Stock ✦",bold:true,color:NAVY},"—",{text:"ICStock ว่าง (0 rows)",color:RED},"—",{text:"จัดใน wf เอง",color:RED}],
    ["Sales Order (เดิม)","Read","SOHD/DT, ARBillHD/DT","On-demand","View (read-only)"],
    [{text:"Invoice Creation ✦",bold:true,color:NAVY},{text:"Import",bold:true},{text:"→ WINSpeed (SOInvHD/DT)",bold:true},"On Shipped",{text:"WINSpeed Import (ไม่เขียน dbo ตรง)",bold:true,color:NAVY}],
    [{text:"Credit Note ✦",bold:true,color:NAVY},{text:"Import",bold:true},{text:"→ WINSpeed (109)",bold:true},"On Claim approved",{text:"WINSpeed Import",bold:true,color:NAVY}],
  ],
  [1900, 1300, 2700, 1700, 1760], { fontSize:16, boldFirst:true }
));
children.push(spacer(80));
children.push(callout("ข้อกำหนด WINSpeed Integration (แก้ไข v3.0)",
  [[run("• ", {}), run("Pricing: ", {bold:true}), run("ใช้ EMSetPriceDT.GoodPriceNet ", {bold:true,color:NAVY}), run("(เดิมระบุ ICPriceHD/DT ซึ่งว่าง 0 rows)", {color:RED})],
   [run("• ", {}), run("Stock: ", {bold:true}), run("ICStock ว่าง — จัด stock ใน schema wf เอง (เดิมระบุอ่าน ICStock ทุก 60s)", {})],
   [run("• ", {}), run("CN/DN: ", {bold:true}), run("CN=SOInvHD 109 (link ด้วย RefSOID), DN=110 (link ด้วย RefNo เพราะ RefSOID=NULL) — ไม่ใช่ ARCNHD/DT", {})],
   [run("• ", {}), run("GL: ", {bold:true}), run("WINSpeed post เอง (Dr 1037 ลูกหนี้-ค้างส่ง / Cr 1120 ขายสินค้า-เงินเชื่อ; ปุ๋ยยกเว้น VAT) — ", {}), run("ยืนยันแล้วว่าไม่มี trigger/SP post GL อัตโนมัติใน DB", {bold:true, color:RED})],
   [run("• ", {}), run("แนวทาง B (D-03): ", {bold:true}), run("ห้ามเขียนตารางบัญชี dbo เด็ดขาด → ส่งผ่านฟีเจอร์ Import ของ WINSpeed (มี IEImportTemplate_wf อยู่แล้ว: IssueStock/ReceiptFG; ต้องตั้ง template ใบสั่งขาย/ใบกำกับเพิ่ม)", {})],
   [run("• ทีมพัฒนาสร้างเฉพาะ View (read) + ไฟล์ import ส่ง DBA ลูกค้า; การ post บัญชีเป็นหน้าที่ WINSpeed 100%", {})]], BLUEBG, NAVY));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 6.3 WINSpeed Import file format (verified จากคู่มือ + UI) ──
children.push(h2("6.3 WINSpeed Import — รูปแบบไฟล์จริง (SO Export/Import)"));
children.push(body([
  run("ยืนยันจากคู่มือ Prosoft (Export-Import Document.pdf) + WINSpeed UI จริง: ส่งใบสั่งขายเข้า WINSpeed ผ่านเมนู ", {}),
  run("SO Export/Import", {bold:true, color:NAVY}),
  run(" (screen w_importexport_so) ด้วยไฟล์ ", {}),
  run("Tab-delimited TXT", {bold:true}),
  run(" แยก Header + Detail ในโฟลเดอร์ YYYYMMDD"),
]));
children.push(h3("SOHD.TXT — Header (1 บรรทัด/ใบสั่งขาย)"));
children.push(makeTable(
  ["คอลัมน์ WINSpeed","map จาก wf / ค่า","อ้าง dbo"],
  [
    ["BrchCode*","=1 (สาขาเดียว)","EMBrch"],
    ["DocuNo*","wf.SalesOrder.SoNo",""],
    ["DocuDate*","OrderDate (DD/MM/YYYY)",""],
    ["CustCode*","→ CustomerID","EMCust"],
    ["ShipDate / CreditDays","ShipDate / เครดิต",""],
    ["TranspCode / EmpCode","TranspID / SalesID","EMTransp/EMEmp"],
    ["SumGoodAmnt* / NetAmnt","Σ line / TotalAmount",""],
    [{text:"VATType",bold:true},{text:"= '3' (ไม่คิดภาษี) — ปุ๋ยยกเว้น VAT",bold:true,color:NAVY},""],
    ["SaleAreaCode","SaleAreaID","EMSaleArea"],
    [{text:"DocuType",bold:true},{text:"Default 104 (ใบสั่งขาย)",bold:true,color:NAVY},""],
  ],
  [2400, 4760, 2200], { fontSize:15, boldFirst:true }
));
children.push(spacer(60));
children.push(h3("SODT.TXT — Detail (1 บรรทัด/รายการสินค้า)"));
children.push(makeTable(
  ["คอลัมน์ WINSpeed","map จาก wf / ค่า","อ้าง dbo"],
  [
    ["BrchCode* / DocuNo*","=1 / = SOHD.DocuNo","EMBrch"],
    ["GoodCode","→ GoodID","EMGood"],
    ["InveCode / LocaCode","=1 / =1","EMInve/EMLoca"],
    [{text:"GoodUnitCode*",bold:true},{text:"=1002 (ตัน)",bold:true,color:NAVY},"EMGoodUnit"],
    ["GoodStockRate2","=1",""],
    [{text:"GoodQty2",bold:true},{text:"QtyTon (ตัน)",bold:true,color:NAVY},""],
    [{text:"GoodPrice",bold:true},{text:"UnitPrice (บาท/ตัน) · ของแถม=0",bold:true,color:NAVY},""],
    ["GoodDiscAmnt / GoodAmnt","DiscAmnt / QtyTon×UnitPrice",""],
    [{text:"DocuType",bold:true},{text:"Default 104",bold:true,color:NAVY},""],
  ],
  [2400, 4760, 2200], { fontSize:15, boldFirst:true }
));
children.push(spacer(80));
children.push(callout("ขั้นตอนการลงบัญชี (ยืนยันจาก UI: ฟอร์ม Post Invoice (WF))",
  [[run("1) ", {bold:true}), run("app สร้าง SOHD.TXT+SODT.TXT (DocuType 104) → Import ที่ SO Export/Import → เกิด ", {}), run("ใบสั่งขาย (รออนุมัติ ยังไม่ลง GL)", {bold:true})],
   [run("2) ", {bold:true}), run("ผู้มีอำนาจรัน ", {}), run("Post Invoice (WF)", {bold:true, color:NAVY}), run(" — กรองตามเลขที่ใบสั่งขาย/วันที่/คลัง → เลือกรายการ → กด Post → WINSpeed สร้าง ", {}), run("ใบกำกับ (107) + GL เอง", {bold:true})],
   [run("3) ", {bold:true}), run("app อ่าน DocuNo/SOInvID กลับมา sync สถานะใน wf (read-only)", {})],
   [run("→ ", {bold:true, color:RED}), run("คู่มือหน้า 12: SO ขายเชื่อ ไม่ลงบัญชีจนกว่าอนุมัติ → บัญชีอยู่ใน WINSpeed 100% เราไม่เขียน dbo", {bold:true, color:RED})]], GREEN, "5E7E45"));
children.push(body([run("รายละเอียดคอลัมน์ครบถ้วน: ดู wf/out/winspeed_import_spec.md", {italics:true, color:GRAYTX, size:16})]));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 7. NFR ──────────────────────────────────────────────────
children.push(h1("7. ความต้องการเชิงคุณภาพ (Non-Functional Requirements)"));
children.push(makeTable(
  ["NFR","หมวด","เกณฑ์เป้าหมาย"],
  [
    ["NFR-001","Performance","P95 < 1s (API ทั่วไป), < 3s (report), < 500ms (master lookup ผ่าน indexed view)"],
    ["NFR-002","Throughput","> 50 SO/นาที (peak), > 10 concurrent unlock"],
    ["NFR-004","Auth/Session","JWT access 15 นาที + refresh 7 วัน, bcrypt cost 12"],
    ["NFR-005","Encryption","TLS 1.2+ in-transit; at-rest disk/TDE; sensitive fields AES-256"],
    ["NFR-006","Audit Logging","append-only, retention 7 ปี, before/after JSON, ห้ามลบ"],
    ["NFR-007","PDPA","data minimization, consent, breach notify < 72 ชม."],
    ["NFR-008","Availability","99.5% ในเวลาทำการ (จ-ส 7:00-19:00)"],
    ["NFR-009","Recoverability","RTO < 4 ชม., RPO < 1 ชม., daily full + hourly incremental"],
    ["NFR-010","Fault Tolerance","DB เดียว (SQL Server) — graceful degradation: ถ้า DB ล่ม กลับไปคีย์ WINSpeed ได้; SP write retry ในระดับ transaction"],
    ["NFR-011","Usability","Counter Sales สร้าง SO ได้ใน 30 นาทีหลังเทรน 1 ครั้ง"],
    ["NFR-013","Code Quality","coverage > 70%, TS strict, ESLint/Prettier, code review บังคับ"],
    ["NFR-016","Browser/Tablet","Chrome/Edge 90+, Safari 14+ (iPad), responsive 768–1024px"],
    ["NFR-018","WS Coexistence","ห้ามแก้ schema, load WS DB เพิ่ม < 10%, คีย์ WS ตรงควบคู่ได้"],
  ],
  [1200, 2100, 6060], { fontSize:16, boldFirst:true }
));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 8. DATA REQUIREMENTS ────────────────────────────────────
children.push(h1("8. ความต้องการด้านข้อมูล (Data Requirements)"));
children.push(h2("8.1 Logical Data Model — schema wf (Entity หลัก)"));
children.push(h3("Domain: Sales Order"));
children.push(makeTable(
  ["Entity","Key Attributes (สรุป)"],
  [
    ["SalesOrder","soNo(PK), customerId, salesId, status, branchId, quotationNo, appQuoLimit, truckReg, totalAmount, verifiedBy, createdAt"],
    ["SalesOrderLine","sold(FK), lineNo, goodId, formula, qtyTon, unitPrice, motherBaby(enum), loadSeq, rebateAccrual"],
    ["SalesOrderAudit","sold(FK), actor, action, beforeJson, afterJson, ip, timestamp"],
    ["UnlockRequest","sold(FK), reason, status, requesterId, approverId, requestedAt, respondedAt"],
    ["WeighTicket ✦","sold(FK), grossKg, tareKg, netKg, weighInAt, weighOutAt, truckReg (ข้อมูลที่ WS ไม่มี)"],
  ],
  [2400, 6960], { fontSize:16, boldFirst:true }
));
children.push(spacer(80));
children.push(h3("Domain: Rebate"));
children.push(makeTable(
  ["Entity","Key Attributes (สรุป)"],
  [
    ["PriceBook ✦","id(PK), formula, month, netPricePerTon, discontinuedFlag, version (อ้าง EMSetPriceDT)"],
    ["RebatePlan ✦","planId(PK), formula, region, netPrice, returnType(REBATE/PRICEDIFF), validFrom, validTo, allocatedAmount, priority, status"],
    ["RebatePool","poolId(PK), planId(FK), salesId(FK), allocated, used, remaining, frozen"],
    ["RebateLedger ✦","id(PK), poolId(FK), soLineId(FK), accrualAmount, fifoSeq, type(ACCRUAL/CLAIM), reversedFlag, createdAt"],
    ["RebateClaim ✦","claimId(PK), customerId, salesId, rebateTotal, priceDiffTotal, status, approvalLevel, invoiceRefs[], wsCreditNoteNo"],
    ["RebateClaimLine","claimId(FK), ledgerId(FK), amount, returnType"],
  ],
  [2400, 6960], { fontSize:16, boldFirst:true }
));
children.push(spacer(80));
children.push(h3("Domain: Giveaway & Control Ticket"));
children.push(makeTable(
  ["Entity","Key Attributes (สรุป)"],
  [
    ["GiveawayBudget ✦","id(PK), region, salesId, itemCode, itemName, brand, budgetQty, usedQty, remainingQty(computed)"],
    ["GiveawayIssue ✦","id(PK), sold(FK), budgetId(FK), qty, issuedAt (อนุญาต remaining ติดลบ + flag เดือน)"],
    ["ControlTicket ✦","id(PK), ticketSetNo, customerId, totalQty, remainingQty, status"],
    ["ControlTicketIssue ✦","id(PK), ticketId(FK), sold(FK), qty, receiveMode(SET_ONLY/WITH_ORDER), issuedAt"],
  ],
  [2400, 6960], { fontSize:16, boldFirst:true }
));
children.push(spacer(80));
children.push(h3("Domain: Paper Trail / System"));
children.push(makeTable(
  ["Entity","Key Attributes (สรุป)"],
  [
    ["PaperCopy","copyId(PK), sold(FK), color(WHITE/BLUE/PINK/YELLOW…), qrNonce, pdfPath, currentHolderId, status"],
    ["PaperScan","scanId(PK), copyId(FK), scannerId, location, scannedAt, action"],
    ["User / Role","userId(PK), username, passwordHash, role, branchId, lineUserId / permissions(JSON)"],
    ["GoodExtra ✦","goodId(PK), bagPerTon (1 ตัน = 20 กระสอบ), weightKgPerBag (ข้อมูลที่ WS ไม่มี)"],
    ["(ไม่มี cache)","อ่าน master ด้วย JOIN ตรงไป dbo (EMGood/EMCust/EMSetPriceDT/EMAcc) — DB เดียวกัน"],
  ],
  [2400, 6960], { fontSize:16, boldFirst:true }
));
children.push(new Paragraph({ children:[new PageBreak()] }));

children.push(h2("8.2 ความสัมพันธ์สำคัญ (สรุป)"));
[
  "SalesOrder 1:N SalesOrderLine / Audit / UnlockRequest / WeighTicket / PaperCopy(=4 สี) / GiveawayIssue / ControlTicketIssue",
  "RebatePlan 1:N RebatePool (ต่อ Sales); RebatePool 1:N RebateLedger; SalesOrderLine 1:N RebateLedger",
  "RebateLedger N:1 RebateClaim (ผ่าน RebateClaimLine, แยก returnType)",
  "PriceBook ↔ RebatePlan (NET price อ้างอิงตามสูตร/เดือน); GiveawayBudget 1:N GiveawayIssue; ControlTicket 1:N ControlTicketIssue",
].forEach(t=>children.push(bullet(t)));
children.push(spacer(120));
children.push(h2("8.3 หน่วยและราคา (ข้อเท็จจริงจากข้อมูลจริง)"));
children.push(makeTable(
  ["หัวข้อ","ข้อเท็จจริง"],
  [
    ["หน่วยหลัก","GoodUnitID=1002 = ตัน (ปุ๋ยทุกสูตร MainGoodUnitID=1002, SaleGoodUnitID=NULL)"],
    ["Conversion","ไม่มี ตัน↔กระสอบ ใน WS (RateQty=1.0 ทุกหน่วย) → คำนวณในแอป 1 ตัน=20 กระสอบ (50 กก.) เก็บใน wf.GoodExtra"],
    ["ปริมาณ/ราคา","SOInvDT.GoodQty2 = ปริมาณ (ตัน), GoodPrice2 = บาท/ตัน, GoodAmnt = Qty2×Price2"],
    ["ราคา NET","EMSetPriceDT.GoodPriceNet (4,054 แถว, 2565–2568) — ICPriceHD/DT และ EMGood.StandardSalePrce ว่าง/NULL"],
    ["ของแถม","line ที่ GoodPrice2=0 (GoodID ระบุของแถม); GoodID=NULL = misc/service (224,571 แถว)"],
  ],
  [2000, 7360], { fontSize:16, boldFirst:true }
));
children.push(spacer(120));
children.push(h2("8.4 Data Migration"));
[
  "ไม่ migrate transaction เก่าจาก WS (start fresh) — master อ่านด้วย JOIN ตรงไป dbo (ไม่ copy/cache)",
  "Import 1 ครั้ง: User accounts (CSV), Rebate Plan/Price Book ปัจจุบัน (Excel), งบของแถมรายภาค (จาก XLS สรุปเบิก)",
  "schema wf สร้างใน DB เดียวกันกับ dbo (dbwins_worldfert9) ด้วย login wf_owner",
].forEach(t=>children.push(bullet(t)));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 9. ARCHITECTURE ─────────────────────────────────────────
children.push(h1("9. สถาปัตยกรรมระบบ (เน้นความเรียบง่าย)"));
children.push(body([
  run("2-tier เรียบง่าย: React SPA (tablet-first) → Express API → "),
  run("SQL Server เดียว", {bold:true, color:NAVY}),
  run(" (dbwins_worldfert9: schema "),
  run("wf", {bold:true}),
  run(" read-write + "),
  run("dbo", {bold:true}),
  run(" read-only) — "),
  run("ไม่มี PostgreSQL / Redis / Message Queue / Background worker", {bold:true, color:RED}),
  run(". wf กับ dbo อยู่ฐานข้อมูลเดียวกัน จึง JOIN ข้าม schema ได้ตรง ไม่ต้อง sync/cache"),
]));
children.push(makeTable(
  ["Layer","Technology","หมายเหตุ"],
  [
    ["Frontend","React 19 + Vite + TypeScript + Tailwind v4 + lucide-react","tablet-first iPad"],
    ["Backend","Express (Node 22 LTS) + REST API","JWT auth (jsonwebtoken + bcrypt) · RBAC 7 roles"],
    [{text:"Database",bold:true,color:NAVY},{text:"SQL Server 2022 เท่านั้น (dbwins_worldfert9)",bold:true},"schema wf + dbo"],
    ["DB Driver","mssql + msnodesqlv8 (named-pipe)","ไม่ใช้ ORM · SQLEXPRESS ปิด TCP"],
    ["Realtime","Polling ทุก 5 วินาที (ไม่ใช้ WebSocket / Socket.IO / Redis)","แจ้ง Unlock"],
    ["PDF / QR","Puppeteer / qrcode","เอกสาร 4 สี"],
    ["DevOps","Docker (single host), GitHub Actions","deploy ง่าย"],
  ],
  [1700, 5660, 2000], { fontSize:16, boldFirst:true }
));
children.push(spacer(120));
children.push(h2("9.1 การแบ่ง Phase (ขอบเขตการออกแบบ)"));
children.push(makeTable(
  ["Phase","ขอบเขต","ระยะเวลา (ออกแบบ)"],
  [
    ["Phase 1","SO + Rebate(Accrual/FIFO) + Price Book + ของแถม + ชุดตั๋วคุม + แม่-ลูก + Paper Trail + WS","~30 วันทำการ"],
    ["Phase 2","Gate Pass + TruckScale + Multi-trip + LINE LIFF เต็มรูป","~30 วัน"],
    ["Phase 3","Production Line + MRP + Lot Tracking","~45 วัน"],
  ],
  [1500, 6360, 1500], { fontSize:17, boldFirst:true }
));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 10. RISK ────────────────────────────────────────────────
children.push(h1("10. ความเสี่ยงสำคัญ (Risk — สรุป)"));
children.push(makeTable(
  ["ID","Risk","Score","Mitigation"],
  [
    ["R-01","ลูกค้าให้ access WINSpeed ช้า/ไม่ได้","15","ระบุใน Kickoff/สัญญา, ใช้ mock data ช่วงแรก"],
    ["R-08","Bug critical ใน Rebate Accrual/FIFO","15","unit test 90%+, dual-run 2 สัปดาห์, อิง RBD68-019 เป็น test fixture"],
    ["R-03","Performance ของ query บน WINSpeed DB","12","indexed views, profile week 1, จำกัด JOIN หนัก"],
    ["R-06","Scope creep","12","Change Request, SRS sign-off"],
    ["R-11 ✦","ของแถม/ชุดตั๋ว ข้อมูลเริ่มต้นไม่ครบ","9","import จาก XLS สรุปเบิก, ตั้งงบเริ่มต้นร่วมกับฝ่ายขาย"],
    ["R-12 ✦","Credit Master ไม่มีใน WS (EMCust.CreditAmnt=0)","9","ออกแบบ Credit ใน wf หรือยืนยันยกเลิก Credit Hold (D-02)"],
  ],
  [900, 3800, 900, 3760], { fontSize:16, boldFirst:true }
));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 11. ACCEPTANCE ──────────────────────────────────────────
children.push(h1("11. เกณฑ์การตรวจรับงาน (Acceptance — สรุป)"));
children.push(makeTable(
  ["TS","Scenario","Expected"],
  [
    ["TS-01","สร้าง SO → Confirm → Rebate accrual auto-apply","SO Confirmed, ledger ตั้งถูกต้องตาม (sell-NET)×ตัน, พิมพ์ 4 สี"],
    ["TS-02","ขอ Unlock → คลัง approve","SO กลับ Draft, accrual reversed (ไม่ลบ)"],
    ["TS-03","Weighbridge ยืนยันออเดอร์+น้ำหนัก → Shipped","SOInv เกิดใน WS (SONo=SO.DocuNo), status Shipped"],
    ["TS-05","เบิก Claim 2 ประเภท (รีเบท+ส่วนต่าง)","Claim breakdown ถูก, รออนุมัติ 4 ชั้น, สร้าง CN DocuType=109"],
    ["TS-09","FIFO ตัดข้าม Plan เมื่อ Pool หมด","ตัด Plan ถัดไป, trace ครบ"],
    ["TS-11 ✦","เลือกของแถมเกินงบ","อนุญาต + เตือน + บันทึก, รายงานรายภาคถูก"],
    ["TS-12 ✦","ชุดตั๋วคุม — รับเฉพาะชุด / รับพร้อม","ยอดคงเหลือลดถูกต้อง, รายงานเฉพาะชุดเรียกได้"],
  ],
  [900, 3400, 5060], { fontSize:16, boldFirst:true }
));
children.push(spacer(120));
children.push(callout("Go-Live Criteria",
  ["ทุก FR ผ่าน acceptance 100%, NFR วิกฤตผ่าน, UAT ≥ 90% (no critical bug), training ≥ 80%, backup/restore ทดสอบสำเร็จ"], GREEN, "5E7E45"));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 12. DIAGRAMS ───────────────────────────────────────────
children.push(h1("12. แผนภาพระบบ (Diagrams)"));
children.push(body([run("ไฟล์ต้นฉบับแก้ไขได้: ", {}), run("WorldFert_Diagrams_v4.drawio", {bold:true, color:NAVY}), run(" (เปิดด้วย diagrams.net / drawio) — 8 หน้า")]));
const diagList = [
  ["dg_d01.trim.png","12.1 Swimlane AS-IS — กระบวนการขายปัจจุบัน (Manual + WINSpeed)"],
  ["dg_d02.trim.png","12.2 Swimlane TO-BE — WS-Sale-App + WINSpeed (Non-Invasive)"],
  ["dg_d03.trim.png","12.3 Workflow — สายเอกสาร + DocuType + Join Keys"],
  ["dg_d04.trim.png","12.4 Work Process — SO State Machine (DRAFT→CONFIRMED→PICKING→SHIPPED)"],
  ["dg_d05.trim.png","12.5 DFD — Context (Lv0) & Level 1"],
  ["dg_d06.trim.png","12.6 ER Diagram — schema wf (+ dbo read-only refs)"],
  ["dg_d07.trim.png","12.7 UML Use Case Diagram"],
  ["dg_d08.trim.png","12.8 UML Class Diagram (Domain model)"],
];
diagList.forEach(([f,cap],i)=>{ children.push(h2(cap)); img(f,620,null).forEach(p=>children.push(p));
  if(i<diagList.length-1) children.push(new Paragraph({ children:[new PageBreak()] })); });
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 13. UI/UX DESIGN ───────────────────────────────────────
children.push(h1("13. การออกแบบ UI/UX (ทุกหน้า)"));
children.push(body([run("Tech Stack: ", {bold:true}), run("React + Vite + TypeScript + Tailwind + shadcn/ui (tablet-first). Mockup HTML แก้ไขได้ใน "), run("ui_mockups/*.html", {bold:true, color:NAVY})]));
const uiList = [
  ["ui_login.trim.png","13.1 หน้าเข้าสู่ระบบ (Login) — JWT + RBAC"],
  ["ui_dashboard.trim.png","13.2 Dashboard — ตั๋วคงค้าง aging, สถานะรถ, Rebate, สต๊อก (real-time)"],
  ["ui_sale-order.trim.png","13.3 ใบสั่งขาย (SO) — แม่/ลูก, ของแถม, ทะเบียนรถ, Rebate preview"],
  ["ui_quotation.trim.png","13.4 ใบเสนอราคา — ราคากลาง + แจ้งเตือนต่ำกว่า set price"],
  ["ui_rebate-pool.trim.png","13.5 Rebate Pool — Ledger + FIFO trace"],
  ["ui_rebate-claim.trim.png","13.6 Rebate Claim — 2 ประเภท → CN (109)"],
  ["ui_giveaway.trim.png","13.7 ของแถม — งบ/สต๊อก + เตือนเบิกเกิน"],
  ["ui_control-ticket.trim.png","13.8 ชุดตั๋วคุม — ยอดคงเหลือ + โหมดรับ"],
  ["ui_paper-trail.trim.png","13.9 Paper Trail — Kanban 5 คอลัมน์ + QR"],
  ["ui_approvals.trim.png","13.10 อนุมัติ/Unlock — ตามกฎเฉพาะ (สุรชัย/รุ่งนิรันดร์/3 ผจก.)"],
  ["ui_reports.trim.png","13.11 รายงาน & Dashboard (export Excel/PDF)"],
  ["ui_admin.trim.png","13.12 ผู้ใช้ & สิทธิ์ (RBAC 7 บทบาท)"],
];
uiList.forEach(([f,cap],i)=>{ children.push(h2(cap)); img(f,600,null).forEach(p=>children.push(p));
  if(i<uiList.length-1 && i%1===0) children.push(new Paragraph({ children:[new PageBreak()] })); });
children.push(new Paragraph({ children:[new PageBreak()] }));

// ─── 14. TRACEABILITY ───────────────────────────────────────
children.push(h1("14. Traceability — Requirement ↔ FR"));
children.push(body("ยืนยันว่า FR ครอบคลุมความต้องการของทีมครบ (เทียบ Requirements/, WS Comment, drawio)"));
children.push(makeTable(
  ["เอกสารทีม","ความต้องการ","FR","สถานะ"],
  [
    ["ปัญหาฯ #1","ตันพ่วงแม่-ลูก เรียงลำดับ","FR-019","✅"],
    ["ปัญหาฯ #2","รายงานเฉพาะชุดตั๋วคุม","FR-021","✅"],
    ["ปัญหาฯ #3","ของแถม + เห็นสต็อก","FR-020","✅"],
    ["ปัญหาฯ #4","รับเฉพาะชุด/พร้อมใบสั่งจอง","FR-021","✅"],
    ["ปัญหาฯ #5","Counter-Sales ตรวจซ้ำ","FR-022","✅"],
    ["ความต้องการ","Rebate FIFO แยก Sales","FR-008/009/010/011","✅"],
    ["ความต้องการ","บันทึกบัญชีตาม WINSpeed ดังเดิม","D-03 แนวทาง B","✅"],
    ["WF Comment 2.3","ตั๋วคงค้าง aging (30/45 วัน)","FR-017","✅"],
    ["WF Comment 2.6","สถานะรถ 3 สถานะ","FR-017 + WeighTicket","✅"],
    ["WF Comment 4-5","Approval levels เฉพาะคน","FR-006/007 (5.5)","✅"],
    ["drawio (9 ปัญหา)","Sales/Store/Account","F1-F8","✅"],
  ],
  [1700, 3400, 2660, 1600], { fontSize:15, boldFirst:true }
));
children.push(spacer(120));
children.push(callout("Master Data & Dependencies (ยืนยัน DB จริง)",
  [[run("ปุ๋ย FG = StockFlag='Y' AND ตัน (193) · ของแถม = GoodGroupID NULL · กระสอบ = GoodGroupID=1000", {})],
   [run("รอข้อมูล: DB เครื่องชั่ง (timestamp รถ), DB โรงงาน/เครื่องโม่ (stock real-time)", {})],
   [run("เอกสารหลักฐาน: ใบสั่งจอง I69-01539/K69-01448, Order Form L62452 (ของแถมกระดาษ), คู่มือ Export-Import", {italics:true, color:GRAYTX})]], BLUEBG, NAVY));

children.push(spacer(160));
children.push(new Paragraph({ alignment:AlignmentType.CENTER, spacing:{ before:160 },
  children:[new TextRun({ text:"— จบเอกสาร / End of Document —", font:FONT, size:20, bold:true, color:NAVY })] }));
children.push(new Paragraph({ alignment:AlignmentType.CENTER, spacing:{ before:60 },
  children:[new TextRun({ text:"Software Requirements Specification | World Fert Co., Ltd. | v5.0 (Production — Implemented) | 23 มิ.ย. 2569", font:FONT, size:16, color:GRAYTX })] }));

// ═══════════════════════════════════════════════════════════
// ASSEMBLE DOCUMENT
// ═══════════════════════════════════════════════════════════
const doc = new Document({
  creator:"World Fert", title:"WF-SRS-001 v5.0",
  styles:{ default:{ document:{ run:{ font:FONT, size:20 } } },
    paragraphStyles:[
      { id:"Heading1", name:"Heading 1", basedOn:"Normal", next:"Normal", quickFormat:true,
        run:{ size:30, bold:true, font:FONT, color:NAVY }, paragraph:{ spacing:{before:320,after:160}, outlineLevel:0 } },
      { id:"Heading2", name:"Heading 2", basedOn:"Normal", next:"Normal", quickFormat:true,
        run:{ size:24, bold:true, font:FONT, color:NAVY }, paragraph:{ spacing:{before:240,after:120}, outlineLevel:1 } },
    ] },
  numbering:{ config:[
    { reference:"wfBullets", levels:[{ level:0, format:LevelFormat.BULLET, text:"•", alignment:AlignmentType.LEFT,
      style:{ run:{ font:FONT }, paragraph:{ indent:{ left:560, hanging:280 } } } }] },
    { reference:"wfNumbers", levels:[{ level:0, format:LevelFormat.DECIMAL, text:"%1.", alignment:AlignmentType.LEFT,
      style:{ paragraph:{ indent:{ left:560, hanging:280 } } } }] },
  ] },
  sections:[{
    properties:{ page:{ size:{ width:12240, height:15840 },
      margin:{ top:1440, right:1440, bottom:1440, left:1440 } } },
    footers:{ default: new Footer({ children:[ new Paragraph({ alignment:AlignmentType.CENTER,
      children:[ new TextRun({ text:"WF-SRS-001 v5.0  ·  หน้า ", font:FONT, size:16, color:GRAYTX }),
        new TextRun({ children:[PageNumber.CURRENT], font:FONT, size:16, color:GRAYTX }) ] }) ] }) },
    children,
  }],
});

Packer.toBuffer(doc).then(buf=>{
  fs.writeFileSync("L:\\My Drive\\World Fert\\WorldFert_SRS_v5_0.docx", buf);
  console.log("✅ Saved WorldFert_SRS_v5_0.docx ("+buf.length+" bytes)");
}).catch(e=>{ console.error("❌", e); process.exit(1); });
